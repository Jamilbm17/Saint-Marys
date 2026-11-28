import {
  api, qs, $, $$, html, raw, setHtml, icon, toast, withBusy, debounce, fmtDate, fmtTime, fmtNumber, initials, whatsappUrl,
} from '../lib.js';

// ---------- Diálogo reutilizable ----------
function openDialog(content, { onMount } = {}) {
  const dialog = document.createElement('dialog');
  setHtml(dialog, content);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
  });
  dialog.showModal();
  onMount?.(dialog);
  return dialog;
}

function showCredentials({ title, credentials }) {
  openDialog(html`
    <div class="dialog-body">
      <h2>${title}</h2>
      <p class="muted" style="font-size:14px">Entrega estas credenciales al apoderado. La contraseña temporal solo se muestra ahora; al ingresar por primera vez deberá aceptar el consentimiento.</p>
      <div class="credential"><span>Usuario</span><strong>${credentials.username}</strong></div>
      <div class="credential"><span>Contraseña temporal</span><strong>${credentials.temporaryPassword}</strong></div>
      <button class="btn btn-primary" data-close>Entendido</button>
    </div>`);
}

const chipConsent = (value) => html`<span class="chip ${value === 'Registrado' ? 'ok' : 'warn'}">${value}</span>`;

// =====================================================================
// Reporte (usado por Inicio y Reportes)
// =====================================================================
function deltaHint(delta, previousTerm, unit = '') {
  if (delta === null || !previousTerm) return html`<span class="hint">Sin período anterior</span>`;
  const sign = delta > 0 ? '+' : '';
  return html`<span class="hint ${delta >= 0 ? 'up' : 'down'}">${sign}${fmtNumber(delta)}${unit} vs. ${previousTerm} bimestre</span>`;
}

function statCards(report) {
  return html`
    <div class="stats">
      <div class="card stat big"><span class="label">Promedio general</span><span class="value">${fmtNumber(report.average)}</span>${deltaHint(report.averageDelta, report.previousTerm)}</div>
      <div class="card stat big"><span class="label">Asistencia</span><span class="value">${report.attendance === null ? '—' : `${fmtNumber(report.attendance)} %`}</span>${deltaHint(report.attendanceDelta, report.previousTerm, ' pts')}</div>
      <div class="card stat big"><span class="label">Estudiantes en riesgo</span><span class="value bad">${report.atRisk.length}</span><span class="hint">de ${report.activeStudents} estudiantes</span></div>
      <div class="card stat big"><span class="label">Notificaciones enviadas</span><span class="value">${report.notifications.total}</span><span class="hint">${report.notifications.timelyPercent === null ? 'Sin envíos' : `${report.notifications.timelyPercent} % entregadas en menos de 24 h`}</span></div>
    </div>`;
}

async function inicio(root, ctx) {
  const report = await api.get(`/reports/performance?${qs({ term: ctx.meta.currentTerm })}`);
  setHtml(
    root,
    html`
      <div class="page">
        <div class="page-head"><div><h1>Resumen del ${report.term} bimestre</h1><p>Indicadores generales de rendimiento, asistencia y comunicación con las familias.</p></div><a class="btn btn-primary" href="#/reportes">${icon('chart', 18)}Ver reporte completo</a></div>
        ${statCards(report)}
        <section class="card">
          <div class="section-head"><h2>Estudiantes en riesgo académico</h2><span class="muted" style="font-size:13px">Promedio menor a 11 o más de 3 faltas injustificadas</span></div>
          ${report.atRisk.length
            ? html`<div class="table-wrap"><table><thead><tr><th>Estudiante</th><th>Promedio</th><th>Faltas injust.</th><th>Motivo</th></tr></thead><tbody>
                ${report.atRisk.map((r) => html`<tr><td style="font-weight:600">${r.name}</td><td>${fmtNumber(r.average)}</td><td>${r.unjustifiedAbsences}</td><td>${r.reasons.join(' · ')}</td></tr>`)}
              </tbody></table></div>`
            : html`<div class="empty">No hay estudiantes en riesgo en este bimestre.</div>`}
        </section>
      </div>`,
  );
}

