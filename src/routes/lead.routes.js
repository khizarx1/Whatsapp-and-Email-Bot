import { Router } from 'express';
import {
  handleSheetWebhook,
  triggerSingleLead,
  triggerBatchLeads,
} from '../controllers/lead.controller.js';

const router = Router();

/**
 * @route   POST /api/leads/webhook
 * @desc    Receives real-time Google Sheet edit events when a status cell changes
 */
router.post('/webhook', handleSheetWebhook);

/**
 * @route   POST /api/leads/trigger-single
 * @desc    Manually triggers WhatsApp + Email outreach for a specific lead by row number or ID
 */
router.post('/trigger-single', triggerSingleLead);

/**
 * @route   POST /api/leads/trigger-batch
 * @desc    Triggers outreach for all leads with a matching status (e.g. "Ready to Contact")
 */
router.post('/trigger-batch', triggerBatchLeads);

export default router;
