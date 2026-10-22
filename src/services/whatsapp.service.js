import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import path from 'path';

let sock = null;
let connectionState = {
  status: 'DISCONNECTED', // 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTED'
  qr: null,
  userJid: null,
  lastError: null,
};

const AUTH_FOLDER = path.resolve('auth_info_baileys');

/**
 * Initializes and connects the Baileys WhatsApp client.
 */
export async function initWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    console.log(`[WhatsApp] Initializing Baileys v${version.join('.')} (Latest: ${isLatest})`);

    const usePairingCode = Boolean(process.env.WHATSAPP_PHONE_NUMBER);

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }), // Suppress internal socket chatter
      auth: state,
      browser: Browsers.ubuntu('Chrome'), // Spoofs official desktop browser to avoid block
      printQRInTerminal: false,
    });

    // If phone number is configured and not registered yet, generate an 8-digit Pairing Code
    if (usePairingCode && !state.creds.registered) {
      setTimeout(async () => {
        try {
          const rawPhone = process.env.WHATSAPP_PHONE_NUMBER.replace(/[^0-9]/g, '');
          console.log(`[WhatsApp] Requesting Pairing Code for phone: ${rawPhone}...`);
          const pairingCode = await sock.requestPairingCode(rawPhone);
          console.log('\n======================================================');
          console.log(`  🔑 YOUR WHATSAPP PAIRING CODE IS: ${pairingCode}`);
          console.log('  1. Open WhatsApp -> Linked Devices -> Link a Device');
          console.log('  2. Tap "Link with phone number instead" at the bottom');
          console.log(`  3. Enter this code: ${pairingCode}`);
          console.log('======================================================\n');
        } catch (pairErr) {
          console.error('[WhatsApp Pairing Code Error]:', pairErr.message);
        }
      }, 3500);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionState.status = 'SCAN_QR';
        connectionState.qr = qr;
        console.log('\n======================================================');
        console.log('  SCAN THIS QR CODE IN WHATSAPP (Linked Devices):');
        console.log('======================================================\n');
        qrcode.generate(qr, { small: true });
        console.log('\n======================================================\n');
      }

      if (connection === 'close') {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        const reason = lastDisconnect?.error?.message || 'Connection closed';

        connectionState.status = 'DISCONNECTED';
        connectionState.lastError = reason;
        console.log(`[WhatsApp] Connection closed. Reason: ${reason}. Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(initWhatsApp, 5000); // Reconnect after 5s
        }
      } else if (connection === 'open') {
        const rawJid = sock.user?.id || '';
        const userJid = rawJid.includes(':')
          ? `${rawJid.split(':')[0]}@s.whatsapp.net`
          : rawJid;

        connectionState.status = 'CONNECTED';
        connectionState.userJid = userJid;
        connectionState.lastError = null;
        connectionState.qr = null;

        console.log(`\n✅ [WhatsApp] Connected successfully! Logged in as: ${userJid}\n`);
      }
    });

    return sock;
  } catch (error) {
    console.error('[WhatsApp Init Error]:', error);
    connectionState.status = 'DISCONNECTED';
    connectionState.lastError = error.message;
    throw error;
  }
}

/**
 * Returns the current live status of WhatsApp connection.
 */
export function getConnectionStatus() {
  return {
    ...connectionState,
    hasActiveSocket: !!sock,
  };
}

/**
 * Resolves the destination JID for alert notifications.
 * Priority:
 * 1. An explicit JID or phone set in WHATSAPP_NOTIFICATION_CHAT (.env)
 * 2. A WhatsApp Group named "whatsapp bot" (case-insensitive)
 * 3. Default fallback: personal "You" chat
 */
export async function resolveNotificationJid() {
  const customTarget = process.env.WHATSAPP_NOTIFICATION_CHAT?.trim();

  // 1. If explicit JID or phone number is configured
  if (customTarget) {
    if (customTarget.includes('@g.us') || customTarget.includes('@s.whatsapp.net')) {
      return customTarget;
    }
    const cleanDigits = customTarget.replace(/[^0-9]/g, '');
    if (cleanDigits.length >= 7) {
      return `${cleanDigits}@s.whatsapp.net`;
    }
  }

  // 2. Check if user created a group named "WhatsApp Bot" (or matching customTarget)
  try {
    const groups = await sock.groupFetchAllParticipating();
    const groupList = Object.values(groups);
    const searchTarget = (customTarget || 'whatsapp bot').toLowerCase();

    const matchingGroup = groupList.find(
      (g) => g.subject && g.subject.toLowerCase().includes(searchTarget)
    );

    if (matchingGroup) {
      console.log(`[WhatsApp] Routing alerts to Group: "${matchingGroup.subject}" (${matchingGroup.id})`);
      return matchingGroup.id;
    }
  } catch (err) {
    console.warn('[WhatsApp] Could not inspect group list:', err.message);
  }

  // 3. Fallback to "You" chat
  return connectionState.userJid;
}

/**
 * Lists all WhatsApp groups the user is currently participating in.
 */
export async function listParticipatingGroups() {
  if (!sock || connectionState.status !== 'CONNECTED') {
    return [];
  }
  try {
    const groups = await sock.groupFetchAllParticipating();
    return Object.values(groups).map((g) => ({
      id: g.id,
      name: g.subject,
      participantsCount: g.participants?.length || 0,
    }));
  } catch (err) {
    console.error('[WhatsApp listGroups Error]:', err.message);
    return [];
  }
}

/**
 * Sends a notification message for special events (Email replies received, batch finished, failures).
 * Automatically delivers to your designated "WhatsApp Bot" group or chat!
 */
export async function sendToUserChat(text) {
  if (!sock || connectionState.status !== 'CONNECTED') {
    console.warn('[WhatsApp] Cannot send notification: Socket not connected.');
    return { success: false, reason: 'WhatsApp socket not connected' };
  }

  const targetJid = await resolveNotificationJid();
  if (!targetJid) {
    throw new Error('Notification target JID could not be resolved.');
  }

  const result = await sock.sendMessage(targetJid, { text });
  console.log(`[WhatsApp] Dispatched notification to ${targetJid}`);
  return { success: true, targetJid, result };
}

/**
 * Generates an 8-digit Pairing Code for a given phone number.
 */
export async function requestPairingCodeForPhone(phoneNumber) {
  if (!sock) {
    throw new Error('WhatsApp socket not initialized.');
  }
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  const code = await sock.requestPairingCode(cleanPhone);
  return code;
}

/**
 * Cleans an international phone number and formats it into a WhatsApp JID.
 * E.g., "+44 20 3959 9123" -> "442039599123@s.whatsapp.net"
 */
export function formatPhoneToJid(phone) {
  if (!phone) return null;
  const digitsOnly = phone.replace(/[^0-9]/g, '');
  if (digitsOnly.length < 7) return null;
  return `${digitsOnly}@s.whatsapp.net`;
}

/**
 * Sends a direct WhatsApp message to any phone number.
 */
export async function sendDirectWhatsApp(phone, message) {
  if (!sock || connectionState.status !== 'CONNECTED') {
    throw new Error('WhatsApp socket is not connected. Scan QR code first.');
  }

  const targetJid = formatPhoneToJid(phone);
  if (!targetJid) {
    throw new Error(`Invalid or incomplete phone number: "${phone}"`);
  }

  const result = await sock.sendMessage(targetJid, { text: message });
  console.log(`[WhatsApp] Sent direct message to ${targetJid}`);
  return { success: true, jid: targetJid, result };
}

/**
 * Sends a personalized WhatsApp outreach message to a lead.
 */
export async function sendWhatsAppToLead(lead, customMessage = null) {
  if (!sock || connectionState.status !== 'CONNECTED') {
    throw new Error('WhatsApp socket is not connected. Scan QR code first.');
  }

  const leadJid = formatPhoneToJid(lead.phone);
  if (!leadJid) {
    throw new Error(`Invalid or missing phone number: "${lead.phone}"`);
  }

  const company = lead.companyName || 'your team';
  const city = lead.city ? ` in ${lead.city}` : '';

  const messageText =
    customMessage ||
    `Hello ${company},\n\nHope you're having a productive week. We noticed your legal practice${city} and wanted to briefly reach out regarding your immigration client workflows.\n\nWould you be open to a quick 5-minute chat this week?\n\nBest regards,\nKhizar`;

  const result = await sock.sendMessage(leadJid, { text: messageText });
  console.log(`[WhatsApp] Sent outreach to ${lead.companyName} (${leadJid})`);
  return { success: true, jid: leadJid, result };
}
