/**
 * Inyección masiva de datos ficticios (se suma a los datos de demostración, no los reemplaza).
 *
 *   npm run seed:bulk                                   4 secciones x 30 estudiantes, bimestres III y IV
 *   npm run seed:bulk -- --sections 6 --students 35     más secciones / estudiantes por sección
 *   npm run seed:bulk -- --terms I,II,III,IV            asistencia y notas de todo el año (muchas escrituras)
 *   npm run seed:bulk -- --force                        ignora el aviso de cuota gratuita de Firestore
 *
 * Plan gratuito (Spark) de Firestore: 20 000 escrituras por día. El script estima las escrituras antes de empezar.
 */
const { hashPassword } = require('./auth');
const { EMPTY_CONVERSATION } = require('./domain');
const { toIsoDate, toIsoDateTime, parseIsoDate, lastWeekday, addDays, weekdaysBetween } = require('./util');
const config = require('./config');
const { DEMO_PASSWORD, TERMS, createBuilder, flush, mulberry32, clamp, at } = require('./seed');

const SECTION_NAMES = [
  ['1.° Secundaria – B', '1.° Secundaria'],
  ['2.° Secundaria – A', '2.° Secundaria'],
  ['2.° Secundaria – B', '2.° Secundaria'],
  ['3.° Secundaria – A', '3.° Secundaria'],
  ['3.° Secundaria – B', '3.° Secundaria'],
  ['4.° Secundaria – A', '4.° Secundaria'],
  ['5.° Secundaria – A', '5.° Secundaria'],
];
const FIRST_NAMES = ['Mateo', 'Valentina', 'Santiago', 'Camila', 'Sebastián', 'Isabella', 'Matías', 'Sofía', 'Joaquín', 'Lucía', 'Thiago', 'Mía', 'Gael', 'Antonella', 'Diego', 'Renata', 'Adrián', 'Fernanda', 'Bruno', 'Daniela', 'Leonardo', 'Ximena', 'Rodrigo', 'Camilo', 'Alonso', 'Luana', 'Piero', 'Nicole', 'Álvaro', 'Zoe'];
const SURNAMES = ['Quispe', 'Huamán', 'Flores', 'Rojas', 'Mendoza', 'Torres', 'García', 'Ramírez', 'Chávez', 'Vargas', 'Castillo', 'Soto', 'Paredes', 'Cárdenas', 'Salazar', 'Espinoza', 'Villanueva', 'Navarro', 'Silva', 'Mamani', 'Condori', 'Ccori', 'Paucar', 'Medina', 'Cabrera', 'Ortega', 'Lazo', 'Arce', 'León', 'Ruiz', 'Vílchez', 'Huertas', 'Díaz', 'Ríos', 'Gómez', 'Poma'];
const PARENT_FIRST = ['Rosa', 'Luis', 'Carmen', 'Jorge', 'Patricia', 'Carlos', 'Elena', 'Miguel', 'Marisol', 'Walter', 'Karina', 'Óscar', 'Nelly', 'Ricardo', 'Teresa', 'Julio', 'Milagros', 'Pedro', 'Ana', 'Víctor'];
const COURSE_OFFSET = [0, 0, -0.8, -0.3, 0, 0.5, 1.5, 1];
const INCIDENTS = [
  ['leve', 'Usó el celular durante la clase.'],
  ['leve', 'No trajo los materiales solicitados.'],
  ['leve', 'Conversó reiteradamente durante la explicación.'],
  ['moderada', 'Se retiró del aula sin autorización.'],
  ['grave', 'Agresión verbal a un compañero durante el recreo.'],
];

const termEnd = (code) => {
  const end = TERMS.find((t) => t.code === code).end;
  return end;
};
const stripAccents = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

/** Cuenta las escrituras que hará la carga (para avisar antes de superar la cuota). */
function estimateWrites({ sections, students, termCodes, ref }) {
  const total = sections * students;
  const days = TERMS.filter((t) => termCodes.includes(t.code)).reduce(
    (sum, t) => sum + weekdaysBetween(t.start, t.end < ref ? t.end : ref).length,
    0,
  );
  const gradeTerms = termCodes.filter((c) => c === 'III' || c === 'IV' || c === 'I' || c === 'II').length;
  return Math.round(total * days + total * 8 * gradeTerms + total * 4 + sections * 9 + total * 5);
}

