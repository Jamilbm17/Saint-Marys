const express = require('express');
const auth = require('../auth');
const push = require('../push');
const { webConfig } = require('../firebase');
const { HttpError, round1, toIsoDate, toIsoDateTime, addDays } = require('../util');
const {
  RISK_AVERAGE,
  requireTerm,
  resolveCurrentTerm,
  conductGrade,
  studentCourseGrades,
  termAttendanceFrom,
  getCompetencies,
} = require('../domain');

const NOTIFICATION_KINDS = ['asistencia', 'conducta', 'notas', 'mensaje', 'comunicado'];

module.exports = function guardianRoutes(store) {
  const router = express.Router();
  router.use(auth.requireRole('apoderado'), auth.requireConsent);

  const termFrom = (req) => (req.query.term ? requireTerm(store, req.query.term) : resolveCurrentTerm(store));

  router.get('/summary', async (req, res) => {
    const term = await termFrom(req);
    const studentId = req.guardian.studentId;
    const student = await store.get('students', studentId);
    const [section, courses, attendanceRecords, allIncidents] = await Promise.all([
      store.get('sections', student.section_id),
      studentCourseGrades(store, studentId, term.code),
      store.find('attendance', { where: { student_id: studentId } }),
      store.find('conduct_incidents', { where: { student_id: studentId } }),
    ]);

    const average = courses.length ? round1(courses.reduce((sum, c) => sum + c.grade, 0) / courses.length) : null;
    const attendance = termAttendanceFrom(attendanceRecords, term);
    const incidents = allIncidents.filter((i) => i.date >= term.startDate && i.date <= term.endDate);
    const counts = incidents.reduce((acc, i) => ({ ...acc, [i.type]: (acc[i.type] || 0) + 1 }), {});

    const latest = attendanceRecords.sort((a, b) => b.date.localeCompare(a.date))[0];
    let alert = null;
    if (latest && latest.status !== 'A' && latest.date >= toIsoDate(addDays(new Date(), -7))) {
      const teacher = latest.recorded_by ? await store.get('users', latest.recorded_by) : null;
      alert = { status: latest.status, date: latest.date, arrivalTime: latest.arrival_time ?? null, teacherName: teacher?.full_name ?? null };
    }

    res.json({
      term: term.code,
      today: toIsoDate(new Date()),
      student: {
        fullName: `${student.first_names} ${student.last_names}`,
        sectionName: section.name,
        grade: section.grade,
      },
      average,
      averageStatus: average === null ? null : average >= RISK_AVERAGE ? 'Aprobado' : 'En riesgo',
      attendance: { percent: attendance.percent, tardies: attendance.T, absences: attendance.FJ + attendance.FI },
      conduct: { grade: conductGrade(incidents), counts, total: incidents.length },
      alert,
      courses: courses.map((c) => ({ courseId: c.courseId, name: c.course, grade: c.grade })),
    });
  });

  router.get('/grades', async (req, res) => {
    const term = await termFrom(req);
    const [courses, competencies] = await Promise.all([
      studentCourseGrades(store, req.guardian.studentId, term.code),
      getCompetencies(store),
    ]);
    const average = courses.length ? round1(courses.reduce((sum, c) => sum + c.grade, 0) / courses.length) : null;
    res.json({
      term: term.code,
      average,
      courses: courses.map((c) => ({
        courseId: c.courseId,
        name: c.course,
        grade: c.grade,
        competencies: competencies
          .filter((k) => k.course_id === c.courseId)
          .map((k, i) => ({ code: k.code, description: k.description, value: [c.c1, c.c2, c.c3, c.c4][i] })),
      })),
    });
  });

  router.get('/notifications', async (req, res) => {
    const { kind } = req.query;
    if (kind && !NOTIFICATION_KINDS.includes(kind)) throw new HttpError(400, 'Tipo de notificación no válido.');
    const rows = await store.find('notifications', { where: { guardian_id: req.guardian.id, ...(kind ? { kind } : {}) } });
    const items = rows
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
      .slice(0, 100)
      .map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, createdAt: n.created_at, readAt: n.read_at ?? null }));
    res.json({ today: toIsoDate(new Date()), items });
  });

  router.post('/notifications/read-all', async (req, res) => {
    const unread = await store.find('notifications', { where: { guardian_id: req.guardian.id, read_at: null } });
    const stamp = toIsoDateTime(new Date());
    await store.commit(unread.map((n) => ({ type: 'update', col: 'notifications', id: n.id, data: { read_at: stamp } })));
    res.json({ marked: unread.length });
  });

  router.post('/notifications/:id/read', async (req, res) => {
    const notification = await store.get('notifications', Number(req.params.id));
    if (notification && notification.guardian_id === req.guardian.id && !notification.read_at) {
      await store.update('notifications', notification.id, { read_at: toIsoDateTime(new Date()) });
    }
    res.json({ ok: true });
  });

  // ---- Notificaciones push (Firebase Cloud Messaging) ----

  router.get('/push/config', (req, res) => {
    res.json({ enabled: push.pushEnabled() && Boolean(webConfig()), config: webConfig() });
  });

  router.post('/push/token', async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw new HttpError(400, 'Token no válido.');
    await push.registerToken(store, req.guardian.id, token, req.headers['user-agent']);
    res.status(201).json({ ok: true });
  });

  router.delete('/push/token', async (req, res) => {
    if (typeof req.body?.token === 'string') await push.unregisterToken(store, req.body.token);
    res.json({ ok: true });
  });

  return router;
};
