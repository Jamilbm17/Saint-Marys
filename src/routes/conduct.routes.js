const express = require('express');
const auth = require('../auth');
const { HttpError, isValidIsoDate, toIsoDate, toIsoDateTime, fullName } = require('../util');
const { assertSectionAccess, requireTerm, parseId, notifyGuardian } = require('../domain');

const TYPES = ['leve', 'moderada', 'grave'];

module.exports = function conductRoutes(db) {
  const router = express.Router();
  router.use(auth.requireRole('docente', 'direccion'));

  router.get('/conduct', (req, res) => {
    const sectionId = parseId(req.query.sectionId, 'sección');
    const term = requireTerm(db, req.query.term);
    assertSectionAccess(db, req.user, sectionId);
    const items = db
      .prepare(`
        SELECT i.id, i.date, i.type, i.description, i.notified_at AS notifiedAt,
               i.notified_guardian AS notifiedGuardian, s.last_names, s.first_names
        FROM conduct_incidents i JOIN students s ON s.id = i.student_id
        WHERE i.section_id = ? AND i.date BETWEEN ? AND ?
        ORDER BY i.date DESC, i.id DESC`)
      .all(sectionId, term.startDate, term.endDate);
    const students = db
      .prepare('SELECT id, last_names, first_names FROM students WHERE section_id = ? AND active = 1 ORDER BY last_names, first_names')
      .all(sectionId)
      .map((s) => ({ id: s.id, fullName: fullName(s) }));
    res.json({
      students,
      items: items.map((i) => ({
        id: i.id,
        date: i.date,
        type: i.type,
        description: i.description,
        studentName: fullName(i),
        notifiedAt: i.notifiedAt,
        notifiedGuardian: i.notifiedGuardian,
      })),
    });
  });

  router.post('/conduct', (req, res) => {
    const { studentId: rawStudent, date, type, description } = req.body || {};
    const studentId = parseId(rawStudent, 'estudiante');
    const student = db
      .prepare('SELECT id, last_names, first_names, section_id FROM students WHERE id = ? AND active = 1')
      .get(studentId);
    if (!student) throw new HttpError(404, 'Estudiante no encontrado.');
    assertSectionAccess(db, req.user, student.section_id);

    if (!isValidIsoDate(date)) throw new HttpError(400, 'Fecha no válida.');
    if (date > toIsoDate(new Date())) throw new HttpError(400, 'La fecha de la incidencia no puede ser futura.');
    if (!TYPES.includes(type)) throw new HttpError(400, 'Tipo de incidencia no válido.');
    const text = typeof description === 'string' ? description.trim() : '';
    if (text.length < 5) throw new HttpError(400, 'Describe lo observado (mínimo 5 caracteres).');
    if (text.length > 1000) throw new HttpError(400, 'La descripción no puede superar los 1000 caracteres.');

    const created = db.transaction(() => {
      const id = db
        .prepare('INSERT INTO conduct_incidents (student_id, section_id, date, type, description, recorded_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(studentId, student.section_id, date, type, text, req.user.id).lastInsertRowid;
      const sent = notifyGuardian(db, studentId, { kind: 'conducta', title: `Incidencia ${type}`, body: text });
      if (sent.sent) {
        db.prepare('UPDATE conduct_incidents SET notified_at = ?, notified_guardian = ? WHERE id = ?').run(
          sent.at,
          sent.guardianName,
          id,
        );
      }
      return { id, sent };
    })();

    res.status(201).json({
      id: created.id,
      notification: {
        sent: created.sent.sent,
        guardianName: created.sent.guardianName,
        at: created.sent.at || toIsoDateTime(new Date()),
      },
    });
  });

  return router;
};
