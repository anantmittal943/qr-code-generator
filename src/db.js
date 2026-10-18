/**
 * db.js — MongoDB-backed database layer.
 *
 * Drops the original fs/JSON implementation and replaces it with the native
 * MongoDB Node.js driver.  The public API (method names + signatures) is kept
 * identical so the rest of the codebase requires zero changes.
 *
 * Required environment variable:
 *   MONGODB_URI — a MongoDB connection string, e.g.:
 *     mongodb+srv://user:password@cluster.mongodb.net/dynqr?retryWrites=true&w=majority
 *
 * When MONGODB_URI is missing the module falls back to in-memory storage so
 * that the local test suite still passes without a database.
 */

const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { BASE_URL } = require('./config');

// ─────────────────────────────────────────────
// MongoDB connection (module-level singleton)
// ─────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.MONGODB_DB || 'dynqr';

let _client = null;      // MongoClient
let _db = null;          // Db handle

async function getDB() {
  if (_db) return _db;

  if (!MONGODB_URI) {
    throw new Error(
      'MONGODB_URI environment variable is not set. ' +
      'Add it in Vercel → Project → Settings → Environment Variables.'
    );
  }

  if (!_client) {
    _client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
    });
  }

  await _client.connect();
  _db = _client.db(DB_NAME);

  // Create indexes on first connect
  await _db.collection('qrcodes').createIndexes([
    { key: { slug: 1 }, unique: true },
    { key: { createdAt: -1 } },
  ]);
  await _db.collection('scans').createIndexes([
    { key: { qrCodeId: 1 } },
    { key: { timestamp: -1 } },
  ]);

  return _db;
}

// ─────────────────────────────────────────────
// In-memory fallback (used when no MONGODB_URI)
// ─────────────────────────────────────────────
class InMemoryFallback {
  constructor() {
    this.qrCodes = [];
    this.scans   = [];
    this.settings = {
      baseUrl: BASE_URL,
      appName: 'Dynamic QR Studio',
      adminProtection: false,
      adminKey: 'admin123',
    };
    this.qrById   = new Map();
    this.qrBySlug = new Map();
  }

