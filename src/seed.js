/**
 * Datos de demostración (ficticios). No contienen información real de estudiantes.
 *
 *   npm run seed -- --reset   borra Firestore y carga los datos de demostración
 *
 * Todas las fechas se calculan a partir del último día hábil, de modo que la
 * demostración siempre tiene un "hoy" con asistencia, avisos y mensajes.
 */
const { hashPassword } = require('./auth');
const { EMPTY_CONVERSATION } = require('./domain');
const { toIsoDate, toIsoDateTime, parseIsoDate, lastWeekday, addDays, weekdaysBetween, courseGrade } = require('./util');
const config = require('./config');

/** Contraseña de todas las cuentas de demostración. Cámbiala si publicas la app. */
const DEMO_PASSWORD = 'colegio2026';

const TERMS = [
  { code: 'I', position: 1, start: '2026-03-16', end: '2026-05-15' },
  { code: 'II', position: 2, start: '2026-05-18', end: '2026-07-24' },
  { code: 'III', position: 3, start: '2026-08-10', end: '2026-10-09' },
  { code: 'IV', position: 4, start: '2026-10-12', end: '2026-12-18' },
];
const ATTENDANCE_TARGET = { I: 96.8, II: 95.9, III: 94.1, IV: 95.2 };

const COURSES = [
  {
    name: 'Matemática',
    teacher: 'rhuaman',
    competencies: [
      'Resuelve problemas de cantidad',
      'Resuelve problemas de regularidad, equivalencia y cambio',
      'Resuelve problemas de forma, movimiento y localización',
      'Resuelve problemas de gestión de datos e incertidumbre',
    ],
  },
  {
    name: 'Comunicación',
    teacher: 'cmedina',
    competencies: [
      'Se comunica oralmente en su lengua materna',
      'Lee diversos tipos de textos escritos en su lengua materna',
      'Escribe diversos tipos de textos en su lengua materna',
      'Reflexiona y evalúa la forma, el contenido y el contexto de los textos',
    ],
  },
  {
    name: 'Inglés',
    teacher: 'asalas',
    competencies: [
      'Se comunica oralmente en inglés como lengua extranjera',
      'Lee diversos tipos de textos escritos en inglés',
      'Escribe diversos tipos de textos en inglés',
      'Interactúa y usa el inglés en contextos reales',
    ],
  },
  {
    name: 'Ciencia y Tecnología',
    teacher: 'lpaucar',
    competencies: [
      'Indaga mediante métodos científicos para construir conocimientos',
      'Explica el mundo físico basándose en conocimientos sobre los seres vivos, materia y energía',
      'Diseña y construye soluciones tecnológicas para resolver problemas de su entorno',
      'Gestiona información científica y comunica resultados',
    ],
  },
  {
    name: 'Ciencias Sociales',
    teacher: 'mortega',
    competencies: [
      'Construye interpretaciones históricas',
      'Gestiona responsablemente el espacio y el ambiente',
      'Gestiona responsablemente los recursos económicos',
      'Participa en acciones ciudadanas con sentido crítico',
    ],
  },
  {
    name: 'DPCC',
    teacher: 'ecabrera',
    competencies: [
      'Construye su identidad',
      'Convive y participa democráticamente en la búsqueda del bien común',
      'Delibera sobre asuntos públicos',
      'Reflexiona sobre valores y conducta ética',
    ],
  },
  {
    name: 'Educación Física',
    teacher: 'jtello',
    competencies: [
      'Se desenvuelve de manera autónoma a través de su motricidad',
      'Asume una vida saludable',
      'Interactúa a través de sus habilidades sociomotrices',
      'Practica actividad física con regularidad',
    ],
  },
  {
    name: 'Arte y Cultura',
    teacher: 'slanda',
    competencies: [
      'Aprecia de manera crítica manifestaciones artístico-culturales',
      'Crea proyectos desde los lenguajes artísticos',
      'Experimenta y combina técnicas y materiales',
      'Comunica y socializa sus creaciones',
    ],
  },
];

