import { Router } from 'express';
import {
  getEmailStatus,
  sendEmailTest,
} from '../controllers/email.controller.js';

const router = Router();

/**
 * @route   GET /api/email/status
 * @desc    Checks status of SMTP outbound sender and IMAP inbound reply listener
 */
router.get('/status', getEmailStatus);

/**
 * @route   POST /api/email/send-test
 * @desc    Sends a test email to verify SMTP credentials (App Password)
 */
router.post('/send-test', sendEmailTest);

export default router;
