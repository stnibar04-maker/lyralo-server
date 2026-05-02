import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import webhookRoutes from './routes/webhooks.js';
import adminRoutes from './routes/admin.js';
import customerRoutes from './routes/customer.js';
import { startPoller } from './jobs/poller.js';
import { query } from './lib/db.js';
import { requireAdmin } from './lib/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Webhook routes need raw body — mount BEFORE express.json()
app.use('/webhooks', webhookRoutes);

// Standard middleware for everything else
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// API routes
app.use('/api/admin', adminRoutes);
app.use('/api/customer', customerRoutes);

// Health check
app.get('/healthz', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, time: new Date().toISOString() });
  } catch {
    res.status(500).json({ ok: false });
  }
});

// Static frontend
app.use(express.static(join(__dirname, 'public')));

// Pretty routes for the SPA pages
app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'track.html')));
app.get('/track', (req, res) => res.sendFile(join(__dirname, 'public', 'track.html')));
app.get('/login', (req, res) => res.sendFile(join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => {
  // Soft-redirect to /login if no auth cookie
  if (!req.cookies?.lyralo_admin) return res.redirect('/login');
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[err]', err);
  res.status(500).json({ error: 'internal' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ Lyralo server listening on :${PORT}`);
  if (process.env.START_POLLER !== 'false') startPoller();
});
