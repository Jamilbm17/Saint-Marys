const express = require('express');
const auth = require('../auth');
const { HttpError, fullName, toIsoDateTime } = require('../util');
const { assertCourseAccess, requireTerm, parseId, notifyGuardian } = require('../domain');

const GRADE_KEYS = ['c1', 'c2', 'c3', 'c4'];

/** Normaliza un valor de nota: null si está vacío; entero 0-20 o lanza error. */
function parseGradeValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (!/^\d{1,2}$/.test(text)) return NaN;
  const number = Number(text);
  return number >= 0 && number <= 20 ? number : NaN;
}

module.exports = function gradesRoutes(db) {
  const router = express.Router();
  router.use(auth.requireRole('docente', 'direccion'));

  router.get('/grades', (req, res) => {
    const sectionId = parseId(req.query.sectionId, 'sección');
    const courseId = parseId(req.query.courseId, 'curso');
    const term = requireTerm(db, req.query.term);
    assertCourseAccess(db, req.user, sectionId, courseId);

    const competencies = db
      .prepare('SELECT code, description FROM competencies WHERE course_id = ? ORDER BY code')
      .all(courseId);
    const rows = db
      .prepare(`
        SELECT s.id AS studentId, s.last_names, s.first_names, g.c1, g.c2, g.c3, g.c4, g.status
        FROM students s
        LEFT JOIN grades g ON g.student_id = s.id AND g.course_id = ? AND g.term = ?
        WHERE s.section_id = ? AND s.active = 1
        ORDER BY s.last_names, s.first_names`)
      .all(courseId, term.code, sectionId);

    res.json({
      term: term.code,
      competencies,
      rows: rows.map((r, index) => ({
        number: index + 1,
        studentId: r.studentId,
        fullName: fullName(r),
        values: GRADE_KEYS.map((k) => r[k]),
        status: r.status || 'draft',
      })),
    });
  });

  router.put('/grades', (req, res) => {
    const { sectionId: rawSection, courseId: rawCourse, term: rawTerm, rows, publish } = req.body || {};
    const sectionId = parseId(rawSection, 'sección');
    const courseId = parseId(rawCourse, 'curso');
    const term = requireTerm(db, rawTerm);
    assertCourseAccess(db, req.user, sectionId, courseId);
    if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'No hay notas para guardar.');

    const students = new Map(
      db
        .prepare('SELECT id, last_names, first_names FROM students WHERE section_id = ? AND active = 1')
        .all(sectionId)
        .map((s) => [s.id, s]),
    );
    const course = db.prepare('SELECT name FROM courses WHERE id = ?').get(courseId);
    const previous = new Map(
      db
        .prepare('SELECT * FROM grades WHERE course_id = ? AND term = ?')
        .all(courseId, term.code)
        .map((g) => [g.student_id, g]),
    );

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

    const upsert = db.prepare(`
      INSERT INTO grades (student_id, course_id, term, c1, c2, c3, c4, status, published_at, updated_by, updated_at)
      VALUES (@studentId, @courseId, @term, @c1, @c2, @c3, @c4, @status, @publishedAt, @updatedBy, @updatedAt)
      ON CONFLICT (student_id, course_id, term) DO UPDATE SET
        c1 = excluded.c1, c2 = excluded.c2, c3 = excluded.c3, c4 = excluded.c4,
        status = excluded.status, published_at = excluded.published_at,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at`);

    const result = { saved: 0, published: Boolean(publish), notified: 0, withoutNotifications: 0 };
    db.transaction(() => {
      const now = toIsoDateTime(new Date());
      for (const { studentId, values } of parsed) {
        const before = previous.get(studentId);
        const unchanged =
          before && GRADE_KEYS.every((k, i) => before[k] === values[i]) && before.status === 'published';
        upsert.run({
          studentId,
          courseId,
          term: term.code,
          c1: values[0],
          c2: values[1],
          c3: values[2],
          c4: values[3],
          status: publish ? 'published' : 'draft',
          publishedAt: publish ? (unchanged ? before.published_at : now) : null,
          updatedBy: req.user.id,
          updatedAt: now,
        });
        result.saved += 1;

        if (publish && !unchanged) {
          const wasPublished = before?.status === 'published';
          const sent = notifyGuardian(db, studentId, {
            kind: 'notas',
            title: wasPublished ? 'Notas actualizadas' : 'Notas publicadas',
            body: `${course.name} – ${term.code} Bimestre ${wasPublished ? 'fue actualizada' : 'ya está disponible'}.`,
          });
          if (sent.sent) result.notified += 1;
          else result.withoutNotifications += 1;
        }
      }
    })();
    res.json(result);
  });

  return router;
};
