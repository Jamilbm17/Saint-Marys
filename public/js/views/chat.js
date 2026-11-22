import { html, icon, fmtTime, fmtLongDate, fmtDayMonth } from '../lib.js';

/** Hilo de mensajes agrupado por día. `viewerRole` decide cuándo mostrar el remitente. */
export function threadHtml(messages, today, viewerRole) {
  if (!messages.length) return html`<div class="empty">Aún no hay mensajes. Escribe el primero.</div>`;
  let lastDay = '';
  const parts = [];
  for (const m of messages) {
    const day = m.createdAt.slice(0, 10);
    if (day !== lastDay) {
      lastDay = day;
      const label = day === today ? `Hoy, ${fmtDayMonth(day)}` : fmtLongDate(day);
      parts.push(html`<div class="day-sep">${label}</div>`);
    }
    if (m.kind === 'system') {
      parts.push(html`<div class="sys-note">${icon('bell', 16)}${m.body}</div>`);
      continue;
    }
    const showName = !m.mine && (viewerRole === 'apoderado' || m.senderRole === 'direccion');
    const meta = [showName ? m.senderName : '', fmtTime(m.createdAt), m.mine && m.readAt ? 'Leído' : ''].filter(Boolean).join(' · ');
    parts.push(html`
      <div class="bubble-wrap ${m.mine ? 'mine' : ''}">
        <div class="bubble">${m.body}</div>
        <span class="meta">${meta}</span>
      </div>`);
  }
  return html`${parts}`;
}

export function scrollToEnd(element) {
  if (element) element.scrollTop = element.scrollHeight;
}
