import 'dotenv/config';
import app from './app.js';
import { initWhatsApp } from './services/whatsapp.service.js';
import { startEmailReplyListener } from './services/email.service.js';

const PORT = process.env.PORT || 3000;

// Start Express HTTP Server
const server = app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Outreach Engine running at http://localhost:${PORT}`);
  console.log(`📋 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`======================================================\n`);

  // 1. Initialize WhatsApp Baileys Client
  try {
    console.log('[System] Initializing WhatsApp Baileys engine...');
    await initWhatsApp();
  } catch (err) {
    console.error('[System] WhatsApp initialization error:', err.message);
  }

  // 2. Initialize IMAP Inbound Email Reply Listener
  try {
    console.log('[System] Initializing Email Reply listener...');
    await startEmailReplyListener();
  } catch (err) {
    console.error('[System] Email listener initialization error:', err.message);
  }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[System] Gracefully shutting down...');
  server.close(() => {
    process.exit(0);
  });
});
