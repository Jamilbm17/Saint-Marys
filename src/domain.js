/**
 * Reglas de dominio compartidas por las rutas: periodos, permisos por sección,
 * notificaciones a apoderados y cálculo de indicadores.
 */
const { HttpError, toIsoDate, toIsoDateTime, lastWeekday, courseGrade, round1, fullName } = require('./util');

const ATTENDANCE_LABELS = { A: 'Asistió', T: 'Tardanza', FJ: 'Falta justificada', FI: 'Falta injustificada' };
const RISK_AVERAGE = 11;
const RISK_UNJUSTIFIED_ABSENCES = 3;

function getTerms(db) {
  return db.prepare('SELECT code, position, start_date AS startDate, end_date AS endDate FROM terms ORDER BY position').all();
}

/** Bimestre vigente: el que contiene la fecha de referencia o, si no hay, el último iniciado. */
function resolveCurrentTerm(db, refDate = new Date()) {
  const ref = toIsoDate(lastWeekday(refDate));
  const terms = getTerms(db);
  const inside = terms.find((t) => ref >= t.startDate && ref <= t.endDate);
  if (inside) return inside;
  const started = terms.filter((t) => t.startDate <= ref);
  return started.length ? started[started.length - 1] : terms[0];
}

function requireTerm(db, code) {
  const term = getTerms(db).find((t) => t.code === code);
  if (!term) throw new HttpError(400, 'Bimestre no válido.');
  return term;
}

function parseId(value, label = 'identificador') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `Valor no válido para ${label}.`);
  return id;
}

/** Secciones a las que el usuario puede acceder. La dirección accede a todas. */
function accessibleSections(db, user) {
  if (user.role === 'direccion') {
    return db.prepare('SELECT id, name, grade, tutor_id AS tutorId FROM sections ORDER BY name').all();
  }
  return db
    .prepare(`
      SELECT DISTINCT s.id, s.name, s.grade, s.tutor_id AS tutorId
      FROM sections s
      LEFT JOIN teaching_assignments ta ON ta.section_id = s.id AND ta.teacher_id = ?
      WHERE ta.id IS NOT NULL OR s.tutor_id = ?
      ORDER BY s.name`)
    .all(user.id, user.id);
}

function assertSectionAccess(db, user, sectionId) {
  const section = accessibleSections(db, user).find((s) => s.id === sectionId);
  if (!section) throw new HttpError(403, 'No tienes acceso a esta sección.');
  return section;
}

function assertCourseAccess(db, user, sectionId, courseId) {
  assertSectionAccess(db, user, sectionId);
  if (user.role === 'direccion') return;
  const assigned = db
    .prepare('SELECT 1 FROM teaching_assignments WHERE teacher_id = ? AND section_id = ? AND course_id = ?')
    .get(user.id, sectionId, courseId);
  if (!assigned) throw new HttpError(403, 'No tienes asignado este curso en la sección.');
}

/** Garantiza que exista la conversación del apoderado con la tutora de la sección. */
function ensureConversation(db, guardianId) {
  const existing = db.prepare('SELECT id FROM conversations WHERE guardian_id = ?').get(guardianId);
  if (existing) return existing.id;
  const tutor = db
    .prepare(`
      SELECT sec.tutor_id AS tutorId
      FROM guardians g
      JOIN students st ON st.id = g.student_id
      JOIN sections sec ON sec.id = st.section_id
      WHERE g.id = ?`)
    .get(guardianId);
  if (!tutor?.tutorId) return null;
  return db
    .prepare('INSERT INTO conversations (guardian_id, teacher_id) VALUES (?, ?)')
    .run(guardianId, tutor.tutorId).lastInsertRowid;
}

/**
 * Crea una notificación para el apoderado del estudiante.
 * Solo se envía si el apoderado aceptó el consentimiento y activó las notificaciones.
 * El canal in-app se considera entregado al instante.
 */
function notifyGuardian(db, studentId, { kind, title, body, at = new Date() }) {
  const guardian = db
    .prepare(`
      SELECT id, full_name AS fullName, consent_accepted_at AS consentAcceptedAt,
             notifications_enabled AS notificationsEnabled
      FROM guardians WHERE student_id = ?`)
    .get(studentId);
  if (!guardian) return { sent: false, reason: 'sin-apoderado', guardianName: null };
  if (!guardian.consentAcceptedAt || !guardian.notificationsEnabled) {
    return { sent: false, reason: 'sin-consentimiento', guardianName: guardian.fullName };
  }
  const stamp = toIsoDateTime(at);
  db.prepare(
    'INSERT INTO notifications (guardian_id, kind, title, body, created_at, delivered_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(guardian.id, kind, title, body, stamp, stamp);
  return { sent: true, guardianName: guardian.fullName, at: stamp };
}

function addSystemMessage(db, studentId, body, at = new Date()) {
  const guardian = db.prepare('SELECT id FROM guardians WHERE student_id = ?').get(studentId);
  if (!guardian) return;
  const conversationId = ensureConversation(db, guardian.id);
  if (!conversationId) return;
  db.prepare("INSERT INTO messages (conversation_id, sender_id, kind, body, created_at, read_at) VALUES (?, NULL, 'system', ?, ?, ?)").run(
    conversationId,
    body,
    toIsoDateTime(at),
    toIsoDateTime(at),
  );
}

/** Calificación de conducta según incidencias del bimestre. */
function conductGrade(incidents) {
  const counts = { leve: 0, moderada: 0, grave: 0 };
  for (const i of incidents) counts[i.type] += 1;
  if (counts.grave > 0 || counts.moderada > 0 || counts.leve >= 3) return 'C';
  if (counts.leve > 0) return 'B';
  return 'A';
}

/** Promedios por curso (solo notas publicadas) de un estudiante en un bimestre. */
function studentCourseGrades(db, studentId, term) {
  const rows = db
    .prepare(`
      SELECT c.id AS courseId, c.name AS course, g.c1, g.c2, g.c3, g.c4
      FROM grades g JOIN courses c ON c.id = g.course_id
      WHERE g.student_id = ? AND g.term = ? AND g.status = 'published'
      ORDER BY c.id`)
    .all(studentId, term);
  return rows.map((r) => ({ ...r, grade: courseGrade(r) })).filter((r) => r.grade !== null);
}

function studentTermAttendance(db, studentId, term) {
  const rows = db
    .prepare(`
      SELECT a.status, COUNT(*) AS n FROM attendance a
      JOIN terms t ON a.date BETWEEN t.start_date AND t.end_date
      WHERE a.student_id = ? AND t.code = ? GROUP BY a.status`)
    .all(studentId, term);
  const counts = { A: 0, T: 0, FJ: 0, FI: 0 };
  for (const r of rows) counts[r.status] = r.n;
  const total = counts.A + counts.T + counts.FJ + counts.FI;
  const percent = total ? round1(((total - counts.FJ - counts.FI) / total) * 100) : null;
  return { ...counts, total, percent };
}

module.exports = {
  ATTENDANCE_LABELS,
  RISK_AVERAGE,
  RISK_UNJUSTIFIED_ABSENCES,
  getTerms,
  resolveCurrentTerm,
  requireTerm,
  parseId,
  accessibleSections,
  assertSectionAccess,
  assertCourseAccess,
  ensureConversation,
  notifyGuardian,
  addSystemMessage,
  conductGrade,
  studentCourseGrades,
  studentTermAttendance,
  fullName,
};
