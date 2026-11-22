const express = require('express');
const auth = require('../auth');
const { HttpError, isValidIsoDate, parseIsoDate, isWeekend, toIsoDate, toIsoDateTime, fullName } = require('../util');
const { accessibleSections, assertSectionAccess, parseId, notifyGuardian, addSystemMessage } = require('../domain');

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

module.exports = function attendanceRoutes(db) {
  const router = express.Router();
  router.use(auth.requireRole('docente', 'direccion'));

  router.get('/sections', (req, res) => {
    const sections = accessibleSections(db, req.user).map((section) => ({
      ...section,
      courses: db
        .prepare(`
          SELECT DISTINCT c.id, c.name FROM courses c
          LEFT JOIN teaching_assignments ta ON ta.course_id = c.id AND ta.section_id = ? AND ta.teacher_id = ?
          WHERE ta.id IS NOT NULL OR ? = 'direccion'
          ORDER BY c.id`)
        .all(section.id, req.user.id, req.user.role),
    }));
    res.json({ sections });
  });

  router.get('/attendance', (req, res) => {
    const sectionId = parseId(req.query.sectionId, 'sección');
    assertSectionAccess(db, req.user, sectionId);
    validateDate(req.query.date);
    const rows = db
      .prepare(`
        SELECT s.id AS studentId, s.last_names, s.first_names, a.status, a.arrival_time AS arrivalTime
        FROM students s
        LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
        WHERE s.section_id = ? AND s.active = 1
        ORDER BY s.last_names, s.first_names`)
      .all(req.query.date, sectionId);
    const saved = rows.some((r) => r.status);
    res.json({
      date: req.query.date,
      saved,
      students: rows.map((r, index) => ({
        number: index + 1,
        studentId: r.studentId,
        fullName: fullName(r),
        status: r.status || 'A',
        arrivalTime: r.arrivalTime,
      })),
    });
  });

  router.put('/attendance', (req, res) => {
    const { sectionId: rawSection, date, records } = req.body || {};
    const sectionId = parseId(rawSection, 'sección');
    assertSectionAccess(db, req.user, sectionId);
    validateDate(date);
    if (!Array.isArray(records) || !records.length) throw new HttpError(400, 'No hay registros para guardar.');

    const students = new Map(
      db
        .prepare('SELECT id, last_names, first_names FROM students WHERE section_id = ? AND active = 1')
        .all(sectionId)
        .map((s) => [s.id, s]),
    );
    const current = new Map(
      db
        .prepare('SELECT student_id, status, arrival_time FROM attendance WHERE date = ? AND section_id = ?')
        .all(date, sectionId)
        .map((r) => [r.student_id, r]),
    );

    const seen = new Set();
    for (const r of records) {
      if (!students.has(r.studentId)) throw new HttpError(400, 'Hay estudiantes que no pertenecen a la sección.');
      if (!STATUSES.includes(r.status)) throw new HttpError(400, 'Estado de asistencia no válido.');
      if (r.arrivalTime && !TIME_PATTERN.test(r.arrivalTime)) throw new HttpError(400, 'Hora de ingreso no válida.');
      if (seen.has(r.studentId)) throw new HttpError(400, 'Hay estudiantes repetidos en el registro.');
      seen.add(r.studentId);
    }

    const upsert = db.prepare(`
      INSERT INTO attendance (student_id, section_id, date, status, arrival_time, recorded_by, updated_at)
      VALUES (@studentId, @sectionId, @date, @status, @arrivalTime, @recordedBy, @updatedAt)
      ON CONFLICT (student_id, date) DO UPDATE SET
        status = excluded.status, arrival_time = excluded.arrival_time,
        recorded_by = excluded.recorded_by, updated_at = excluded.updated_at`);

    const result = { saved: 0, notified: 0, withoutNotifications: 0 };
    const save = db.transaction(() => {
      for (const r of records) {
        const previous = current.get(r.studentId);
        const arrivalTime = r.status === 'T' ? r.arrivalTime || null : null;
        upsert.run({
          studentId: r.studentId,
          sectionId,
          date,
          status: r.status,
          arrivalTime,
          recordedBy: req.user.id,
          updatedAt: toIsoDateTime(new Date()),
        });
        result.saved += 1;

        const changed = !previous || previous.status !== r.status || previous.arrival_time !== arrivalTime;
        if (r.status === 'A' || !changed) continue;

        const student = students.get(r.studentId);
        const name = student.first_names;
        const bodies = {
          T: arrivalTime
            ? `${name} ingresó a las ${formatClock(arrivalTime)} El horario de ingreso es hasta las 7:50 a. m.`
            : `${name} llegó tarde. El horario de ingreso es hasta las 7:50 a. m.`,
          FJ: `Se registró una falta justificada de ${name}.`,
          FI: `Se registró una falta injustificada de ${name}. Comunícate con la tutora si necesitas justificarla.`,
        };
        const titles = { T: 'Tardanza', FJ: 'Falta justificada', FI: 'Falta injustificada' };
        const sent = notifyGuardian(db, r.studentId, { kind: 'asistencia', title: titles[r.status], body: bodies[r.status] });
        if (sent.sent) {
          result.notified += 1;
          const notice =
            r.status === 'T' && arrivalTime
              ? `Aviso automático enviado: tardanza registrada a las ${formatClock(arrivalTime)}`
              : `Aviso automático enviado: ${titles[r.status].toLowerCase()} registrada`;
          addSystemMessage(db, r.studentId, notice);
        } else {
          result.withoutNotifications += 1;
        }
      }
    });
    save();
    res.json(result);
  });

  return router;
};
