import {
  api, qs, $, $$, html, raw, setHtml, icon, toast, withBusy, debounce, initials, fmtDate, fmtLongDate, fmtTime, fmtRelative,
  fmtNumber, ATTENDANCE, whatsappUrl,
} from '../lib.js';
import { threadHtml, scrollToEnd } from './chat.js';

const select = (id, label, options, value, attrs = '') => html`
  <label class="field" for="${id}">${label}
    <select class="select" id="${id}" ${raw(attrs)}>${options.map((o) => html`<option value="${o.value}" ${o.value === value ? raw('selected') : ''}>${o.label}</option>`)}</select>
  </label>`;

const noSections = html`<div class="page"><div class="alert warn">${icon('alert')}<span>No tienes secciones asignadas. Comunícate con la dirección.</span></div></div>`;

// =====================================================================
// Inicio
// =====================================================================
async function inicio(root, ctx) {
  const { sections } = await api.get('/teacher/sections');
  if (!sections.length) return setHtml(root, noSections);
  const section = sections[0];
  const firstName = ctx.me.fullName.replace(/^Prof\.\s+/, '').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  const [attendance, conduct, badges] = await Promise.all([
    api.get(`/teacher/attendance?${qs({ sectionId: section.id, date: ctx.meta.defaultDate })}`),
    api.get(`/teacher/conduct?${qs({ sectionId: section.id, term: ctx.meta.currentTerm })}`),
    api.get('/badges'),
  ]);
  const count = (status) => attendance.students.filter((s) => s.status === status).length;
  const total = attendance.students.length;

  setHtml(
    root,
    html`
      <div class="page">
        <div class="page-head"><div><h1>${greeting}, ${firstName}</h1><p>${section.name} · ${fmtLongDate(ctx.meta.defaultDate)}</p></div></div>
        ${attendance.saved ? '' : html`<div class="alert warn">${icon('alert')}<span>Aún no se registró la asistencia de esta fecha. <a href="#/asistencia">Registrar ahora</a></span></div>`}
        <div class="stats">
          <div class="card stat"><span class="label">Asistieron</span><span class="value good">${count('A') + count('T')}</span><span class="hint">de ${total} estudiantes</span></div>
          <div class="card stat"><span class="label">Tardanzas</span><span class="value warn">${count('T')}</span><span class="hint">registradas hoy</span></div>
          <div class="card stat"><span class="label">Faltas</span><span class="value bad">${count('FJ') + count('FI')}</span><span class="hint">${count('FJ')} justificadas · ${count('FI')} injustificadas</span></div>
          <div class="card stat"><span class="label">Mensajes sin leer</span><span class="value">${badges.messages}</span><span class="hint"><a href="#/mensajes">Abrir mensajes</a></span></div>
        </div>
        <div class="split">
          <section class="card card-pad grow">
            <div class="section-head" style="padding:0 0 8px"><h2>Incidencias recientes</h2><a href="#/conducta" style="font-size:13px;font-weight:600">Ver todas</a></div>
            ${conduct.items.length
              ? conduct.items.slice(0, 3).map((i) => html`<div class="incident"><div class="head"><strong>${i.studentName}</strong><span class="muted" style="font-size:13px">${fmtDate(i.date)}</span></div><p style="font-size:14px;color:var(--ink-2)">${i.description}</p></div>`)
              : html`<div class="empty">Sin incidencias registradas en el bimestre.</div>`}
          </section>
          <section class="card card-pad side">
            <h2 style="margin-bottom:12px">Accesos rápidos</h2>
            <div style="display:flex;flex-direction:column;gap:10px">
              <a class="btn" href="#/asistencia">${icon('attendance', 18)}Registrar asistencia</a>
              <a class="btn" href="#/notas">${icon('grades', 18)}Registrar notas</a>
              <a class="btn" href="#/conducta">${icon('conduct', 18)}Registrar incidencia</a>
            </div>
          </section>
        </div>
      </div>`,
  );
}

