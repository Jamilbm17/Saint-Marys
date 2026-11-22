const express = require('express');
const auth = require('../auth');
const { HttpError, toIsoDate, lastWeekday, toIsoDateTime } = require('../util');
const { getTerms, resolveCurrentTerm } = require('../domain');
const config = require('../config');

const ROLE_LABELS = { docente: 'Docente', direccion: 'Dirección', apoderado: 'Apoderado' };
const DUMMY_HASH = auth.hashPassword('contraseña-inexistente');

module.exports = function authRoutes(db) {
  const router = express.Router();
  const limiter = auth.createLoginLimiter();

  function describeUser(req) {
    const { user } = req;
    const base = {
      id: user.id,
      role: user.role,
      fullName: user.fullName,
      roleLabel: user.title || ROLE_LABELS[user.role],
    };
    if (user.role !== 'apoderado') return base;
    const g = req.guardian;
    const student = db
      .prepare(`
        SELECT s.id, s.last_names, s.first_names, sec.name AS sectionName, sec.grade
        FROM students s JOIN sections sec ON sec.id = s.section_id WHERE s.id = ?`)
      .get(g.studentId);
    return {
      ...base,
      guardian: {
        id: g.id,
        firstName: g.fullName.split(' ')[0],
        consentAccepted: Boolean(g.consentAcceptedAt),
        notificationsEnabled: Boolean(g.notificationsEnabled),
        student: {
          id: student.id,
          fullName: `${student.first_names} ${student.last_names}`,
          shortName: student.first_names,
          sectionName: student.sectionName,
          grade: student.grade,
        },
      },
    };
  }

  router.post('/login', (req, res) => {
    const { role, username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      throw new HttpError(400, 'Ingresa tu usuario y contraseña.');
    }
    limiter.check(req, username);
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username.trim());
    const valid = auth.verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid || (role && user.role !== role)) {
      limiter.fail(req, username);
      throw new HttpError(401, 'Usuario o contraseña incorrectos para el perfil seleccionado.');
    }
    limiter.reset(req, username);
    const { token, expires, persistent } = auth.createSession(db, user.id, { remember: req.body.remember === true });
    auth.setSessionCookie(res, token, expires, persistent);
    req.user = { id: user.id, role: user.role, fullName: user.full_name, title: user.title };
    if (user.role === 'apoderado') {
      req.guardian = db
        .prepare(`
          SELECT id, student_id AS studentId, full_name AS fullName, phone,
                 consent_accepted_at AS consentAcceptedAt, notifications_enabled AS notificationsEnabled
          FROM guardians WHERE user_id = ?`)
        .get(user.id);
    }
    res.json({ user: describeUser(req) });
  });

  router.post('/logout', (req, res) => {
    auth.destroySession(db, req.sessionToken);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', auth.requireAuth, (req, res) => {
    res.json({ user: describeUser(req) });
  });

  router.post('/consent', auth.requireRole('apoderado'), (req, res) => {
    const { dataConsent, notificationsConsent } = req.body || {};
    if (dataConsent !== true) {
      throw new HttpError(400, 'Debes autorizar el tratamiento de datos para continuar.');
    }
    db.prepare('UPDATE guardians SET consent_accepted_at = ?, notifications_enabled = ? WHERE id = ?').run(
      toIsoDateTime(new Date()),
      notificationsConsent === true ? 1 : 0,
      req.guardian.id,
    );
    res.json({ ok: true });
  });

  return router;
};

/** Datos globales de la aplicación (año escolar, bimestres, fecha de referencia). */
module.exports.metaRoute = function metaRoute(db) {
  const router = express.Router();
  router.get('/', auth.requireAuth, (req, res) => {
    const now = new Date();
    const current = resolveCurrentTerm(db, now);
    res.json({
      schoolYear: config.schoolYear,
      terms: getTerms(db),
      currentTerm: current.code,
      today: toIsoDate(now),
      defaultDate: toIsoDate(lastWeekday(now)),
      institution: {
        name: "College Saint Mary's",
        address: "Jr. Santa María Antonieta 202, Urb. Palao · San Martín de Porres",
      },
    });
  });
  return router;
};
