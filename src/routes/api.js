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

/**
 * Resolves the effective base URL for QR codes.
 * Prioritizes stored production settings, then the incoming request host (Render/Vercel),
 * and finally falls back to default settings.
 */
function resolveBaseUrl(req) {
  const settings = db.getSettings();
  if (settings && settings.baseUrl && !settings.baseUrl.includes('localhost')) {
    return settings.baseUrl;
  }
  const host = req.get('host');
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    return `${req.protocol}://${host}`;
  }
  return settings?.baseUrl || null;
}

// Admin authentication middleware (optional, enabled via settings)
async function adminAuthMiddleware(req, res, next) {
  try {
    const settings = await db.getSettings();
    if (!settings.adminProtection) {
      return next();
    }

    const clientKey = req.headers['x-admin-key'] || req.query.key;
    if (!clientKey || clientKey !== settings.adminKey) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing admin key.' });
    }

    next();
  } catch (err) {
    next(err);
  }
}

router.use(adminAuthMiddleware);

// --- Overview & Analytics ---

router.get('/stats', async (req, res) => {
  try {
    const data = await analyticsService.getOverviewMetrics();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- QR Code CRUD ---

router.get('/qr', async (req, res) => {
  try {
    const { search, tag, active, sort, order, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const reqBase = resolveBaseUrl(req);

    let parsedActive;
    if (active === 'true') parsedActive = true;
    if (active === 'false') parsedActive = false;

    const result = await db.getQRCodes({
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
        shortUrl: qrService.getEncodedUrl(qr.slug, reqBase)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/qr', async (req, res) => {
  try {
    const { destinationUrl, title, slug, tags, style, expiresAt, active } = req.body;
    const reqBase = resolveBaseUrl(req);

    if (!destinationUrl) {
      return res.status(400).json({ error: 'destinationUrl is required.' });
    }

    const normUrl = bulkService.normalizeUrl(destinationUrl);
    if (!normUrl) {
      return res.status(400).json({ error: 'Invalid destination URL format.' });
    }

    let parsedExpires = null;
    if (expiresAt) {
      const d = new Date(expiresAt);
      if (!isNaN(d.getTime())) parsedExpires = d.toISOString();
    }

    const qr = await db.createQRCode({
      destinationUrl: normUrl,
      title: title || undefined,
      slug: slug || undefined,
      tags,
      style,
      expiresAt: parsedExpires,
      active
    });

    res.status(201).json({
      ...qr,
      shortUrl: qrService.getEncodedUrl(qr.slug, reqBase)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/qr/:id', async (req, res) => {
  try {
    const qr = await db.getQRCodeById(req.params.id);
    if (!qr) {
      return res.status(404).json({ error: 'QR Code not found.' });
    }
    res.json({
      ...qr,
      shortUrl: qrService.getEncodedUrl(qr.slug, resolveBaseUrl(req))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/qr/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.destinationUrl) {
      const normUrl = bulkService.normalizeUrl(updates.destinationUrl);
      if (!normUrl) {
        return res.status(400).json({ error: 'Invalid destination URL format.' });
      }
      updates.destinationUrl = normUrl;
    }

    if (updates.expiresAt !== undefined) {
      if (updates.expiresAt) {
        const d = new Date(updates.expiresAt);
        updates.expiresAt = !isNaN(d.getTime()) ? d.toISOString() : null;
      } else {
        updates.expiresAt = null;
      }
    }

    const updated = await db.updateQRCode(req.params.id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'QR Code not found.' });
    }

    res.json({
      ...updated,
      shortUrl: qrService.getEncodedUrl(updated.slug, resolveBaseUrl(req))
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/qr/:id', async (req, res) => {
  try {
    const success = await db.deleteQRCode(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'QR Code not found.' });
    }
    res.json({ message: 'QR Code and related scans deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Image Generation & Downloads ---

router.get('/qr/:id/preview', async (req, res) => {
  try {
    const qr = await db.getQRCodeById(req.params.id);
    if (!qr) return res.status(404).send('Not Found');

    const format = (req.query.format || 'png').toLowerCase();
    const shortUrl = qrService.getEncodedUrl(qr.slug, resolveBaseUrl(req));
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
    const qr = await db.getQRCodeById(req.params.id);
    if (!qr) return res.status(404).send('Not Found');

    const format = (req.query.format || 'png').toLowerCase();
    const size = req.query.size ? Number(req.query.size) : 1024;
    const shortUrl = qrService.getEncodedUrl(qr.slug, resolveBaseUrl(req));
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

router.get('/qr/:id/analytics', async (req, res) => {
  try {
    const data = await analyticsService.getQRAnalytics(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'QR Code not found.' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Bulk Operations ---

router.post('/bulk/create', async (req, res) => {
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

    const result = await bulkService.processBulkCreation(listToProcess);
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
    .on('end', async () => {
      try {
        const result = await bulkService.processBulkCreation(rows);
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
    await bulkService.streamZipArchive(res, { qrIds: ids, format, baseUrl: resolveBaseUrl(req) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/bulk/export-csv', async (req, res) => {
  try {
    const csvContent = await bulkService.generateCSV(resolveBaseUrl(req));
    res.attachment(`qr-codes-${Date.now()}.csv`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Settings ---

router.get('/settings', async (req, res) => {
  try {
    const current = await db.getSettings();
    const effectiveBaseUrl = (current.baseUrl && !current.baseUrl.includes('localhost'))
      ? current.baseUrl
      : (resolveBaseUrl(req) || current.baseUrl);
    res.json({
      baseUrl: effectiveBaseUrl,
      appName: current.appName,
      adminProtection: current.adminProtection
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const { baseUrl, appName, adminProtection, adminKey } = req.body;
    const updates = {};
    if (baseUrl !== undefined) updates.baseUrl = baseUrl.replace(/\/+$/, '');
    if (appName !== undefined) updates.appName = appName;
    if (adminProtection !== undefined) updates.adminProtection = Boolean(adminProtection);
    if (adminKey !== undefined && adminKey.trim()) updates.adminKey = adminKey.trim();

    const saved = await db.updateSettings(updates);
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
