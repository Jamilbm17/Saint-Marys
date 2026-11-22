const express = require('express');
const ExcelJS = require('exceljs');
const auth = require('../auth');
const { fullName, round1, courseGrade, toIsoDateTime } = require('../util');
const { RISK_AVERAGE, RISK_UNJUSTIFIED_ABSENCES, getTerms, requireTerm, resolveCurrentTerm } = require('../domain');

const mean = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);

module.exports = function reportsRoutes(db) {
  const router = express.Router();
  router.use(auth.requireRole('direccion'));

  /** Promedios de cada estudiante activo (solo notas publicadas) en un bimestre. */
  function studentAverages(termCode) {
    const rows = db
      .prepare(`
        SELECT s.id AS studentId, s.last_names, s.first_names, c.name AS course, g.c1, g.c2, g.c3, g.c4
        FROM grades g
        JOIN students s ON s.id = g.student_id AND s.active = 1
        JOIN courses c ON c.id = g.course_id
        WHERE g.term = ? AND g.status = 'published'
        ORDER BY s.last_names, s.first_names, c.id`)
      .all(termCode);
    const byStudent = new Map();
    for (const r of rows) {
      const grade = courseGrade(r);
      if (grade === null) continue;
      if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, { studentId: r.studentId, name: fullName(r), grades: [] });
      byStudent.get(r.studentId).grades.push({ course: r.course, grade });
    }
    return [...byStudent.values()].map((s) => ({ ...s, average: round1(mean(s.grades.map((g) => g.grade))) }));
  }

  function attendancePercent(term) {
    const row = db
      .prepare(`
        SELECT COUNT(*) AS total, SUM(a.status IN ('FJ', 'FI')) AS absences
        FROM attendance a JOIN students s ON s.id = a.student_id AND s.active = 1
        WHERE a.date BETWEEN ? AND ?`)
      .get(term.startDate, term.endDate);
    return row.total ? round1(((row.total - row.absences) / row.total) * 100) : null;
  }

  function buildReport(termCode) {
    const term = requireTerm(db, termCode);
    const terms = getTerms(db);
    const previous = terms.find((t) => t.position === term.position - 1) || null;

    const students = studentAverages(term.code);
    const average = students.length ? round1(mean(students.map((s) => s.average))) : null;
    const previousStudents = previous ? studentAverages(previous.code) : [];
    const previousAverage = previousStudents.length ? round1(mean(previousStudents.map((s) => s.average))) : null;

    const attendance = attendancePercent(term);
    const previousAttendance = previous ? attendancePercent(previous) : null;

    const unjustified = new Map(
      db
        .prepare(`
          SELECT a.student_id AS studentId, COUNT(*) AS n FROM attendance a
          WHERE a.status = 'FI' AND a.date BETWEEN ? AND ? GROUP BY a.student_id`)
        .all(term.startDate, term.endDate)
        .map((r) => [r.studentId, r.n]),
    );
    const activeStudents = db
      .prepare(`
        SELECT s.id, s.last_names, s.first_names, g.id AS guardianId, g.full_name AS guardianName, g.phone
        FROM students s LEFT JOIN guardians g ON g.student_id = s.id
        WHERE s.active = 1 ORDER BY s.last_names, s.first_names`)
      .all();
    const averageByStudent = new Map(students.map((s) => [s.studentId, s.average]));

    const atRisk = [];
    for (const s of activeStudents) {
      const studentAverage = averageByStudent.get(s.id) ?? null;
      const absences = unjustified.get(s.id) || 0;
      const reasons = [];
      if (studentAverage !== null && studentAverage < RISK_AVERAGE) reasons.push(`Promedio menor a ${RISK_AVERAGE}`);
      if (absences > RISK_UNJUSTIFIED_ABSENCES) reasons.push(`Más de ${RISK_UNJUSTIFIED_ABSENCES} faltas injustificadas`);
      if (reasons.length) {
        atRisk.push({
          studentId: s.id,
          name: fullName(s),
          average: studentAverage,
          unjustifiedAbsences: absences,
          reasons,
          guardian: s.guardianId ? { id: s.guardianId, name: s.guardianName, phone: s.phone } : null,
        });
      }
    }

    const courseRows = db
      .prepare(`
        SELECT c.name AS course, g.c1, g.c2, g.c3, g.c4
        FROM grades g JOIN students s ON s.id = g.student_id AND s.active = 1 JOIN courses c ON c.id = g.course_id
        WHERE g.term = ? AND g.status = 'published'`)
      .all(term.code);
    const byCourse = new Map();
    for (const r of courseRows) {
      const grade = courseGrade(r);
      if (grade === null) continue;
      byCourse.set(r.course, [...(byCourse.get(r.course) || []), grade]);
    }
    const courses = [...byCourse.entries()]
      .map(([name, grades]) => ({ name, average: round1(mean(grades)) }))
      .sort((a, b) => b.average - a.average);

    const notif = db
      .prepare(`
        SELECT COUNT(*) AS total,
               SUM(delivered_at IS NOT NULL AND (julianday(delivered_at) - julianday(created_at)) <= 1) AS timely
        FROM notifications WHERE date(created_at) BETWEEN ? AND ?`)
      .get(term.startDate, term.endDate);

    return {
      term: term.code,
      previousTerm: previous?.code ?? null,
      generatedAt: toIsoDateTime(new Date()),
      activeStudents: activeStudents.length,
      average,
      averageDelta: average !== null && previousAverage !== null ? round1(average - previousAverage) : null,
      attendance,
      attendanceDelta: attendance !== null && previousAttendance !== null ? round1(attendance - previousAttendance) : null,
      atRisk,
      notifications: {
        total: notif.total,
        timelyPercent: notif.total ? Math.round(((notif.timely || 0) / notif.total) * 100) : null,
      },
      courses,
      attendanceByTerm: terms
        .map((t) => ({ term: t.code, percent: attendancePercent(t) }))
        .filter((t) => t.percent !== null),
      students,
    };
  }

  router.get('/performance', (req, res) => {
    const term = req.query.term ? requireTerm(db, req.query.term) : resolveCurrentTerm(db);
    res.json(buildReport(term.code));
  });

  router.get('/performance.xlsx', async (req, res) => {
    const term = req.query.term ? requireTerm(db, req.query.term) : resolveCurrentTerm(db);
    const report = buildReport(term.code);

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
