const crypto = require('node:crypto');
const express = require('express');
const auth = require('../auth');
const { HttpError, fullName, toIsoDateTime } = require('../util');
const { parseId, ensureConversation, byName, byText, getCourses } = require('../domain');

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

async function validateStudentInput(store, body) {
  const dni = String(body.dni || '').trim();
  if (!/^\d{8}$/.test(dni)) throw new HttpError(400, 'El DNI debe tener 8 dígitos.');
  const name = parseFullName(body.fullName);
  const sectionId = parseId(body.sectionId, 'sección');
  if (!(await store.get('sections', sectionId))) throw new HttpError(400, 'La sección no existe.');
  const guardianName = String(body.guardian?.fullName || '').trim().replace(/\s+/g, ' ');
  if (guardianName.length < 5) throw new HttpError(400, 'Ingresa el nombre completo del apoderado.');
  if (guardianName.length > 120) throw new HttpError(400, 'El nombre del apoderado es demasiado largo.');
  return { dni, ...name, sectionId, guardianName, phone: normalizePhone(body.guardian?.phone) };
}

module.exports = function adminRoutes(store) {
  const router = express.Router();
  router.use(auth.requireRole('direccion'));

  const toStudent = (student, section, guardian, user) => ({
    id: student.id,
    dni: student.dni,
    fullName: fullName(student),
    active: Boolean(student.active),
    sectionId: student.section_id,
    sectionName: section?.name,
    guardian: guardian ? { id: guardian.id, fullName: guardian.full_name, phone: guardian.phone, username: user?.username } : null,
    consent: guardian?.consent_accepted_at ? 'Registrado' : 'Pendiente',
  });

  /** Arma la vista completa de un estudiante (sección, apoderado y usuario). */
  async function studentView(id) {
    const student = await store.get('students', id);
    const [section, guardian] = await Promise.all([
      store.get('sections', student.section_id),
      store.findOne('guardians', { student_id: id }),
    ]);
    const user = guardian ? await store.get('users', guardian.user_id) : null;
    return toStudent(student, section, guardian, user);
  }

  router.get('/students', async (req, res) => {
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 8, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const status = ['active', 'inactive'].includes(req.query.status) ? req.query.status : 'all';
    const search = String(req.query.search || '').trim().toLowerCase();

    const [students, guardians, sections] = await Promise.all([
      store.find('students'),
      store.find('guardians'),
      store.find('sections'),
    ]);
    const guardianByStudent = new Map(guardians.map((g) => [g.student_id, g]));
    const sectionById = new Map(sections.map((s) => [s.id, s]));

    const matching = students
      .filter((s) => (status === 'all' ? true : status === 'active' ? s.active : !s.active))
      .filter((s) => {
        if (!search) return true;
        const guardianName = guardianByStudent.get(s.id)?.full_name || '';
        return (
          s.dni.includes(search) ||
          `${s.last_names} ${s.first_names}`.toLowerCase().includes(search) ||
          guardianName.toLowerCase().includes(search)
        );
      })
      .sort(byName);
    const pageItems = matching.slice((page - 1) * pageSize, page * pageSize);
    const users = new Map(
      (await store.getMany('users', pageItems.map((s) => guardianByStudent.get(s.id)?.user_id).filter(Boolean))).map((u) => [u.id, u]),
    );

    const active = students.filter((s) => s.active);
    res.json({
      items: pageItems.map((s) => {
        const guardian = guardianByStudent.get(s.id);
        return toStudent(s, sectionById.get(s.section_id), guardian, guardian && users.get(guardian.user_id));
      }),
      total: matching.length,
      page,
      pageSize,
      activeCount: active.length,
      consentCount: active.filter((s) => guardianByStudent.get(s.id)?.consent_accepted_at).length,
    });
  });

  router.get('/sections-list', async (req, res) => {
    const sections = (await store.find('sections')).sort(byText('name'));
    res.json({ sections: sections.map((s) => ({ id: s.id, name: s.name, grade: s.grade })) });
  });

  async function assertUniqueDni(dni, ignoreId = 0) {
    const clash = await store.findOne('students', { dni });
    if (clash && clash.id !== ignoreId) {
      throw new HttpError(409, `Ya existe un estudiante con este DNI (${clash.first_names} ${clash.last_names}).`);
    }
  }

  async function uniqueUsername(base) {
    let candidate = base;
    for (let n = 2; await store.findOne('users', { username: candidate }); n += 1) candidate = `${base}${n}`;
    return candidate;
  }

  router.post('/students', async (req, res) => {
    const input = await validateStudentInput(store, req.body || {});
    await assertUniqueDni(input.dni);
    const password = temporaryPassword();
    const username = await uniqueUsername(baseUsername(input.guardianName));
    const now = toIsoDateTime(new Date());

    const studentId = await store.insert('students', {
      dni: input.dni,
      last_names: input.lastNames,
      first_names: input.firstNames,
      section_id: input.sectionId,
      active: true,
      created_at: now,
      updated_at: now,
    });
    const userId = await store.insert('users', {
      username,
      password_hash: auth.hashPassword(password),
      role: 'apoderado',
      full_name: input.guardianName,
      title: null,
      active: true,
      created_at: now,
    });
    const guardianId = await store.insert('guardians', {
      user_id: userId,
      student_id: studentId,
      full_name: input.guardianName,
      phone: input.phone,
      relationship: null,
      consent_accepted_at: null,
      notifications_enabled: false,
    });
    await ensureConversation(store, guardianId);
    store.clearCache('report:');

    res.status(201).json({ student: await studentView(studentId), credentials: { username, temporaryPassword: password } });
  });

  router.put('/students/:id', async (req, res) => {
    const id = parseId(req.params.id, 'estudiante');
    if (!(await store.get('students', id))) throw new HttpError(404, 'Estudiante no encontrado.');
    const input = await validateStudentInput(store, req.body || {});
    await assertUniqueDni(input.dni, id);

    await store.update('students', id, {
      dni: input.dni,
      last_names: input.lastNames,
      first_names: input.firstNames,
      section_id: input.sectionId,
      updated_at: toIsoDateTime(new Date()),
    });
    const guardian = await store.findOne('guardians', { student_id: id });
    if (guardian) {
      await store.update('guardians', guardian.id, { full_name: input.guardianName, phone: input.phone });
      await store.update('users', guardian.user_id, { full_name: input.guardianName });
    }
    store.clearCache('report:');
    res.json({ student: await studentView(id) });
  });

  /** Activar / desactivar (no se eliminan estudiantes para conservar su historial). */
  router.patch('/students/:id/active', async (req, res) => {
    const id = parseId(req.params.id, 'estudiante');
    if (typeof req.body?.active !== 'boolean') throw new HttpError(400, 'Indica si el estudiante queda activo.');
    const active = req.body.active;
    if (!(await store.get('students', id))) throw new HttpError(404, 'Estudiante no encontrado.');
    await store.update('students', id, { active, updated_at: toIsoDateTime(new Date()) });
    const guardian = await store.findOne('guardians', { student_id: id });
    if (guardian) {
      await store.update('users', guardian.user_id, { active });
      if (!active) await store.removeWhere('sessions', { user_id: guardian.user_id });
    }
    store.clearCache('report:');
    res.json({ student: await studentView(id) });
  });

  router.post('/students/:id/guardian/reset-password', async (req, res) => {
    const id = parseId(req.params.id, 'estudiante');
    const guardian = await store.findOne('guardians', { student_id: id });
    const user = guardian && (await store.get('users', guardian.user_id));
    if (!user) throw new HttpError(404, 'El estudiante no tiene apoderado registrado.');
    const password = temporaryPassword();
    await store.update('users', user.id, { password_hash: auth.hashPassword(password) });
    await store.removeWhere('sessions', { user_id: user.id });
    res.json({ credentials: { username: user.username, temporaryPassword: password } });
  });

  router.get('/teachers', async (req, res) => {
    const [teachers, assignments, sections, courses] = await Promise.all([
      store.find('users', { where: { role: 'docente' } }),
      store.find('teaching_assignments'),
      store.find('sections'),
      getCourses(store),
    ]);
    const courseName = new Map(courses.map((c) => [c.id, c]));
    const sectionName = new Map(sections.map((s) => [s.id, s.name]));
    res.json({
      teachers: teachers
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
        .map((t) => ({
          id: t.id,
          username: t.username,
          fullName: t.full_name,
          title: t.title,
          active: Boolean(t.active),
          assignments: assignments
            .filter((a) => a.teacher_id === t.id)
            .sort((a, b) => a.course_id - b.course_id)
            .map((a) => ({ course: courseName.get(a.course_id).name, section: sectionName.get(a.section_id) })),
          tutorOf: sections.filter((s) => s.tutor_id === t.id).map((s) => s.name),
        })),
    });
  });

  router.get('/sections', async (req, res) => {
    const [sections, students, assignments, users, courses] = await Promise.all([
      store.find('sections'),
      store.find('students', { where: { active: true } }),
      store.find('teaching_assignments'),
      store.find('users', { where: { role: 'docente' } }),
      getCourses(store),
    ]);
    const teacherName = new Map(users.map((u) => [u.id, u.full_name]));
    const courseName = new Map(courses.map((c) => [c.id, c.name]));
    res.json({
      sections: sections.sort(byText('name')).map((s) => ({
        id: s.id,
        name: s.name,
        grade: s.grade,
        schoolYear: s.school_year,
        tutorName: teacherName.get(s.tutor_id) ?? null,
        students: students.filter((st) => st.section_id === s.id).length,
        courses: assignments
          .filter((a) => a.section_id === s.id)
          .sort((a, b) => a.course_id - b.course_id)
          .map((a) => ({ id: a.course_id, name: courseName.get(a.course_id), teacherName: teacherName.get(a.teacher_id) })),
      })),
    });
  });

  router.get('/consents', async (req, res) => {
    const [students, guardians] = await Promise.all([store.find('students', { where: { active: true } }), store.find('guardians')]);
    const guardianByStudent = new Map(guardians.map((g) => [g.student_id, g]));
    const rows = students
      .filter((s) => guardianByStudent.has(s.id))
      .sort((a, b) => {
        const pending = (s) => (guardianByStudent.get(s.id).consent_accepted_at ? 0 : 1);
        return pending(b) - pending(a) || byName(a, b);
      });
    res.json({
      items: rows.map((s) => {
        const g = guardianByStudent.get(s.id);
        return {
          studentName: fullName(s),
          guardianName: g.full_name,
          phone: g.phone,
          acceptedAt: g.consent_accepted_at ?? null,
          notificationsEnabled: Boolean(g.notifications_enabled),
        };
      }),
    });
  });

  return router;
};
