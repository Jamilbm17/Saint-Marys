import {
  api, qs, $, $$, html, raw, setHtml, icon, iconPath, logo, toast, withBusy, initials, fmtLongDate, fmtTime, fmtNotificationTime,
  fmtNumber,
} from '../lib.js';
import { threadHtml } from './chat.js';
import { pushStatus, enablePush } from '../push.js';

const NAV = [
  { path: 'inicio', label: 'Inicio', icon: 'home' },
  { path: 'notas', label: 'Notas', icon: 'grades' },
  { path: 'avisos', label: 'Avisos', icon: 'bell', badge: 'notifications' },
  { path: 'mensajes', label: 'Mensajes', icon: 'chat', badge: 'messages' },
];

/** Marco móvil común: contenido + barra de navegación inferior. */
function frame(root, { active, header, main, extra = '' }) {
  setHtml(
    root,
    html`
      <div class="phone-bg"><div class="phone">
        ${header}
        <main class="p-main" style="${active === 'mensajes' ? 'padding:0' : ''}">${main}</main>
        ${extra}
        <nav class="p-bar" aria-label="Navegación principal">
          ${NAV.map((n) => html`<a href="#/${n.path}" class="${n.path === active ? 'active' : ''}" ${n.path === active ? raw('aria-current="page"') : ''}>${icon(n.icon, 22)}${n.label}${n.badge ? html`<span class="badge" data-badge="${n.badge}" hidden>0</span>` : ''}</a>`)}
        </nav>
      </div></div>`,
  );
}

const subHeader = (title, right = '') => html`
  <header class="p-sub"><a class="back" href="#/inicio" aria-label="Volver">${icon('back', 22)}</a><h1>${title}</h1>${right}</header>`;

// =====================================================================
// Inicio
// =====================================================================
async function inicio(root, ctx) {
  const summary = await api.get('/guardian/summary');
  const { student, alert } = summary;
  const conductHint = summary.conduct.total
    ? Object.entries(summary.conduct.counts).map(([type, n]) => `${n} incidencia${n > 1 ? 's' : ''} ${type}${n > 1 && type !== 'grave' ? 's' : ''}`).join(', ')
    : 'Sin incidencias';
  const alertTitles = { T: 'Tardanza', FJ: 'Falta justificada', FI: 'Falta injustificada' };
  const alertWhen = alert ? (alert.date === summary.today ? 'hoy' : `el ${fmtLongDate(alert.date).toLowerCase()}`) : '';

  frame(root, {
    active: 'inicio',
    header: html`
      <header class="p-head">
        <div class="p-top">
          <div class="brand-s">${logo(30)}<span>Saint Mary's</span></div>
          <div style="display:flex;align-items:center">
            <a class="p-icon" href="#/avisos" aria-label="Notificaciones">${icon('bell', 22)}<span class="badge" data-badge="notifications" hidden>0</span></a>
            <button class="p-icon" id="logout" aria-label="Cerrar sesión">${icon('logout', 22)}</button>
          </div>
        </div>
        <div class="p-student">
          <span class="avatar">${initials(student.fullName)}</span>
          <div><strong>${student.fullName}</strong><span>${student.grade} · ${summary.term} Bimestre</span></div>
        </div>
      </header>`,
    main: html`
      <div class="p-stats">
        <div class="p-stat"><span class="label">Promedio</span><span class="value">${fmtNumber(summary.average)}</span><span class="hint ${summary.averageStatus === 'Aprobado' ? 'good' : 'bad'}">${summary.averageStatus || 'Sin notas'}</span></div>
        <div class="p-stat"><span class="label">Asistencia</span><span class="value">${summary.attendance.percent === null ? '—' : `${Math.round(summary.attendance.percent)} %`}</span><span class="hint warn">${summary.attendance.tardies} tardanza${summary.attendance.tardies === 1 ? '' : 's'}</span></div>
        <div class="p-stat"><span class="label">Conducta</span><span class="value">${summary.conduct.grade}</span><span class="hint muted" style="color:var(--ink-3)">${conductHint}</span></div>
      </div>
      ${alert
        ? html`<div class="p-alert">${icon('clock')}<div><strong>${alertTitles[alert.status]} registrada ${alertWhen}</strong><span>${alert.status === 'T' && alert.arrivalTime ? `Ingresó a las ${fmtTime(alert.arrivalTime)} · ` : ''}${alert.teacherName || 'Colegio'}</span></div></div>`
        : ''}
      <section class="p-card">
        <div class="head"><h2>Notas por curso</h2><a href="#/notas" style="font-size:13px;font-weight:600">Ver detalle</a></div>
        ${summary.courses.length
          ? summary.courses.map((c) => html`<div class="p-row"><span>${c.name}</span><span class="pill ${c.grade < 11 ? 'risk' : ''}">${c.grade}</span></div>`)
          : html`<div class="empty">Aún no hay notas publicadas.</div>`}
      </section>`,
  });
  $('#logout', root).addEventListener('click', () => ctx.logout());
}

