const express = require('express');
const auth = require('../auth');
const { HttpError, toIsoDate, lastWeekday, toIsoDateTime } = require('../util');
const { getTerms, resolveCurrentTerm } = require('../domain');
const config = require('../config');

const ROLE_LABELS = { docente: 'Docente', direccion: 'Dirección', apoderado: 'Apoderado' };
const DUMMY_HASH = auth.hashPassword('contraseña-inexistente');

module.exports = function authRoutes(store) {
  const router = express.Router();
  const limiter = auth.createLoginLimiter();

  async function describeUser(req) {
    const { user } = req;
    const base = {
      id: user.id,
      role: user.role,
      fullName: user.fullName,
      roleLabel: user.title || ROLE_LABELS[user.role],
    };
    if (user.role !== 'apoderado') return base;
    const g = req.guardian;
    const student = await store.get('students', g.studentId);
    const section = await store.get('sections', student.section_id);
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
          sectionName: section.name,
          grade: section.grade,
        },
      },
    };
  }

  router.post('/login', async (req, res) => {
    const { role, username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      throw new HttpError(400, 'Ingresa tu usuario y contraseña.');
    }
    limiter.check(req, username);
    const found = await store.findOne('users', { username: username.trim().toLowerCase() });
    const user = found?.active ? found : null;
    const valid = auth.verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid || (role && user.role !== role)) {
      limiter.fail(req, username);
      throw new HttpError(401, 'Usuario o contraseña incorrectos para el perfil seleccionado.');
    }
    limiter.reset(req, username);
    const { token, expires, persistent } = await auth.createSession(store, user.id, { remember: req.body.remember === true });
    auth.setSessionCookie(res, token, expires, persistent);
    req.user = { id: user.id, role: user.role, fullName: user.full_name, title: user.title };
    if (user.role === 'apoderado') {
      req.guardian = auth.guardianView(await store.findOne('guardians', { user_id: user.id }));
    }
    res.json({ user: await describeUser(req) });
  });

  router.post('/logout', async (req, res) => {
    await auth.destroySession(store, req.sessionToken);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', auth.requireAuth, async (req, res) => {
    res.json({ user: await describeUser(req) });
  });

  router.post('/consent', auth.requireRole('apoderado'), async (req, res) => {
    const { dataConsent, notificationsConsent } = req.body || {};
    if (dataConsent !== true) {
      throw new HttpError(400, 'Debes autorizar el tratamiento de datos para continuar.');
    }
    await store.update('guardians', req.guardian.id, {
      consent_accepted_at: toIsoDateTime(new Date()),
      notifications_enabled: notificationsConsent === true,
    });
    res.json({ ok: true });
  });

  return router;
};

/** Datos globales de la aplicación (año escolar, bimestres, fecha de referencia). */
module.exports.metaRoute = function metaRoute(store) {
  const router = express.Router();
  router.get('/', auth.requireAuth, async (req, res) => {
    const now = new Date();
    const current = await resolveCurrentTerm(store, now);
    res.json({
      schoolYear: config.schoolYear,
      terms: await getTerms(store),
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
