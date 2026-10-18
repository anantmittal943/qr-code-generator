const app = require('./src/server');

// Initialize database immediately on startup
if (app.bootstrap) {
  app.bootstrap(false).catch(err => {
    console.error('[Serverless Init] Bootstrap error:', err.message);
  });
}

module.exports = app;