// =====================================================================
// Notas (detalle)
// =====================================================================
async function notas(root, ctx) {
  let term = ctx.meta.currentTerm;
  async function draw() {
    const data = await api.get(`/guardian/grades?${qs({ term })}`);
    frame(root, {
      active: 'notas',
      header: subHeader('Notas', html`<span class="muted" style="font-size:13px;padding-right:8px">Promedio ${fmtNumber(data.average)}</span>`),
      main: html`
        <div class="filters" style="padding:0">${ctx.meta.terms.map((t) => html`<button data-term="${t.code}" aria-pressed="${String(t.code === term)}">${t.code} bimestre</button>`)}</div>
        ${data.courses.length
          ? data.courses.map((c) => html`
            <article class="p-card course-card">
              <div class="head"><strong>${c.name}</strong><span class="pill ${c.grade < 11 ? 'risk' : ''}">${c.grade}</span></div>
              ${c.competencies.map((k) => html`<div class="comp"><span>${k.code} · ${k.description}</span><b>${k.value}</b></div>`)}
            </article>`)
          : html`<div class="empty">No hay notas publicadas para el ${term} bimestre.</div>`}`,
    });
    $$('[data-term]', root).forEach((b) => b.addEventListener('click', () => { term = b.dataset.term; draw(); }));
  }
  await draw();
}

// =====================================================================
// Avisos
// =====================================================================
const KIND_STYLE = {
  asistencia: { icon: 'clock', bg: '#fef3c7', fg: '#92400e' },
  mensaje: { icon: 'chat', bg: '#e5f2e9', fg: '#17703f' },
  notas: { icon: 'grades', bg: '#dcfce7', fg: '#166534' },
  conducta: { icon: 'conduct', bg: '#ffedd5', fg: '#9a3412' },
  comunicado: { icon: 'grades', bg: '#e5f2e9', fg: '#17703f' },
};
const FILTERS = [['', 'Todas'], ['asistencia', 'Asistencia'], ['conducta', 'Conducta'], ['notas', 'Notas']];