// =====================================================================
// Asistencia
// =====================================================================
const STAT_LABELS = { A: 'Asistieron', T: 'Tardanzas', FJ: 'Faltas justificadas', FI: 'Faltas injustificadas' };

async function asistencia(root, ctx) {
  const { sections } = await api.get('/teacher/sections');
  if (!sections.length) return setHtml(root, noSections);
  const st = { sectionId: sections[0].id, date: ctx.meta.defaultDate, rows: [], baseline: new Map(), error: '' };

  setHtml(
    root,
    html`
      <div class="page">
        <div class="page-head">
          <div><h1>Registro de asistencia</h1><p>Marca el estado de cada estudiante y guarda en una sola acción.</p></div>
          <div class="toolbar">
            ${select('att-section', 'Sección', sections.map((s) => ({ value: String(s.id), label: s.name })), String(st.sectionId), sections.length === 1 ? 'disabled' : '')}
            <label class="field" for="att-date">Fecha<input class="input" type="date" id="att-date" value="${st.date}" max="${ctx.meta.today}" style="min-width:190px"></label>
          </div>
        </div>
        <div id="att-body"><div class="loading">Cargando…</div></div>
      </div>`,
  );
  const body = $('#att-body', root);

  async function load() {
    st.error = '';
    try {
      const data = await api.get(`/teacher/attendance?${qs({ sectionId: st.sectionId, date: st.date })}`);
      st.rows = data.students.map((s) => ({ ...s, time: s.arrivalTime || '' }));
      st.baseline = new Map(data.students.map((s) => [s.studentId, `${data.saved ? s.status : 'A'}|${s.arrivalTime || ''}`]));
      st.saved = data.saved;
    } catch (error) {
      st.error = error.message;
      st.rows = [];
    }
    draw();
  }

  const pending = () => st.rows.filter((r) => r.status !== 'A' && st.baseline.get(r.studentId) !== `${r.status}|${r.status === 'T' ? r.time : ''}`).length;

  function draw() {
    const count = (code) => st.rows.filter((r) => r.status === code).length;
    const notify = pending();
    setHtml(
      body,
      html`
        <div style="display:flex;flex-direction:column;gap:20px">
          <p class="muted" style="font-size:14px">${fmtLongDate(st.date)}${st.saved ? ' · asistencia ya registrada' : ''}</p>
          ${st.error ? html`<div class="alert error" role="alert">${icon('alert')}<span>${st.error}</span></div>` : ''}
          ${st.rows.length
            ? html`
              <div class="stats">
                ${Object.entries(ATTENDANCE).map(([code, a]) => html`<div class="card stat"><span class="label">${STAT_LABELS[code]}</span><span class="value" style="color:${a.color}">${count(code)}</span></div>`)}
              </div>
              <div class="card table-wrap">
                <table>
                  <thead><tr><th style="width:56px">N.°</th><th>Apellidos y nombres</th><th style="width:420px">Estado</th></tr></thead>
                  <tbody>
                    ${st.rows.map((r, i) => html`
                      <tr>
                        <td class="muted">${r.number}</td>
                        <td style="font-weight:500;font-size:15px">${r.fullName}
                          ${r.status === 'T' ? html`<label class="time-inline">Hora de ingreso <input type="time" data-time="${i}" value="${r.time}" aria-label="Hora de ingreso de ${r.fullName}"></label>` : ''}
                        </td>
                        <td><div class="seg4" role="group" aria-label="Estado de ${r.fullName}">
                          ${Object.entries(ATTENDANCE).map(([code, a]) => html`<button type="button" data-row="${i}" data-status="${code}" aria-pressed="${String(r.status === code)}" style="${r.status === code ? `background:${a.color};border-color:${a.color}` : ''}">${a.short}</button>`)}
                        </div></td>
                      </tr>`)}
                  </tbody>
                </table>
              </div>
              <div class="notice-bar">
                <div class="text">${icon('bell')}<span>${notify
                  ? html`Al guardar, se enviará una notificación automática a <strong>${notify === 1 ? '1 apoderado' : `${notify} apoderados`}</strong> (tardanza o falta).`
                  : 'No hay cambios que requieran notificar a los apoderados.'}</span></div>
                <div class="actions">
                  <button class="btn" id="mark-all" type="button">Marcar todos “Asistió”</button>
                  <button class="btn btn-primary" id="save" type="button">Guardar asistencia</button>
                </div>
              </div>`
            : ''}
        </div>`,
    );
  }

  body.addEventListener('click', (event) => {
    const statusButton = event.target.closest('[data-status]');
    if (statusButton) {
      const row = st.rows[Number(statusButton.dataset.row)];
      row.status = statusButton.dataset.status;
      if (row.status === 'T' && !row.time) row.time = '08:10';
      return draw();
    }
    if (event.target.closest('#mark-all')) {
      st.rows.forEach((r) => { r.status = 'A'; });
      return draw();
    }
    const save = event.target.closest('#save');
    if (save) {
      withBusy(save, async () => {
        try {
          const result = await api.put('/teacher/attendance', {
            sectionId: st.sectionId,
            date: st.date,
            records: st.rows.map((r) => ({ studentId: r.studentId, status: r.status, arrivalTime: r.status === 'T' ? r.time || null : null })),
          });
          const extra = result.withoutNotifications ? ` ${result.withoutNotifications} apoderado(s) no tienen notificaciones activas.` : '';
          toast(`Asistencia guardada. Se notificó a ${result.notified} apoderado(s).${extra}`);
          await load();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }
  });
  body.addEventListener('change', (event) => {
    const time = event.target.closest('[data-time]');
    if (time) {
      st.rows[Number(time.dataset.time)].time = time.value;
      draw();
    }
  });
  $('#att-section', root).addEventListener('change', (event) => { st.sectionId = Number(event.target.value); load(); });
  $('#att-date', root).addEventListener('change', (event) => { if (event.target.value) { st.date = event.target.value; load(); } });
  await load();
}

// =====================================================================
// Notas
// =====================================================================
const GRADE_PATTERN = /^\d{1,2}$/;
const gradeState = (value) => {
  const text = String(value ?? '').trim();
  if (text === '') return 'empty';
  return GRADE_PATTERN.test(text) && Number(text) >= 0 && Number(text) <= 20 ? 'ok' : 'invalid';
};

async function notas(root, ctx) {
  const { sections } = await api.get('/teacher/sections');
  const available = sections.filter((s) => s.courses.length);
  if (!available.length) return setHtml(root, noSections);
  const st = { section: available[0], courseId: available[0].courses[0].id, term: ctx.meta.currentTerm, data: null, values: [] };
  const termOptions = ctx.meta.terms.map((t) => ({ value: t.code, label: t.code }));

  setHtml(
    root,
    html`
      <div class="page">
        <div class="page-head">
          <div><h1>Registro de notas</h1><p>Escala vigesimal (0 a 20). El promedio se calcula automáticamente.</p></div>
          <div class="toolbar">
            ${select('g-section', 'Sección', available.map((s) => ({ value: String(s.id), label: s.name })), String(st.section.id), available.length === 1 ? 'disabled' : '')}
            <div id="course-slot"></div>
            ${select('g-term', 'Bimestre', termOptions, st.term)}
          </div>
        </div>
        <div id="g-body"><div class="loading">Cargando…</div></div>
      </div>`,
  );
  const body = $('#g-body', root);

  const drawCourseSelect = () =>
    setHtml($('#course-slot', root), select('g-course', 'Curso', st.section.courses.map((c) => ({ value: String(c.id), label: c.name })), String(st.courseId), st.section.courses.length === 1 ? 'disabled' : ''));

  async function load() {
    setHtml(body, html`<div class="loading">Cargando…</div>`);
    try {
      st.data = await api.get(`/teacher/grades?${qs({ sectionId: st.section.id, courseId: st.courseId, term: st.term })}`);
    } catch (error) {
      return setHtml(body, html`<div class="alert error" role="alert">${icon('alert')}<span>${error.message}</span></div>`);
    }
    st.values = st.data.rows.map((r) => r.values.map((v) => (v === null ? '' : String(v))));
    drawTable();
  }

  function drawTable() {
    const { competencies, rows } = st.data;
    const published = rows.length && rows.every((r) => r.status === 'published');
    setHtml(
      body,
      html`
        <div style="display:flex;flex-direction:column;gap:20px">
          <div class="card legend">${competencies.map((c) => html`<span><strong>${c.code}</strong> · ${c.description}</span>`)}</div>
          <div class="card table-wrap">
            <table>
              <thead><tr><th style="width:48px">N.°</th><th>Apellidos y nombres</th>${competencies.map((c) => html`<th class="num" style="width:84px">${c.code}</th>`)}<th class="num" style="width:96px">Promedio</th><th style="width:120px">Estado</th></tr></thead>
              <tbody>
                ${rows.map((r, i) => html`
                  <tr data-row="${i}">
                    <td class="muted">${r.number}</td>
                    <td style="font-weight:500;font-size:15px">${r.fullName}</td>
                    ${[0, 1, 2, 3].map((k) => html`<td class="num"><input class="grade-input" type="text" inputmode="numeric" maxlength="2" data-i="${i}" data-k="${k}" value="${st.values[i][k]}" aria-label="${competencies[k]?.code || `C${k + 1}`} ${r.fullName}"></td>`)}
                    <td class="avg" data-avg></td>
                    <td data-chip></td>
                  </tr>`)}
              </tbody>
            </table>
          </div>
          <div class="alert error hidden" id="g-error" role="alert">${icon('alert')}<span></span></div>
          <div class="row-between">
            <span style="font-size:14px" class="muted">Promedio de la sección: <strong style="color:var(--ink)" id="class-avg">—</strong> · En riesgo (menor a 11): <strong class="bad" id="risk-count">0</strong></span>
            <div class="actions">
              <button class="btn" id="draft" type="button">Guardar borrador</button>
              <button class="btn btn-primary" id="publish" type="button">Publicar notas</button>
            </div>
          </div>
          <p class="muted" style="font-size:13px">${published ? 'Estas notas están publicadas y son visibles para los apoderados.' : 'Las notas en borrador no son visibles para los apoderados. Al publicar se les notifica.'}</p>
        </div>`,
    );
    refresh();
  }

  /** Recalcula promedios, estados y errores sin volver a dibujar los campos (conserva el foco). */
  function refresh() {
    const errors = [];
    const averages = [];
    $$('tr[data-row]', body).forEach((tr) => {
      const i = Number(tr.dataset.row);
      const values = st.values[i];
      const states = values.map(gradeState);
      $$('.grade-input', tr).forEach((input, k) => input.classList.toggle('invalid', states[k] === 'invalid'));
      const name = st.data.rows[i].fullName;
      states.forEach((s, k) => {
        if (s === 'invalid') errors.push(`${name.split(',')[1].trim()} ${name.split(' ')[0]} (C${k + 1})`);
      });
      const complete = states.every((s) => s === 'ok');
      const avg = complete ? Math.round(values.reduce((sum, v) => sum + Number(v), 0) / 4) : null;
      if (avg !== null) averages.push(avg);
      const risk = avg !== null && avg < 11;
      const avgCell = $('[data-avg]', tr);
      avgCell.textContent = avg === null ? '—' : String(avg).padStart(2, '0');
      avgCell.className = `avg ${risk ? 'bad' : ''}`;
      const chip = avg === null ? (states.includes('invalid') ? ['Revisar', 'warn'] : ['Sin notas', 'muted']) : risk ? ['En riesgo', 'danger'] : ['Aprobado', 'ok'];
      setHtml($('[data-chip]', tr), html`<span class="chip ${chip[1]}">${chip[0]}</span>`);
    });
    const box = $('#g-error', body);
    box.classList.toggle('hidden', errors.length === 0);
    $('span', box).textContent = `Nota fuera de rango en ${errors.join(', ')}. Solo se aceptan valores de 0 a 20.`;
    $('#class-avg', body).textContent = averages.length ? fmtNumber(averages.reduce((s, v) => s + v, 0) / averages.length) : '—';
    $('#risk-count', body).textContent = averages.filter((v) => v < 11).length;
  }

  async function save(button, publish) {
    const flat = st.values.flat();
    if (flat.some((v) => gradeState(v) === 'invalid')) return toast('Corrige las notas fuera de rango antes de guardar.', 'error');
    if (publish && flat.some((v) => gradeState(v) !== 'ok')) return toast('Completa todas las notas antes de publicar.', 'error');
    await withBusy(button, async () => {
      try {
        const result = await api.put('/teacher/grades', {
          sectionId: st.section.id, courseId: st.courseId, term: st.term, publish,
          rows: st.data.rows.map((r, i) => ({ studentId: r.studentId, values: st.values[i] })),
        });
        toast(publish ? `Notas publicadas. Se notificó a ${result.notified} apoderado(s).` : 'Borrador guardado.');
        await load();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  body.addEventListener('input', (event) => {
    const input = event.target.closest('.grade-input');
    if (!input) return;
    st.values[Number(input.dataset.i)][Number(input.dataset.k)] = input.value.trim();
    refresh();
  });
  body.addEventListener('click', (event) => {
    const draft = event.target.closest('#draft');
    const publish = event.target.closest('#publish');
    if (draft) save(draft, false);
    if (publish) save(publish, true);
  });
  $('#g-section', root).addEventListener('change', (event) => {
    st.section = available.find((s) => s.id === Number(event.target.value));
    st.courseId = st.section.courses[0].id;
    drawCourseSelect();
    load();
  });
  root.addEventListener('change', (event) => {
    if (event.target.id === 'g-course') { st.courseId = Number(event.target.value); load(); }
    if (event.target.id === 'g-term') { st.term = event.target.value; load(); }
  });
  drawCourseSelect();
  await load();
}

// =====================================================================
// Conducta
// =====================================================================
const TYPE_CHIP = { leve: 'warn', moderada: 'orange', grave: 'danger' };

async function conducta(root, ctx) {
  const { sections } = await api.get('/teacher/sections');
  if (!sections.length) return setHtml(root, noSections);
  const section = sections[0];
  let banner = null;

  async function draw() {
    const data = await api.get(`/teacher/conduct?${qs({ sectionId: section.id, term: ctx.meta.currentTerm })}`);
    setHtml(
      root,
      html`
        <div class="page">
          <div class="page-head"><div><h1>Incidencias de conducta</h1><p>${section.name} · Cada incidencia se notifica al apoderado.</p></div></div>
          ${banner
            ? banner.sent
              ? html`<div class="alert ok" role="status">${icon('checkCircle')}<span>Incidencia registrada. Se notificó al apoderado <strong>${banner.guardianName}</strong> por notificación push y aviso en la plataforma · ${fmtTime(banner.at)}</span></div>`
              : html`<div class="alert warn" role="status">${icon('alert')}<span>Incidencia registrada. ${banner.guardianName ? `${banner.guardianName} no tiene las notificaciones activas, por lo que no se envió aviso.` : 'El estudiante no tiene apoderado registrado.'}</span></div>`
            : ''}
          <div class="split">
            <form class="card card-pad side" id="incident-form" style="display:flex;flex-direction:column;gap:16px;flex:1 1 380px" novalidate>
              <h2 style="font-size:18px">Nueva incidencia</h2>
              <label class="field" for="inc-student">Estudiante
                <select class="select" id="inc-student" style="height:44px" required>
                  <option value="">Selecciona un estudiante</option>
                  ${data.students.map((s) => html`<option value="${s.id}">${s.fullName}</option>`)}
                </select>
              </label>
              <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
                <label class="field" for="inc-date">Fecha<input class="input" type="date" id="inc-date" value="${ctx.meta.defaultDate}" max="${ctx.meta.today}" style="height:44px"></label>
                <label class="field" for="inc-type">Tipo<select class="select" id="inc-type" style="height:44px"><option value="leve">Leve</option><option value="moderada">Moderada</option><option value="grave">Grave</option></select></label>
              </div>
              <label class="field" for="inc-text">Descripción<textarea class="textarea" id="inc-text" rows="4" maxlength="1000" placeholder="Describe lo observado y las acciones tomadas"></textarea></label>
              <div class="note">${icon('bell', 18)}<span>El apoderado recibirá la notificación automáticamente al guardar.</span></div>
              <div class="alert error hidden" id="inc-error" role="alert">${icon('alert')}<span></span></div>
              <button class="btn btn-primary" type="submit" style="height:46px;font-size:15px">Registrar incidencia</button>
            </form>
            <section class="card card-pad grow" style="flex:1.3 1 420px">
              <div class="row-between" style="margin-bottom:6px"><h2 style="font-size:18px">Historial del bimestre</h2><span class="muted" style="font-size:13px">${data.items.length} registros</span></div>
              ${data.items.length
                ? data.items.map((i) => html`
                  <article class="incident">
                    <div class="head"><strong style="font-size:15px">${i.studentName}</strong><div style="display:flex;gap:8px;align-items:center"><span class="chip ${TYPE_CHIP[i.type]}">${i.type[0].toUpperCase() + i.type.slice(1)}</span><span class="muted" style="font-size:13px">${fmtDate(i.date)}</span></div></div>
                    <p style="font-size:14px;line-height:1.5;color:var(--ink-2)">${i.description}</p>
                    ${i.notifiedAt
                      ? html`<span class="sent">${icon('check', 14)}Notificado: ${i.notifiedGuardian} · ${i.notifiedAt.startsWith(ctx.meta.today) ? 'hoy' : fmtDate(i.notifiedAt.slice(0, 10))} ${fmtTime(i.notifiedAt)}</span>`
                      : html`<span class="sent off">Sin aviso (el apoderado no tiene notificaciones activas)</span>`}
                  </article>`)
                : html`<div class="empty">Aún no hay incidencias en este bimestre.</div>`}
            </section>
          </div>
        </div>`,
    );

    const form = $('#incident-form', root);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = $('#inc-error', root);
      const fail = (message) => { $('span', errorBox).textContent = message; errorBox.classList.remove('hidden'); };
      errorBox.classList.add('hidden');
      const studentId = Number($('#inc-student', root).value);
      const description = $('#inc-text', root).value.trim();
      if (!studentId) return fail('Selecciona un estudiante.');
      if (description.length < 5) return fail('Describe lo observado (mínimo 5 caracteres).');
      await withBusy($('button[type=submit]', form), async () => {
        try {
          const result = await api.post('/teacher/conduct', { studentId, date: $('#inc-date', root).value, type: $('#inc-type', root).value, description });
          banner = result.notification;
          await draw();
        } catch (error) {
          fail(error.message);
        }
      });
    });
  }
  await draw();
}

// =====================================================================
// Mensajes
// =====================================================================
async function mensajes(root, ctx) {
  const today = ctx.meta.today;
  let selected = ctx.params[0] ? Number(ctx.params[0]) : null;
  let filter = '';
  let list = [];

  setHtml(
    root,
    html`
      <div class="chat">
        <section class="chat-list">
          <div class="search"><label for="conv-search" class="sr-only">Buscar apoderado</label><input class="input" id="conv-search" type="search" placeholder="Buscar apoderado o estudiante"></div>
          <div id="conv-list"></div>
        </section>
        <section class="chat-pane" id="pane"></section>
      </div>`,
  );

  const drawList = () => {
    const q = filter.trim().toLowerCase();
    const items = list.filter((c) => !q || c.guardianName.toLowerCase().includes(q) || c.studentName.toLowerCase().includes(q));
    setHtml(
      $('#conv-list', root),
      items.length
        ? items.map((c) => html`
          <a class="conv ${c.guardianId === selected ? 'active' : ''}" href="#/mensajes/${c.guardianId}">
            <span class="avatar lg">${initials(c.guardianName)}</span>
            <span class="body">
              <span class="row"><span class="name">${c.guardianName}</span><span class="time">${fmtRelative(c.lastAt, today)}</span></span>
              <span class="sub">${c.studentName}</span>
              <span class="last">${c.lastBody || 'Sin mensajes'}</span>
            </span>
            ${c.unread ? html`<span class="dot" aria-label="${c.unread} sin leer"></span>` : ''}
          </a>`)
        : html`<div class="empty">No hay resultados.</div>`,
    );
  };

  async function loadList() {
    list = (await api.get('/conversations')).conversations;
    if (!selected && list.length) selected = (list.find((c) => c.lastAt) || list[0]).guardianId;
    drawList();
  }

  /** Actualiza solo los mensajes (no el campo de texto) para no perder lo que se está escribiendo. */
  async function refreshThread() {
    const data = await api.get(`/conversations/${selected}/messages`);
    const thread = $('#thread', root);
    if (!thread) return data;
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    setHtml(thread, threadHtml(data.messages, today, 'docente'));
    if (nearBottom) scrollToEnd(thread);
    return data;
  }

  async function openThread() {
    const pane = $('#pane', root);
    if (!selected) return setHtml(pane, html`<div class="empty">Selecciona una conversación.</div>`);
    let data;
    try {
      data = await api.get(`/conversations/${selected}/messages`);
    } catch (error) {
      return setHtml(pane, html`<div class="page"><div class="alert error">${icon('alert')}<span>${error.message}</span></div></div>`);
    }
    setHtml(
      pane,
      html`
        <div class="chat-head">
          <span class="avatar lg">${initials(data.guardian.name)}</span>
          <div class="who"><strong style="font-size:15px">${data.guardian.name}</strong><span>Apoderado de ${data.student.fullName} · ${data.student.sectionName}</span></div>
          ${whatsappUrl(data.guardian.phone) ? html`<a class="btn btn-ghost" style="margin-left:auto" href="${whatsappUrl(data.guardian.phone)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir WhatsApp con el apoderado">WhatsApp</a>` : ''}
        </div>
        <div class="thread" id="thread">${threadHtml(data.messages, today, 'docente')}</div>
        <form class="composer" id="composer">
          <label for="msg" class="sr-only">Escribir mensaje</label>
          <input class="input" id="msg" maxlength="2000" autocomplete="off" placeholder="Escribe un mensaje…">
          <button class="btn btn-primary" type="submit">${icon('send', 18)}Enviar</button>
        </form>`,
    );
    scrollToEnd($('#thread', root));
    $('#composer', root).addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = $('#msg', root);
      const body = input.value.trim();
      if (!body) return;
      await withBusy($('button', event.target), async () => {
        try {
          await api.post(`/conversations/${selected}/messages`, { body });
          input.value = '';
          await Promise.all([refreshThread(), loadList()]);
          scrollToEnd($('#thread', root));
          ctx.refreshBadges();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
  }

  $('#conv-search', root).addEventListener('input', debounce((event) => { filter = event.target.value; drawList(); }, 150));
  await loadList();
  await openThread();
  ctx.refreshBadges();

  const timer = setInterval(async () => {
    if (document.hidden || !selected) return;
    try { await Promise.all([loadList(), refreshThread()]); ctx.refreshBadges(); } catch { /* reintenta en el siguiente ciclo */ }
  }, 20000);
  ctx.onLeave(() => clearInterval(timer));
}

export const teacherViews = { inicio, asistencia, notas, conducta, mensajes };
