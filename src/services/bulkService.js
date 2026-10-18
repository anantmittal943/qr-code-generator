const archiver = require('archiver');
const db = require('../db');
const qrService = require('./qrService');

class BulkService {
  /**
   * Cleans and ensures valid HTTP/HTTPS protocol
   */
  normalizeUrl(rawUrl) {
    if (!rawUrl) return '';
    let trimmed = rawUrl.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = `https://${trimmed}`;
    }
    try {
      new URL(trimmed);
      return trimmed;
    } catch {
      return '';
    }
  }

  /**
   * Processes a list of items for bulk creation (async)
   */
  async processBulkCreation(items) {
    const results = {
      total: items.length,
      successCount: 0,
      failedCount: 0,
      created: [],
      errors: []
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rawUrl = item.destinationUrl || item.destination_url || item.url || item.target || '';
      const normUrl = this.normalizeUrl(rawUrl);

      if (!normUrl) {
        results.failedCount++;
        results.errors.push({
          index: i + 1,
          item,
          error: `Invalid destination URL: "${rawUrl}"`
        });
        continue;
      }

      const title = (item.title || item.name || `QR Code ${i + 1}`).trim();
      let customSlug = (item.slug || item.custom_slug || '').trim().toLowerCase();

      // Check if custom slug already exists; if so, make unique
      if (customSlug && await db.getQRCodeBySlug(customSlug)) {
        customSlug = `${customSlug}-${Math.random().toString(36).slice(2, 6)}`;
      }

      const tags = item.tags ? (Array.isArray(item.tags) ? item.tags : item.tags.split(',').map(t => t.trim())) : [];
      const fgColor = item.fgColor || item.fg_color || item.color || '#000000';
      const bgColor = item.bgColor || item.bg_color || '#ffffff';

      try {
        const qr = await db.createQRCode({
          title,
          destinationUrl: normUrl,
          slug: customSlug || undefined,
          tags,
          style: {
            fgColor,
            bgColor,
            errorCorrectionLevel: item.errorCorrectionLevel || 'M'
          }
        });
        results.successCount++;
        results.created.push(qr);
      } catch (err) {
        results.failedCount++;
        results.errors.push({
          index: i + 1,
          item,
          error: err.message
        });
      }
    }

    return results;
  }

  /**
   * Parses raw lines of text into QR code creation entries
   */
  parseTextLines(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const items = [];

    for (const line of lines) {
      if (line.startsWith('#')) continue; // comments

      // Formats: "Title | URL | Slug", "Title, URL", or just "URL"
      if (line.includes('|')) {
        const parts = line.split('|').map(p => p.trim());
        items.push({
          title: parts[0],
          destinationUrl: parts[1],
          slug: parts[2] || undefined
        });
      } else if (line.includes(',') && !line.startsWith('http')) {
        const parts = line.split(',').map(p => p.trim());
        items.push({
          title: parts[0],
          destinationUrl: parts[1],
          slug: parts[2] || undefined
        });
      } else {
        items.push({
          title: `QR Code ${items.length + 1}`,
          destinationUrl: line
        });
      }
    }

    return items;
  }

  /**
   * Exports QR codes to a ZIP archive stream (async)
   */
  async streamZipArchive(res, { qrIds, format = 'all', baseUrl } = {}) {
    let list;
    if (Array.isArray(qrIds) && qrIds.length > 0) {
      list = (await Promise.all(qrIds.map(id => db.getQRCodeById(id)))).filter(Boolean);
    } else {
      list = (await db.getQRCodes()).items;
    }

    if (list.length === 0) {
      throw new Error('No QR codes available to export.');
    }

    const archiverModule = require('archiver');
    const archive = archiverModule.ZipArchive
      ? new archiverModule.ZipArchive({ zlib: { level: 9 } })
      : archiverModule('zip', { zlib: { level: 9 } });

    res.attachment(`qr-codes-export-${Date.now()}.zip`);
    res.setHeader('Content-Type', 'application/zip');
    archive.pipe(res);

    // Add metadata summary CSV
    const csvRows = ['ID,Title,Slug,Short_URL,Destination_URL,Total_Scans,Unique_Visitors,Active,Created_At'];
    for (const qr of list) {
      const shortUrl = qrService.getEncodedUrl(qr.slug, baseUrl);
      csvRows.push([
        `"${qr.id}"`,
        `"${(qr.title || '').replace(/"/g, '""')}"`,
        `"${qr.slug}"`,
        `"${shortUrl}"`,
        `"${(qr.destinationUrl || '').replace(/"/g, '""')}"`,
        qr.totalScans || 0,
        qr.uniqueVisitors || 0,
        qr.active,
        `"${qr.createdAt}"`
      ].join(','));
    }
    archive.append(csvRows.join('\r\n'), { name: 'manifest.csv' });

    // Add QR code images
    for (const qr of list) {
      const shortUrl = qrService.getEncodedUrl(qr.slug, baseUrl);
      const safeTitle = (qr.title || qr.slug).replace(/[^a-z0-9_-]/gi, '_').slice(0, 30);
      const baseFilename = `${qr.slug}-${safeTitle}`;

      if (format === 'png' || format === 'all') {
        const pngBuf = await qrService.toPngBuffer(shortUrl, {
          width: 1024,
          fgColor: qr.style?.fgColor,
          bgColor: qr.style?.bgColor,
          errorCorrectionLevel: qr.style?.errorCorrectionLevel,
          margin: qr.style?.margin
        });
        archive.append(pngBuf, { name: `png/${baseFilename}.png` });
      }

      if (format === 'svg' || format === 'all') {
        const svgStr = await qrService.toSVG(shortUrl, {
          fgColor: qr.style?.fgColor,
          bgColor: qr.style?.bgColor,
          errorCorrectionLevel: qr.style?.errorCorrectionLevel,
          margin: qr.style?.margin
        });
        archive.append(svgStr, { name: `svg/${baseFilename}.svg` });
      }
    }

    await archive.finalize();
  }

  /**
   * Generates a CSV string of all QR codes (async)
   */
  async generateCSV(baseUrl) {
    const list = (await db.getQRCodes()).items;
    const csvRows = ['ID,Title,Slug,Short_URL,Destination_URL,Total_Scans,Unique_Visitors,Active,Created_At,Last_Scanned_At'];
    for (const qr of list) {
      const shortUrl = qrService.getEncodedUrl(qr.slug, baseUrl);
      csvRows.push([
        `"${qr.id}"`,
        `"${(qr.title || '').replace(/"/g, '""')}"`,
        `"${qr.slug}"`,
        `"${shortUrl}"`,
        `"${(qr.destinationUrl || '').replace(/"/g, '""')}"`,
        qr.totalScans || 0,
        qr.uniqueVisitors || 0,
        qr.active,
        `"${qr.createdAt}"`,
        `"${qr.lastScannedAt || ''}"`
      ].join(','));
    }
    return csvRows.join('\r\n');
  }
}

module.exports = new BulkService();
