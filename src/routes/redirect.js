const express = require('express');
const router = express.Router();
const redirectService = require('../services/redirectService');

function renderStatusPage(title, headline, message, iconColor = '#ef4444') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Dynamic QR</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen flex items-center justify-center p-4">
  <div class="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl text-center">
    <div class="w-16 h-16 mx-auto mb-5 rounded-full flex items-center justify-center" style="background-color: ${iconColor}22; color: ${iconColor};">
      <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
      </svg>
    </div>
    <h1 class="text-2xl font-bold tracking-tight mb-2 text-white">${headline}</h1>
    <p class="text-slate-400 mb-6 text-sm leading-relaxed">${message}</p>
    <div class="border-t border-slate-700/60 pt-5">
      <a href="/" class="inline-flex items-center text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors">
        Powered by Dynamic QR Studio &rarr;
      </a>
    </div>
  </div>
</body>
</html>`;
}

router.get('/:slug', (req, res) => {
  const { slug } = req.params;
  const result = redirectService.processRedirect(slug, req);

  if (result.status === 'ok') {
    return res.redirect(302, result.destinationUrl);
  }

  if (result.status === 'inactive') {
    return res.status(403).send(renderStatusPage(
      'QR Code Paused',
      'QR Code Currently Paused',
      result.message || 'This dynamic QR code destination is currently paused by its administrator. Please check back later.',
      '#f59e0b'
    ));
  }

  if (result.status === 'expired') {
    return res.status(410).send(renderStatusPage(
      'Campaign Expired',
      'QR Code Expired',
      result.message || 'This dynamic QR campaign has reached its expiration date.',
      '#ef4444'
    ));
  }

  // Not found
  return res.status(404).send(renderStatusPage(
    'Not Found',
    'QR Code Not Found',
    'The QR code or redirection link you scanned does not exist or has been removed.',
    '#64748b'
  ));
});

module.exports = router;
