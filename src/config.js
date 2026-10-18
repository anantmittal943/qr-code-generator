const path = require('path');

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';

module.exports = {
  PORT,
  BASE_URL,
  DATA_DIR,
  ADMIN_KEY
};
