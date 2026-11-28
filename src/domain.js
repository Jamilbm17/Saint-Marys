/**
 * Reglas de dominio compartidas por las rutas: periodos, permisos por sección,
 * notificaciones a apoderados y cálculo de indicadores.
 */
const { HttpError, toIsoDate, toIsoDateTime, lastWeekday, courseGrade, round1, fullName } = require('./util');
const push = require('./push');

const ATTENDANCE_LABELS = { A: 'Asistió', T: 'Tardanza', FJ: 'Falta justificada', FI: 'Falta injustificada' };
const RISK_AVERAGE = 11;
const RISK_UNJUSTIFIED_ABSENCES = 3;
const STATIC_TTL = 5 * 60 * 1000;

const byName = (a, b) => a.last_names.localeCompare(b.last_names, 'es') || a.first_names.localeCompare(b.first_names, 'es');
const byText = (field) => (a, b) => a[field].localeCompare(b[field], 'es');

/** Datos de referencia casi estáticos: se leen una vez y se guardan en caché unos minutos. */
const getCourses = (store) =>
  store.cached('courses', STATIC_TTL, async () => (await store.find('courses')).sort((a, b) => a.id - b.id));

const getCompetencies = (store) =>
  store.cached('competencies', STATIC_TTL, async () =>
    (await store.find('competencies')).sort((a, b) => a.course_id - b.course_id || a.code.localeCompare(b.code)),
  );

async function getTerms(store) {
  return store.cached('terms', STATIC_TTL, async () =>
    (await store.find('terms'))
      .map((t) => ({ code: t.id, position: t.position, startDate: t.start_date, endDate: t.end_date }))
      .sort((a, b) => a.position - b.position),
  );
}

/** Bimestre vigente: el que contiene la fecha de referencia o, si no hay, el último iniciado. */
async function resolveCurrentTerm(store, refDate = new Date()) {
  const ref = toIsoDate(lastWeekday(refDate));
  const terms = await getTerms(store);
  const inside = terms.find((t) => ref >= t.startDate && ref <= t.endDate);
  if (inside) return inside;
  const started = terms.filter((t) => t.startDate <= ref);
  return started.length ? started[started.length - 1] : terms[0];
}

async function requireTerm(store, code) {
  const term = (await getTerms(store)).find((t) => t.code === code);
  if (!term) throw new HttpError(400, 'Bimestre no válido.');
  return term;
}

function parseId(value, label = 'identificador') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `Valor no válido para ${label}.`);
  return id;
}

const sectionView = (s) => ({ id: s.id, name: s.name, grade: s.grade, tutorId: s.tutor_id });

/** Secciones a las que el usuario puede acceder. La dirección accede a todas. */
async function accessibleSections(store, user) {
  if (user.role === 'direccion') {
    return (await store.find('sections')).sort(byText('name')).map(sectionView);
  }
  const [tutored, assignments] = await Promise.all([
    store.find('sections', { where: { tutor_id: user.id } }),
    store.find('teaching_assignments', { where: { teacher_id: user.id } }),
  ]);
  const assigned = await store.getMany('sections', assignments.map((a) => a.section_id));
  const unique = new Map([...tutored, ...assigned].map((s) => [s.id, s]));
  return [...unique.values()].sort(byText('name')).map(sectionView);
}

async function assertSectionAccess(store, user, sectionId) {
  const section = (await accessibleSections(store, user)).find((s) => s.id === sectionId);
  if (!section) throw new HttpError(403, 'No tienes acceso a esta sección.');
  return section;
}

async function assertCourseAccess(store, user, sectionId, courseId) {
  await assertSectionAccess(store, user, sectionId);
  if (user.role === 'direccion') return;
  const assigned = await store.find('teaching_assignments', { where: { teacher_id: user.id, section_id: sectionId, course_id: courseId } });
  if (!assigned.length) throw new HttpError(403, 'No tienes asignado este curso en la sección.');
}

const EMPTY_CONVERSATION = { last_body: null, last_at: null, unread_guardian: 0, unread_staff: 0 };

/** Garantiza que exista la conversación del apoderado con la tutora de la sección. */
async function ensureConversation(store, guardianId) {
  const existing = await store.findOne('conversations', { guardian_id: guardianId });
  if (existing) return existing.id;
  const guardian = await store.get('guardians', guardianId);
  const student = guardian && (await store.get('students', guardian.student_id));
  const section = student && (await store.get('sections', student.section_id));
  if (!section?.tutor_id) return null;
  return store.insert('conversations', { guardian_id: guardianId, teacher_id: section.tutor_id, ...EMPTY_CONVERSATION });
}

