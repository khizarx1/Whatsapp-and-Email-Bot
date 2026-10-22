import * as emailService from '../services/email.service.js';

/**
 * GET /api/email/status
 * Returns connection state of the SMTP outbound sender & IMAP inbound listener.
 */
export async function getEmailStatus(req, res) {
  try {
    const status = await emailService.checkEmailHealth();
    return res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('[getEmailStatus Error]:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * POST /api/email/send-test
 * Sends a self-test email to verify SMTP configuration and App Password.
 */
export async function sendEmailTest(req, res) {
  try {
    const { to } = req.body;
    const recipient = to || process.env.EMAIL_USER;

    if (!recipient) {
      return res.status(400).json({
        error: 'No recipient provided and EMAIL_USER environment variable is not set.',
      });
    }

    const result = await emailService.sendTestEmail(recipient);
    return res.json({
      success: true,
      message: `Test email successfully sent to ${recipient}.`,
      result,
    });
  } catch (error) {
    console.error('[sendEmailTest Error]:', error);
    return res.status(500).json({ error: error.message });
  }
}
