import express from 'express';
import cors from 'cors';
import apiRoutes from './routes/index.js';

const app = express();

// Standard middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount all API routes under /api
app.use('/api', apiRoutes);

// Root greeting
app.get('/', (req, res) => {
  res.json({
    message: 'WhatsApp & Email Outreach Bot API is running',
    docs: '/api/health',
  });
});

export default app;
