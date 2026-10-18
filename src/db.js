const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, BASE_URL } = require('./config');

class Database {
  constructor() {
    this.dataDir = DATA_DIR;
    this.qrCodesFile = path.join(this.dataDir, 'qrcodes.json');
    this.scansFile = path.join(this.dataDir, 'scans.json');
    this.settingsFile = path.join(this.dataDir, 'settings.json');

    this.qrCodes = [];
    this.scans = [];
    this.settings = {
      baseUrl: BASE_URL,
      appName: 'Dynamic QR Studio',
      adminProtection: false,
      adminKey: 'admin123'
    };

    this.qrById = new Map();
    this.qrBySlug = new Map();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.qrCodes = this._loadFile(this.qrCodesFile, []);
    this.scans = this._loadFile(this.scansFile, []);
    this.settings = this._loadFile(this.settingsFile, this.settings);

    this._rebuildIndexes();
    this.initialized = true;
    console.log(`[Database] Loaded ${this.qrCodes.length} QR codes and ${this.scans.length} scan records.`);
  }

  _loadFile(filePath, defaultValue) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error(`[Database] Error reading ${filePath}, using defaults:`, err.message);
    }
    this._saveFile(filePath, defaultValue);
    return defaultValue;
  }

  _saveFile(filePath, data) {
    try {
      const tempPath = `${filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempPath, filePath);
    } catch (err) {
      console.error(`[Database] Error writing to ${filePath}:`, err.message);
    }
  }

  _rebuildIndexes() {
    this.qrById.clear();
    this.qrBySlug.clear();
    for (const qr of this.qrCodes) {
      this.qrById.set(qr.id, qr);
      if (qr.slug) {
        this.qrBySlug.set(qr.slug.toLowerCase(), qr);
      }
    }
  }

  // --- QR Code Methods ---

  getQRCodes({ search, tag, active, sort = 'createdAt', order = 'desc', limit, offset = 0 } = {}) {
    let list = [...this.qrCodes];

    if (search) {
      const s = search.toLowerCase();
      list = list.filter(q =>
        q.title.toLowerCase().includes(s) ||
        q.slug.toLowerCase().includes(s) ||
        q.destinationUrl.toLowerCase().includes(s) ||
        (q.tags && q.tags.some(t => t.toLowerCase().includes(s)))
      );
    }

    if (tag) {
      list = list.filter(q => q.tags && q.tags.includes(tag));
    }

    if (typeof active === 'boolean') {
      list = list.filter(q => q.active === active);
    }

    list.sort((a, b) => {
      let valA = a[sort];
      let valB = b[sort];
      if (sort === 'createdAt' || sort === 'updatedAt' || sort === 'lastScannedAt') {
        valA = valA ? new Date(valA).getTime() : 0;
        valB = valB ? new Date(valB).getTime() : 0;
      }
      if (valA < valB) return order === 'asc' ? -1 : 1;
      if (valA > valB) return order === 'asc' ? 1 : -1;
      return 0;
    });

    const total = list.length;
    if (limit) {
      list = list.slice(offset, offset + limit);
    }

    return { total, items: list };
  }

  getQRCodeById(id) {
    return this.qrById.get(id) || null;
  }

  getQRCodeBySlug(slug) {
    if (!slug) return null;
    return this.qrBySlug.get(slug.toLowerCase()) || null;
  }

  createQRCode(data) {
    const id = crypto.randomUUID();
    const slug = (data.slug || this.generateSlug()).trim().toLowerCase();

    if (this.qrBySlug.has(slug)) {
      throw new Error(`The custom slug "${slug}" is already in use.`);
    }

    const newQR = {
      id,
      slug,
      title: data.title || `QR Code ${slug}`,
      destinationUrl: data.destinationUrl,
      active: data.active !== undefined ? Boolean(data.active) : true,
      tags: Array.isArray(data.tags) ? data.tags : (data.tags ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
      style: {
        fgColor: data.style?.fgColor || '#000000',
        bgColor: data.style?.bgColor || '#ffffff',
        errorCorrectionLevel: data.style?.errorCorrectionLevel || 'M',
        margin: data.style?.margin !== undefined ? Number(data.style.margin) : 2,
        dotStyle: data.style?.dotStyle || 'square'
      },
      expiresAt: data.expiresAt || null,
      totalScans: 0,
      uniqueVisitors: 0,
      lastScannedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.qrCodes.push(newQR);
    this._rebuildIndexes();
    this._saveFile(this.qrCodesFile, this.qrCodes);
    return newQR;
  }

  updateQRCode(id, updates) {
    const qr = this.qrById.get(id);
    if (!qr) return null;

    if (updates.slug && updates.slug.toLowerCase() !== qr.slug.toLowerCase()) {
      const newSlug = updates.slug.trim().toLowerCase();
      const existing = this.qrBySlug.get(newSlug);
      if (existing && existing.id !== id) {
        throw new Error(`The slug "${newSlug}" is already taken.`);
      }
      qr.slug = newSlug;
    }

    if (updates.title !== undefined) qr.title = updates.title;
    if (updates.destinationUrl !== undefined) qr.destinationUrl = updates.destinationUrl;
    if (updates.active !== undefined) qr.active = Boolean(updates.active);
    if (updates.expiresAt !== undefined) qr.expiresAt = updates.expiresAt;

    if (updates.tags !== undefined) {
      qr.tags = Array.isArray(updates.tags) ? updates.tags : updates.tags.split(',').map(t => t.trim()).filter(Boolean);
    }

    if (updates.style) {
      qr.style = {
        ...qr.style,
        ...updates.style
      };
    }

    qr.updatedAt = new Date().toISOString();

    this._rebuildIndexes();
    this._saveFile(this.qrCodesFile, this.qrCodes);
    return qr;
  }

  deleteQRCode(id) {
    const idx = this.qrCodes.findIndex(q => q.id === id);
    if (idx === -1) return false;

    const qr = this.qrCodes[idx];
    this.qrCodes.splice(idx, 1);
    this._rebuildIndexes();
    this._saveFile(this.qrCodesFile, this.qrCodes);

    // Clean up scans for this QR
    this.scans = this.scans.filter(s => s.qrCodeId !== id);
    this._saveFile(this.scansFile, this.scans);
    return true;
  }

  generateSlug(length = 6) {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let slug = '';
    let attempts = 0;
    while (attempts < 50) {
      slug = '';
      for (let i = 0; i < length; i++) {
        slug += chars[Math.floor(Math.random() * chars.length)];
      }
      if (!this.qrBySlug.has(slug)) return slug;
      attempts++;
    }
    return crypto.randomUUID().slice(0, 8);
  }

  // --- Scan Tracking Methods ---

  recordScan(scanData) {
    const id = crypto.randomUUID();
    const qr = this.qrById.get(scanData.qrCodeId);

    const record = {
      id,
      qrCodeId: scanData.qrCodeId,
      slug: scanData.slug,
      timestamp: new Date().toISOString(),
      ipHash: scanData.ipHash || 'unknown',
      userAgent: scanData.userAgent || '',
      device: scanData.device || 'desktop',
      browser: scanData.browser || 'Unknown',
      os: scanData.os || 'Unknown',
      referrer: scanData.referrer || 'Direct',
      country: scanData.country || 'Unknown'
    };

    this.scans.push(record);
    this._saveFile(this.scansFile, this.scans);

    if (qr) {
      qr.totalScans = (qr.totalScans || 0) + 1;
      qr.lastScannedAt = record.timestamp;

      // Calculate unique visitors for this QR
      const uniqueIps = new Set(this.scans.filter(s => s.qrCodeId === qr.id).map(s => s.ipHash));
      qr.uniqueVisitors = uniqueIps.size;

      this._saveFile(this.qrCodesFile, this.qrCodes);
    }

    return record;
  }

  getScansByQRCodeId(qrCodeId, { limit = 100 } = {}) {
    return this.scans
      .filter(s => s.qrCodeId === qrCodeId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  getAllScans({ limit = 100 } = {}) {
    return [...this.scans]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  // --- Settings & Metrics ---

  getSettings() {
    return { ...this.settings };
  }

  updateSettings(updates) {
    this.settings = { ...this.settings, ...updates };
    this._saveFile(this.settingsFile, this.settings);
    return this.settings;
  }

  getOverviewStats() {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const totalQRs = this.qrCodes.length;
    const activeQRs = this.qrCodes.filter(q => q.active).length;
    const totalScans = this.scans.length;

    const todayScans = this.scans.filter(s => s.timestamp.startsWith(todayStr)).length;
    const allUniqueVisitors = new Set(this.scans.map(s => s.ipHash)).size;

    return {
      totalQRs,
      activeQRs,
      inactiveQRs: totalQRs - activeQRs,
      totalScans,
      todayScans,
      uniqueVisitors: allUniqueVisitors
    };
  }
}

const db = new Database();
module.exports = db;
