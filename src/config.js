const path = require('path');

const PORT = process.env.PORT || 3000;
const VERCEL_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
const BASE_URL = process.env.BASE_URL || VERCEL_URL || `http://localhost:${PORT}`;
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/data' : path.join(__dirname, '..', 'data'));
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';

module.exports = {
  PORT,
  BASE_URL,
  DATA_DIR,
  ADMIN_KEY
};
