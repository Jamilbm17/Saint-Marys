const path = require('node:path');

const root = path.resolve(__dirname, '..');

module.exports = {
  root,
  port: Number(process.env.PORT) || 3000,
  schoolYear: 2026,
  sessionDays: 7,
  isProduction: process.env.NODE_ENV === 'production',
  /** Detrás de Render/Railway usa TRUST_PROXY=1 para que req.ip y la cookie Secure funcionen. */
  trustProxy: process.env.TRUST_PROXY ?? 'loopback',
};
