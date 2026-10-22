import nodemailer from 'nodemailer';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import * as whatsappService from './whatsapp.service.js';
import * as sheetsService from './sheets.service.js';

let transporter = null;
let imapConnection = null;
let isListenerActive = false;
let isChecking = false;
let lastSeenUid = 0;
const processedUids = new Set();

/**
 * Creates and verifies the outbound Nodemailer SMTP transporter.
 */
export function getTransporter() {
  if (!transporter) {
    const user = process.env.EMAIL_USER?.trim();
    const pass = process.env.EMAIL_PASS?.trim().replace(/\s+/g, '');

    if (!user || !pass) {
      console.warn('[Email] EMAIL_USER or EMAIL_PASS not set in environment.');
      return null;
    }

    transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: { user, pass },
    });
  }
  return transporter;
}

/**
 * Checks connectivity of outbound SMTP transporter.
 */
export async function checkEmailHealth() {
  const mailer = getTransporter();
  let smtpStatus = 'not_configured';

  if (mailer) {
    try {
      await mailer.verify();
      smtpStatus = 'connected';
    } catch (err) {
      smtpStatus = `error: ${err.message}`;
    }
  }

  return {
    smtp: smtpStatus,
    imapListener: isListenerActive ? 'active' : 'inactive',
  };
}

/**
 * Sends a personalized outbound email to a lead.
 */