// =====================================================================
// Estudiantes
// =====================================================================
async function estudiantes(root, ctx) {
  const { sections } = await api.get('/admin/sections-list');
  const st = { page: 1, search: '', status: 'all', editing: null, data: null };

  setHtml(
    root,
    html`
      <div class="page">
        <div class="page-head">
          <div><h1>Estudiantes y apoderados</h1><p id="counts">&nbsp;</p></div>
          <button class="btn btn-primary" id="new-student">${icon('plus', 18)}Nuevo estudiante</button>
        </div>
        <div class="split">
          <section class="card grow" style="overflow:hidden">
            <div class="toolbar" style="padding:14px 16px;border-bottom:1px solid var(--line);align-items:center">
              <label class="sr-only" for="q">Buscar</label>
              <input class="input" id="q" type="search" placeholder="Buscar por nombre, DNI o apoderado" style="flex:1 1 220px;height:40px;width:auto">
              <select class="select" id="status" aria-label="Estado" style="height:40px;width:auto">
                <option value="all">Todos los estados</option><option value="active">Activos</option><option value="inactive">Inactivos</option>
              </select>
            </div>
            <div id="table"></div>
          </section>
          <section class="card card-pad side" id="form-card" style="display:flex;flex-direction:column;gap:14px"></section>
        </div>
      </div>`,
  );

  async function loadTable() {
    st.data = await api.get(`/admin/students?${qs({ page: st.page, pageSize: 8, search: st.search, status: st.status })}`);
    const { items, total, page, pageSize, activeCount, consentCount } = st.data;
    $('#counts', root).textContent = `${activeCount} estudiantes activos · ${consentCount} consentimientos registrados`;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const from = total ? (page - 1) * pageSize + 1 : 0;
    setHtml(
      $('#table', root),
      html`
        <div class="table-wrap"><table>
          <thead><tr><th>DNI</th><th>Estudiante</th><th>Apoderado</th><th>Consentimiento</th><th class="right">Acciones</th></tr></thead>
          <tbody>
            ${items.length
              ? items.map((s) => html`
                <tr style="${s.active ? '' : 'opacity:.6'}">
                  <td class="tnum">${s.dni}</td>
                  <td style="font-weight:500">${s.fullName}${s.active ? '' : html` <span class="chip muted">Inactivo</span>`}</td>
                  <td>${s.guardian ? html`<div style="line-height:1.3">${s.guardian.fullName}<div class="muted" style="font-size:12px">${s.guardian.phone}</div></div>` : '—'}</td>
                  <td>${chipConsent(s.consent)}</td>
                  <td class="right" style="white-space:nowrap">
                    <button class="btn btn-icon" data-edit="${s.id}" aria-label="Editar ${s.fullName}" title="Editar">${icon('edit', 16)}</button>
                    <button class="btn btn-icon neutral" data-reset="${s.id}" aria-label="Restablecer contraseña del apoderado de ${s.fullName}" title="Restablecer contraseña">${icon('key', 16)}</button>
                    <button class="btn btn-icon neutral" data-toggle="${s.id}" aria-label="${s.active ? 'Desactivar' : 'Activar'} ${s.fullName}" title="${s.active ? 'Desactivar' : 'Activar'}">${icon(s.active ? 'ban' : 'restore', 16)}</button>
                  </td>
                </tr>`)
              : html`<tr><td colspan="5"><div class="empty">No se encontraron estudiantes.</div></td></tr>`}
          </tbody>
        </table></div>
        <div class="row-between" style="padding:12px 16px;font-size:13px;color:var(--ink-3)">
          <span>${total ? `Mostrando ${from}–${from + items.length - 1} de ${total}` : 'Sin resultados'}</span>
          <div style="display:flex;gap:6px">
            ${Array.from({ length: pages }, (_, i) => html`<button class="btn btn-sm" data-page="${i + 1}" style="min-width:34px;padding:0 8px;${i + 1 === page ? 'background:var(--green-600);border-color:var(--green-600);color:#fff' : ''}" aria-label="Página ${i + 1}" ${i + 1 === page ? raw('aria-current="page"') : ''}>${i + 1}</button>`)}
          </div>
        </div>`,
    );
  }

  function drawForm(errors = {}) {
    const s = st.editing;
    const v = (key, fallback = '') => (st.formValues && key in st.formValues ? st.formValues[key] : fallback);
    setHtml(
      $('#form-card', root),
      html`
        <div class="row-between"><h2 style="font-size:18px">${s ? 'Editar estudiante' : 'Nuevo estudiante'}</h2>${s ? html`<button class="btn btn-ghost btn-icon neutral" id="close-form" aria-label="Cerrar">${icon('close', 18)}</button>` : ''}</div>
        <form id="student-form" style="display:flex;flex-direction:column;gap:14px" novalidate>
          <label class="field" for="f-dni">DNI del estudiante
            <input class="input ${errors.dni ? 'invalid' : ''}" id="f-dni" inputmode="numeric" maxlength="8" value="${v('dni', s?.dni)}" ${errors.dni ? raw('aria-invalid="true" aria-describedby="e-dni"') : ''}>
            ${errors.dni ? html`<span class="field-error" id="e-dni">${errors.dni}</span>` : ''}
          </label>
          <label class="field" for="f-name">Apellidos y nombres
            <input class="input ${errors.name ? 'invalid' : ''}" id="f-name" placeholder="Apellidos, Nombres" value="${v('name', s?.fullName)}">
            ${errors.name ? html`<span class="field-error">${errors.name}</span>` : ''}
          </label>
          <label class="field" for="f-section">Sección
            <select class="select" id="f-section">${sections.map((sec) => html`<option value="${sec.id}" ${String(sec.id) === String(v('sectionId', s?.sectionId)) ? raw('selected') : ''}>${sec.name}</option>`)}</select>
          </label>
          <div style="height:1px;background:var(--line)"></div>
          <strong style="font-size:14px">Apoderado</strong>
          <label class="field" for="f-guardian">Nombre completo
            <input class="input ${errors.guardian ? 'invalid' : ''}" id="f-guardian" value="${v('guardian', s?.guardian?.fullName)}">
            ${errors.guardian ? html`<span class="field-error">${errors.guardian}</span>` : ''}
          </label>
          <label class="field" for="f-phone">Celular
            <input class="input ${errors.phone ? 'invalid' : ''}" id="f-phone" inputmode="tel" maxlength="11" value="${v('phone', s?.guardian?.phone)}">
            ${errors.phone ? html`<span class="field-error">${errors.phone}</span>` : ''}
          </label>
          ${errors.general ? html`<div class="alert error" role="alert">${icon('alert')}<span>${errors.general}</span></div>` : ''}
          ${s ? '' : html`<p class="muted" style="font-size:12px">Al guardar se crea el usuario del apoderado con una contraseña temporal.</p>`}
          <div style="display:flex;gap:10px"><button type="button" class="btn" id="cancel-form" style="flex:1">Cancelar</button><button type="submit" class="btn btn-primary" style="flex:1">Guardar</button></div>
        </form>`,
    );
  }

  function resetForm() {
    st.editing = null;
    st.formValues = null;
    drawForm();
  }

  async function submitForm(event) {
    event.preventDefault();
    const values = {
      dni: $('#f-dni', root).value.trim(),
      name: $('#f-name', root).value.trim(),
      sectionId: $('#f-section', root).value,
      guardian: $('#f-guardian', root).value.trim(),
      phone: $('#f-phone', root).value.trim(),
    };
    st.formValues = values;
    const errors = {};
    if (!/^\d{8}$/.test(values.dni)) errors.dni = 'El DNI debe tener 8 dígitos.';
    if (!values.name.includes(',')) errors.name = 'Usa el formato "Apellidos, Nombres".';
    if (values.guardian.length < 5) errors.guardian = 'Ingresa el nombre completo del apoderado.';
    if (values.phone.replace(/\D/g, '').length !== 9) errors.phone = 'El celular debe tener 9 dígitos.';
    if (Object.keys(errors).length) return drawForm(errors);

    const payload = { dni: values.dni, fullName: values.name, sectionId: Number(values.sectionId), guardian: { fullName: values.guardian, phone: values.phone } };
    await withBusy($('button[type=submit]', root), async () => {
      try {
        if (st.editing) {
          await api.put(`/admin/students/${st.editing.id}`, payload);
          toast('Estudiante actualizado.');
        } else {
          const result = await api.post('/admin/students', payload);
          toast('Estudiante registrado.');
          showCredentials({ title: 'Apoderado registrado', credentials: result.credentials });
        }
        resetForm();
        await loadTable();
      } catch (error) {
        drawForm(error.status === 409 ? { dni: error.message } : { general: error.message });
      }
    });
  }

  root.addEventListener('submit', (event) => { if (event.target.id === 'student-form') submitForm(event); });
  root.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.id === 'new-student' || target.id === 'cancel-form' || target.id === 'close-form') {
      resetForm();
      if (target.id === 'new-student') $('#f-dni', root).focus();
      return;
    }
    if (target.dataset.page) { st.page = Number(target.dataset.page); return loadTable(); }
    const find = (id) => st.data.items.find((s) => s.id === Number(id));
    if (target.dataset.edit) {
      st.editing = find(target.dataset.edit);
      st.formValues = null;
      drawForm();
      $('#form-card', root).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (target.dataset.toggle) {
      const student = find(target.dataset.toggle);
      const next = !student.active;
      const message = next
        ? `¿Activar a ${student.fullName}? Su apoderado podrá ingresar nuevamente.`
        : `¿Desactivar a ${student.fullName}? Se conserva su historial, pero dejará de aparecer en las listas y su apoderado no podrá ingresar.`;
      if (!window.confirm(message)) return;
      try {
        await api.patch(`/admin/students/${student.id}/active`, { active: next });
        toast(next ? 'Estudiante activado.' : 'Estudiante desactivado.');
        await loadTable();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
    if (target.dataset.reset) {
      const student = find(target.dataset.reset);
      if (!window.confirm(`¿Restablecer la contraseña del apoderado de ${student.fullName}? Se cerrará su sesión actual.`)) return;
      try {
        const result = await api.post(`/admin/students/${student.id}/guardian/reset-password`);
        showCredentials({ title: 'Contraseña restablecida', credentials: result.credentials });
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
  $('#q', root).addEventListener('input', debounce((event) => { st.search = event.target.value; st.page = 1; loadTable(); }, 250));
  $('#status', root).addEventListener('change', (event) => { st.status = event.target.value; st.page = 1; loadTable(); });

  drawForm();
  await loadTable();
}

// =====================================================================
// Docentes, cursos y consentimientos
// =====================================================================
async function docentes(root) {
  const { teachers } = await api.get('/admin/teachers');
  setHtml(
    root,
    html`
      <div class="page">
        <div class="page-head"><div><h1>Docentes</h1><p>${teachers.length} docentes registrados · asignación de cursos del año escolar.</p></div></div>
        <section class="card table-wrap"><table>
          <thead><tr><th>Docente</th><th>Usuario</th><th>Cursos asignados</th><th>Tutoría</th></tr></thead>
          <tbody>${teachers.map((t) => html`
            <tr>
              <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar">${initials(t.fullName)}</span><div style="line-height:1.25"><strong>${t.fullName}</strong><div class="muted" style="font-size:12px">${t.title || ''}</div></div></div></td>
              <td class="tnum">${t.username}</td>
              <td>${t.assignments.length ? t.assignments.map((a) => html`<span class="chip ok" style="margin:2px 4px 2px 0">${a.course}</span>`) : '—'}</td>
              <td>${t.tutorOf.length ? t.tutorOf.join(', ') : '—'}</td>
            </tr>`)}</tbody>
        </table></section>
      </div>`,
  );
}

async function cursos(root) {
  const { sections } = await api.get('/admin/sections');
  setHtml(
    root,
    html`
      <div class="page">
        <div class="page-head"><div><h1>Cursos y secciones</h1><p>Distribución de cursos y docentes por sección.</p></div></div>
        ${sections.map((s) => html`
          <section class="card">
            <div class="section-head" style="border-bottom:1px solid var(--line)">
              <div><h2>${s.name}</h2><p class="muted" style="font-size:13px;margin-top:2px">Año escolar ${s.schoolYear} · Tutora: ${s.tutorName || 'Sin asignar'}</p></div>
              <span class="chip ok">${s.students} estudiantes activos</span>
            </div>
            <div class="table-wrap"><table>
              <thead><tr><th>Curso</th><th>Docente</th></tr></thead>
              <tbody>${s.courses.map((c) => html`<tr><td style="font-weight:500">${c.name}</td><td>${c.teacherName}</td></tr>`)}</tbody>
            </table></div>
          </section>`)}
      </div>`,
  );
}

async function consentimientos(root) {
  const { items } = await api.get('/admin/consents');
  const pending = items.filter((i) => !i.acceptedAt).length;
  setHtml(
    root,
    html`
      <div class="page">
        <div class="page-head"><div><h1>Consentimientos</h1><p>${items.length - pending} de ${items.length} apoderados aceptaron el tratamiento de datos (Ley N.° 29733).</p></div></div>
        ${pending ? html`<div class="alert warn">${icon('alert')}<span>${pending} apoderado(s) aún no aceptan el consentimiento y no reciben notificaciones.</span></div>` : ''}
        <section class="card table-wrap"><table>
          <thead><tr><th>Estudiante</th><th>Apoderado</th><th>Celular</th><th>Consentimiento</th><th>Notificaciones</th></tr></thead>
          <tbody>${items.map((i) => html`
            <tr>
              <td style="font-weight:500">${i.studentName}</td><td>${i.guardianName}</td><td class="tnum">${i.phone}</td>
              <td>${i.acceptedAt ? html`<span class="chip ok">Registrado</span> <span class="muted" style="font-size:12px">${fmtDate(i.acceptedAt.slice(0, 10))}</span>` : html`<span class="chip warn">Pendiente</span>`}</td>
              <td>${i.acceptedAt ? (i.notificationsEnabled ? html`<span class="chip ok">Activadas</span>` : html`<span class="chip muted">Desactivadas</span>`) : '—'}</td>
            </tr>`)}</tbody>
        </table></section>
      </div>`,
  );
}

// =====================================================================
// Reportes
// =====================================================================
async function reportes(root, ctx) {
  let term = ctx.meta.currentTerm;

  async function draw() {
    const report = await api.get(`/reports/performance?${qs({ term })}`);
    const stamp = report.generatedAt;
    setHtml(
      root,
      html`
        <div class="page">
          <div class="page-head">
            <div><h1>Reporte de rendimiento</h1><p>Actualizado al ${fmtDate(stamp.slice(0, 10))}, ${fmtTime(stamp)}</p></div>
            <div class="toolbar">
              <label class="field" for="r-term">Bimestre
                <select class="select" id="r-term" style="min-width:110px">${ctx.meta.terms.map((t) => html`<option ${t.code === term ? raw('selected') : ''}>${t.code}</option>`)}</select>
              </label>
              <button class="btn" id="export-pdf" type="button"><span style="color:#b91c1c;display:inline-flex">${icon('pdf', 16)}</span>Exportar PDF</button>
              <a class="btn" href="/api/reports/performance.xlsx?${qs({ term })}" download><span style="color:#15803d;display:inline-flex">${icon('sheet', 16)}</span>Exportar Excel</a>
            </div>
          </div>
          ${statCards(report)}
          <div class="split">
            <section class="card card-pad grow" style="flex:1.4 1 420px;display:flex;flex-direction:column;gap:14px">
              <div class="row-between"><h2>Promedio por curso</h2><span class="legend-line"><i></i>Nota mínima aprobatoria (11)</span></div>
              ${report.courses.length
                ? report.courses.map((c) => html`<div class="hbar"><span style="color:var(--ink-2)">${c.name}</span><div class="track"><div class="fill" style="width:${(c.average / 20 * 100).toFixed(1)}%"></div><div class="min"></div></div><span class="val">${fmtNumber(c.average)}</span></div>`)
                : html`<div class="empty">Sin notas publicadas en este bimestre.</div>`}
            </section>
            <section class="card card-pad side" style="display:flex;flex-direction:column;gap:14px">
              <h2>Asistencia por bimestre</h2>
              <div class="vbars">
                ${report.attendanceByTerm.map((a) => html`<div class="vbar ${a.term === term ? 'current' : ''}"><strong>${fmtNumber(a.percent)} %</strong><div class="bar" style="height:${Math.max(4, Math.round(((a.percent - 90) / 10) * 160))}px"></div><span class="muted">${a.term} bim.</span></div>`)}
              </div>
              <span class="muted" style="font-size:12px">Escala desde 90 % para resaltar la variación.</span>
            </section>
          </div>
          <section class="card">
            <div class="section-head"><h2>Estudiantes en riesgo académico</h2><span class="muted" style="font-size:13px">Promedio menor a 11 o más de 3 faltas injustificadas</span></div>
            ${report.atRisk.length
              ? html`<div class="table-wrap"><table>
                  <thead><tr><th>Estudiante</th><th>Promedio</th><th>Faltas injust.</th><th>Motivo</th><th class="no-print">Acción</th></tr></thead>
                  <tbody>${report.atRisk.map((r, i) => html`
                    <tr>
                      <td style="font-weight:600">${r.name}</td>
                      <td style="font-weight:700" class="${r.average !== null && r.average < 11 ? 'bad' : ''}">${fmtNumber(r.average)}</td>
                      <td style="font-weight:${r.unjustifiedAbsences > 3 ? 700 : 400}" class="${r.unjustifiedAbsences > 3 ? 'bad' : ''}">${r.unjustifiedAbsences}</td>
                      <td>${r.reasons.map((reason) => html`<span class="chip ${reason.startsWith('Promedio') ? 'danger' : 'orange'}" style="margin:2px 4px 2px 0">${reason}</span>`)}</td>
                      <td class="no-print">${r.guardian ? html`<button class="btn btn-ghost btn-sm" data-contact="${i}" style="padding:0">Contactar apoderado</button>` : '—'}</td>
                    </tr>`)}</tbody>
                </table></div>`
              : html`<div class="empty">No hay estudiantes en riesgo en este bimestre.</div>`}
          </section>
        </div>`,
    );

    $('#r-term', root).addEventListener('change', (event) => { term = event.target.value; draw(); });
    $('#export-pdf', root).addEventListener('click', () => window.print());
    $$('[data-contact]', root).forEach((button) =>
      button.addEventListener('click', () => contactDialog(report.atRisk[Number(button.dataset.contact)], ctx)),
    );
  }
  await draw();
}

function contactDialog(risk, ctx) {
  openDialog(
    html`
      <form class="dialog-body" id="contact-form">
        <h2>Contactar apoderado</h2>
        <p class="muted" style="font-size:14px"><strong style="color:var(--ink)">${risk.guardian.name}</strong> · apoderado de ${risk.name}<br>Celular: ${risk.guardian.phone}${whatsappUrl(risk.guardian.phone) ? html` · <a href="${whatsappUrl(risk.guardian.phone)}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>` : ''}</p>
        <label class="field" for="contact-body">Mensaje
          <textarea class="textarea" id="contact-body" rows="4" maxlength="2000" required placeholder="Escribe el mensaje para el apoderado"></textarea>
        </label>
        <div class="alert error hidden" id="contact-error" role="alert">${icon('alert')}<span></span></div>
        <div style="display:flex;gap:10px"><button type="button" class="btn" data-close style="flex:1">Cancelar</button><button type="submit" class="btn btn-primary" style="flex:1">${icon('send', 16)}Enviar</button></div>
      </form>`,
    {
      onMount(dialog) {
        $('#contact-body', dialog).focus();
        $('#contact-form', dialog).addEventListener('submit', async (event) => {
          event.preventDefault();
          const body = $('#contact-body', dialog).value.trim();
          if (!body) return;
          await withBusy($('button[type=submit]', dialog), async () => {
            try {
              await api.post(`/conversations/${risk.guardian.id}/messages`, { body });
              toast('Mensaje enviado al apoderado.');
              dialog.close();
            } catch (error) {
              const box = $('#contact-error', dialog);
              $('span', box).textContent = error.message;
              box.classList.remove('hidden');
            }
          });
        });
      },
    },
  );
}

export const directorViews = { inicio, estudiantes, docentes, cursos, consentimientos, reportes };
