import { Router } from 'express';
import {
  getWhatsAppStatus,
  sendWhatsAppTest,
  getPairingCode,
  getWhatsAppGroups,
  sendDirectMessage,
} from '../controllers/whatsapp.controller.js';

const router = Router();

/**
 * @route   GET /api/whatsapp/status
 * @desc    Checks if WhatsApp client is connected, disconnected, or awaiting QR scan
 */
router.get('/status', getWhatsAppStatus);

/**
 * @route   GET /api/whatsapp/groups
 * @desc    Lists all participating WhatsApp groups
 */
router.get('/groups', getWhatsAppGroups);

/**
 * @route   POST /api/whatsapp/send-message
 * @desc    Sends a direct WhatsApp message to any phone number
 */
router.post('/send-message', sendDirectMessage);

/**
 * @route   POST /api/whatsapp/pairing-code
 * @desc    Generates an 8-character Pairing Code to link WhatsApp without QR scanning
 */
router.post('/pairing-code', getPairingCode);

/**
 * @route   POST /api/whatsapp/send-test
 * @desc    Sends a test ping to the user's personal "You" chat to confirm socket delivery
 */
router.post('/send-test', sendWhatsAppTest);

export default router;
