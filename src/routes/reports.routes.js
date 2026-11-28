const express = require('express');
const ExcelJS = require('exceljs');
const auth = require('../auth');
const { fullName, round1, courseGrade, toIsoDateTime } = require('../util');
const {
  RISK_AVERAGE,
  RISK_UNJUSTIFIED_ABSENCES,
  getTerms,
  getCourses,
  requireTerm,
  resolveCurrentTerm,
  byName,
} = require('../domain');

const mean = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);
const REPORT_TTL = 2 * 60 * 1000;
const dayStart = (iso) => `${iso} 00:00:00`;
const dayEnd = (iso) => `${iso} 23:59:59`;

module.exports = function reportsRoutes(store) {
  const router = express.Router();
  router.use(auth.requireRole('direccion'));

  /** Promedios de cada estudiante activo (solo notas publicadas) en un bimestre. */
  async function studentAverages(termCode, studentsById, courseNames) {
    const rows = (await store.find('grades', { where: { term: termCode, status: 'published' } }))
      .filter((g) => studentsById.has(g.student_id))
      .sort((a, b) => byName(studentsById.get(a.student_id), studentsById.get(b.student_id)) || a.course_id - b.course_id);
    const byStudent = new Map();
    for (const g of rows) {
      const grade = courseGrade(g);
      if (grade === null) continue;
      if (!byStudent.has(g.student_id)) {
        byStudent.set(g.student_id, { studentId: g.student_id, name: fullName(studentsById.get(g.student_id)), grades: [] });
      }
      byStudent.get(g.student_id).grades.push({ course: courseNames.get(g.course_id), grade });
    }
    return [...byStudent.values()].map((s) => ({ ...s, average: round1(mean(s.grades.map((g) => g.grade))) }));
  }

  /** Registros de asistencia de un bimestre (una sola consulta por rango de fechas). */
  const attendanceOfTerm = (term) => store.find('attendance', { range: { field: 'date', gte: term.startDate, lte: term.endDate } });

  const percentFrom = (records) => {
    const absences = records.filter((a) => a.status === 'FJ' || a.status === 'FI').length;
    return records.length ? round1(((records.length - absences) / records.length) * 100) : null;
  };

  async function buildReport(termCode) {
    const term = await requireTerm(store, termCode);
    const terms = await getTerms(store);
    const previous = terms.find((t) => t.position === term.position - 1) || null;

    const [allStudents, guardians, courses] = await Promise.all([
      store.find('students', { where: { active: true } }),
      store.find('guardians'),
      getCourses(store),
    ]);
    const studentsById = new Map(allStudents.map((s) => [s.id, s]));
    const guardianByStudent = new Map(guardians.map((g) => [g.student_id, g]));
    const courseNames = new Map(courses.map((c) => [c.id, c.name]));

    const students = await studentAverages(term.code, studentsById, courseNames);
    const average = students.length ? round1(mean(students.map((s) => s.average))) : null;
    const previousStudents = previous ? await studentAverages(previous.code, studentsById, courseNames) : [];
    const previousAverage = previousStudents.length ? round1(mean(previousStudents.map((s) => s.average))) : null;

    const attendanceByTermAll = await Promise.all(
      terms.map(async (t) => ({ term: t.code, records: (await attendanceOfTerm(t)).filter((a) => studentsById.has(a.student_id)) })),
    );
    const recordsOf = (code) => attendanceByTermAll.find((t) => t.term === code)?.records || [];
    const attendance = percentFrom(recordsOf(term.code));
    const previousAttendance = previous ? percentFrom(recordsOf(previous.code)) : null;

    const unjustified = new Map();
    for (const a of recordsOf(term.code)) {
      if (a.status === 'FI') unjustified.set(a.student_id, (unjustified.get(a.student_id) || 0) + 1);
    }
    const averageByStudent = new Map(students.map((s) => [s.studentId, s.average]));

    const atRisk = [];
    for (const s of [...allStudents].sort(byName)) {
      const studentAverage = averageByStudent.get(s.id) ?? null;
      const absences = unjustified.get(s.id) || 0;
      const reasons = [];
      if (studentAverage !== null && studentAverage < RISK_AVERAGE) reasons.push(`Promedio menor a ${RISK_AVERAGE}`);
      if (absences > RISK_UNJUSTIFIED_ABSENCES) reasons.push(`Más de ${RISK_UNJUSTIFIED_ABSENCES} faltas injustificadas`);
      if (reasons.length) {
        const g = guardianByStudent.get(s.id);
        atRisk.push({
          studentId: s.id,
          name: fullName(s),
          average: studentAverage,
          unjustifiedAbsences: absences,
          reasons,
          guardian: g ? { id: g.id, name: g.full_name, phone: g.phone } : null,
        });
      }
    }

    const byCourse = new Map();
    for (const s of students) {
      for (const g of s.grades) byCourse.set(g.course, [...(byCourse.get(g.course) || []), g.grade]);
    }
    const courseAverages = [...byCourse.entries()]
      .map(([name, grades]) => ({ name, average: round1(mean(grades)) }))
      .sort((a, b) => b.average - a.average);

    const notifications = await store.find('notifications', {
      range: { field: 'created_at', gte: dayStart(term.startDate), lte: dayEnd(term.endDate) },
    });
    const timely = notifications.filter((n) => {
      if (!n.delivered_at) return false;
      return new Date(n.delivered_at.replace(' ', 'T')) - new Date(n.created_at.replace(' ', 'T')) <= 24 * 60 * 60 * 1000;
    }).length;

    return {
      term: term.code,
      previousTerm: previous?.code ?? null,
      generatedAt: toIsoDateTime(new Date()),
      activeStudents: allStudents.length,
      average,
      averageDelta: average !== null && previousAverage !== null ? round1(average - previousAverage) : null,
      attendance,
      attendanceDelta: attendance !== null && previousAttendance !== null ? round1(attendance - previousAttendance) : null,
      atRisk,
      notifications: {
        total: notifications.length,
        timelyPercent: notifications.length ? Math.round((timely / notifications.length) * 100) : null,
      },
      courses: courseAverages,
      attendanceByTerm: attendanceByTermAll.map((t) => ({ term: t.term, percent: percentFrom(t.records) })).filter((t) => t.percent !== null),
      students,
    };
  }

  /** El reporte recorre varias colecciones: se guarda en caché unos minutos (se invalida al guardar datos). */
  const reportFor = (termCode) => store.cached(`report:${termCode}`, REPORT_TTL, () => buildReport(termCode));

  router.get('/performance', async (req, res) => {
    const term = req.query.term ? await requireTerm(store, req.query.term) : await resolveCurrentTerm(store);
    res.json(await reportFor(term.code));
  });

  router.get('/performance.xlsx', async (req, res) => {
    const term = req.query.term ? await requireTerm(store, req.query.term) : await resolveCurrentTerm(store);
    const report = await reportFor(term.code);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "College Saint Mary's";
    const style = (sheet) => {
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3B20' } };
      sheet.columns.forEach((column) => {
        column.width = Math.max(14, column.width || 14);
      });
    };

    const summary = workbook.addWorksheet('Resumen');
    summary.columns = [{ header: 'Indicador', width: 36 }, { header: 'Valor', width: 18 }];
    summary.addRows([
      ['Bimestre', report.term],
      ['Estudiantes activos', report.activeStudents],
      ['Promedio general', report.average],
      ['Variación del promedio', report.averageDelta],
      ['Asistencia (%)', report.attendance],
      ['Variación de la asistencia (pts)', report.attendanceDelta],
      ['Estudiantes en riesgo', report.atRisk.length],
      ['Notificaciones enviadas', report.notifications.total],
      ['Entregadas en menos de 24 h (%)', report.notifications.timelyPercent],
      ['Generado', report.generatedAt],
    ]);
    style(summary);

    const courses = workbook.addWorksheet('Promedio por curso');
    courses.columns = [{ header: 'Curso', width: 28 }, { header: 'Promedio', width: 14 }];
    report.courses.forEach((c) => courses.addRow([c.name, c.average]));
    style(courses);

    const attendance = workbook.addWorksheet('Asistencia por bimestre');
    attendance.columns = [{ header: 'Bimestre', width: 14 }, { header: 'Asistencia (%)', width: 16 }];
    report.attendanceByTerm.forEach((a) => attendance.addRow([a.term, a.percent]));
    style(attendance);

    const risk = workbook.addWorksheet('Estudiantes en riesgo');
    risk.columns = [
      { header: 'Estudiante', width: 34 },
      { header: 'Promedio', width: 12 },
      { header: 'Faltas injustificadas', width: 22 },
      { header: 'Motivo', width: 50 },
    ];
    report.atRisk.forEach((r) => risk.addRow([r.name, r.average, r.unjustifiedAbsences, r.reasons.join(' · ')]));
    style(risk);

    const detail = workbook.addWorksheet('Promedios por estudiante');
    const courseNames = report.courses.map((c) => c.name);
    detail.columns = [{ header: 'Estudiante', width: 34 }, ...courseNames.map((name) => ({ header: name, width: 18 })), { header: 'Promedio', width: 12 }];
    report.students.forEach((s) => {
      const byCourse = new Map(s.grades.map((g) => [g.course, g.grade]));
      detail.addRow([s.name, ...courseNames.map((name) => byCourse.get(name) ?? ''), s.average]);
    });
    style(detail);

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-rendimiento-${report.term}-bimestre.xlsx"`);
    res.send(Buffer.from(buffer));
  });

  return router;
};