export async function sendEmailToLead(lead, customSubject = null, customHtml = null) {
  const mailer = getTransporter();
  if (!mailer) {
    throw new Error('Email transporter not configured. Please check EMAIL_USER and EMAIL_PASS in .env.');
  }

  const to = lead.email;
  if (!to || !to.includes('@')) {
    throw new Error(`Invalid email address: "${to}"`);
  }

  const company = lead.companyName || 'Legal Team';
  const city = lead.city ? ` in ${lead.city}` : '';
  const subject = customSubject || `Inquiry regarding legal practice workflows - ${company}`;

  const html =
    customHtml ||
    `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <p>Dear ${company},</p>
      <p>I hope this email finds you well.</p>
      <p>I came across your legal practice${city} and was impressed by your track record in immigration services. We help legal firms streamline their intake workflows and automate client communication.</p>
      <p>Would you be open to a quick 5-minute conversation sometime this week to see if this could benefit your team?</p>
      <br/>
      <p>Best regards,<br/><strong>Khizar</strong></p>
    </div>
  `;

  const info = await mailer.sendMail({
    from: `"Khizar" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });

  console.log(`[Email] Dispatched email to ${company} (${to}) - MessageId: ${info.messageId}`);
  return info;
}

/**
 * Sends a self-test email to verify credentials.
 */
export async function sendTestEmail(recipient) {
  const mailer = getTransporter();
  if (!mailer) {
    throw new Error('Email transporter not configured. Please check EMAIL_USER and EMAIL_PASS in .env.');
  }

  return await mailer.sendMail({
    from: `"Outreach Bot" <${process.env.EMAIL_USER}>`,
    to: recipient,
    subject: '🤖 Email Bot Self-Test Successful',
    text: 'If you received this message, your outbound Nodemailer configuration is working properly!',
  });
}

/**
 * Starts the IMAP real-time listener for incoming email replies.
 * When a reply arrives, it triggers an instant WhatsApp alert to your personal "You" chat!
 */
export async function startEmailReplyListener() {
  const user = process.env.EMAIL_USER?.trim();
  const password = process.env.EMAIL_PASS?.trim().replace(/\s+/g, '');

  if (!user || !password) {
    console.warn('[IMAP Listener] Cannot start listener: EMAIL_USER or EMAIL_PASS missing.');
    return;
  }

  const imapConfig = {
    imap: {
      user,
      password,
      host: process.env.IMAP_HOST || 'imap.gmail.com',
      port: parseInt(process.env.IMAP_PORT || '993', 10),
      tls: process.env.IMAP_TLS !== 'false',
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
      keepalive: {
        interval: 2000,
        idleInterval: 10000,
        forceNoop: false,
      },
    },
  };

  try {
    console.log('[IMAP Listener] Connecting to email inbox...');
    imapConnection = await imaps.connect(imapConfig);
    isListenerActive = true;
    console.log('✅ [IMAP Listener] Connected! Listening for incoming lead responses...');

    const box = await imapConnection.openBox('INBOX');

    // Initialize lastSeenUid to capture recent incoming messages
    if (!lastSeenUid) {
      lastSeenUid = Math.max(1, (box.uidnext || 1) - 2);
      console.log(`[IMAP Listener] Watching INBOX from UID ${lastSeenUid} (Next UID: ${box.uidnext})`);
    }

    // Run immediate check for new replies
    await checkNewReplies();

    // Listen to raw node-imap socket events for sub-second triggers
    if (imapConnection.imap) {
      imapConnection.imap.on('mail', async () => {
        await checkNewReplies();
      });
      imapConnection.imap.on('update', async () => {
        await checkNewReplies();
      });
    }

    // High-frequency 2.5s fallback poller to ensure near-zero latency
    const pollInterval = setInterval(async () => {
      if (isListenerActive && imapConnection) {
        await checkNewReplies();
      } else {
        clearInterval(pollInterval);
      }
    }, 2500);

    imapConnection.on('error', (err) => {
      console.error('[IMAP Listener Error]:', err.message);
      isListenerActive = false;
      clearInterval(pollInterval);
    });

    imapConnection.on('close', () => {
      console.log('[IMAP Listener] Connection closed. Attempting reconnect in 10s...');
      isListenerActive = false;
      clearInterval(pollInterval);
      setTimeout(startEmailReplyListener, 10000);
    });
  } catch (error) {
    console.error('[IMAP Listener] Failed to start:', error.message);
    isListenerActive = false;
  }
}

/**
 * Strips quoted history and MIME artifacts into clean, readable text.
 */
function cleanEmailText(text) {
  if (!text) return '(No message text)';
  const lines = text.split(/\r?\n/);
  const cleanLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Stop at quoted reply headers
    if (
      /^On .+ wrote:$/i.test(trimmed) ||
      /^---------- Forwarded message ---------/i.test(trimmed) ||
      /^From: /i.test(trimmed)
    ) {
      break;
    }
    // Skip quoted lines starting with '>'
    if (trimmed.startsWith('>')) {
      continue;
    }
    cleanLines.push(line);
  }

  const result = cleanLines.join('\n').trim();
  return result.slice(0, 500) || text.trim().slice(0, 300);
}

/**
 * Fetches recent unread messages and sends WhatsApp notification to user's "You" chat.
 */
async function checkNewReplies() {
  if (!imapConnection || !isListenerActive || isChecking) return;

  isChecking = true;
  try {
    const searchStart = lastSeenUid + 1;
    const searchCriteria = [['UID', `${searchStart}:*`]];
    const fetchOptions = { bodies: [''], markSeen: false };

    const messages = await imapConnection.search(searchCriteria, fetchOptions);

    if (!messages || messages.length === 0) return;

    for (const item of messages) {
      const uid = item.attributes?.uid;

      // Skip already processed messages or older UIDs
      if (!uid || processedUids.has(uid) || uid <= lastSeenUid) {
        continue;
      }

      processedUids.add(uid);
      lastSeenUid = Math.max(lastSeenUid, uid);

      // Keep cache size bounded
      if (processedUids.size > 2000) {
        const oldest = Array.from(processedUids).slice(0, 1000);
        oldest.forEach((id) => processedUids.delete(id));
      }

      const all = item.parts.find((part) => part.which === '');
      const parsed = all ? await simpleParser(all.body) : null;

      if (!parsed) continue;

      const senderName = parsed.from?.value?.[0]?.name || parsed.from?.text || 'Unknown Sender';
      const senderEmail = parsed.from?.value?.[0]?.address || '';
      const subject = parsed.subject || '(No Subject)';
      const cleanMessage = cleanEmailText(parsed.text);

      const myEmail = process.env.EMAIL_USER?.toLowerCase().trim();

      // Ignore self-sent emails and internal system tests
      if (
        (senderEmail && myEmail && senderEmail.toLowerCase() === myEmail) ||
        subject.includes('Self-Test') ||
        subject.includes('🤖 Email Bot')
      ) {
        continue;
      }

      console.log(`[IMAP Listener] ⚡ Reply detected from ${senderName}: "${subject}"`);

      // Clean, simple, readable WhatsApp alert format
      const alertText = [
        `📩 *New Email Reply*`,
        ``,
        `*From:* ${senderName}${senderEmail ? ` (${senderEmail})` : ''}`,
        `*Subject:* ${subject}`,
        ``,
        `*Message:*`,
        `${cleanMessage}`,
      ].join('\n');

      try {
        await whatsappService.sendToUserChat(alertText);
        console.log(`[WhatsApp] ⚡ Alert dispatched to group!`);
      } catch (waErr) {
        console.error(`[WhatsApp Alert Error]:`, waErr.message);
      }

      // Automatically mark lead as 'Replied' in database / Sheet
      if (senderEmail) {
        try {
          await sheetsService.markLeadAsReplied(senderEmail);
        } catch (sheetErr) {
          console.error(`[Sheet Update Error]:`, sheetErr.message);
        }
      }
    }
  } catch (err) {
    console.error('[checkNewReplies Error]:', err.message);
  } finally {
    isChecking = false;
  }
}
