const db = require('../db');

class AnalyticsService {
  /**
   * Generates summary statistics and chart data for the admin overview
   */
  getOverviewMetrics() {
    const stats = db.getOverviewStats();
    const allScans = db.getAllScans({ limit: 5000 });
    const { items: allQRs } = db.getQRCodes({ sort: 'totalScans', order: 'desc', limit: 5 });

    const timeline = this._calculateTimeline(allScans, 14);
    const devices = this._aggregateProperty(allScans, 'device');
    const browsers = this._aggregateProperty(allScans, 'browser');
    const oses = this._aggregateProperty(allScans, 'os');
    const referrers = this._aggregateProperty(allScans, 'referrer');

    return {
      stats,
      topQRs: allQRs.map(q => ({
        id: q.id,
        title: q.title,
        slug: q.slug,
        destinationUrl: q.destinationUrl,
        totalScans: q.totalScans || 0,
        uniqueVisitors: q.uniqueVisitors || 0,
        active: q.active
      })),
      timeline,
      devices,
      browsers,
      oses,
      referrers,
      recentScans: allScans.slice(0, 15).map(s => {
        const qr = db.getQRCodeById(s.qrCodeId);
        return {
          ...s,
          qrTitle: qr ? qr.title : s.slug
        };
      })
    };
  }

  /**
   * Generates analytics for a specific QR Code
   */
  getQRAnalytics(qrCodeId) {
    const qr = db.getQRCodeById(qrCodeId);
    if (!qr) return null;

    const scans = db.getScansByQRCodeId(qrCodeId, { limit: 1000 });
    const timeline = this._calculateTimeline(scans, 14);
    const devices = this._aggregateProperty(scans, 'device');
    const browsers = this._aggregateProperty(scans, 'browser');
    const oses = this._aggregateProperty(scans, 'os');
    const referrers = this._aggregateProperty(scans, 'referrer');

    return {
      qr: {
        id: qr.id,
        title: qr.title,
        slug: qr.slug,
        destinationUrl: qr.destinationUrl,
        active: qr.active,
        totalScans: qr.totalScans || 0,
        uniqueVisitors: qr.uniqueVisitors || 0,
        createdAt: qr.createdAt,
        lastScannedAt: qr.lastScannedAt
      },
      timeline,
      devices,
      browsers,
      oses,
      referrers,
      recentScans: scans.slice(0, 50)
    };
  }

  _calculateTimeline(scans, days = 14) {
    const dates = [];
    const dateMap = new Map();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const str = d.toISOString().slice(0, 10);
      dates.push(str);
      dateMap.set(str, 0);
    }

    for (const scan of scans) {
      const day = scan.timestamp.slice(0, 10);
      if (dateMap.has(day)) {
        dateMap.set(day, dateMap.get(day) + 1);
      }
    }

    return {
      labels: dates,
      counts: dates.map(d => dateMap.get(d))
    };
  }

  _aggregateProperty(items, key) {
    const counts = {};
    for (const item of items) {
      let val = item[key] || 'Unknown';
      if (val === 'mobile') val = 'Mobile';
      if (val === 'desktop') val = 'Desktop';
      if (val === 'tablet') val = 'Tablet';
      counts[val] = (counts[val] || 0) + 1;
    }

    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    return {
      labels: sorted.map(s => s[0]),
      counts: sorted.map(s => s[1])
    };
  }
}

module.exports = new AnalyticsService();
