const http = require('http');
const { bootstrap } = require('../src/server');
const db = require('../src/db');

function request(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'Content-Type': 'application/json'
    };

    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method: options.method || 'GET',
      headers: { ...defaultHeaders, ...options.headers }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: raw,
          text: () => raw.toString('utf8'),
          json: () => JSON.parse(raw.toString('utf8'))
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Automated Tests ---');
  const server = await bootstrap();

  try {
    // 1. Test Overview Stats
    const statsRes = await request('/api/stats');
    console.log(`[Test 1] GET /api/stats: status=${statsRes.statusCode}`);
    if (statsRes.statusCode !== 200) throw new Error('Stats returned non-200');
    const stats = statsRes.json();
    console.log(`         Total QRs: ${stats.stats.totalQRs}, Total Scans: ${stats.stats.totalScans}`);

    // 2. Test Create QR Code
    const testSlug = `test-${Date.now()}`;
    const createRes = await request('/api/qr', { method: 'POST' }, {
      destinationUrl: 'https://example.com/initial-destination',
      title: 'Automated Test QR',
      slug: testSlug,
      tags: ['Test', 'Automation'],
      style: { fgColor: '#2563eb', bgColor: '#ffffff', errorCorrectionLevel: 'H' }
    });
    console.log(`[Test 2] POST /api/qr: status=${createRes.statusCode}`);
    if (createRes.statusCode !== 201) throw new Error(`Create QR failed: ${createRes.text()}`);
    const createdQR = createRes.json();
    console.log(`         Created ID: ${createdQR.id}, Slug: ${createdQR.slug}, ShortUrl: ${createdQR.shortUrl}`);

    // 3. Test SVG Generation
    const svgRes = await request(`/api/qr/${createdQR.id}/preview?format=svg`);
    console.log(`[Test 3] GET SVG preview: status=${svgRes.statusCode}, Content-Type=${svgRes.headers['content-type']}`);
    if (!svgRes.text().includes('<svg')) throw new Error('Invalid SVG returned');

    // 4. Test PNG Generation
    const pngRes = await request(`/api/qr/${createdQR.id}/preview?format=png`);
    console.log(`[Test 4] GET PNG preview: status=${pngRes.statusCode}, bytes=${pngRes.body.length}`);
    if (pngRes.body.length < 50) throw new Error('Invalid PNG buffer length');

    // 5. Test Redirection Engine
    const redirectRes = await request(`/r/${testSlug}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        'Referer': 'https://twitter.com/post/123'
      }
    });
    console.log(`[Test 5] GET /r/${testSlug}: status=${redirectRes.statusCode}, Location=${redirectRes.headers.location}`);
    if (redirectRes.statusCode !== 302) throw new Error(`Expected 302 redirect, got ${redirectRes.statusCode}`);
    if (redirectRes.headers.location !== 'https://example.com/initial-destination') {
      throw new Error(`Unexpected destination location: ${redirectRes.headers.location}`);
    }

    // Wait a brief moment for async scan recording
    await new Promise(r => setTimeout(r, 200));

    // Verify scan recorded
    const qrAfterScan = await (await request(`/api/qr/${createdQR.id}`)).json();
    console.log(`[Test 6] Verified scan count: totalScans=${qrAfterScan.totalScans}`);
    if (qrAfterScan.totalScans < 1) throw new Error('Scan count did not increment');

    // 7. Test Dynamic Destination URL Update (without changing slug or QR)
    const updateRes = await request(`/api/qr/${createdQR.id}`, { method: 'PUT' }, {
      destinationUrl: 'https://example.com/UPDATED-DESTINATION'
    });
    console.log(`[Test 7] PUT /api/qr/${createdQR.id}: status=${updateRes.statusCode}`);
    if (updateRes.statusCode !== 200) throw new Error('Failed to update QR');

    // Test redirection with new destination URL
    const updatedRedirectRes = await request(`/r/${testSlug}`);
    console.log(`[Test 8] Redirection after dynamic update: Location=${updatedRedirectRes.headers.location}`);
    if (updatedRedirectRes.headers.location !== 'https://example.com/UPDATED-DESTINATION') {
      throw new Error(`Redirection did not update dynamically: ${updatedRedirectRes.headers.location}`);
    }

    // 8. Test Campaign Expiration
    const pastDate = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const expireUpdateRes = await request(`/api/qr/${createdQR.id}`, { method: 'PUT' }, {
      expiresAt: pastDate
    });
    console.log(`[Test 9] PUT expiresAt in past: status=${expireUpdateRes.statusCode}`);
    if (expireUpdateRes.statusCode !== 200) throw new Error('Failed to set expiration');

    const expiredRedirectRes = await request(`/r/${testSlug}`);
    console.log(`[Test 10] GET /r/${testSlug} when expired: status=${expiredRedirectRes.statusCode}`);
    if (expiredRedirectRes.statusCode !== 410) {
      throw new Error(`Expected HTTP 410 for expired campaign, got ${expiredRedirectRes.statusCode}`);
    }
    if (!expiredRedirectRes.text().includes('Campaign Expired') && !expiredRedirectRes.text().includes('Expired')) {
      throw new Error('Expired page did not contain expected expiration message');
    }

    // Clear expiration (re-activate)
    const clearExpireRes = await request(`/api/qr/${createdQR.id}`, { method: 'PUT' }, {
      expiresAt: null
    });
    console.log(`[Test 11] PUT clear expiresAt: status=${clearExpireRes.statusCode}`);
    const unexpiredRedirectRes = await request(`/r/${testSlug}`);
    console.log(`[Test 12] GET /r/${testSlug} after clearing expiration: status=${unexpiredRedirectRes.statusCode}`);
    if (unexpiredRedirectRes.statusCode !== 302) {
      throw new Error(`Expected HTTP 302 after clearing expiration, got ${unexpiredRedirectRes.statusCode}`);
    }

    // 9. Test Bulk Creation via Multi-line Text
    const bulkRes = await request('/api/bulk/create', { method: 'POST' }, {
      text: "Bulk Campaign 1 | https://site1.com | bulk1\nBulk Campaign 2 | https://site2.com | bulk2"
    });
    console.log(`[Test 13] POST /api/bulk/create: status=${bulkRes.statusCode}`);
    const bulkData = bulkRes.json();
    console.log(`         Successfully created: ${bulkData.successCount} of ${bulkData.total}`);
    if (bulkData.successCount !== 2) throw new Error('Bulk creation failed');

    // 10. Test Bulk ZIP Export
    const zipRes = await request('/api/bulk/export?format=all');
    console.log(`[Test 14] GET /api/bulk/export: status=${zipRes.statusCode}, bytes=${zipRes.body.length}`);
    if (zipRes.statusCode !== 200 || zipRes.body.length < 100) throw new Error('ZIP export failed');

    // 11. Clean up test QR
    const delRes = await request(`/api/qr/${createdQR.id}`, { method: 'DELETE' });
    console.log(`[Test 15] DELETE test QR: status=${delRes.statusCode}`);
    if (delRes.statusCode !== 200) throw new Error('Delete failed');

    // 12. Test Dynamic Domain Detection (Host / x-forwarded headers)
    const dynamicDomainRes = await request('/api/qr', {
      headers: {
        'x-forwarded-host': 'my-new-domain.com',
        'x-forwarded-proto': 'https'
      }
    });
    console.log(`[Test 16] GET /api/qr with new domain host header: status=${dynamicDomainRes.statusCode}`);
    const dynamicQRs = dynamicDomainRes.json();
    if (dynamicQRs.items.length > 0) {
      const itemUrl = dynamicQRs.items[0].shortUrl;
      console.log(`         Resolved shortUrl: ${itemUrl}`);
      if (!itemUrl.startsWith('https://my-new-domain.com/r/')) {
        throw new Error(`Expected shortUrl to start with https://my-new-domain.com/r/, got ${itemUrl}`);
      }

      // Verify SVG preview generates with the new domain
      const dynamicSvgRes = await request(`/api/qr/${dynamicQRs.items[0].id}/preview?format=svg`, {
        headers: {
          'x-forwarded-host': 'my-new-domain.com',
          'x-forwarded-proto': 'https'
        }
      });
      if (!dynamicSvgRes.text().includes('svg')) {
        throw new Error('Dynamic SVG preview failed');
      }
    }

    // 13. Test Settings Custom Base URL Update
    const customBaseUrl = 'https://custom-shortlink.example.com';
    const putSettingsRes = await request('/api/settings', { method: 'PUT' }, {
      baseUrl: customBaseUrl
    });
    console.log(`[Test 17] PUT /api/settings custom baseUrl: status=${putSettingsRes.statusCode}`);
    if (putSettingsRes.statusCode !== 200) throw new Error('Failed to update settings');
    const settingsData = putSettingsRes.json();
    if (settingsData.baseUrl !== customBaseUrl) {
      throw new Error(`Expected settings baseUrl to be ${customBaseUrl}, got ${settingsData.baseUrl}`);
    }

    const qrListAfterSettings = (await request('/api/qr')).json();
    if (qrListAfterSettings.items.length > 0) {
      const updatedUrl = qrListAfterSettings.items[0].shortUrl;
      console.log(`         Verified shortUrl after settings update: ${updatedUrl}`);
      if (!updatedUrl.startsWith(`${customBaseUrl}/r/`)) {
        throw new Error(`Expected shortUrl to start with ${customBaseUrl}/r/, got ${updatedUrl}`);
      }
    }

    console.log('\n✅ ALL 17 AUTOMATED TESTS PASSED SUCCESSFULLY! Dynamic domain resolution and baseUrl verified.\n');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  } finally {
    server.close();
    process.exit(0);
  }
}

runTests();
