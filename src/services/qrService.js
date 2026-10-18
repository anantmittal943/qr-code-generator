const QRCode = require('qrcode');
const db = require('../db');

class QRService {
  /**
   * Builds the encoded URL for a dynamic QR code
   */
  getEncodedUrl(slug, overrideBaseUrl) {
    const settings = db.getSettings();
    const base = (overrideBaseUrl || settings.baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
    return `${base}/r/${slug}`;
  }

  /**
   * Generates a PNG Buffer
   */
  async toPngBuffer(text, options = {}) {
    const opts = {
      errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      margin: options.margin !== undefined ? Number(options.margin) : 2,
      width: options.width ? Number(options.width) : 512,
      color: {
        dark: options.fgColor || '#000000',
        light: options.bgColor || '#ffffff'
      }
    };
    return await QRCode.toBuffer(text, opts);
  }

  /**
   * Generates an SVG string
   */
  async toSVG(text, options = {}) {
    const opts = {
      errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      margin: options.margin !== undefined ? Number(options.margin) : 2,
      width: options.width ? Number(options.width) : 512,
      color: {
        dark: options.fgColor || '#000000',
        light: options.bgColor || '#ffffff'
      }
    };
    return await QRCode.toString(text, { ...opts, type: 'svg' });
  }

  /**
   * Generates a Base64 Data URL (PNG)
   */
  async toDataURL(text, options = {}) {
    const opts = {
      errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      margin: options.margin !== undefined ? Number(options.margin) : 2,
      width: options.width ? Number(options.width) : 320,
      color: {
        dark: options.fgColor || '#000000',
        light: options.bgColor || '#ffffff'
      }
    };
    return await QRCode.toDataURL(text, opts);
  }
}

module.exports = new QRService();
