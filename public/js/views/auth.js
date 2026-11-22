import { api, $, $$, html, setHtml, icon, logo, toast, withBusy } from '../lib.js';

const ROLES = [
  { value: 'docente', label: 'Docente' },
  { value: 'direccion', label: 'Dirección' },
  { value: 'apoderado', label: 'Apoderado' },
];

export function loginView(root, ctx) {
  let role = 'docente';
  const features = [
    ['attendance', 'Registro diario de asistencia por sección'],
    ['bell', 'Notificaciones automáticas a los apoderados'],
    ['chart', 'Reportes de rendimiento por bimestre'],
  ];

  setHtml(
    root,
    html`
      <main class="login">
        <section class="login-hero">
          <div class="brand">${logo(48)}<div><small>College</small><strong style="font-size:22px">Saint Mary's</strong></div></div>
          <div>
            <h1>Control Académico</h1>
            <p class="lead">Notas, asistencia y conducta en un solo lugar, con avisos al celular de las familias el mismo día.</p>
            <ul>${features.map(([name, text]) => html`<li>${icon(name)}${text}</li>`)}</ul>
          </div>
          <p class="addr">Jr. Santa María Antonieta 202, Urb. Palao · San Martín de Porres</p>
        </section>
        <section class="login-panel">
          <form class="login-card" id="login-form" novalidate>
            <div>
              <h2>Iniciar sesión</h2>
              <p class="muted" style="margin-top:6px">Ingresa con el usuario que te entregó el colegio.</p>
            </div>
            <div class="field">
              <span>Ingresar como</span>
              <div class="roles" role="group" aria-label="Perfil">
                ${ROLES.map((r) => html`<button type="button" data-role="${r.value}" aria-pressed="${String(r.value === role)}">${r.label}</button>`)}
              </div>
            </div>
            <div class="field">
              <label for="username">Usuario</label>
              <input class="input" id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" style="height:46px" required>
            </div>
            <div class="field">
              <label for="password">Contraseña</label>
              <input class="input" id="password" name="password" type="password" autocomplete="current-password" style="height:46px" required>
            </div>
            <div class="row-between">
              <label class="check" style="align-items:center;font-size:14px"><input type="checkbox" id="remember" style="width:18px;height:18px">Recordarme</label>
              <a href="#/login" id="forgot" style="font-size:14px;font-weight:500">¿Olvidaste tu contraseña?</a>
            </div>
            <div class="alert error hidden" id="login-error" role="alert">${icon('alert')}<span></span></div>
            <button class="btn btn-primary btn-block" type="submit">Ingresar</button>
            <div class="note">${icon('lock', 18)}<span>Conexión segura (HTTPS). Cada perfil ve solo la información que le corresponde, conforme a la Ley N.° 29733.</span></div>
          </form>
        </section>
      </main>`,
  );

  $$('[data-role]', root).forEach((button) =>
    button.addEventListener('click', () => {
      role = button.dataset.role;
      $$('[data-role]', root).forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    }),
  );
  $('#forgot', root).addEventListener('click', (event) => {
    event.preventDefault();
    toast('Solicita a la dirección del colegio que restablezca tu contraseña.', 'ok');
  });

  const form = $('#login-form', root);
  const errorBox = $('#login-error', root);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.classList.add('hidden');
    const username = $('#username', root).value.trim();
    const password = $('#password', root).value;
    if (!username || !password) {
      $('span', errorBox).textContent = 'Ingresa tu usuario y contraseña.';
      errorBox.classList.remove('hidden');
      return;
    }
    await withBusy($('button[type=submit]', form), async () => {
      try {
        await api.post('/auth/login', { role, username, password, remember: $('#remember', root).checked });
        await ctx.onSuccess();
      } catch (error) {
        $('span', errorBox).textContent = error.message;
        errorBox.classList.remove('hidden');
      }
    });
  });
  $('#username', root).focus();
}

export function consentView(root, ctx) {
  const { guardian } = ctx.me;
  const items = [
    ['grades', 'Qué datos usamos', 'Notas, asistencia, conducta y tu número de contacto.'],
    ['bell', 'Para qué', 'Informarte del rendimiento de tu hijo y avisarte de faltas o incidencias.'],
    ['shield', 'Quién los ve', 'Solo tú, los docentes de la sección y la dirección. No se comparten con terceros.'],
  ];
  setHtml(
    root,
    html`
      <div class="phone-bg"><div class="phone">
        <header class="p-head" style="flex-direction:row;align-items:center;gap:12px;padding:20px 20px 18px">
          ${logo(34)}
          <div style="line-height:1.2"><strong style="font-size:16px;display:block">Saint Mary's</strong><span style="font-size:13px;color:#c6dccd">Primer ingreso · Paso 1 de 1</span></div>
        </header>
        <main class="p-main" style="padding:22px 20px;gap:16px">
          <div>
            <h1 style="font-size:22px;line-height:1.25">Consentimiento para el uso de datos</h1>
            <p style="margin-top:6px;font-size:14px;line-height:1.5" class="muted">Hola, ${guardian.firstName}. Antes de continuar, necesitamos tu autorización para tratar los datos de <strong style="color:var(--ink)">${guardian.student.fullName}</strong>.</p>
          </div>
          <div class="consent-box">
            ${items.map(([name, title, text]) => html`<div class="consent-item"><span class="ico">${icon(name, 18)}</span><div><strong>${title}</strong><span>${text}</span></div></div>`)}
            <a href="#/consentimiento" id="policy" style="font-size:13px;font-weight:500">Leer la política completa (Ley N.° 29733)</a>
          </div>
          <label class="check"><input type="checkbox" id="data-consent">Autorizo al College Saint Mary's a tratar los datos de mi hijo para los fines descritos.</label>
          <label class="check"><input type="checkbox" id="notif-consent" checked>Quiero recibir notificaciones en este celular.</label>
          <div class="alert error hidden" id="consent-error" role="alert">${icon('alert')}<span></span></div>
        </main>
        <footer class="p-foot">
          <button class="btn btn-primary btn-block" id="accept" style="border-radius:12px;height:50px" disabled>Acepto y continuar</button>
          <p>Sin tu consentimiento no se activan las notificaciones. Se guardará la fecha de aceptación.</p>
          <button class="btn btn-ghost btn-sm" id="decline" style="align-self:center">Salir</button>
        </footer>
      </div></div>`,
  );

  const dataCheck = $('#data-consent', root);
  const accept = $('#accept', root);
  dataCheck.addEventListener('change', () => {
    accept.disabled = !dataCheck.checked;
  });
  $('#policy', root).addEventListener('click', (event) => {
    event.preventDefault();
    toast('La política completa de tratamiento de datos está disponible en la secretaría del colegio.');
  });
  $('#decline', root).addEventListener('click', () => ctx.logout());
  accept.addEventListener('click', () =>
    withBusy(accept, async () => {
      try {
        await api.post('/auth/consent', { dataConsent: dataCheck.checked, notificationsConsent: $('#notif-consent', root).checked });
        await ctx.onSuccess();
      } catch (error) {
        const box = $('#consent-error', root);
        $('span', box).textContent = error.message;
        box.classList.remove('hidden');
      }
    }),
  );
}
