const express = require('express');
const auth = require('../auth');
const { HttpError, isValidIsoDate, toIsoDate, toIsoDateTime, fullName } = require('../util');
const { assertSectionAccess, requireTerm, parseId, notifyGuardian, byName } = require('../domain');

const TYPES = ['leve', 'moderada', 'grave'];

module.exports = function conductRoutes(store) {
  const router = express.Router();
  router.use(auth.requireRole('docente', 'direccion'));

  router.get('/conduct', async (req, res) => {
    const sectionId = parseId(req.query.sectionId, 'sección');
    const term = await requireTerm(store, req.query.term);
    await assertSectionAccess(store, req.user, sectionId);
    const [incidents, students] = await Promise.all([
      store.find('conduct_incidents', { where: { section_id: sectionId } }),
      store.find('students', { where: { section_id: sectionId } }),
    ]);
    const byId = new Map(students.map((s) => [s.id, s]));
    const items = incidents
      .filter((i) => i.date >= term.startDate && i.date <= term.endDate)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    res.json({
      students: students
        .filter((s) => s.active)
        .sort(byName)
        .map((s) => ({ id: s.id, fullName: fullName(s) })),
      items: items.map((i) => ({
        id: i.id,
        date: i.date,
        type: i.type,
        description: i.description,
        studentName: fullName(byId.get(i.student_id)),
        notifiedAt: i.notified_at,
        notifiedGuardian: i.notified_guardian,
      })),
    });
  });

  router.post('/conduct', async (req, res) => {
    const { studentId: rawStudent, date, type, description } = req.body || {};
    const studentId = parseId(rawStudent, 'estudiante');
    const student = await store.get('students', studentId);
    if (!student?.active) throw new HttpError(404, 'Estudiante no encontrado.');
    await assertSectionAccess(store, req.user, student.section_id);

    if (!isValidIsoDate(date)) throw new HttpError(400, 'Fecha no válida.');
    if (date > toIsoDate(new Date())) throw new HttpError(400, 'La fecha de la incidencia no puede ser futura.');
    if (!TYPES.includes(type)) throw new HttpError(400, 'Tipo de incidencia no válido.');
    const text = typeof description === 'string' ? description.trim() : '';
    if (text.length < 5) throw new HttpError(400, 'Describe lo observado (mínimo 5 caracteres).');
    if (text.length > 1000) throw new HttpError(400, 'La descripción no puede superar los 1000 caracteres.');

    const id = await store.insert('conduct_incidents', {
      student_id: studentId,
      section_id: student.section_id,
      date,
      type,
      description: text,
      recorded_by: req.user.id,
      created_at: toIsoDateTime(new Date()),
      notified_at: null,
      notified_guardian: null,
    });
    const sent = await notifyGuardian(store, studentId, { kind: 'conducta', title: `Incidencia ${type}`, body: text });
    if (sent.sent) await store.update('conduct_incidents', id, { notified_at: sent.at, notified_guardian: sent.guardianName });
    store.clearCache('report:');

    res.status(201).json({
      id,
      notification: {
        sent: sent.sent,
        guardianName: sent.guardianName,
        at: sent.at || toIsoDateTime(new Date()),
      },
    });
  });

  return router;
};
