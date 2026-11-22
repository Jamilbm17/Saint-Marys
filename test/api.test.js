const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { seed, DEMO_PASSWORD } = require('../src/seed');

let server;
let base;
let db;

before(async () => {
  db = openDatabase(':memory:');
  seed(db);
  server = createApp(db).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

/** Cliente mínimo con cookie de sesión. */
function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    return { status: res.status, data };
  };
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body ?? {}),
    put: (path, body) => call('PUT', path, body),
    patch: (path, body) => call('PATCH', path, body),
    login: (role, username) => call('POST', '/api/auth/login', { role, username, password: DEMO_PASSWORD }),
  };
}

test('el inicio de sesión valida usuario, contraseña y perfil', async () => {
  const c = client();
  const wrongRole = await c.login('direccion', 'rhuaman');
  assert.equal(wrongRole.status, 401);
  const wrongPassword = await c.post('/api/auth/login', { role: 'docente', username: 'rhuaman', password: 'otra' });
  assert.equal(wrongPassword.status, 401);
  const ok = await c.login('docente', 'rhuaman');
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.role, 'docente');
});

test('las rutas protegidas exigen sesión y rol', async () => {
  const anonymous = client();
  assert.equal((await anonymous.get('/api/meta')).status, 401);

  const teacher = client();
  await teacher.login('docente', 'rhuaman');
  assert.equal((await teacher.get('/api/admin/students')).status, 403);
  assert.equal((await teacher.get('/api/reports/performance')).status, 403);
  assert.equal((await teacher.get('/api/guardian/summary')).status, 403);
});

test('la asistencia guardada muestra el estado del día y valida los datos', async () => {
  const teacher = client();
  await teacher.login('docente', 'rhuaman');
  const { data: meta } = await teacher.get('/api/meta');
  const { data: sections } = await teacher.get('/api/teacher/sections');
  const sectionId = sections.sections[0].id;

  const day = await teacher.get(`/api/teacher/attendance?sectionId=${sectionId}&date=${meta.defaultDate}`);
  assert.equal(day.status, 200);
  assert.equal(day.data.students.length, 14);
  const statuses = Object.fromEntries(day.data.students.map((s) => [s.fullName, s.status]));
  assert.equal(statuses['Flores Huamán, Camila'], 'FJ');
  assert.equal(statuses['Navarro Silva, Joaquín'], 'T');
  assert.equal(statuses['Soto Villanueva, Gael'], 'FI');

  assert.equal((await teacher.get(`/api/teacher/attendance?sectionId=${sectionId}&date=2999-01-01`)).status, 400);
  assert.equal((await teacher.get(`/api/teacher/attendance?sectionId=${sectionId}&date=2026-11-21`)).status, 400, 'sábado');
  const bad = await teacher.put('/api/teacher/attendance', {
    sectionId,
    date: meta.defaultDate,
    records: [{ studentId: day.data.students[0].studentId, status: 'X' }],
  });
  assert.equal(bad.status, 400);
});

test('guardar una falta notifica al apoderado que activó las notificaciones', async () => {
  const teacher = client();
  await teacher.login('docente', 'rhuaman');
  const { data: meta } = await teacher.get('/api/meta');
  const { data: sections } = await teacher.get('/api/teacher/sections');
  const sectionId = sections.sections[0].id;
  const day = await teacher.get(`/api/teacher/attendance?sectionId=${sectionId}&date=${meta.defaultDate}`);
  const records = day.data.students.map((s) => ({
    studentId: s.studentId,
    status: s.fullName.startsWith('Alvarado') ? 'FI' : s.status,
    arrivalTime: s.arrivalTime,
  }));
  const saved = await teacher.put('/api/teacher/attendance', { sectionId, date: meta.defaultDate, records });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.notified, 1, 'solo cambió el estado de Mateo');

  const parent = client();
  await parent.login('apoderado', 'rquispe');
  const list = await parent.get('/api/guardian/notifications?kind=asistencia');
  assert.equal(list.status, 200);
  assert.ok(list.data.items.some((n) => n.title === 'Falta injustificada' && n.readAt === null));

  // Guardar de nuevo sin cambios no duplica avisos.
  const again = await teacher.put('/api/teacher/attendance', { sectionId, date: meta.defaultDate, records });
  assert.equal(again.data.notified, 0);
});

