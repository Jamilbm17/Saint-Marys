const express = require('express');
const auth = require('../auth');
const { HttpError, round1, toIsoDate, toIsoDateTime, addDays } = require('../util');
const {
  RISK_AVERAGE,
  requireTerm,
  resolveCurrentTerm,
  conductGrade,
  studentCourseGrades,
  studentTermAttendance,
} = require('../domain');

const NOTIFICATION_KINDS = ['asistencia', 'conducta', 'notas', 'mensaje', 'comunicado'];

module.exports = function guardianRoutes(db) {
  const router = express.Router();
  router.use(auth.requireRole('apoderado'), auth.requireConsent);

  const termFrom = (req) => (req.query.term ? requireTerm(db, req.query.term) : resolveCurrentTerm(db));

  router.get('/summary', (req, res) => {
    const term = termFrom(req);
    const studentId = req.guardian.studentId;
    const student = db
      .prepare(`
        SELECT s.last_names, s.first_names, sec.name AS sectionName, sec.grade
        FROM students s JOIN sections sec ON sec.id = s.section_id WHERE s.id = ?`)
      .get(studentId);

    const courses = studentCourseGrades(db, studentId, term.code);
    const average = courses.length ? round1(courses.reduce((sum, c) => sum + c.grade, 0) / courses.length) : null;
    const attendance = studentTermAttendance(db, studentId, term.code);

    const incidents = db
      .prepare('SELECT type FROM conduct_incidents WHERE student_id = ? AND date BETWEEN ? AND ?')
      .all(studentId, term.startDate, term.endDate);
    const counts = incidents.reduce((acc, i) => ({ ...acc, [i.type]: (acc[i.type] || 0) + 1 }), {});

    const recent = db
      .prepare(`
        SELECT a.status, a.date, a.arrival_time AS arrivalTime, u.full_name AS teacherName
        FROM attendance a LEFT JOIN users u ON u.id = a.recorded_by
        WHERE a.student_id = ? ORDER BY a.date DESC LIMIT 1`)
      .get(studentId);
    const alert =
      recent && recent.status !== 'A' && recent.date >= toIsoDate(addDays(new Date(), -7)) ? recent : null;

    res.json({
      term: term.code,
      today: toIsoDate(new Date()),
      student: {
        fullName: `${student.first_names} ${student.last_names}`,
        sectionName: student.sectionName,
        grade: student.grade,
      },
      average,
      averageStatus: average === null ? null : average >= RISK_AVERAGE ? 'Aprobado' : 'En riesgo',
      attendance: { percent: attendance.percent, tardies: attendance.T, absences: attendance.FJ + attendance.FI },
      conduct: { grade: conductGrade(incidents), counts, total: incidents.length },
      alert,
      courses: courses.map((c) => ({ courseId: c.courseId, name: c.course, grade: c.grade })),
    });
  });

  router.get('/grades', (req, res) => {
    const term = termFrom(req);
    const studentId = req.guardian.studentId;
    const courses = studentCourseGrades(db, studentId, term.code);
    const competencies = db.prepare('SELECT course_id AS courseId, code, description FROM competencies ORDER BY course_id, code').all();
    const average = courses.length ? round1(courses.reduce((sum, c) => sum + c.grade, 0) / courses.length) : null;
    res.json({
      term: term.code,
      average,
      courses: courses.map((c) => ({
        courseId: c.courseId,
        name: c.course,
        grade: c.grade,
        competencies: competencies
          .filter((k) => k.courseId === c.courseId)
          .map((k, i) => ({ code: k.code, description: k.description, value: [c.c1, c.c2, c.c3, c.c4][i] })),
      })),
    });
  });

  router.get('/notifications', (req, res) => {
    const { kind } = req.query;
    if (kind && !NOTIFICATION_KINDS.includes(kind)) throw new HttpError(400, 'Tipo de notificación no válido.');
    const items = db
      .prepare(`
        SELECT id, kind, title, body, created_at AS createdAt, read_at AS readAt
        FROM notifications WHERE guardian_id = ? ${kind ? 'AND kind = ?' : ''}
        ORDER BY created_at DESC, id DESC LIMIT 100`)
      .all(...(kind ? [req.guardian.id, kind] : [req.guardian.id]));
    res.json({ today: toIsoDate(new Date()), items });
  });

  router.post('/notifications/read-all', (req, res) => {
    const info = db
      .prepare('UPDATE notifications SET read_at = ? WHERE guardian_id = ? AND read_at IS NULL')
      .run(toIsoDateTime(new Date()), req.guardian.id);
    res.json({ marked: info.changes });
  });

  router.post('/notifications/:id/read', (req, res) => {
    db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND guardian_id = ?').run(
      toIsoDateTime(new Date()),
      Number(req.params.id),
      req.guardian.id,
    );
    res.json({ ok: true });
  });

  return router;
};
