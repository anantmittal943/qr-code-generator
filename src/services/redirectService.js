const crypto = require('crypto');
const { UAParser } = require('ua-parser-js');
const db = require('../db');

class RedirectService {
  /**
   * Hashes an IP address with a daily rotating salt for privacy
   */
  hashIP(ip) {
    if (!ip) return 'anonymous';
    const day = new Date().toISOString().slice(0, 10);
    return crypto.createHash('sha256').update(`${ip}-${day}`).digest('hex').slice(0, 16);
  }

  /**
   * Parses referrer into a clean domain name or "Direct"
   */
  parseReferrer(rawReferrer) {
    if (!rawReferrer) return 'Direct';
    try {
      const url = new URL(rawReferrer);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return 'Direct';
    }
  }

  /**
   * Processes a redirection request (async — DB calls are awaited)
   */
  async processRedirect(slug, req) {
    const qr = await db.getQRCodeBySlug(slug);

    if (!qr) {
      return {
        status: 'not_found',
        message: 'The requested QR code does not exist.'
      };
    }

    if (!qr.active) {
      return {
        status: 'inactive',
        qr,
        message: 'This QR code has been paused by the administrator.'
      };
    }

    if (qr.expiresAt) {
      const expiry = new Date(qr.expiresAt);
      if (expiry.getTime() < Date.now()) {
        return {
          status: 'expired',
          qr,
          message: 'This QR code campaign has expired.'
        };
      }
    }

    // Process scan analytics asynchronously (fire-and-forget)
    const rawIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || '';
    const referrer = this.parseReferrer(req.headers['referer'] || req.headers['referrer']);

    let device = 'desktop';
    let browser = 'Unknown';
    let os = 'Unknown';

    try {
      const parser = new UAParser(userAgent);
      const parsed = parser.getResult();
      device = parsed.device?.type || 'desktop';
      browser = parsed.browser?.name || 'Browser';
      os = parsed.os?.name || 'Unknown OS';
    } catch (err) {
      console.warn('[RedirectService] UA parse warning:', err.message);
    }

    // Log scan to DB (non-blocking, fire-and-forget via Promise)
    db.recordScan({
      qrCodeId: qr.id,
      slug: qr.slug,
      ipHash: this.hashIP(rawIp),
      userAgent,
      device,
      browser,
      os,
      referrer
    }).catch(err => {
      console.error('[RedirectService] Failed to record scan:', err.message);
    });

    return {
      status: 'ok',
      destinationUrl: qr.destinationUrl,
      qr
    };
  }
}

module.exports = new RedirectService();