test('las notas se validan en escala 0-20 y solo se publican completas', async () => {
  const teacher = client();
  await teacher.login('docente', 'rhuaman');
  const { data: sections } = await teacher.get('/api/teacher/sections');
  const section = sections.sections[0];
  const math = section.courses.find((c) => c.name === 'Matemática');
  assert.equal(section.courses.length, 1, 'la docente solo ve su curso');

  const grid = await teacher.get(`/api/teacher/grades?sectionId=${section.id}&courseId=${math.id}&term=IV`);
  assert.equal(grid.status, 200);
  assert.equal(grid.data.competencies.length, 4);
  const rows = grid.data.rows.map((r) => ({ studentId: r.studentId, values: r.values }));

  const outOfRange = structuredClone(rows);
  outOfRange[5].values[2] = '21';
  const rejected = await teacher.put('/api/teacher/grades', { sectionId: section.id, courseId: math.id, term: 'IV', rows: outOfRange, publish: false });
  assert.equal(rejected.status, 422);
  assert.match(rejected.data.error, /fuera de rango/);

  const incomplete = structuredClone(rows);
  incomplete[0].values[0] = '';
  const draft = await teacher.put('/api/teacher/grades', { sectionId: section.id, courseId: math.id, term: 'IV', rows: incomplete, publish: false });
  assert.equal(draft.status, 200);
  const blocked = await teacher.put('/api/teacher/grades', { sectionId: section.id, courseId: math.id, term: 'IV', rows: incomplete, publish: true });
  assert.equal(blocked.status, 422);

  const restored = await teacher.put('/api/teacher/grades', { sectionId: section.id, courseId: math.id, term: 'IV', rows, publish: true });
  assert.equal(restored.status, 200);
});

test('el apoderado solo accede tras aceptar el consentimiento y ve únicamente a su hijo', async () => {
  const parent = client();
  await parent.login('apoderado', 'jnavarro');
  const me = await parent.get('/api/auth/me');
  assert.equal(me.data.user.guardian.consentAccepted, false);
  assert.equal((await parent.get('/api/guardian/summary')).status, 403);
  assert.equal((await parent.get('/api/conversations')).status, 403);
  assert.equal((await parent.post('/api/auth/consent', { dataConsent: false })).status, 400);

  assert.equal((await parent.post('/api/auth/consent', { dataConsent: true, notificationsConsent: true })).status, 200);
  const summary = await parent.get('/api/guardian/summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.data.student.fullName, 'Joaquín Navarro Silva');
  assert.equal(summary.data.conduct.grade, 'B');
  assert.equal(summary.data.alert.status, 'T');

  // Un apoderado no puede leer la conversación de otro.
  const foreign = await parent.get('/api/conversations/1/messages');
  assert.equal(foreign.status, 200);
  assert.equal(foreign.data.student.fullName, 'Joaquín Navarro Silva');
});

test('dirección registra estudiantes con DNI único y los desactiva sin eliminarlos', async () => {
  const director = client();
  await director.login('direccion', 'vgallardo');
  const { data: sections } = await director.get('/api/admin/sections-list');
  const sectionId = sections.sections[0].id;

  const duplicate = await director.post('/api/admin/students', {
    dni: '81457302', fullName: 'Alvarado Quispe, Mateo', sectionId, guardian: { fullName: 'Rocío Quispe Mamani', phone: '987 412 563' },
  });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.data.error, /Mateo Alvarado Quispe/);

  const created = await director.post('/api/admin/students', {
    dni: '70112233', fullName: 'Prueba Gómez, Lucía', sectionId, guardian: { fullName: 'Ana Gómez Ríos', phone: '999 888 777' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.student.consent, 'Pendiente');
  assert.ok(created.data.credentials.temporaryPassword.length >= 10);

  // El nuevo apoderado puede ingresar con la contraseña temporal.
  const newParent = client();
  const login = await newParent.post('/api/auth/login', {
    role: 'apoderado', username: created.data.credentials.username, password: created.data.credentials.temporaryPassword,
  });
  assert.equal(login.status, 200);

  const off = await director.patch(`/api/admin/students/${created.data.student.id}/active`, { active: false });
  assert.equal(off.data.student.active, false);
  assert.equal((await newParent.get('/api/auth/me')).status, 401, 'se cierran las sesiones del apoderado');
  const list = await director.get('/api/admin/students?search=prueba&status=inactive');
  assert.equal(list.data.total, 1);
});

test('el reporte de rendimiento identifica a los estudiantes en riesgo', async () => {
  const director = client();
  await director.login('direccion', 'vgallardo');
  const report = await director.get('/api/reports/performance?term=IV');
  assert.equal(report.status, 200);
  const names = report.data.atRisk.map((r) => r.name).sort();
  assert.deepEqual(names, ['Chávez Torres, Diego', 'Soto Villanueva, Gael']);
  assert.equal(report.data.courses.length, 8);
  assert.equal(report.data.attendanceByTerm.length, 4);

  const xlsx = await fetch(`${base}/api/reports/performance.xlsx?term=IV`, {
    headers: { cookie: '' },
  });
  assert.equal(xlsx.status, 401, 'la exportación también exige sesión');
});
