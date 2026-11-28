const express = require('express');
const auth = require('../auth');
const { HttpError, isValidIsoDate, parseIsoDate, isWeekend, toIsoDate, toIsoDateTime, fullName } = require('../util');
const {
  accessibleSections,
  assertSectionAccess,
  parseId,
  notifyGuardian,
  addSystemMessage,
  getCourses,
  byName,
} = require('../domain');

const STATUSES = ['A', 'T', 'FJ', 'FI'];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const formatClock = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'p. m.' : 'a. m.';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
};

function validateDate(value) {
  if (!isValidIsoDate(value)) throw new HttpError(400, 'Fecha no válida.');
  const date = parseIsoDate(value);
  if (isWeekend(date)) throw new HttpError(400, 'Solo se registra asistencia de lunes a viernes.');
  if (value > toIsoDate(new Date())) throw new HttpError(400, 'No se puede registrar asistencia de fechas futuras.');
}

module.exports = function attendanceRoutes(store) {
  const router = express.Router();
  router.use(auth.requireRole('docente', 'direccion'));

  router.get('/sections', async (req, res) => {
    const [sections, courses, assignments] = await Promise.all([
      accessibleSections(store, req.user),
      getCourses(store),
      req.user.role === 'direccion' ? [] : store.find('teaching_assignments', { where: { teacher_id: req.user.id } }),
    ]);
    res.json({
      sections: sections.map((section) => {
        const allowed = new Set(assignments.filter((a) => a.section_id === section.id).map((a) => a.course_id));
        return {
          ...section,
          courses: courses
            .filter((c) => req.user.role === 'direccion' || allowed.has(c.id))
            .map((c) => ({ id: c.id, name: c.name })),
        };
      }),
    });
  });

  router.get('/attendance', async (req, res) => {
    const sectionId = parseId(req.query.sectionId, 'sección');
    await assertSectionAccess(store, req.user, sectionId);
    validateDate(req.query.date);
    const [students, records] = await Promise.all([
      store.find('students', { where: { section_id: sectionId, active: true } }),
      store.find('attendance', { where: { section_id: sectionId, date: req.query.date } }),
    ]);
    const byStudent = new Map(records.map((r) => [r.student_id, r]));
    const rows = students.sort(byName);
    res.json({
      date: req.query.date,
      saved: rows.some((s) => byStudent.has(s.id)),
      students: rows.map((s, index) => ({
        number: index + 1,
        studentId: s.id,
        fullName: fullName(s),
        status: byStudent.get(s.id)?.status || 'A',
        arrivalTime: byStudent.get(s.id)?.arrival_time ?? null,
      })),
    });
  });

  router.put('/attendance', async (req, res) => {
    const { sectionId: rawSection, date, records } = req.body || {};
    const sectionId = parseId(rawSection, 'sección');
    await assertSectionAccess(store, req.user, sectionId);
    validateDate(date);
    if (!Array.isArray(records) || !records.length) throw new HttpError(400, 'No hay registros para guardar.');

    const [studentList, currentList] = await Promise.all([
      store.find('students', { where: { section_id: sectionId, active: true } }),
      store.find('attendance', { where: { section_id: sectionId, date } }),
    ]);
    const students = new Map(studentList.map((s) => [s.id, s]));
    const current = new Map(currentList.map((r) => [r.student_id, r]));

    const seen = new Set();
    for (const r of records) {
      if (!students.has(r.studentId)) throw new HttpError(400, 'Hay estudiantes que no pertenecen a la sección.');
      if (!STATUSES.includes(r.status)) throw new HttpError(400, 'Estado de asistencia no válido.');
      if (r.arrivalTime && !TIME_PATTERN.test(r.arrivalTime)) throw new HttpError(400, 'Hora de ingreso no válida.');
      if (seen.has(r.studentId)) throw new HttpError(400, 'Hay estudiantes repetidos en el registro.');
      seen.add(r.studentId);
    }

    const now = toIsoDateTime(new Date());
    const fresh = records.filter((r) => !current.has(r.studentId));
    const newIds = await store.allocIds('attendance', fresh.length);
    const ops = [];
    const changes = [];
    for (const r of records) {
      const previous = current.get(r.studentId);
      const arrivalTime = r.status === 'T' ? r.arrivalTime || null : null;
      const data = {
        student_id: r.studentId,
        section_id: sectionId,
        date,
        status: r.status,
        arrival_time: arrivalTime,
        recorded_by: req.user.id,
        updated_at: now,
      };
      if (previous) ops.push({ type: 'set', col: 'attendance', id: previous.id, data });
      else ops.push({ type: 'set', col: 'attendance', id: newIds[fresh.indexOf(r)], data });
      const changed = !previous || previous.status !== r.status || (previous.arrival_time ?? null) !== arrivalTime;
      if (r.status !== 'A' && changed) changes.push({ studentId: r.studentId, status: r.status, arrivalTime });
    }
    await store.commit(ops);
    store.clearCache('report:');

    const result = { saved: records.length, notified: 0, withoutNotifications: 0 };
    for (const { studentId, status, arrivalTime } of changes) {
      const name = students.get(studentId).first_names;
      const bodies = {
        T: arrivalTime
          ? `${name} ingresó a las ${formatClock(arrivalTime)} El horario de ingreso es hasta las 7:50 a. m.`
          : `${name} llegó tarde. El horario de ingreso es hasta las 7:50 a. m.`,
        FJ: `Se registró una falta justificada de ${name}.`,
        FI: `Se registró una falta injustificada de ${name}. Comunícate con la tutora si necesitas justificarla.`,
      };
      const titles = { T: 'Tardanza', FJ: 'Falta justificada', FI: 'Falta injustificada' };
      const sent = await notifyGuardian(store, studentId, { kind: 'asistencia', title: titles[status], body: bodies[status] });
      if (sent.sent) {
        result.notified += 1;
        const notice =
          status === 'T' && arrivalTime
            ? `Aviso automático enviado: tardanza registrada a las ${formatClock(arrivalTime)}`
            : `Aviso automático enviado: ${titles[status].toLowerCase()} registrada`;
        await addSystemMessage(store, studentId, notice);
      } else {
        result.withoutNotifications += 1;
      }
    }
    res.json(result);
  });

  return router;
};
