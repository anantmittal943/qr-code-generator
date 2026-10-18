const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const router = express.Router();

const db = require('../db');
const qrService = require('../services/qrService');
const analyticsService = require('../services/analyticsService');
const bulkService = require('../services/bulkService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Admin authentication middleware (optional, enabled via settings)
function adminAuthMiddleware(req, res, next) {
  const settings = db.getSettings();
  if (!settings.adminProtection) {
    return next();
  }

  const clientKey = req.headers['x-admin-key'] || req.query.key;
  if (!clientKey || clientKey !== settings.adminKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing admin key.' });
  }

  next();
}

router.use(adminAuthMiddleware);

// --- Overview & Analytics ---

router.get('/stats', (req, res) => {
  try {
    const data = analyticsService.getOverviewMetrics();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- QR Code CRUD ---

router.get('/qr', (req, res) => {
  try {
    const { search, tag, active, sort, order, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let parsedActive;
    if (active === 'true') parsedActive = true;
    if (active === 'false') parsedActive = false;

    const result = db.getQRCodes({
      search,
      tag,
      active: parsedActive,
      sort,
      order,
      limit: Number(limit),
      offset
    });

    res.json({
      total: result.total,
      page: Number(page),
      limit: Number(limit),
      items: result.items.map(qr => ({
        ...qr,
        shortUrl: qrService.getEncodedUrl(qr.slug)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/qr', async (req, res) => {
  try {
    const { destinationUrl, title, slug, tags, style, expiresAt, active } = req.body;

    if (!destinationUrl) {
      return res.status(400).json({ error: 'destinationUrl is required.' });
    }

    const normUrl = bulkService.normalizeUrl(destinationUrl);
    if (!normUrl) {
      return res.status(400).json({ error: 'Invalid destination URL format.' });
    }

    const qr = db.createQRCode({
      destinationUrl: normUrl,
      title: title || undefined,
      slug: slug || undefined,
      tags,
      style,
      expiresAt,
      active
    });

    res.status(201).json({
      ...qr,
      shortUrl: qrService.getEncodedUrl(qr.slug)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/qr/:id', (req, res) => {
  const qr = db.getQRCodeById(req.params.id);
  if (!qr) {
    return res.status(404).json({ error: 'QR Code not found.' });
  }
  res.json({
    ...qr,
    shortUrl: qrService.getEncodedUrl(qr.slug)
  });
});

router.put('/qr/:id', (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.destinationUrl) {
      const normUrl = bulkService.normalizeUrl(updates.destinationUrl);
      if (!normUrl) {
        return res.status(400).json({ error: 'Invalid destination URL format.' });
      }
      updates.destinationUrl = normUrl;
    }

    const updated = db.updateQRCode(req.params.id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'QR Code not found.' });
    }

    res.json({
      ...updated,
      shortUrl: qrService.getEncodedUrl(updated.slug)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/qr/:id', (req, res) => {
  const success = db.deleteQRCode(req.params.id);
  if (!success) {
    return res.status(404).json({ error: 'QR Code not found.' });
  }
  res.json({ message: 'QR Code and related scans deleted successfully.' });
});

// --- Image Generation & Downloads ---

router.get('/qr/:id/preview', async (req, res) => {
  try {
    const qr = db.getQRCodeById(req.params.id);
    if (!qr) return res.status(404).send('Not Found');

    const format = (req.query.format || 'png').toLowerCase();
    const shortUrl = qrService.getEncodedUrl(qr.slug);
    const style = {
      ...qr.style,
      width: req.query.size ? Number(req.query.size) : 300,
      margin: req.query.margin ? Number(req.query.margin) : (qr.style?.margin || 2)
    };

    if (format === 'svg') {
      const svg = await qrService.toSVG(shortUrl, style);
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svg);
    } else {
      const buffer = await qrService.toPngBuffer(shortUrl, style);
      res.setHeader('Content-Type', 'image/png');
      return res.send(buffer);
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get('/qr/:id/download', async (req, res) => {
  try {
    const qr = db.getQRCodeById(req.params.id);
    if (!qr) return res.status(404).send('Not Found');

    const format = (req.query.format || 'png').toLowerCase();
    const size = req.query.size ? Number(req.query.size) : 1024;
    const shortUrl = qrService.getEncodedUrl(qr.slug);
    const safeTitle = (qr.title || qr.slug).replace(/[^a-z0-9_-]/gi, '_');
    const filename = `${qr.slug}-${safeTitle}.${format}`;

    const style = {
      ...qr.style,
      width: size
    };

    if (format === 'svg') {
      const svg = await qrService.toSVG(shortUrl, style);
      res.attachment(filename);
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svg);
    } else {
      const buffer = await qrService.toPngBuffer(shortUrl, style);
      res.attachment(filename);
      res.setHeader('Content-Type', 'image/png');
      return res.send(buffer);
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Live QR generation endpoint for instant preview in dashboard
router.get('/preview-custom', async (req, res) => {
  try {
    const text = req.query.text || 'https://example.com';
    const fgColor = req.query.fgColor || '#000000';
    const bgColor = req.query.bgColor || '#ffffff';
    const errorCorrectionLevel = req.query.errorCorrectionLevel || 'M';
    const format = req.query.format || 'png';

    const opts = { fgColor, bgColor, errorCorrectionLevel, width: 320, margin: 2 };

    if (format === 'svg') {
      const svg = await qrService.toSVG(text, opts);
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svg);
    } else {
      const buffer = await qrService.toPngBuffer(text, opts);
      res.setHeader('Content-Type', 'image/png');
      return res.send(buffer);
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// --- Analytics Endpoint ---

router.get('/qr/:id/analytics', (req, res) => {
  const data = analyticsService.getQRAnalytics(req.params.id);
  if (!data) {
    return res.status(404).json({ error: 'QR Code not found.' });
  }
  res.json(data);
});

// --- Bulk Operations ---

router.post('/bulk/create', (req, res) => {
  try {
    const { items, text } = req.body;
    let listToProcess = [];

    if (Array.isArray(items)) {
      listToProcess = items;
    } else if (text && typeof text === 'string') {
      listToProcess = bulkService.parseTextLines(text);
    } else {
      return res.status(400).json({ error: 'Provide either an "items" array or "text" lines.' });
    }

    if (listToProcess.length === 0) {
      return res.status(400).json({ error: 'No items found to process.' });
    }

    const result = bulkService.processBulkCreation(listToProcess);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please upload a CSV file.' });
  }

  const rows = [];
  const stream = Readable.from(req.file.buffer);

  stream
    .pipe(csv())
    .on('data', data => rows.push(data))
    .on('end', () => {
      try {
        const result = bulkService.processBulkCreation(rows);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    })
    .on('error', err => {
      res.status(400).json({ error: `Failed to parse CSV file: ${err.message}` });
    });
});

router.get('/bulk/export', async (req, res) => {
  try {
    const format = req.query.format || 'all';
    const ids = req.query.ids ? req.query.ids.split(',') : null;
    await bulkService.streamZipArchive(res, { qrIds: ids, format });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/bulk/export-csv', (req, res) => {
  try {
    const csvContent = bulkService.generateCSV();
    res.attachment(`qr-codes-${Date.now()}.csv`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Settings ---

router.get('/settings', (req, res) => {
  const current = db.getSettings();
  res.json({
    baseUrl: current.baseUrl,
    appName: current.appName,
    adminProtection: current.adminProtection
  });
});

router.put('/settings', (req, res) => {
  try {
    const { baseUrl, appName, adminProtection, adminKey } = req.body;
    const updates = {};
    if (baseUrl !== undefined) updates.baseUrl = baseUrl.replace(/\/+$/, '');
    if (appName !== undefined) updates.appName = appName;
    if (adminProtection !== undefined) updates.adminProtection = Boolean(adminProtection);
    if (adminKey !== undefined && adminKey.trim()) updates.adminKey = adminKey.trim();

    const saved = db.updateSettings(updates);
    res.json({
      baseUrl: saved.baseUrl,
      appName: saved.appName,
      adminProtection: saved.adminProtection,
      message: 'Settings updated successfully.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