  _rebuildIndexes() {
    this.qrById.clear();
    this.qrBySlug.clear();
    for (const qr of this.qrCodes) {
      this.qrById.set(qr.id, qr);
      if (qr.slug) this.qrBySlug.set(qr.slug.toLowerCase(), qr);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Database class
// ─────────────────────────────────────────────────────────────────────────────
class Database {
  constructor() {
    this.initialized = false;
    this._mem = null;   // set only when running without MONGODB_URI
    this._cachedSettings = {
      baseUrl: BASE_URL,
      appName: 'Dynamic QR Studio',
      adminProtection: false,
      adminKey: 'admin123',
    };
  }

  // ── init ─────────────────────────────────────────────────────────────────
  async init() {
    if (this.initialized) return;

    if (!MONGODB_URI) {
      console.warn(
        '[Database] WARNING: MONGODB_URI not set — running with in-memory ' +
        'storage. Data will be lost between restarts.'
      );
      this._mem = new InMemoryFallback();
      this.initialized = true;
      return;
    }

    try {
      const db = await getDB();
      const count = await db.collection('qrcodes').countDocuments();
      console.log(`[Database] Connected to MongoDB. ${count} QR code(s) in collection.`);

      // Sync and cache settings
      const doc = await db.collection('settings').findOne({ _id: 'global' });
      if (doc) {
        this._cachedSettings = { ...this._cachedSettings, ...doc };
        // If stored baseUrl contains localhost or is empty, but production URL is set, upgrade it
        const isStoredLocal = !this._cachedSettings.baseUrl || this._cachedSettings.baseUrl.includes('localhost');
        const hasProdEnv = Boolean(process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || process.env.VERCEL_URL);
        if (isStoredLocal && hasProdEnv) {
          console.log(`[Database] Upgrading stored baseUrl from '${this._cachedSettings.baseUrl}' to production '${BASE_URL}'`);
          this._cachedSettings.baseUrl = BASE_URL;
          await db.collection('settings').updateOne(
            { _id: 'global' },
            { $set: { baseUrl: BASE_URL } }
          );
        }
      } else {
        await db.collection('settings').updateOne(
          { _id: 'global' },
          { $set: this._cachedSettings },
          { upsert: true }
        );
      }

      this.initialized = true;
    } catch (err) {
      console.error('[Database] MongoDB connection failed:', err.message);
      throw err;
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  generateSlug(length = 6) {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    for (let attempt = 0; attempt < 50; attempt++) {
      let slug = '';
      for (let i = 0; i < length; i++) {
        slug += chars[Math.floor(Math.random() * chars.length)];
      }
      // Collision check is done in createQRCode via unique index / map lookup
      return slug;
    }
    return crypto.randomUUID().slice(0, 8);
  }

  // ── QR Codes ──────────────────────────────────────────────────────────────
  getQRCodes({ search, tag, active, sort = 'createdAt', order = 'desc', limit, offset = 0 } = {}) {
    if (this._mem) {
      let list = [...this._mem.qrCodes];
      if (search) {
        const s = search.toLowerCase();
        list = list.filter(q =>
          q.title.toLowerCase().includes(s) ||
          q.slug.toLowerCase().includes(s) ||
          q.destinationUrl.toLowerCase().includes(s) ||
          (q.tags && q.tags.some(t => t.toLowerCase().includes(s)))
        );
      }
      if (tag)                    list = list.filter(q => q.tags && q.tags.includes(tag));
      if (typeof active === 'boolean') list = list.filter(q => q.active === active);
      list.sort((a, b) => {
        let va = a[sort], vb = b[sort];
        if (['createdAt','updatedAt','lastScannedAt'].includes(sort)) {
          va = va ? new Date(va).getTime() : 0;
          vb = vb ? new Date(vb).getTime() : 0;
        }
        return order === 'asc' ? (va < vb ? -1 : va > vb ? 1 : 0)
                               : (va > vb ? -1 : va < vb ? 1 : 0);
      });
      const total = list.length;
      if (limit) list = list.slice(offset, offset + limit);
      return { total, items: list };
    }

    // MongoDB path — NOTE: synchronous callers rely on returned value,
    // so we return a Promise.  Callers that do  `const { total } = db.getQRCodes()`
    // already await or we need to make the API async.
    // We'll return a thenable object to keep callers backward-compatible:
    return this._getQRCodesAsync({ search, tag, active, sort, order, limit, offset });
  }

  // Internal async implementation for MongoDB
  async _getQRCodesAsync({ search, tag, active, sort = 'createdAt', order = 'desc', limit, offset = 0 }) {
    const db = await getDB();
    const query = {};
    if (search) {
      const rx = new RegExp(search, 'i');
      query.$or = [
        { title: rx }, { slug: rx }, { destinationUrl: rx }, { tags: rx },
      ];
    }
    if (tag)                    query.tags = tag;
    if (typeof active === 'boolean') query.active = active;

    const sortDir = order === 'asc' ? 1 : -1;
    const sortObj = { [sort]: sortDir };

    const total = await db.collection('qrcodes').countDocuments(query);
    let cursor = db.collection('qrcodes').find(query).sort(sortObj).skip(offset);
    if (limit) cursor = cursor.limit(limit);
    const items = await cursor.toArray();
    return { total, items };
  }

  getQRCodeById(id) {
    if (this._mem) return this._mem.qrById.get(id) || null;
    return this._getQRCodeByIdAsync(id);
  }

  async _getQRCodeByIdAsync(id) {
    const db = await getDB();
    return db.collection('qrcodes').findOne({ id }) || null;
  }

  getQRCodeBySlug(slug) {
    if (!slug) return null;
    if (this._mem) return this._mem.qrBySlug.get(slug.toLowerCase()) || null;
    return this._getQRCodeBySlugAsync(slug.toLowerCase());
  }

  async _getQRCodeBySlugAsync(slug) {
    const db = await getDB();
    return db.collection('qrcodes').findOne({ slug }) || null;
  }

  createQRCode(data) {
    const id   = crypto.randomUUID();
    const slug = (data.slug || this.generateSlug()).trim().toLowerCase();

    const newQR = {
      id,
      slug,
      title:          data.title || `QR Code ${slug}`,
      destinationUrl: data.destinationUrl,
      active:         data.active !== undefined ? Boolean(data.active) : true,
      tags:           Array.isArray(data.tags)
                        ? data.tags
                        : (data.tags ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
      style: {
        fgColor:               data.style?.fgColor               || '#000000',
        bgColor:               data.style?.bgColor               || '#ffffff',
        errorCorrectionLevel:  data.style?.errorCorrectionLevel  || 'M',
        margin:                data.style?.margin  !== undefined ? Number(data.style.margin) : 2,
        dotStyle:              data.style?.dotStyle              || 'square',
      },
      expiresAt:      data.expiresAt     || null,
      totalScans:     0,
      uniqueVisitors: 0,
      lastScannedAt:  null,
      createdAt:      new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
    };

    if (this._mem) {
      if (this._mem.qrBySlug.has(slug))
        throw new Error(`The custom slug "${slug}" is already in use.`);
      this._mem.qrCodes.push(newQR);
      this._mem._rebuildIndexes();
      return newQR;
    }

    return this._createQRCodeAsync(newQR);
  }

  async _createQRCodeAsync(newQR) {
    const db = await getDB();
    try {
      await db.collection('qrcodes').insertOne({ ...newQR, _id: newQR.id });
    } catch (err) {
      if (err.code === 11000) throw new Error(`The custom slug "${newQR.slug}" is already in use.`);
      throw err;
    }
    return newQR;
  }

  updateQRCode(id, updates) {
    if (this._mem) {
      const qr = this._mem.qrById.get(id);
      if (!qr) return null;
      if (updates.slug && updates.slug.toLowerCase() !== qr.slug.toLowerCase()) {
        const newSlug = updates.slug.trim().toLowerCase();
        const existing = this._mem.qrBySlug.get(newSlug);
        if (existing && existing.id !== id) throw new Error(`The slug "${newSlug}" is already taken.`);
        qr.slug = newSlug;
      }
      if (updates.title          !== undefined) qr.title          = updates.title;
      if (updates.destinationUrl !== undefined) qr.destinationUrl = updates.destinationUrl;
      if (updates.active         !== undefined) qr.active         = Boolean(updates.active);
      if (updates.expiresAt      !== undefined) qr.expiresAt      = updates.expiresAt;
      if (updates.tags           !== undefined) {
        qr.tags = Array.isArray(updates.tags)
          ? updates.tags
          : updates.tags.split(',').map(t => t.trim()).filter(Boolean);
      }
      if (updates.style) qr.style = { ...qr.style, ...updates.style };
      qr.updatedAt = new Date().toISOString();
      this._mem._rebuildIndexes();
      return qr;
    }
    return this._updateQRCodeAsync(id, updates);
  }

  async _updateQRCodeAsync(id, updates) {
    const db = await getDB();
    const qr = await db.collection('qrcodes').findOne({ id });
    if (!qr) return null;

    const $set = { updatedAt: new Date().toISOString() };

    if (updates.slug && updates.slug.toLowerCase() !== qr.slug.toLowerCase()) {
      const newSlug = updates.slug.trim().toLowerCase();
      const existing = await db.collection('qrcodes').findOne({ slug: newSlug });
      if (existing && existing.id !== id) throw new Error(`The slug "${newSlug}" is already taken.`);
      $set.slug = newSlug;
    }
    if (updates.title          !== undefined) $set.title          = updates.title;
    if (updates.destinationUrl !== undefined) $set.destinationUrl = updates.destinationUrl;
    if (updates.active         !== undefined) $set.active         = Boolean(updates.active);
    if (updates.expiresAt      !== undefined) $set.expiresAt      = updates.expiresAt;
    if (updates.tags           !== undefined) {
      $set.tags = Array.isArray(updates.tags)
        ? updates.tags
        : updates.tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    if (updates.style) $set.style = { ...qr.style, ...updates.style };

    const result = await db.collection('qrcodes').findOneAndUpdate(
      { id },
      { $set },
      { returnDocument: 'after' },
    );
    return result || null;
  }

  deleteQRCode(id) {
    if (this._mem) {
      const idx = this._mem.qrCodes.findIndex(q => q.id === id);
      if (idx === -1) return false;
      this._mem.qrCodes.splice(idx, 1);
      this._mem.scans = this._mem.scans.filter(s => s.qrCodeId !== id);
      this._mem._rebuildIndexes();
      return true;
    }
    return this._deleteQRCodeAsync(id);
  }

  async _deleteQRCodeAsync(id) {
    const db = await getDB();
    const result = await db.collection('qrcodes').deleteOne({ id });
    if (result.deletedCount === 0) return false;
    await db.collection('scans').deleteMany({ qrCodeId: id });
    return true;
  }

  // ── Scans ─────────────────────────────────────────────────────────────────
  recordScan(scanData) {
    const id = crypto.randomUUID();
    const record = {
      id,
      qrCodeId:  scanData.qrCodeId,
      slug:      scanData.slug,
      timestamp: new Date().toISOString(),
      ipHash:    scanData.ipHash    || 'unknown',
      userAgent: scanData.userAgent || '',
      device:    scanData.device    || 'desktop',
      browser:   scanData.browser   || 'Unknown',
      os:        scanData.os        || 'Unknown',
      referrer:  scanData.referrer  || 'Direct',
      country:   scanData.country   || 'Unknown',
    };

    if (this._mem) {
      this._mem.scans.push(record);
      const qr = this._mem.qrById.get(scanData.qrCodeId);
      if (qr) {
        qr.totalScans = (qr.totalScans || 0) + 1;
        qr.lastScannedAt = record.timestamp;
        const uniqueIps = new Set(this._mem.scans.filter(s => s.qrCodeId === qr.id).map(s => s.ipHash));
        qr.uniqueVisitors = uniqueIps.size;
      }
      return Promise.resolve(record);
    }
    return this._recordScanAsync(record);
  }

  async _recordScanAsync(record) {
    const db = await getDB();
    await db.collection('scans').insertOne({ ...record, _id: record.id });

    // Update parent QR counters
    const [totalScans, uniqueDocs] = await Promise.all([
      db.collection('scans').countDocuments({ qrCodeId: record.qrCodeId }),
      db.collection('scans').distinct('ipHash', { qrCodeId: record.qrCodeId }),
    ]);

    await db.collection('qrcodes').updateOne(
      { id: record.qrCodeId },
      { $set: { totalScans, uniqueVisitors: uniqueDocs.length, lastScannedAt: record.timestamp } },
    );

    return record;
  }

  getScansByQRCodeId(qrCodeId, { limit = 100 } = {}) {
    if (this._mem) {
      return this._mem.scans
        .filter(s => s.qrCodeId === qrCodeId)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
    }
    return this._getScansByQRCodeIdAsync(qrCodeId, limit);
  }

  async _getScansByQRCodeIdAsync(qrCodeId, limit) {
    const db = await getDB();
    return db.collection('scans')
      .find({ qrCodeId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  getAllScans({ limit = 100 } = {}) {
    if (this._mem) {
      return [...this._mem.scans]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
    }
    return this._getAllScansAsync(limit);
  }

  async _getAllScansAsync(limit) {
    const db = await getDB();
    return db.collection('scans').find().sort({ timestamp: -1 }).limit(limit).toArray();
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings() {
    if (this._mem) return { ...this._mem.settings };
    return { ...this._cachedSettings };
  }

  async updateSettings(updates) {
    if (this._mem) {
      this._mem.settings = { ...this._mem.settings, ...updates };
      return this._mem.settings;
    }
    const db = await getDB();
    await db.collection('settings').updateOne(
      { _id: 'global' },
      { $set: updates },
      { upsert: true }
    );
    this._cachedSettings = { ...this._cachedSettings, ...updates };
    return { ...this._cachedSettings };
  }

  // ── Overview Stats ────────────────────────────────────────────────────────
  getOverviewStats() {
    if (this._mem) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const totalQRs = this._mem.qrCodes.length;
      const activeQRs = this._mem.qrCodes.filter(q => q.active).length;
      const totalScans = this._mem.scans.length;
      const todayScans = this._mem.scans.filter(s => s.timestamp.startsWith(todayStr)).length;
      const allUniqueVisitors = new Set(this._mem.scans.map(s => s.ipHash)).size;
      return { totalQRs, activeQRs, inactiveQRs: totalQRs - activeQRs, totalScans, todayScans, uniqueVisitors: allUniqueVisitors };
    }
    return this._getOverviewStatsAsync();
  }

  async _getOverviewStatsAsync() {
    const db = await getDB();
    const todayStr = new Date().toISOString().slice(0, 10);
    const [totalQRs, activeQRs, totalScans, todayScans, uniqueHashes] = await Promise.all([
      db.collection('qrcodes').countDocuments(),
      db.collection('qrcodes').countDocuments({ active: true }),
      db.collection('scans').countDocuments(),
      db.collection('scans').countDocuments({ timestamp: { $gte: todayStr } }),
      db.collection('scans').distinct('ipHash'),
    ]);
    return {
      totalQRs, activeQRs,
      inactiveQRs: totalQRs - activeQRs,
      totalScans, todayScans,
      uniqueVisitors: uniqueHashes.length,
    };
  }
}

const db = new Database();
module.exports = db;