/**
 * Crea una notificación para el apoderado del estudiante.
 * Solo se envía si el apoderado aceptó el consentimiento y activó las notificaciones.
 * El aviso dentro de la plataforma se considera entregado al instante; además se envía una push (FCM) si hay dispositivos.
 */
async function notifyGuardian(store, studentId, { kind, title, body, at = new Date() }) {
  const guardian = await store.findOne('guardians', { student_id: studentId });
  if (!guardian) return { sent: false, reason: 'sin-apoderado', guardianName: null };
  if (!guardian.consent_accepted_at || !guardian.notifications_enabled) {
    return { sent: false, reason: 'sin-consentimiento', guardianName: guardian.full_name };
  }
  const stamp = toIsoDateTime(at);
  await store.insert('notifications', {
    guardian_id: guardian.id,
    kind,
    title,
    body,
    created_at: stamp,
    delivered_at: stamp,
    read_at: null,
  });
  push.sendToGuardian(store, guardian.id, { title, body, kind }); // sin await: no bloquea la respuesta
  return { sent: true, guardianName: guardian.full_name, at: stamp };
}

/** Registra un mensaje en la conversación y mantiene sus contadores (último mensaje y no leídos). */
async function appendMessage(store, conversationId, { senderId, kind = 'text', body, at = new Date(), read = false, fromGuardian = false }) {
  const stamp = toIsoDateTime(at);
  const id = await store.insert('messages', {
    conversation_id: conversationId,
    sender_id: senderId,
    kind,
    body,
    created_at: stamp,
    read_at: read ? stamp : null,
  });
  if (kind === 'text') {
    const conversation = await store.get('conversations', conversationId);
    const patch = { last_body: body, last_at: stamp };
    if (!read) {
      if (fromGuardian) patch.unread_staff = (conversation.unread_staff || 0) + 1;
      else patch.unread_guardian = (conversation.unread_guardian || 0) + 1;
    }
    await store.update('conversations', conversationId, patch);
  }
  return { id, createdAt: stamp };
}

async function addSystemMessage(store, studentId, body, at = new Date()) {
  const guardian = await store.findOne('guardians', { student_id: studentId });
  if (!guardian) return;
  const conversationId = await ensureConversation(store, guardian.id);
  if (!conversationId) return;
  await appendMessage(store, conversationId, { senderId: null, kind: 'system', body, at, read: true });
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
async function studentCourseGrades(store, studentId, term) {
  const [rows, courses] = await Promise.all([
    store.find('grades', { where: { student_id: studentId, term } }),
    getCourses(store),
  ]);
  const names = new Map(courses.map((c) => [c.id, c.name]));
  return rows
    .filter((g) => g.status === 'published')
    .sort((a, b) => a.course_id - b.course_id)
    .map((g) => ({ courseId: g.course_id, course: names.get(g.course_id), c1: g.c1, c2: g.c2, c3: g.c3, c4: g.c4 }))
    .map((r) => ({ ...r, grade: courseGrade(r) }))
    .filter((r) => r.grade !== null);
}

function termAttendanceFrom(records, term) {
  const counts = { A: 0, T: 0, FJ: 0, FI: 0 };
  for (const r of records) if (r.date >= term.startDate && r.date <= term.endDate) counts[r.status] += 1;
  const total = counts.A + counts.T + counts.FJ + counts.FI;
  const percent = total ? round1(((total - counts.FJ - counts.FI) / total) * 100) : null;
  return { ...counts, total, percent };
}

async function studentTermAttendance(store, studentId, term) {
  const records = await store.find('attendance', { where: { student_id: studentId } });
  return termAttendanceFrom(records, term);
}

module.exports = {
  ATTENDANCE_LABELS,
  RISK_AVERAGE,
  RISK_UNJUSTIFIED_ABSENCES,
  EMPTY_CONVERSATION,
  byName,
  byText,
  getCourses,
  getCompetencies,
  getTerms,
  resolveCurrentTerm,
  requireTerm,
  parseId,
  accessibleSections,
  assertSectionAccess,
  assertCourseAccess,
  ensureConversation,
  notifyGuardian,
  appendMessage,
  addSystemMessage,
  conductGrade,
  studentCourseGrades,
  termAttendanceFrom,
  studentTermAttendance,
  fullName,
};
