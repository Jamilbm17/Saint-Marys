const crypto = require('node:crypto');
const config = require('./config');
const { HttpError, toIsoDateTime, addDays } = require('./util');

const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, KEY_LENGTH);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Con "recordarme" la sesión dura varios días; sin él, dura una jornada y la cookie no persiste. */
async function createSession(store, userId, { remember = false } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = remember ? addDays(new Date(), config.sessionDays) : new Date(Date.now() + 12 * 60 * 60 * 1000);
  await store.set('sessions', sha256(token), {
    user_id: userId,
    created_at: toIsoDateTime(new Date()),
    expires_at: toIsoDateTime(expires),
  });
  return { token, expires, persistent: remember };
}

async function destroySession(store, token) {
  if (token) await store.remove('sessions', sha256(token));
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function setSessionCookie(res, token, expires, persistent = true) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (persistent) flags.push(`Expires=${expires.toUTCString()}`);
  if (config.isProduction) flags.push('Secure');
  res.append('Set-Cookie', `sid=${token}; ${flags.join('; ')}`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

const guardianView = (g) => ({
  id: g.id,
  studentId: g.student_id,
  fullName: g.full_name,
  phone: g.phone,
  consentAcceptedAt: g.consent_accepted_at,
  notificationsEnabled: g.notifications_enabled,
});

/** Resuelve la sesión y carga req.user (y req.guardian para apoderados). */
function authenticate(store) {
  return async (req, res, next) => {
    const token = parseCookies(req.headers.cookie).sid;
    if (token) {
      const session = await store.get('sessions', sha256(token));
      if (session && session.expires_at > toIsoDateTime(new Date())) {
        const user = await store.get('users', session.user_id);
        if (user?.active) {
          req.sessionToken = token;
          req.user = { id: user.id, username: user.username, role: user.role, fullName: user.full_name, title: user.title };
          if (user.role === 'apoderado') {
            const guardian = await store.findOne('guardians', { user_id: user.id });
            req.guardian = guardian ? guardianView(guardian) : undefined;
          }
        }
      }
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Inicia sesión para continuar.'));
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Inicia sesión para continuar.'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'No tienes permiso para esta acción.'));
    next();
  };
}

/** El apoderado debe haber aceptado el consentimiento antes de ver información. */
function requireConsent(req, res, next) {
  if (!req.guardian?.consentAcceptedAt) {
    return next(new HttpError(403, 'Debes aceptar el consentimiento para continuar.'));
  }
  next();
}

/** Limitador simple de intentos fallidos de inicio de sesión (en memoria). */
function createLoginLimiter({ maxAttempts = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map();
  const key = (req, username) => `${req.ip}|${String(username).toLowerCase()}`;
  return {
    check(req, username) {
      const entry = attempts.get(key(req, username));
      if (entry && entry.resetAt > Date.now() && entry.count >= maxAttempts) {
        throw new HttpError(429, 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
      }
    },
    fail(req, username) {
      const k = key(req, username);
      const entry = attempts.get(k);
      if (!entry || entry.resetAt <= Date.now()) attempts.set(k, { count: 1, resetAt: Date.now() + windowMs });
      else entry.count += 1;
    },
    reset(req, username) {
      attempts.delete(key(req, username));
    },
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  guardianView,
  authenticate,
  requireAuth,
  requireRole,
  requireConsent,
  createLoginLimiter,
};
