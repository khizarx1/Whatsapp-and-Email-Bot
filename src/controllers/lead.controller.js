import * as whatsappService from '../services/whatsapp.service.js';
import * as emailService from '../services/email.service.js';
import * as sheetsService from '../services/sheets.service.js';

/**
 * Core outreach dispatcher for a single lead record.
 * Coordinates Email, WhatsApp, "You" chat alert, and Sheet status update.
 */
export async function executeLeadOutreach(lead, rowNumber) {
  const results = {
    companyName: lead.companyName || 'Unknown Company',
    row: rowNumber,
    emailSent: false,
    whatsAppSent: false,
    errors: [],
  };

  // 1. Send Email (if email exists)
  if (lead.email && lead.email.trim() !== '') {
    try {
      await emailService.sendEmailToLead(lead);
      results.emailSent = true;
    } catch (err) {
      console.error(`[Email Error] Failed to send to ${lead.email}:`, err.message);
      results.errors.push(`Email error: ${err.message}`);
    }
  }

  // 2. Send WhatsApp (if phone exists)
  if (lead.phone && lead.phone.trim() !== '') {
    try {
      await whatsappService.sendWhatsAppToLead(lead);
      results.whatsAppSent = true;
    } catch (err) {
      console.error(`[WhatsApp Error] Failed to send to ${lead.phone}:`, err.message);
      results.errors.push(`WhatsApp error: ${err.message}`);
    }
  }

  // 3. Special Event Notifications:
  // (Per user requirement: Standard sends do not notify WhatsApp; alerts are reserved for Responses, Batch completions, or Failures)
  if (results.errors.length > 0) {
    try {
      const errorAlert = [
        `⚠️ *Outreach Warning / Failure*`,
        `🏢 Lead: ${lead.companyName || 'Unknown'}`,
        `❌ Errors: ${results.errors.join(', ')}`,
      ].join('\n');
      await whatsappService.sendToUserChat(errorAlert);
    } catch (err) {
      console.error(`[Notification Error] Could not alert 'You' chat:`, err.message);
    }
  }

  // 4. Update the Google Sheet row status to 'Contacted'
  try {
    const newStatus = results.emailSent || results.whatsAppSent ? 'Contacted' : 'Failed';
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await sheetsService.updateLeadStatus(rowNumber, newStatus, `Outreach completed at ${timestamp}`);
  } catch (err) {
    console.error(`[Sheet Update Error] Could not update row ${rowNumber}:`, err.message);
  }

  return results;
}

/**
 * POST /api/leads/webhook
 * Handles incoming webhooks when a cell or status is modified in Google Sheets.
 */
export async function handleSheetWebhook(req, res) {
  try {
    const { row, status, leadData } = req.body;

    if (!row) {
      return res.status(400).json({ error: 'Missing required "row" field in webhook body.' });
    }

    // Trigger outreach when status changes to 'Ready to Contact' or 'Trigger Outreach'
    const triggerStatuses = ['ready to contact', 'trigger outreach', 'send'];
    const normalizedStatus = (status || '').toLowerCase().trim();

    if (!triggerStatuses.includes(normalizedStatus)) {
      return res.json({
        success: true,
        message: `Status '${status}' is not a trigger state. No action taken.`,
      });
    }

    // If lead data was not sent directly in webhook payload, read it from the Sheet
    const lead = leadData || (await sheetsService.getLeadByRow(row));

    if (!lead) {
      return res.status(404).json({ error: `Lead at row ${row} could not be found.` });
    }

    const result = await executeLeadOutreach(lead, row);
    return res.json({ success: true, message: 'Outreach executed successfully', result });
  } catch (error) {
    console.error('[handleSheetWebhook Error]:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * POST /api/leads/trigger-single
 * Trigger outreach manually for a specific lead row.
 */
export async function triggerSingleLead(req, res) {
  try {
    const { row } = req.body;
    if (!row) {
      return res.status(400).json({ error: 'Please provide a valid "row" number.' });
    }

    const lead = await sheetsService.getLeadByRow(row);
    if (!lead) {
      return res.status(404).json({ error: `No lead found at row ${row}.` });
    }

    const result = await executeLeadOutreach(lead, row);
    return res.json({ success: true, result });
  } catch (error) {
    console.error('[triggerSingleLead Error]:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * POST /api/leads/trigger-batch
 * Scans Sheet for leads matching targetStatus and dispatches outreach with a polite delay between each.
 */
export async function triggerBatchLeads(req, res) {
  try {
    const { targetStatus = 'Ready to Contact', limit = 10, delaySeconds = 25 } = req.body;

    const matchedLeads = await sheetsService.getLeadsByStatus(targetStatus, limit);

    if (!matchedLeads || matchedLeads.length === 0) {
      return res.json({
        success: true,
        message: `No leads found with status '${targetStatus}'.`,
        processed: 0,
      });
    }

    // Process asynchronously so the API responds without timing out
    res.json({
      success: true,
      message: `Batch job initiated for ${matchedLeads.length} leads.`,
      leadsToProcess: matchedLeads.length,
    });

    // Run queue in background with safety delays
    (async () => {
      for (const { lead, rowNumber } of matchedLeads) {
        console.log(`[Batch Engine] Processing lead at row ${rowNumber}: ${lead.companyName}`);
        await executeLeadOutreach(lead, rowNumber);

        // Delay to avoid WhatsApp spam triggers and rate limits
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
      }
      console.log(`[Batch Engine] Completed batch of ${matchedLeads.length} leads.`);

      // Special Event Notification: Batch Run Completed
      try {
        await whatsappService.sendToUserChat(
          `🏁 *Batch Run Finished!*\n\n• Successfully processed: ${matchedLeads.length} leads\n• Target status was: "${targetStatus}"`
        );
      } catch (err) {
        console.error('[Notification Error] Could not send batch completion alert:', err.message);
      }
    })().catch((err) => console.error('[Batch Background Error]:', err));
  } catch (error) {
    console.error('[triggerBatchLeads Error]:', error);
    return res.status(500).json({ error: error.message });
  }
}
