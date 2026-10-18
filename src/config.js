const path = require('path');

const PORT = process.env.PORT || 3000;
const VERCEL_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || null;
const rawBaseUrl = process.env.BASE_URL || RENDER_EXTERNAL_URL || VERCEL_URL || `http://localhost:${PORT}`;
const BASE_URL = rawBaseUrl.replace(/\/+$/, '');
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/data' : path.join(__dirname, '..', 'data'));
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';

module.exports = {
  PORT,
  BASE_URL,
  DATA_DIR,
  ADMIN_KEY
};
