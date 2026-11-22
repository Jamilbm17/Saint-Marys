import { api, setUnauthorizedHandler, $, $$, setHtml, html, raw, icon, logo, initials, toast } from './lib.js';
import { loginView, consentView } from './views/auth.js';
import { teacherViews } from './views/teacher.js';
import { directorViews } from './views/director.js';
import { guardianViews } from './views/guardian.js';

const app = document.getElementById('app');
const state = { me: null, meta: null, badges: { messages: 0, notifications: 0 }, cleanups: [], shellRole: null };

const NAV = {
  docente: [
    { path: 'inicio', label: 'Inicio', icon: 'home' },
    { path: 'asistencia', label: 'Asistencia', icon: 'attendance' },
    { path: 'notas', label: 'Notas', icon: 'grades' },
    { path: 'conducta', label: 'Conducta', icon: 'conduct' },
    { path: 'mensajes', label: 'Mensajes', icon: 'chat', badge: 'messages' },
  ],
  direccion: [
    { path: 'inicio', label: 'Inicio', icon: 'home' },
    { section: 'Datos maestros' },
    { path: 'estudiantes', label: 'Estudiantes', icon: 'students' },
    { path: 'docentes', label: 'Docentes', icon: 'teacher' },
    { path: 'cursos', label: 'Cursos y secciones', icon: 'book' },
    { path: 'consentimientos', label: 'Consentimientos', icon: 'shield' },
    { section: 'Seguimiento' },
    { path: 'reportes', label: 'Reportes', icon: 'chart' },
  ],
};

const VIEWS = { docente: teacherViews, direccion: directorViews, apoderado: guardianViews };

export const navigate = (path) => {
  location.hash = `#/${path}`;
};

function parseHash() {
  const [path = '', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { path, params: rest };
}

async function loadSession() {
  try {
    state.me = (await api.get('/auth/me')).user;
    state.meta = await api.get('/meta');
  } catch {
    state.me = null;
  }
}

async function refreshBadges() {
  if (!state.me || (state.me.role === 'apoderado' && !state.me.guardian.consentAccepted)) return;
  try {
    state.badges = await api.get('/badges');
  } catch {
    return;
  }
  $$('[data-badge]').forEach((element) => {
    const count = state.badges[element.dataset.badge] || 0;
    element.textContent = count;
    element.hidden = count === 0;
  });
}

async function logout() {
  try {
    await api.post('/auth/logout');
  } finally {
    state.me = null;
    state.shellRole = null;
    navigate('login');
  }
}

setUnauthorizedHandler(() => {
  if (!state.me) return;
  state.me = null;
  state.shellRole = null;
  toast('Tu sesión expiró. Inicia sesión nuevamente.', 'error');
  navigate('login');
});

function runCleanups() {
  state.cleanups.splice(0).forEach((fn) => fn());
}

function buildStaffShell(role) {
  const items = NAV[role]
    .map((item) =>
      item.section
        ? html`<span class="nav-section">${item.section}</span>`
        : html`<a href="#/${item.path}" data-nav="${item.path}">${icon(item.icon)}${item.label}${
            item.badge ? html`<span class="badge" data-badge="${item.badge}" hidden>0</span>` : ''
          }</a>`,
    );
  const { me } = state;
  setHtml(
    app,
    html`
      <div class="shell" id="shell">
        <aside class="sidebar" id="sidebar">
          <div class="brand">${logo(36)}<div><small>College</small><strong>Saint Mary's</strong></div></div>
          <nav class="nav" aria-label="Menú ${role}">${items}</nav>
          <div class="sidebar-foot"><button class="linklike" id="logout">${icon('logout')}Cerrar sesión</button></div>
        </aside>
        <div class="main">
          <header class="topbar">
            <div style="display:flex;align-items:center;gap:12px">
              <button class="menu-toggle" id="menu-toggle" aria-label="Abrir menú">${icon('menu')}</button>
              <span class="context" id="context"></span>
            </div>
            <div class="user-chip">
              <span class="avatar ${role === 'direccion' ? 'gold' : ''}">${initials(me.fullName)}</span>
              <div class="who"><strong>${me.fullName}</strong><span>${me.roleLabel}</span></div>
            </div>
          </header>
          <div id="view"></div>
        </div>
      </div>`,
  );
  $('#logout').addEventListener('click', logout);
  $('#menu-toggle').addEventListener('click', () => $('#shell').classList.toggle('nav-open'));
  $('#sidebar').addEventListener('click', (event) => {
    if (event.target.closest('a')) $('#shell').classList.remove('nav-open');
  });
  state.shellRole = role;
  loadContextLabel(role);
}

async function loadContextLabel(role) {
  const label = $('#context');
  if (role === 'docente') {
    label.textContent = `${state.meta.currentTerm} Bimestre · Año escolar ${state.meta.schoolYear}`;
    return;
  }
  label.textContent = `Año escolar ${state.meta.schoolYear}`;
  try {
    const { sections } = await api.get('/admin/sections-list');
    const grades = [...new Set(sections.map((s) => s.grade))].join(', ');
    if (grades) label.textContent = `Grado piloto: ${grades} · Año escolar ${state.meta.schoolYear}`;
  } catch {
    /* el contexto es solo informativo */
  }
}

async function route() {
  runCleanups();
  const { path, params } = parseHash();
  const ctx = { get me() { return state.me; }, get meta() { return state.meta; }, params, navigate, refreshBadges, onLeave: (fn) => state.cleanups.push(fn), logout };

  if (!state.me) {
    state.shellRole = null;
    if (path !== 'login') return navigate('login');
    return loginView(app, { ...ctx, onSuccess: async () => { await loadSession(); navigate('inicio'); } });
  }
  if (path === 'login' || path === '') return navigate('inicio');

  const { role } = state.me;
  if (role === 'apoderado' && !state.me.guardian.consentAccepted) {
    state.shellRole = null;
    if (path !== 'consentimiento') return navigate('consentimiento');
    return consentView(app, { ...ctx, onSuccess: async () => { await loadSession(); navigate('inicio'); } });
  }
  if (path === 'consentimiento') return navigate('inicio');

  const views = VIEWS[role];
  const view = views[path];
  if (!view) return navigate('inicio');

  if (role === 'apoderado') {
    state.shellRole = null;
    await view(app, { ...ctx, badges: state.badges });
    refreshBadges();
    return;
  }
  if (state.shellRole !== role) buildStaffShell(role);
  $$('[data-nav]').forEach((a) => {
    const active = a.dataset.nav === path;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  // Contenedor nuevo en cada ruta: descarta los listeners de la vista anterior.
  const container = document.createElement('div');
  container.id = 'view';
  $('#view').replaceWith(container);
  setHtml(container, html`<div class="loading">Cargando…</div>`);
  try {
    await view(container, ctx);
  } catch (error) {
    setHtml(container, html`<div class="page"><div class="alert error">${icon('alert')}<span>${error.message}</span></div></div>`);
  }
  window.scrollTo(0, 0);
  refreshBadges();
}

window.addEventListener('hashchange', route);
await loadSession();
await route();
