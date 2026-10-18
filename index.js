const app = require('./src/server');

module.exports = async (req, res) => {
  try {
    if (app.bootstrap) {
      await app.bootstrap(false);
    }
    return app(req, res);
  } catch (err) {
    console.error('[Root Handler Error]', err);
    res.status(500).json({ error: err.message });
  }
};