async function avisos(root, ctx) {
  let kind = '';
  async function draw() {
    const [data, push] = await Promise.all([api.get(`/guardian/notifications?${qs({ kind })}`), pushStatus().catch(() => 'unsupported')]);
    const today = data.items.filter((n) => n.createdAt.startsWith(data.today));
    const older = data.items.filter((n) => !n.createdAt.startsWith(data.today));
    const card = (n) => {
      const style = KIND_STYLE[n.kind];
      return html`
        <article class="notif ${n.readAt ? '' : 'unread'}">
          <span class="ico" style="background:${style.bg};color:${style.fg}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${raw(iconPath(style.icon))}</svg></span>
          <span class="txt"><span class="top"><strong>${n.title}</strong><span>${fmtNotificationTime(n.createdAt, data.today)}</span></span><p>${n.body}</p></span>
        </article>`;
    };
    frame(root, {
      active: 'avisos',
      header: subHeader('Notificaciones', html`<button class="btn btn-ghost" id="read-all">Marcar leídas</button>`),
      main: html`
        ${push === 'default' ? html`
          <div class="alert" style="background:#e5f2e9;border:1px solid #b9dcc6;justify-content:space-between">
            <span>${icon('bell', 18)} Recibe los avisos en tu celular, aunque no tengas la página abierta.</span>
            <button class="btn btn-primary" id="enable-push">Activar</button>
          </div>` : ''}
        ${push === 'denied' ? html`<div class="alert">Bloqueaste las notificaciones del navegador. Puedes habilitarlas desde los ajustes del sitio.</div>` : ''}
        <div class="filters" style="padding:0;margin:-4px 0 0">${FILTERS.map(([value, label]) => html`<button data-kind="${value}" aria-pressed="${String(value === kind)}">${label}</button>`)}</div>
        ${today.length ? html`<span class="group-label">Hoy</span>${today.map(card)}` : ''}
        ${older.length ? html`<span class="group-label" style="padding-top:8px">Anteriores</span>${older.map(card)}` : ''}
        ${data.items.length ? '' : html`<div class="empty">No tienes notificaciones.</div>`}`,
    });
    $$('[data-kind]', root).forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind; draw(); }));
    $('#enable-push', root)?.addEventListener('click', async (event) => {
      await withBusy(event.currentTarget, async () => {
        try {
          await enablePush();
          toast('Notificaciones activadas en este dispositivo.');
        } catch (error) {
          toast(error.message, 'error');
        }
      });
      await draw();
    });
    $('#read-all', root).addEventListener('click', async () => {
      await api.post('/guardian/notifications/read-all');
      await draw();
      ctx.refreshBadges();
    });
  }
  await draw();
}

// =====================================================================
// Mensajes
// =====================================================================
async function mensajes(root, ctx) {
  const today = ctx.meta.today;
  const first = await api.get('/conversations');
  if (!first.conversations.length) {
    return frame(root, { active: 'mensajes', header: subHeader('Mensajes'), main: html`<div class="empty" style="padding:32px">Tu hijo(a) aún no tiene un tutor asignado para mensajes.</div>` });
  }
  const teacherName = first.conversations[0].teacherName;

  async function load(initial = false) {
    const data = await api.get('/conversations/me/messages');
    if (initial) {
      frame(root, {
        active: 'mensajes',
        header: subHeader(teacherName.replace(/^Prof\.\s+/, 'Prof. ')),
        main: html`<div class="p-chat"><div class="thread" id="thread"></div></div>`,
        extra: html`
          <form class="p-compose" id="composer">
            <label for="msg" class="sr-only">Escribir mensaje</label>
            <input class="input" id="msg" maxlength="2000" autocomplete="off" placeholder="Escribe un mensaje…">
            <button class="btn btn-primary" type="submit" aria-label="Enviar">${icon('send', 18)}</button>
          </form>`,
      });
      $('#composer', root).addEventListener('submit', async (event) => {
        event.preventDefault();
        const input = $('#msg', root);
        const body = input.value.trim();
        if (!body) return;
        await withBusy($('button', event.target), async () => {
          try {
            await api.post('/conversations/me/messages', { body });
            input.value = '';
            await load();
            window.scrollTo(0, document.body.scrollHeight);
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      });
    }
    setHtml($('#thread', root), threadHtml(data.messages, today, 'apoderado'));
    if (initial) window.scrollTo(0, document.body.scrollHeight);
  }
  await load(true);
  const timer = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 20000);
  ctx.onLeave(() => clearInterval(timer));
}

export const guardianViews = { inicio, notas, avisos, mensajes };
