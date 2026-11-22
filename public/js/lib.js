// Utilidades compartidas por todas las vistas: plantillas seguras, API, formatos e iconos.

class Raw {
  constructor(value) {
    this.value = value;
  }
}

/** Marca un fragmento como HTML ya seguro (resultado de otra plantilla `html`). */
export const raw = (value) => new Raw(value);

const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => escapeMap[c]);

function render(value) {
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === false || value === null || value === undefined) return '';
  return esc(value);
}

/** Plantilla HTML que escapa todas las interpolaciones salvo las marcadas con `raw`/`html`. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new Raw(out);
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function setHtml(element, template) {
  element.innerHTML = render(template);
}

// ---------- API ----------

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (handler) => {
  onUnauthorized = handler;
};

export async function api(method, path, body) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Revisa tu conexión.');
  }
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(response.status, data?.error || 'Ocurrió un error inesperado.');
  }
  return data;
}
api.get = (path) => api('GET', path);
api.post = (path, body = {}) => api('POST', path, body);
api.put = (path, body) => api('PUT', path, body);
api.patch = (path, body) => api('PATCH', path, body);

export const qs = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

// ---------- Avisos ----------

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const item = document.createElement('div');
  item.className = `toast toast-${kind}`;
  item.textContent = message;
  box.append(item);
  setTimeout(() => item.remove(), kind === 'error' ? 6000 : 3800);
}

// ---------- Fechas ----------

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const pad = (n) => String(n).padStart(2, '0');

export const parseDate = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const toIso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const shiftDays = (iso, days) => {
  const d = parseDate(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
};

export const fmtDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const fmtLongDate = (iso) => {
  const d = parseDate(iso);
  return `${cap(WEEKDAYS[d.getDay()])}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
};
export const fmtDayMonth = (iso) => {
  const d = parseDate(iso);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
};

/** "9:12 a. m." a partir de "2026-11-20 09:12:00" o "09:12". */
export function fmtTime(value) {
  const time = value.length > 5 ? value.slice(11, 16) : value;
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h >= 12 ? 'p. m.' : 'a. m.'}`;
}

/** Etiqueta relativa: hora si es hoy, "Ayer" o dd/mm. */
export function fmtRelative(stamp, today) {
  if (!stamp) return '';
  const day = stamp.slice(0, 10);
  if (day === today) return fmtTime(stamp).replace(' a. m.', '').replace(' p. m.', '');
  if (day === shiftDays(today, -1)) return 'Ayer';
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** "Mié 18" para fechas pasadas, hora si es hoy. */
export function fmtNotificationTime(stamp, today) {
  const day = stamp.slice(0, 10);
  if (day === today) return fmtTime(stamp);
  const d = parseDate(day);
  return `${cap(WEEKDAYS[d.getDay()]).slice(0, 3)} ${pad(d.getDate())}`;
}

export const initials = (name) =>
  name
    .replace(/^(Prof\.|Lic\.|Dr\.|Dra\.|Sr\.|Sra\.)\s+/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

export const fmtNumber = (value, digits = 1) => (value === null || value === undefined ? '—' : Number(value).toFixed(digits));

// ---------- Iconos (trazo, 24x24) ----------

const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  attendance: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M9 15l2 2 4-4"/>',
  grades: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7M9 8h3"/>',
  conduct: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  students: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.6 3.5 5.2"/>',
  teacher: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  ban: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>',
  restore: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  send: '<path d="M4 12l16-8-6 16-2-7z"/>',
  check: '<path d="M5 12l4 4 10-10"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M12 10v7M9 14l3 3 3-3"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8l6 8M15 8l-6 8"/>',
  logout: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};

export const iconPath = (name) => ICONS[name] || '';

export function icon(name, size = 20) {
  return html`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${raw(iconPath(name))}</svg>`;
}

export const logo = (size = 36) =>
  html`<img src="/img/logo.png" alt="Logo College Saint Mary's" width="${size}" height="${size}" class="logo" style="width:${size}px;height:${size}px">`;

/** Etiquetas y colores de los estados de asistencia. */
export const ATTENDANCE = {
  A: { label: 'Asistió', short: 'Asistió', color: '#15803D' },
  T: { label: 'Tardanza', short: 'Tardanza', color: '#B45309' },
  FJ: { label: 'Faltas justificadas', short: 'F. justif.', color: '#5B6472' },
  FI: { label: 'Faltas injustificadas', short: 'F. injust.', color: '#B91C1C' },
};

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Evita doble envío: deshabilita el botón mientras corre la acción. */
export async function withBusy(button, action) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    return await action();
  } finally {
    button.disabled = false;
  }
}
