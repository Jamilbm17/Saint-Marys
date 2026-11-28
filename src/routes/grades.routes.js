const express = require('express');
const auth = require('../auth');
const { HttpError, fullName, toIsoDateTime } = require('../util');
const {
  assertCourseAccess,
  requireTerm,
  parseId,
  notifyGuardian,
  getCourses,
  getCompetencies,
  byName,
} = require('../domain');

const GRADE_KEYS = ['c1', 'c2', 'c3', 'c4'];

/** Normaliza un valor de nota: null si está vacío; entero 0-20 o NaN si no es válido. */
function parseGradeValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (!/^\d{1,2}$/.test(text)) return NaN;
  const number = Number(text);
  return number >= 0 && number <= 20 ? number : NaN;
}

module.exports = function gradesRoutes(store) {
  const router = express.Router();
  router.use(auth.requireRole('docente', 'direccion'));

  router.get('/grades', async (req, res) => {
    const sectionId = parseId(req.query.sectionId, 'sección');
    const courseId = parseId(req.query.courseId, 'curso');
    const term = await requireTerm(store, req.query.term);
    await assertCourseAccess(store, req.user, sectionId, courseId);

    const [competencies, students, grades] = await Promise.all([
      getCompetencies(store),
      store.find('students', { where: { section_id: sectionId, active: true } }),
      store.find('grades', { where: { course_id: courseId, term: term.code } }),
    ]);
    const byStudent = new Map(grades.map((g) => [g.student_id, g]));

    res.json({
      term: term.code,
      competencies: competencies.filter((c) => c.course_id === courseId).map((c) => ({ code: c.code, description: c.description })),
      rows: students.sort(byName).map((s, index) => {
        const g = byStudent.get(s.id);
        return {
          number: index + 1,
          studentId: s.id,
          fullName: fullName(s),
          values: GRADE_KEYS.map((k) => g?.[k] ?? null),
          status: g?.status || 'draft',
        };
      }),
    });
  });

  router.put('/grades', async (req, res) => {
    const { sectionId: rawSection, courseId: rawCourse, term: rawTerm, rows, publish } = req.body || {};
    const sectionId = parseId(rawSection, 'sección');
    const courseId = parseId(rawCourse, 'curso');
    const term = await requireTerm(store, rawTerm);
    await assertCourseAccess(store, req.user, sectionId, courseId);
    if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'No hay notas para guardar.');

    const [studentList, courses, previousList] = await Promise.all([
      store.find('students', { where: { section_id: sectionId, active: true } }),
      getCourses(store),
      store.find('grades', { where: { course_id: courseId, term: term.code } }),
    ]);
    const students = new Map(studentList.map((s) => [s.id, s]));
    const course = courses.find((c) => c.id === courseId);
    const previous = new Map(previousList.map((g) => [g.student_id, g]));

    const invalid = [];
    const incomplete = [];
    const parsed = rows.map((row) => {
      const student = students.get(row.studentId);
      if (!student) throw new HttpError(400, 'Hay estudiantes que no pertenecen a la sección.');
      if (!Array.isArray(row.values) || row.values.length !== 4) throw new HttpError(400, 'Formato de notas no válido.');
      const values = row.values.map(parseGradeValue);
      values.forEach((v, k) => {
        if (Number.isNaN(v)) invalid.push(`${fullName(student)} (C${k + 1})`);
      });
      if (values.some((v) => v === null)) incomplete.push(fullName(student));
      return { studentId: row.studentId, values };
    });
    if (invalid.length) {
      throw new HttpError(422, `Nota fuera de rango en ${invalid.join(', ')}. Solo se aceptan valores de 0 a 20.`);
    }
    if (publish && incomplete.length) {
      throw new HttpError(422, `Faltan notas por completar para publicar: ${incomplete.join(', ')}.`);
    }

    const now = toIsoDateTime(new Date());
    const fresh = parsed.filter(({ studentId }) => !previous.has(studentId));
    const newIds = await store.allocIds('grades', fresh.length);
    const ops = [];
    const toNotify = [];
    for (const { studentId, values } of parsed) {
      const before = previous.get(studentId);
      const unchanged = before && GRADE_KEYS.every((k, i) => (before[k] ?? null) === values[i]) && before.status === 'published';
      const data = {
        student_id: studentId,
        course_id: courseId,
        term: term.code,
        c1: values[0],
        c2: values[1],
        c3: values[2],
        c4: values[3],
        status: publish ? 'published' : 'draft',
        published_at: publish ? (unchanged ? before.published_at : now) : null,
        updated_by: req.user.id,
        updated_at: now,
      };
      const id = before ? before.id : newIds[fresh.findIndex((f) => f.studentId === studentId)];
      ops.push({ type: 'set', col: 'grades', id, data });
      if (publish && !unchanged) toNotify.push({ studentId, wasPublished: before?.status === 'published' });
    }
    await store.commit(ops);
    store.clearCache('report:');

    const result = { saved: parsed.length, published: Boolean(publish), notified: 0, withoutNotifications: 0 };
    for (const { studentId, wasPublished } of toNotify) {
      const sent = await notifyGuardian(store, studentId, {
        kind: 'notas',
        title: wasPublished ? 'Notas actualizadas' : 'Notas publicadas',
        body: `${course.name} – ${term.code} Bimestre ${wasPublished ? 'fue actualizada' : 'ya está disponible'}.`,
      });
      if (sent.sent) result.notified += 1;
      else result.withoutNotifications += 1;
    }
    res.json(result);
  });

  return router;
};