async function seedBulk(store, { sections = 4, students = 30, termCodes = ['III', 'IV'], referenceDate = new Date(), force = false } = {}) {
  const last = TERMS[TERMS.length - 1].end;
  const ref = toIsoDate(lastWeekday(referenceDate)) > last ? last : toIsoDate(lastWeekday(referenceDate));
  const rng = mulberry32(7000 + sections * 31 + students);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const dayOffset = (days) => toIsoDate(addDays(parseIsoDate(ref), -days));
  const estimate = estimateWrites({ sections, students, termCodes, ref });
  console.log(`Estimación: ~${estimate.toLocaleString('es-PE')} escrituras (${sections} secciones x ${students} estudiantes).`);
  if (store.kind === 'firestore' && estimate > 18000 && !force) {
    throw new Error('Supera la cuota diaria gratuita de Firestore (20 000 escrituras). Reduce --sections/--students/--terms o usa --force (plan Blaze o emulador).');
  }

  const [courses, assignments, existingSections, existingStudents, existingUsers] = await Promise.all([
    store.find('courses'),
    store.find('teaching_assignments'),
    store.find('sections'),
    store.find('students'),
    store.find('users'),
  ]);
  if (!courses.length) throw new Error('Primero carga los datos base: npm run seed');
  courses.sort((a, b) => a.id - b.id);
  const teacherByCourse = new Map(assignments.map((a) => [a.course_id, a.teacher_id]));
  const tutors = existingUsers.filter((u) => u.role === 'docente');
  const takenNames = new Set(existingSections.map((s) => s.name));
  const takenDni = new Set(existingStudents.map((s) => s.dni));
  const takenUsers = new Set(existingUsers.map((u) => u.username));

  // Los ids nuevos continúan los existentes (el almacén lleva el contador de cada colección).
  const base = {};
  for (const col of ['sections', 'teaching_assignments', 'students', 'users', 'guardians', 'conversations', 'attendance', 'grades', 'conduct_incidents', 'notifications']) {
    const [first] = await store.allocIds(col, 1);
    base[col] = first - 1;
  }
  const b = createBuilder(base);

  const passwordHash = hashPassword(DEMO_PASSWORD);
  const now = toIsoDateTime(new Date());
  const available = SECTION_NAMES.filter(([name]) => !takenNames.has(name)).slice(0, sections);
  if (available.length < sections) console.log(`Solo hay ${available.length} nombres de sección libres; se crearán esas.`);

  let studentSeq = 0;
  const summary = { sections: 0, students: 0 };
  available.forEach(([name, grade], sectionIndex) => {
    const tutor = tutors[sectionIndex % tutors.length];
    const sectionId = b.add('sections', { name, grade, school_year: config.schoolYear, tutor_id: tutor.id });
    courses.forEach((c) => b.add('teaching_assignments', { teacher_id: teacherByCourse.get(c.id), course_id: c.id, section_id: sectionId }));
    summary.sections += 1;

    for (let n = 0; n < students; n += 1) {
      studentSeq += 1;
      const first = pick(FIRST_NAMES);
      const last = `${pick(SURNAMES)} ${pick(SURNAMES)}`;
      let dni;
      do dni = String(70000000 + Math.floor(rng() * 9999999)); while (takenDni.has(dni));
      takenDni.add(dni);
      const parentName = `${pick(PARENT_FIRST)} ${last}`;
      const baseUser = `${stripAccents(parentName).toLowerCase().split(/\s+/)[0][0]}${stripAccents(last).toLowerCase().split(/\s+/)[0]}`.replace(/[^a-z0-9]/g, '');
      let username = baseUser;
      for (let k = 2; takenUsers.has(username); k += 1) username = `${baseUser}${k}`;
      takenUsers.add(username);

      const consent = rng() < 0.85;
      const active = rng() > 0.02;
      const studentId = b.add('students', { dni, last_names: last, first_names: first, section_id: sectionId, active, created_at: now, updated_at: now });
      const userId = b.add('users', { username, password_hash: passwordHash, role: 'apoderado', full_name: parentName, title: null, active, created_at: now });
      const guardianId = b.add('guardians', {
        user_id: userId,
        student_id: studentId,
        full_name: parentName,
        phone: `9${String(Math.floor(rng() * 99999999)).padStart(8, '0')}`.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3'),
        relationship: 'Apoderado',
        consent_accepted_at: consent ? at(dayOffset(20 + Math.floor(rng() * 30)), '19:00') : null,
        notifications_enabled: consent && rng() < 0.9,
      });
      b.add('conversations', { guardian_id: guardianId, teacher_id: tutor.id, ...EMPTY_CONVERSATION });

      // Perfil del estudiante: nivel académico y propensión a faltar.
      const level = clamp(14 + (rng() + rng() + rng() - 1.5) * 4, 6, 19);
      const absenceRate = rng() < 0.08 ? 0.12 : 0.03 + rng() * 0.03;

      for (const termCode of termCodes) {
        courses.forEach((c, ci) => {
          const grade = clamp(Math.round(level + COURSE_OFFSET[ci] + (rng() * 3 - 1.5)), 4, 20);
          const values = [0, 1, 2, 3].map(() => clamp(grade + Math.floor(rng() * 3) - 1, 0, 20));
          const stamp = at(termEnd(termCode), '17:00');
          b.add('grades', { student_id: studentId, course_id: c.id, term: termCode, c1: values[0], c2: values[1], c3: values[2], c4: values[3], status: 'published', published_at: stamp, updated_by: teacherByCourse.get(c.id), updated_at: stamp });
        });
        const term = TERMS.find((t) => t.code === termCode);
        for (const day of weekdaysBetween(term.start, term.end < ref ? term.end : ref)) {
          const roll = rng();
          let status = 'A';
          let time = null;
          if (roll < absenceRate * 0.6) status = 'FJ';
          else if (roll < absenceRate) status = 'FI';
          else if (roll < absenceRate + 0.02) {
            status = 'T';
            time = `08:${String(5 + Math.floor(rng() * 25)).padStart(2, '0')}`;
          }
          b.add('attendance', { student_id: studentId, section_id: sectionId, date: day, status, arrival_time: time, recorded_by: tutor.id, updated_at: at(day, '08:30') });
        }
      }

      if (rng() < 0.12) {
        const [type, text] = pick(INCIDENTS);
        const date = dayOffset(Math.floor(rng() * 25));
        const stamp = at(date, '10:15');
        b.add('conduct_incidents', { student_id: studentId, section_id: sectionId, date, type, description: text, recorded_by: tutor.id, created_at: stamp, notified_at: consent ? stamp : null, notified_guardian: consent ? parentName : null });
        if (consent) b.add('notifications', { guardian_id: guardianId, kind: 'conducta', title: `Incidencia ${type}`, body: text, created_at: stamp, delivered_at: stamp, read_at: rng() < 0.5 ? stamp : null });
      }
      if (consent) {
        const stamp = at(dayOffset(2), '15:35');
        b.add('notifications', { guardian_id: guardianId, kind: 'notas', title: 'Notas publicadas', body: 'Comunicación – IV Bimestre ya está disponible.', created_at: stamp, delivered_at: stamp, read_at: rng() < 0.6 ? stamp : null });
      }
      summary.students += 1;
    }
  });

  console.log('Escribiendo en el almacén…');
  const counts = await flush(store, b);
  store.clearCache();
  return { counts, summary, studentSeq };
}

module.exports = { seedBulk, estimateWrites };

if (require.main === module) {
  (async () => {
    const { openStore } = require('./store');
    const store = openStore();
    if (store.kind === 'memory') {
      console.log('No hay credenciales de Firebase configuradas (ver .env.example). La carga se perdería al terminar.');
      process.exit(1);
    }
    const { counts } = await seedBulk(store, {
      sections: Number(arg('sections', 4)),
      students: Number(arg('students', 30)),
      termCodes: String(arg('terms', 'III,IV')).split(',').map((c) => c.trim().toUpperCase()),
      force: process.argv.includes('--force'),
    });
    console.log('Carga masiva lista:');
    console.log(Object.entries(counts).map(([col, n]) => `${col}: ${n}`).join(' · '));
    console.log(`Todas las cuentas de apoderado usan la contraseña común de src/seed.js (DEMO_PASSWORD).`);
  })().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
