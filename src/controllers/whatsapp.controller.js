import * as whatsappService from '../services/whatsapp.service.js';

/**
 * GET /api/whatsapp/status
 * Returns connection state of the Baileys WhatsApp client.
 */
export async function getWhatsAppStatus(req, res) {
  try {
    const status = whatsappService.getConnectionStatus();
    return res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('[getWhatsAppStatus Error]:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * GET /api/whatsapp/groups
 * Lists all participating WhatsApp groups to easily find group IDs.
 */
export async function getWhatsAppGroups(req, res) {
  try {
    const groups = await whatsappService.listParticipatingGroups();
    return res.json({
      success: true,
      count: groups.length,
      groups,
    });
  } catch (error) {
    console.error('[getWhatsAppGroups Error]:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * POST /api/whatsapp/send-message
 * Sends a direct WhatsApp message to any specified phone number.
 */
export async function sendDirectMessage(req, res) {
  try {
    const { phone, message } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Please provide a valid "phone" number.' });
    }
    if (!message) {
      return res.status(400).json({ error: 'Please provide a "message" string.' });
    }

    const result = await whatsappService.sendDirectWhatsApp(phone, message);
    return res.json({
      success: true,
      message: `Message successfully sent to ${phone}.`,
      result,
    });
  } catch (error) {
    console.error('[sendDirectMessage Error]:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * POST /api/whatsapp/pairing-code
 * Generates an 8-digit Pairing Code to link WhatsApp using your phone number instead of scanning a QR code.
 */
export async function getPairingCode(req, res) {
  try {
    const { phoneNumber } = req.body;
    const phone = phoneNumber || process.env.WHATSAPP_PHONE_NUMBER;

    if (!phone) {
      return res.status(400).json({
        error: 'Please provide a valid "phoneNumber" with country code (e.g. 923001234567).',
      });
    }

    const code = await whatsappService.requestPairingCodeForPhone(phone);
    return res.json({
      success: true,
      message: 'Pairing code generated. Enter this in your WhatsApp app under "Link with phone number instead".',
      pairingCode: code,
    });
  } catch (error) {
    console.error('[getPairingCode Error]:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * POST /api/whatsapp/send-test
 * Sends a direct test message to the user's personal "You" chat.
 */
export async function sendWhatsAppTest(req, res) {
  try {
    const { message } = req.body;
    const testMessage =
      message ||
      `🤖 *WhatsApp Bot Connection Test*\n\nIf you see this message in your "You" chat, the Baileys socket is connected and ready to send outreach alerts!`;

    const result = await whatsappService.sendToUserChat(testMessage);
    return res.json({
      success: true,
      message: 'Test message dispatched to your WhatsApp "You" chat.',
      result,
    });
  } catch (error) {
    console.error('[sendWhatsAppTest Error]:', error);
    return res.status(500).json({ error: error.message });
  }
}
