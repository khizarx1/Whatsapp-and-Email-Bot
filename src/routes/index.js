import { Router } from 'express';
import leadRoutes from './lead.routes.js';
import whatsappRoutes from './whatsapp.routes.js';
import emailRoutes from './email.routes.js';

const router = Router();

// Mount feature-specific sub-routers
router.use('/leads', leadRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/email', emailRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
