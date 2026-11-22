const crypto = require('node:crypto');
const express = require('express');
const auth = require('../auth');
const { HttpError, fullName } = require('../util');
const { parseId, ensureConversation } = require('../domain');

const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function temporaryPassword(length = 10) {
  return Array.from(crypto.randomBytes(length), (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('');
}

const stripAccents = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** "Rocío Quispe Mamani" -> "rquispe" */
function baseUsername(guardianName) {
  const [first = 'apoderado', second = ''] = stripAccents(guardianName).toLowerCase().split(/\s+/);
  return `${first[0]}${second}`.replace(/[^a-z0-9]/g, '') || 'apoderado';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 9) throw new HttpError(400, 'El celular debe tener 9 dígitos.');
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

/** "Apellidos, Nombres" -> { lastNames, firstNames } */
function parseFullName(value) {
  const [last, first] = String(value || '').split(',').map((part) => part.trim().replace(/\s+/g, ' '));
  if (!last || !first) throw new HttpError(400, 'Escribe los apellidos y nombres con el formato "Apellidos, Nombres".');
  if (last.length > 80 || first.length > 80) throw new HttpError(400, 'Apellidos y nombres son demasiado largos.');
  return { lastNames: last, firstNames: first };
}

function validateStudentInput(db, body) {
  const dni = String(body.dni || '').trim();
  if (!/^\d{8}$/.test(dni)) throw new HttpError(400, 'El DNI debe tener 8 dígitos.');
  const name = parseFullName(body.fullName);
  const sectionId = parseId(body.sectionId, 'sección');
  if (!db.prepare('SELECT 1 FROM sections WHERE id = ?').get(sectionId)) throw new HttpError(400, 'La sección no existe.');
  const guardianName = String(body.guardian?.fullName || '').trim().replace(/\s+/g, ' ');
  if (guardianName.length < 5) throw new HttpError(400, 'Ingresa el nombre completo del apoderado.');
  if (guardianName.length > 120) throw new HttpError(400, 'El nombre del apoderado es demasiado largo.');
  return { dni, ...name, sectionId, guardianName, phone: normalizePhone(body.guardian?.phone) };
}

module.exports = function adminRoutes(db) {
  const router = express.Router();
  router.use(auth.requireRole('direccion'));

  const studentRow = `
    SELECT s.id, s.dni, s.last_names, s.first_names, s.active, s.section_id AS sectionId, sec.name AS sectionName,
           g.id AS guardianId, g.full_name AS guardianName, g.phone, g.consent_accepted_at AS consentAcceptedAt,
           u.username AS guardianUsername
    FROM students s
    JOIN sections sec ON sec.id = s.section_id
    LEFT JOIN guardians g ON g.student_id = s.id
    LEFT JOIN users u ON u.id = g.user_id`;

  const toStudent = (r) => ({
    id: r.id,
    dni: r.dni,
    fullName: fullName(r),
    active: Boolean(r.active),
    sectionId: r.sectionId,
    sectionName: r.sectionName,
    guardian: r.guardianId
      ? { id: r.guardianId, fullName: r.guardianName, phone: r.phone, username: r.guardianUsername }
      : null,
    consent: r.consentAcceptedAt ? 'Registrado' : 'Pendiente',
  });

  router.get('/students', (req, res) => {
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 8, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const status = ['active', 'inactive'].includes(req.query.status) ? req.query.status : 'all';
    const search = String(req.query.search || '').trim().toLowerCase();

    const where = [];
    const params = [];
    if (status !== 'all') {
      where.push('s.active = ?');
      params.push(status === 'active' ? 1 : 0);
    }
    if (search) {
      where.push("(s.dni LIKE ? OR lower(s.last_names || ' ' || s.first_names) LIKE ? OR lower(g.full_name) LIKE ?)");
      const like = `%${search.replace(/[%_]/g, '')}%`;
      params.push(like, like, like);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM students s LEFT JOIN guardians g ON g.student_id = s.id ${clause}`)
      .get(...params).n;
    const items = db
      .prepare(`${studentRow} ${clause} ORDER BY s.last_names, s.first_names LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize)
      .map(toStudent);
    const totals = db
      .prepare(`
        SELECT SUM(s.active = 1) AS active,
               SUM(s.active = 1 AND g.consent_accepted_at IS NOT NULL) AS consents
        FROM students s LEFT JOIN guardians g ON g.student_id = s.id`)
      .get();
    res.json({
      items,
      total,
      page,
      pageSize,
      activeCount: totals.active || 0,
      consentCount: totals.consents || 0,
    });
  });

  router.get('/sections-list', (req, res) => {
    res.json({ sections: db.prepare('SELECT id, name, grade FROM sections ORDER BY name').all() });
  });

  function assertUniqueDni(dni, ignoreId = 0) {
    const clash = db.prepare('SELECT id, first_names, last_names FROM students WHERE dni = ? AND id <> ?').get(dni, ignoreId);
    if (clash) {
      throw new HttpError(409, `Ya existe un estudiante con este DNI (${clash.first_names} ${clash.last_names}).`);
    }
  }

  function uniqueUsername(base) {
    let candidate = base;
    for (let n = 2; db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate); n += 1) {
      candidate = `${base}${n}`;
    }
    return candidate;
  }

  router.post('/students', (req, res) => {
    const input = validateStudentInput(db, req.body || {});
    assertUniqueDni(input.dni);
    const password = temporaryPassword();
    const username = uniqueUsername(baseUsername(input.guardianName));

    const studentId = db.transaction(() => {
      const id = db
        .prepare('INSERT INTO students (dni, last_names, first_names, section_id) VALUES (?, ?, ?, ?)')
        .run(input.dni, input.lastNames, input.firstNames, input.sectionId).lastInsertRowid;
      const userId = db
        .prepare("INSERT INTO users (username, password_hash, role, full_name) VALUES (?, ?, 'apoderado', ?)")
        .run(username, auth.hashPassword(password), input.guardianName).lastInsertRowid;
      const guardianId = db
        .prepare('INSERT INTO guardians (user_id, student_id, full_name, phone) VALUES (?, ?, ?, ?)')
        .run(userId, id, input.guardianName, input.phone).lastInsertRowid;
      ensureConversation(db, guardianId);
      return id;
    })();

    const created = toStudent(db.prepare(`${studentRow} WHERE s.id = ?`).get(studentId));
    res.status(201).json({ student: created, credentials: { username, temporaryPassword: password } });
  });

  router.put('/students/:id', (req, res) => {
    const id = parseId(req.params.id, 'estudiante');
    const current = db.prepare('SELECT id FROM students WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Estudiante no encontrado.');
    const input = validateStudentInput(db, req.body || {});
    assertUniqueDni(input.dni, id);

    db.transaction(() => {
      db.prepare(
        "UPDATE students SET dni = ?, last_names = ?, first_names = ?, section_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
      ).run(input.dni, input.lastNames, input.firstNames, input.sectionId, id);
      const guardian = db.prepare('SELECT id, user_id FROM guardians WHERE student_id = ?').get(id);
      if (guardian) {
        db.prepare('UPDATE guardians SET full_name = ?, phone = ? WHERE id = ?').run(input.guardianName, input.phone, guardian.id);
        db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(input.guardianName, guardian.user_id);
      }
    })();
    res.json({ student: toStudent(db.prepare(`${studentRow} WHERE s.id = ?`).get(id)) });
  });

  /** Activar / desactivar (no se eliminan estudiantes para conservar su historial). */
  router.patch('/students/:id/active', (req, res) => {
    const id = parseId(req.params.id, 'estudiante');
    if (typeof req.body?.active !== 'boolean') throw new HttpError(400, 'Indica si el estudiante queda activo.');
    const active = req.body.active ? 1 : 0;
    const exists = db.prepare('SELECT id FROM students WHERE id = ?').get(id);
    if (!exists) throw new HttpError(404, 'Estudiante no encontrado.');
    db.transaction(() => {
      db.prepare("UPDATE students SET active = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(active, id);
      const guardian = db.prepare('SELECT user_id FROM guardians WHERE student_id = ?').get(id);
      if (guardian) {
        db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active, guardian.user_id);
        if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(guardian.user_id);
      }
    })();
    res.json({ student: toStudent(db.prepare(`${studentRow} WHERE s.id = ?`).get(id)) });
  });

  router.post('/students/:id/guardian/reset-password', (req, res) => {
    const id = parseId(req.params.id, 'estudiante');
    const guardian = db
      .prepare('SELECT g.user_id AS userId, u.username FROM guardians g JOIN users u ON u.id = g.user_id WHERE g.student_id = ?')
      .get(id);
    if (!guardian) throw new HttpError(404, 'El estudiante no tiene apoderado registrado.');
    const password = temporaryPassword();
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), guardian.userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(guardian.userId);
    })();
    res.json({ credentials: { username: guardian.username, temporaryPassword: password } });
  });

  router.get('/teachers', (req, res) => {
    const teachers = db.prepare("SELECT id, username, full_name AS fullName, title, active FROM users WHERE role = 'docente' ORDER BY full_name").all();
    const assignments = db
      .prepare(`
        SELECT ta.teacher_id AS teacherId, c.name AS course, sec.name AS section
        FROM teaching_assignments ta JOIN courses c ON c.id = ta.course_id JOIN sections sec ON sec.id = ta.section_id
        ORDER BY c.id`)
      .all();
    const tutorships = db.prepare('SELECT tutor_id AS teacherId, name FROM sections WHERE tutor_id IS NOT NULL').all();
    res.json({
      teachers: teachers.map((t) => ({
        ...t,
        active: Boolean(t.active),
        assignments: assignments.filter((a) => a.teacherId === t.id).map((a) => ({ course: a.course, section: a.section })),
        tutorOf: tutorships.filter((s) => s.teacherId === t.id).map((s) => s.name),
      })),
    });
  });

  router.get('/sections', (req, res) => {
    const sections = db
      .prepare(`
        SELECT sec.id, sec.name, sec.grade, sec.school_year AS schoolYear, u.full_name AS tutorName,
               (SELECT COUNT(*) FROM students s WHERE s.section_id = sec.id AND s.active = 1) AS students
        FROM sections sec LEFT JOIN users u ON u.id = sec.tutor_id ORDER BY sec.name`)
      .all();
    const courses = db
      .prepare(`
        SELECT ta.section_id AS sectionId, c.id AS courseId, c.name AS course, u.full_name AS teacherName
        FROM teaching_assignments ta JOIN courses c ON c.id = ta.course_id JOIN users u ON u.id = ta.teacher_id
        ORDER BY c.id`)
      .all();
    res.json({
      sections: sections.map((s) => ({
        ...s,
        courses: courses.filter((c) => c.sectionId === s.id).map((c) => ({ id: c.courseId, name: c.course, teacherName: c.teacherName })),
      })),
    });
  });

  router.get('/consents', (req, res) => {
    const rows = db
      .prepare(`
        SELECT s.last_names, s.first_names, g.full_name AS guardianName, g.phone,
               g.consent_accepted_at AS acceptedAt, g.notifications_enabled AS notificationsEnabled
        FROM guardians g JOIN students s ON s.id = g.student_id
        WHERE s.active = 1 ORDER BY (g.consent_accepted_at IS NULL) DESC, s.last_names, s.first_names`)
      .all();
    res.json({
      items: rows.map((r) => ({
        studentName: fullName(r),
        guardianName: r.guardianName,
        phone: r.phone,
        acceptedAt: r.acceptedAt,
        notificationsEnabled: Boolean(r.notificationsEnabled),
      })),
    });
  });

  return router;
};
