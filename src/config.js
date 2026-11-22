const path = require('node:path');

const root = path.resolve(__dirname, '..');

module.exports = {
  root,
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(root, 'data', 'saint-marys.db'),
  schoolYear: 2026,
  sessionDays: 7,
  isProduction: process.env.NODE_ENV === 'production',
};