const STAFF = [
  { username: 'rhuaman', role: 'docente', fullName: 'Prof. Rosa Huamán', title: 'Docente tutora' },
  { username: 'vgallardo', role: 'direccion', fullName: 'Lic. Virginia Gallardo', title: 'Dirección' },
  { username: 'cmedina', role: 'docente', fullName: 'Prof. Carlos Medina', title: 'Docente' },
  { username: 'asalas', role: 'docente', fullName: 'Prof. Andrea Salas', title: 'Docente' },
  { username: 'lpaucar', role: 'docente', fullName: 'Prof. Luis Paucar', title: 'Docente' },
  { username: 'mortega', role: 'docente', fullName: 'Prof. Marta Ortega', title: 'Docente' },
  { username: 'ecabrera', role: 'docente', fullName: 'Prof. Elena Cabrera', title: 'Docente' },
  { username: 'jtello', role: 'docente', fullName: 'Prof. Jorge Tello', title: 'Docente' },
  { username: 'slanda', role: 'docente', fullName: 'Prof. Sofía Landa', title: 'Docente' },
];

// Orden alfabético: es el mismo orden de las listas de la aplicación.
const STUDENTS = [
  { dni: '81457302', last: 'Alvarado Quispe', first: 'Mateo', user: 'rquispe', parent: 'Rocío Quispe Mamani', phone: '987 412 563', consent: true, base: 15, math: [15, 14, 16, 15] },
  { dni: '81390475', last: 'Castillo Ramos', first: 'Valeria', user: 'eramos', parent: 'Elena Ramos Díaz', phone: '956 203 118', consent: true, base: 17, math: [17, 18, 16, 17] },
  { dni: '81522964', last: 'Chávez Torres', first: 'Diego', user: 'lchavez', parent: 'Luis Chávez Medina', phone: '944 871 209', consent: true, math: [10, 9, 11, 10], fixed: [11, 10, 10, 11, 10, 11, 10] },
  { dni: '81277631', last: 'Flores Huamán', first: 'Camila', user: 'phuaman', parent: 'Patricia Huamán Rojas', phone: '991 330 457', consent: true, base: 14, math: [14, 13, 15, 14] },
  { dni: '81604187', last: 'García Mendoza', first: 'Sebastián', user: 'kmendoza', parent: 'Karina Mendoza León', phone: '963 518 402', consent: false, base: 13.5, math: [12, 13, 12, 14] },
  { dni: '81438820', last: 'Huertas Vílchez', first: 'Luciana', user: 'ohuertas', parent: 'Óscar Huertas Paz', phone: '978 064 731', consent: true, base: 16, math: [16, 15, 20, 16] },
  { dni: '81355096', last: 'López Paredes', first: 'Thiago', user: 'cparedes', parent: 'Carmen Paredes Ruiz', phone: '935 742 186', consent: false, base: 15, math: [15, 16, 14, 15] },
  { dni: '81491573', last: 'Mendoza Rojas', first: 'Ariana', user: 'rmendoza', parent: 'Ricardo Mendoza Arce', phone: '982 657 014', consent: true, base: 17.5, math: [18, 17, 18, 19] },
  { dni: '81512847', last: 'Navarro Silva', first: 'Joaquín', user: 'jnavarro', parent: 'Jorge Navarro Cárdenas', phone: '974 215 380', consent: false, math: [14, 15, 13, 15], fixed: [16, 13, 15, 15, 16, 14, 15] },
  { dni: '81466219', last: 'Paredes Cárdenas', first: 'Fernanda', user: 'mcardenas', parent: 'Marisol Cárdenas Vega', phone: '961 748 205', consent: true, base: 16, math: [16, 16, 17, 15] },
  { dni: '81583470', last: 'Quispe Salazar', first: 'Adrián', user: 'wquispe', parent: 'Walter Quispe Huanca', phone: '945 327 618', consent: true, base: 13, math: [13, 12, 14, 13] },
  { dni: '81409736', last: 'Ramírez Ccori', first: 'Isabella', user: 'nccori', parent: 'Nelly Ccori Flores', phone: '998 160 472', consent: true, base: 16.5, math: [17, 16, 18, 17] },
  { dni: '81371058', last: 'Soto Villanueva', first: 'Gael', user: 'mvillanueva', parent: 'Milagros Villanueva Soto', phone: '952 683 914', consent: true, math: [11, 12, 13, 12], fixed: [12, 12, 12, 12, 12, 12, 13] },
  { dni: '81548392', last: 'Vargas Espinoza', first: 'Mía', user: 'tespinoza', parent: 'Teresa Espinoza Lazo', phone: '987 305 126', consent: true, base: 15, math: [15, 14, 15, 16] },
];

