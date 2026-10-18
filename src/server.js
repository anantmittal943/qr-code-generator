const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { PORT, BASE_URL } = require('./config');
const db = require('./db');
const apiRouter = require('./routes/api');
const redirectRouter = require('./routes/redirect');

const app = express();
app.set('trust proxy', 1);

// ─── Core Middlewares ────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── DB Init Middleware (MUST come before routes) ────────────────────────────
// Ensures the DB is connected on the first request.  Subsequent calls resolve
// instantly because getDB() caches the MongoClient.
let _initPromise = null;
app.use(async (req, res, next) => {
  try {
    if (!_initPromise) _initPromise = db.init();
    await _initPromise;
    next();
  } catch (err) {
    console.error('[Server] DB init failed:', err.message);
    res.status(503).json({
      error: 'Database unavailable. Check MONGODB_URI environment variable.',
      detail: err.message,
    });
  }
});

// ─── Static Assets (served directly from /public on local; Vercel CDN in prod) ─
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/r', redirectRouter);
app.use('/api', apiRouter);

// ─── SPA Fallback ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/r')) {
    const indexPath = path.join(__dirname, '..', 'public', 'index.html');
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  }
  next();
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// ─── Seed helper ─────────────────────────────────────────────────────────────
async function seedIfEmpty() {
  try {
    const result = db.getQRCodes({ limit: 1 });
    const { total } = result && typeof result.then === 'function'
      ? await result
      : result;

    if (total > 0) return;

    console.log('[Server] Seeding initial sample QR codes…');

    const qrData = [
      { title: 'Company Official Website', destinationUrl: 'https://github.com',          slug: 'website', tags: ['Marketing', 'Official'], style: { fgColor: '#1e293b', bgColor: '#ffffff', errorCorrectionLevel: 'H' } },
      { title: 'Product Launch Promo 2026', destinationUrl: 'https://news.ycombinator.com', slug: 'promo26', tags: ['Campaign', 'Sale'],      style: { fgColor: '#0f766e', bgColor: '#f0fdfa', errorCorrectionLevel: 'Q' } },
      { title: 'Customer Feedback Survey', destinationUrl: 'https://google.com',            slug: 'survey',  tags: ['Support', 'Feedback'],   style: { fgColor: '#7c3aed', bgColor: '#ffffff', errorCorrectionLevel: 'M' } },
    ];

    const created = [];
    for (const d of qrData) {
      const qr = db.createQRCode(d);
      created.push(typeof qr.then === 'function' ? await qr : qr);
    }

    const seedScans = [
      { device: 'mobile',  browser: 'Safari',       os: 'iOS',     referrer: 'instagram.com' },
      { device: 'mobile',  browser: 'Chrome Mobile', os: 'Android', referrer: 'Direct'        },
      { device: 'desktop', browser: 'Chrome',        os: 'Windows', referrer: 'Direct'        },
      { device: 'desktop', browser: 'Firefox',       os: 'macOS',   referrer: 'google.com'    },
      { device: 'tablet',  browser: 'Safari',        os: 'iOS',     referrer: 'twitter.com'   },
      { device: 'mobile',  browser: 'Chrome Mobile', os: 'Android', referrer: 'Direct'        },
    ];

    for (let i = 0; i < seedScans.length; i++) {
      const scan = seedScans[i];
      const target = created[i % created.length];
      const rec = db.recordScan({
        qrCodeId: target.id,
        slug:     target.slug,
        ipHash:   `seed-${i}`,
        userAgent: `Seed Agent/${i}`,
        device:   scan.device,
        browser:  scan.browser,
        os:       scan.os,
        referrer: scan.referrer,
      });
      if (rec && typeof rec.then === 'function') await rec;
    }
  } catch (err) {
    console.warn('[Server] Seeding skipped:', err.message);
  }
}

// ─── Bootstrap (used by local dev + test runner) ─────────────────────────────
async function bootstrap(startListener = true) {
  if (!_initPromise) _initPromise = db.init();
  await _initPromise;
  await seedIfEmpty();

  if (!startListener) return null;

  const server = app.listen(PORT, () => {
    console.log('=======================================================');
    console.log('🚀 Dynamic QR Studio is live!');
    console.log(`📡 Dashboard:    http://localhost:${PORT}`);
    console.log(`🔀 Redirects:    ${BASE_URL}/r/<slug>`);
    console.log(`⚡ API:          http://localhost:${PORT}/api`);
    console.log('=======================================================');
  });

  return server;
}

if (require.main === module) {
  bootstrap(true);
}

module.exports = app;
module.exports.app = app;
module.exports.bootstrap = bootstrap;
