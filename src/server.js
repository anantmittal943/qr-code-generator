const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT, BASE_URL } = require('./config');
const db = require('./db');
const apiRouter = require('./routes/api');
const redirectRouter = require('./routes/redirect');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static Assets (Dashboard SPA)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Redirection Engine
app.use('/r', redirectRouter);

// REST API
app.use('/api', apiRouter);

// Fallback for SPA routing
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/r')) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  next();
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// Lazy database initialization for serverless environments (like Vercel)
let initPromise = null;
function ensureInitialized() {
  if (!initPromise) {
    initPromise = db.init();
  }
  return initPromise;
}

app.use(async (req, res, next) => {
  try {
    await ensureInitialized();
    next();
  } catch (err) {
    next(err);
  }
});

// Bootstrap & Seed Initial Data if empty
async function bootstrap(startListener = true) {
  await ensureInitialized();

  const { total } = db.getQRCodes();
  if (total === 0) {
    console.log('[Server] Seeding initial sample dynamic QR codes...');
    const qr1 = db.createQRCode({
      title: 'Company Official Website',
      destinationUrl: 'https://github.com',
      slug: 'website',
      tags: ['Marketing', 'Official'],
      style: { fgColor: '#1e293b', bgColor: '#ffffff', errorCorrectionLevel: 'H' }
    });

    const qr2 = db.createQRCode({
      title: 'Product Launch Promo 2026',
      destinationUrl: 'https://news.ycombinator.com',
      slug: 'promo26',
      tags: ['Campaign', 'Sale'],
      style: { fgColor: '#0f766e', bgColor: '#f0fdfa', errorCorrectionLevel: 'Q' }
    });

    const qr3 = db.createQRCode({
      title: 'Customer Feedback Survey',
      destinationUrl: 'https://google.com',
      slug: 'survey',
      tags: ['Support', 'Feedback'],
      style: { fgColor: '#7c3aed', bgColor: '#ffffff', errorCorrectionLevel: 'M' }
    });

    const seedScans = [
      { device: 'mobile', browser: 'Safari', os: 'iOS', referrer: 'instagram.com' },
      { device: 'mobile', browser: 'Chrome Mobile', os: 'Android', referrer: 'Direct' },
      { device: 'desktop', browser: 'Chrome', os: 'Windows', referrer: 'Direct' },
      { device: 'desktop', browser: 'Firefox', os: 'macOS', referrer: 'google.com' },
      { device: 'tablet', browser: 'Safari', os: 'iOS', referrer: 'twitter.com' },
      { device: 'mobile', browser: 'Chrome Mobile', os: 'Android', referrer: 'Direct' }
    ];

    for (let i = 0; i < seedScans.length; i++) {
      const scan = seedScans[i];
      const targetQR = (i % 2 === 0) ? qr1 : (i % 3 === 0 ? qr2 : qr3);
      db.recordScan({
        qrCodeId: targetQR.id,
        slug: targetQR.slug,
        ipHash: `ip-hash-${i}`,
        userAgent: `Sample Agent ${i}`,
        device: scan.device,
        browser: scan.browser,
        os: scan.os,
        referrer: scan.referrer
      });
    }
  }

  if (!startListener) {
    return null;
  }

  const server = app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Dynamic QR Code Generator Server is live!`);
    console.log(`📡 Dashboard UI:   http://localhost:${PORT}`);
    console.log(`🔀 Redirection:   ${BASE_URL}/r/<slug>`);
    console.log(`⚡ API Endpoints:  http://localhost:${PORT}/api`);
    console.log(`=======================================================`);
  });

  return server;
}

if (require.main === module) {
  bootstrap(true);
}

module.exports = app;
module.exports.app = app;
module.exports.bootstrap = bootstrap;