// Desplazamiento por curso respecto al nivel base del estudiante (sin Matemática).
const COURSE_OFFSET = { Comunicación: 0, Inglés: -0.8, 'Ciencia y Tecnología': -0.3, 'Ciencias Sociales': 0, DPCC: 0.5, 'Educación Física': 1.5, 'Arte y Cultura': 1 };
const COMPETENCY_PATTERNS = [[0, 0, 0, 0], [1, -1, 0, 0], [0, 1, -1, 0], [-1, 0, 0, 1], [1, 0, -1, 0], [0, -1, 1, 0]];

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const at = (isoDate, time) => `${isoDate} ${time}:00`;


/** Acumula documentos por colección con ids autoincrementales; se vuelcan al almacén de una sola vez. */
function createBuilder(start = {}) {
  const tables = {};
  const counters = { ...start };
  return {
    tables,
    add(col, data) {
      counters[col] = (counters[col] || 0) + 1;
      (tables[col] ||= []).push({ id: counters[col], ...data });
      return counters[col];
    },
    addWithId(col, id, data) {
      (tables[col] ||= []).push({ id, ...data });
      return id;
    },
    find(col, id) {
      return tables[col].find((d) => d.id === id);
    },
  };
}

async function wipe(store) {
  await store.wipe();
}

async function flush(store, builder) {
  const counts = {};
  for (const [col, docs] of Object.entries(builder.tables)) {
    await store.bulkLoad(col, docs);
    counts[col] = docs.length;
  }
  return counts;
}

