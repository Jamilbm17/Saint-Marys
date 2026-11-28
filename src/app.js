const path = require('node:path');
const express = require('express');
const config = require('./config');
const auth = require('./auth');
const { HttpError } = require('./util');
const authRoutes = require('./routes/auth.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const gradesRoutes = require('./routes/grades.routes');
const conductRoutes = require('./routes/conduct.routes');
const messagesRoutes = require('./routes/messages.routes');
const guardianRoutes = require('./routes/guardian.routes');
const adminRoutes = require('./routes/admin.routes');
const reportsRoutes = require('./routes/reports.routes');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      // SDK de Firebase Messaging (notificaciones push) servido desde el CDN de Google
      "script-src 'self' https://www.gstatic.com",
      "connect-src 'self' https://*.googleapis.com https://fcmregistrations.googleapis.com https://firebaseinstallations.googleapis.com",
      "worker-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
}

/** Las peticiones que modifican datos deben ser JSON (mitiga CSRF junto con SameSite=Lax). */
function requireJsonForWrites(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['content-length'] !== '0') {
    if (!req.is('application/json')) return next(new HttpError(415, 'Se esperaba application/json.'));
  }
  next();
}

function createApp(store) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', Number.isNaN(Number(config.trustProxy)) ? config.trustProxy : Number(config.trustProxy));
  app.use(securityHeaders);
  app.use(express.json({ limit: '100kb' }));
  app.use(auth.authenticate(store));

  const api = express.Router();
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(requireJsonForWrites);
  api.use('/auth', authRoutes(store));
  api.use('/meta', authRoutes.metaRoute(store));
  api.use('/teacher', attendanceRoutes(store));
  api.use('/teacher', gradesRoutes(store));
  api.use('/teacher', conductRoutes(store));
  api.use('/', messagesRoutes(store));
  api.use('/guardian', guardianRoutes(store));
  api.use('/admin', adminRoutes(store));
  api.use('/reports', reportsRoutes(store));
  api.use((req, res, next) => next(new HttpError(404, 'Recurso no encontrado.')));
  app.use('/api', api);

  app.use(express.static(path.join(config.root, 'public')));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(config.root, 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'JSON no válido.');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'La petición es demasiado grande.');
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Ocurrió un error inesperado. Inténtalo nuevamente.' : err.message });
  });

  return app;
}

module.exports = { createApp };