async function seed(store, { referenceDate = new Date() } = {}) {
  const rng = mulberry32(2026);
  const last = TERMS[TERMS.length - 1].end;
  const clampIso = (iso) => (iso < '2026-10-12' ? '2026-10-12' : iso > last ? last : iso);
  const ref = clampIso(toIsoDate(lastWeekday(referenceDate)));
  const dayOffset = (days) => toIsoDate(addDays(parseIsoDate(ref), -days));
  const passwordHash = hashPassword(DEMO_PASSWORD);
  const now = toIsoDateTime(new Date());
  const b = createBuilder();

  // --- Bimestres, cursos y competencias ---
  TERMS.forEach((t) => b.addWithId('terms', t.code, { position: t.position, start_date: t.start, end_date: t.end }));

  const courseIds = {};
  COURSES.forEach((course) => {
    const id = b.add('courses', { name: course.name });
    courseIds[course.name] = id;
    course.competencies.forEach((description, i) => b.add('competencies', { course_id: id, code: `C${i + 1}`, description }));
  });

  // --- Personal ---
  const userIds = {};
  const addUser = (username, role, fullNameText, title) =>
    b.add('users', { username, password_hash: passwordHash, role, full_name: fullNameText, title, active: true, created_at: now });
  STAFF.forEach((u) => {
    userIds[u.username] = addUser(u.username, u.role, u.fullName, u.title);
  });

  // --- Sección y asignaciones ---
  const sectionId = b.add('sections', {
    name: '1.° Secundaria – Única',
    grade: '1.° Secundaria',
    school_year: config.schoolYear,
    tutor_id: userIds.rhuaman,
  });
  COURSES.forEach((course) =>
    b.add('teaching_assignments', { teacher_id: userIds[course.teacher], course_id: courseIds[course.name], section_id: sectionId }),
  );

  // --- Estudiantes, apoderados y conversaciones ---
  const studentIds = [];
  const guardianIds = [];
  const guardianUserIds = [];
  const conversationIds = [];
  STUDENTS.forEach((s) => {
    const studentId = b.add('students', {
      dni: s.dni,
      last_names: s.last,
      first_names: s.first,
      section_id: sectionId,
      active: true,
      created_at: now,
      updated_at: now,
    });
    const userId = addUser(s.user, 'apoderado', s.parent, null);
    const guardianId = b.add('guardians', {
      user_id: userId,
      student_id: studentId,
      full_name: s.parent,
      phone: s.phone,
      relationship: 'Apoderado',
      consent_accepted_at: s.consent ? at(dayOffset(30), '19:20') : null,
      notifications_enabled: Boolean(s.consent),
    });
    studentIds.push(studentId);
    guardianIds.push(guardianId);
    guardianUserIds.push(userId);
    conversationIds.push(
      b.add('conversations', { guardian_id: guardianId, teacher_id: userIds.rhuaman, ...EMPTY_CONVERSATION }),
    );
  });
  const idx = Object.fromEntries(STUDENTS.map((s, i) => [s.first, i]));

  // --- Notas (III y IV bimestre, todas publicadas) ---
  const addGrade = (studentId, courseId, term, values, publishedAt, teacherId) =>
    b.add('grades', {
      student_id: studentId,
      course_id: courseId,
      term,
      c1: values[0],
      c2: values[1],
      c3: values[2],
      c4: values[3],
      status: 'published',
      published_at: publishedAt,
      updated_by: teacherId,
      updated_at: publishedAt,
    });
  const spread = (grade) => {
    const pattern = COMPETENCY_PATTERNS[Math.floor(rng() * COMPETENCY_PATTERNS.length)];
    return pattern.map((delta) => clamp(grade + delta, 0, 20));
  };
  STUDENTS.forEach((s, i) => {
    COURSES.forEach((course, c) => {
      let grade;
      if (course.name === 'Matemática') grade = null;
      else if (s.fixed) grade = s.fixed[c - 1];
      else grade = clamp(Math.round(s.base + COURSE_OFFSET[course.name] + (rng() * 1.8 - 0.9)), 8, 20);

      const iv = grade === null ? s.math.map((v) => clamp(v, 0, 20)) : spread(grade);
      const finalGrade = courseGrade({ c1: iv[0], c2: iv[1], c3: iv[2], c4: iv[3] });
      // III bimestre: ligeramente menor en promedio para que el reporte muestre variación.
      const previousGrade = clamp(finalGrade - (rng() < 0.4 ? 1 : 0), 0, 20);
      const iii = spread(previousGrade);
      const teacherId = userIds[course.teacher];
      addGrade(studentIds[i], courseIds[course.name], 'III', iii, at('2026-10-09', '17:00'), teacherId);
      addGrade(studentIds[i], courseIds[course.name], 'IV', iv, at(dayOffset(2), '15:30'), teacherId);
    });
  });

  // --- Asistencia ---
  const attendanceNotifications = [];
  for (const term of TERMS) {
    const days = weekdaysBetween(term.start, term.end < ref ? term.end : ref);
    if (!days.length) continue;
    const isCurrent = term.code === 'IV';
    const marks = new Map(); // `${student}|${day}` -> { status, time }
    const fiCount = new Array(STUDENTS.length).fill(0);
    const mark = (student, day, status, time = null) => {
      marks.set(`${student}|${day}`, { status, time });
      if (status === 'FI') fiCount[student] += 1;
    };

    const excluded = new Set();
    if (isCurrent) {
      // Situaciones fijas que se ven en las capturas del diseño.
      mark(idx.Camila, ref, 'FJ');
      mark(idx.Joaquín, ref, 'T', '08:12');
      mark(idx.Gael, ref, 'FI');
      const earlier = (n) => days[Math.max(0, Math.min(n, days.length - 2))];
      [5, 12, 20].forEach((n) => mark(idx.Gael, earlier(n), 'FI'));
      mark(idx.Diego, earlier(8), 'FI');
      mark(idx.Joaquín, earlier(10), 'FJ');
      [idx.Joaquín, idx.Gael, idx.Diego].forEach((n) => excluded.add(n));
    }

    const cells = [];
    STUDENTS.forEach((_, s) => {
      if (excluded.has(s)) return;
      days.forEach((d) => {
        // El día de referencia queda exactamente como en las capturas de diseño.
        if (isCurrent && d === ref) return;
        if (!marks.has(`${s}|${d}`)) cells.push([s, d]);
      });
    });
    for (let i = cells.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const fixedAbsences = [...marks.values()].filter((m) => m.status === 'FJ' || m.status === 'FI').length;
    const totalCells = STUDENTS.length * days.length;
    const targetAbsences = Math.round(totalCells * (1 - ATTENDANCE_TARGET[term.code] / 100)) - fixedAbsences;
    let cursor = 0;
    for (let n = 0; n < targetAbsences && cursor < cells.length; n += 1, cursor += 1) {
      const [s, d] = cells[cursor];
      const status = rng() < 0.4 && fiCount[s] < 2 ? 'FI' : 'FJ';
      mark(s, d, status);
    }
    const tardies = Math.round(totalCells * 0.018);
    for (let n = 0; n < tardies && cursor < cells.length; n += 1, cursor += 1) {
      const [s, d] = cells[cursor];
      mark(s, d, 'T', `08:${String(5 + Math.floor(rng() * 25)).padStart(2, '0')}`);
    }

    for (const day of days) {
      STUDENTS.forEach((_, s) => {
        const entry = marks.get(`${s}|${day}`) || { status: 'A', time: null };
        b.add('attendance', {
          student_id: studentIds[s],
          section_id: sectionId,
          date: day,
          status: entry.status,
          arrival_time: entry.time,
          recorded_by: userIds.rhuaman,
          updated_at: at(day, '08:30'),
        });
        if (isCurrent && entry.status !== 'A') attendanceNotifications.push({ s, day, ...entry });
      });
    }
  }

  // --- Notificaciones ---
  let notificationCount = 0;
  const pushNotification = (studentIndex, kind, title, body, createdAt) => {
    notificationCount += 1;
    const created = new Date(createdAt.replace(' ', 'T'));
    // Casi todas se entregan en minutos; una de cada ~37 tarda más de 24 horas (ejemplo de reintento).
    const delayMinutes = notificationCount % 37 === 0 ? 26 * 60 : 2 + Math.floor(rng() * 18);
    const delivered = new Date(created.getTime() + delayMinutes * 60000);
    const isToday = createdAt.startsWith(ref);
    b.add('notifications', {
      guardian_id: guardianIds[studentIndex],
      kind,
      title,
      body,
      created_at: createdAt,
      delivered_at: toIsoDateTime(delivered),
      read_at: isToday ? null : toIsoDateTime(delivered),
    });
  };
  const clock = (time) => {
    const [h, m] = time.split(':').map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'p. m.' : 'a. m.'}`;
  };
  const consenting = STUDENTS.map((s, i) => i).filter((i) => STUDENTS[i].consent || i === idx.Joaquín);

  consenting.forEach((i) => {
    pushNotification(i, 'comunicado', 'Comunicado de la dirección', 'Reunión de padres del IV bimestre: viernes 11 de diciembre, 6:00 p. m.', at(dayOffset(18), '08:00'));
    pushNotification(i, 'notas', 'Notas publicadas', 'Comunicación – IV Bimestre ya está disponible.', at(dayOffset(2), '15:35'));
  });
  attendanceNotifications.forEach(({ s, day, status, time }) => {
    if (!STUDENTS[s].consent && s !== idx.Joaquín) return;
    const name = STUDENTS[s].first;
    if (status === 'T') {
      pushNotification(s, 'asistencia', 'Tardanza', `${name} ingresó a las ${clock(time)} El horario de ingreso es hasta las 7:50 a. m.`, at(day, `08:${String(Number(time.slice(3)) + 3).padStart(2, '0')}`));
    } else if (status === 'FJ') {
      pushNotification(s, 'asistencia', 'Falta justificada', `Se registró una falta justificada de ${name}.`, at(day, '09:00'));
    } else {
      pushNotification(s, 'asistencia', 'Falta injustificada', `Se registró una falta injustificada de ${name}. Comunícate con la tutora si necesitas justificarla.`, at(day, '09:00'));
    }
  });

  // --- Conducta ---
  const incidents = [
    { who: 'Diego', days: 0, time: '10:42', type: 'leve', text: 'Usó el celular durante la clase de Matemática. Se conversó con el estudiante y guardó el equipo.' },
    { who: 'Gael', days: 7, time: '11:05', type: 'moderada', text: 'Se retiró del aula sin permiso durante el segundo bloque. Se coordinó entrevista con la familia.' },
    { who: 'Joaquín', days: 14, time: '09:30', type: 'leve', text: 'No trajo los materiales de Arte y Cultura por segunda vez en la semana.' },
    { who: 'Sebastián', days: 21, time: '12:15', type: 'leve', text: 'Interrumpió reiteradamente la exposición de un compañero.' },
  ];
  incidents.forEach((inc) => {
    const i = idx[inc.who];
    const date = dayOffset(inc.days);
    const stamp = at(date, inc.time);
    const notified = STUDENTS[i].consent || i === idx.Joaquín;
    b.add('conduct_incidents', {
      student_id: studentIds[i],
      section_id: sectionId,
      date,
      type: inc.type,
      description: inc.text,
      recorded_by: userIds.rhuaman,
      created_at: stamp,
      notified_at: notified ? stamp : null,
      notified_guardian: notified ? STUDENTS[i].parent : null,
    });
    if (notified) pushNotification(i, 'conducta', `Incidencia ${inc.type}`, inc.text, stamp);
  });

  // --- Mensajes ---
  const say = (i, from, day, time, body, { read = true, kind = 'text' } = {}) => {
    const stamp = at(day, time);
    const sender = kind === 'system' ? null : from === 'teacher' ? userIds.rhuaman : guardianUserIds[i];
    b.add('messages', { conversation_id: conversationIds[i], sender_id: sender, kind, body, created_at: stamp, read_at: read ? stamp : null });
    if (kind === 'text') {
      const conversation = b.find('conversations', conversationIds[i]);
      conversation.last_body = body;
      conversation.last_at = stamp;
      if (!read) conversation[from === 'teacher' ? 'unread_guardian' : 'unread_staff'] += 1;
    }
    if (from === 'teacher' && kind === 'text' && STUDENTS[i].consent) {
      pushNotification(i, 'mensaje', 'Mensaje de Prof. Rosa Huamán', body.length > 140 ? `${body.slice(0, 137)}…` : body, stamp);
    }
  };

  const today = dayOffset(0);
  say(idx.Joaquín, 'system', today, '08:15', 'Aviso automático enviado: tardanza registrada a las 8:12 a. m.', { kind: 'system' });
  say(idx.Joaquín, 'guardian', today, '08:40', 'Buenos días, profesora. Recibí el aviso de la tardanza de Joaquín. Hubo mucho tráfico en la Av. Perú, no volverá a pasar.');
  say(idx.Joaquín, 'teacher', today, '09:05', 'Buenos días, señor Navarro. Gracias por avisar. Le recuerdo que el ingreso es hasta las 7:50 a. m. Joaquín viene trabajando muy bien en Matemática.');
  say(idx.Joaquín, 'guardian', today, '09:12', 'Qué bueno saberlo. ¿Cuándo se publican las notas del IV bimestre?', { read: false });
  // Jorge aún no acepta el consentimiento: su aviso de mensaje se genera al ingresar, como los demás.
  b.add('notifications', {
    guardian_id: guardianIds[idx.Joaquín],
    kind: 'mensaje',
    title: 'Mensaje de Prof. Rosa Huamán',
    body: 'Gracias por avisar. Joaquín viene trabajando muy bien en Matemática.',
    created_at: at(today, '09:05'),
    delivered_at: at(today, '09:07'),
    read_at: null,
  });
  notificationCount += 1;

  say(idx.Diego, 'system', today, '10:42', 'Aviso automático enviado: incidencia leve registrada', { kind: 'system' });
  say(idx.Diego, 'teacher', today, '10:50', 'Buenos días, señor Chávez. Hoy Diego usó el celular en clase de Matemática. Conversamos y guardó el equipo; le aviso para que lo converse en casa.');
  say(idx.Diego, 'guardian', today, '10:58', 'Entendido, hoy conversaré con Diego.', { read: false });

  const yesterday = dayOffset(1);
  say(idx.Gael, 'teacher', yesterday, '16:10', 'Buenas tardes, señora Milagros. ¿Podemos coordinar la entrevista por la salida de Gael del aula? Quedo atenta a su disponibilidad.');
  say(idx.Gael, 'guardian', yesterday, '17:25', 'Confirmo la entrevista del martes.');
  say(idx.Camila, 'guardian', yesterday, '18:02', 'Adjunté el certificado médico en secretaría.');
  say(idx.Ariana, 'teacher', dayOffset(3), '13:20', 'Buenas tardes, señor Mendoza. Ariana obtuvo una excelente nota en su exposición de Comunicación.');
  say(idx.Ariana, 'guardian', dayOffset(3), '19:40', 'Muchas gracias, profesora.');

  const counts = await flush(store, b);
  return { referenceDay: ref, counts };
}

module.exports = { seed, wipe, DEMO_PASSWORD, TERMS, createBuilder, flush, mulberry32, clamp, at };

if (require.main === module) {
  (async () => {
    const { openStore } = require('./store');
    const store = openStore();
    if (store.kind === 'memory') {
      console.log('Aviso: no hay credenciales de Firebase; se usaría memoria y los datos se perderían al terminar. Configura .env (ver .env.example).');
      process.exit(1);
    }
    const reset = process.argv.includes('--reset');
    const hasData = Boolean(await store.findOne('users', { username: 'vgallardo' }));
    if (hasData && !reset) {
      console.log('Firestore ya tiene datos. Usa "npm run seed -- --reset" para reiniciarlo (borra TODO).');
      return;
    }
    if (hasData) {
      console.log('Borrando datos existentes…');
      await wipe(store);
    }
    const { referenceDay, counts } = await seed(store);
    console.log(`Datos de demostración cargados en Firestore (día de referencia: ${referenceDay}).`);
    console.log(Object.entries(counts).map(([col, n]) => `${col}: ${n}`).join(' · '));
    console.log('Usuarios de ejemplo (contraseña común en src/seed.js): rhuaman · vgallardo · jnavarro');
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
