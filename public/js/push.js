/**
 * Notificaciones push del apoderado con Firebase Cloud Messaging (FCM).
 * El SDK se carga bajo demanda desde el CDN de Google, solo si el servidor tiene FCM configurado.
 */
import { api } from './lib.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';
const TOKEN_KEY = 'saintmarys.fcmToken';

let setupPromise;

/** Estado: 'unsupported' | 'disabled' (servidor sin FCM) | 'denied' | 'granted' | 'default'. */
export async function pushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  const { enabled } = await api.get('/guardian/push/config');
  if (!enabled) return 'disabled';
  if (Notification.permission === 'granted' && localStorage.getItem(TOKEN_KEY)) return 'granted';
  return Notification.permission === 'denied' ? 'denied' : 'default';
}

async function setup() {
  const { config } = await api.get('/guardian/push/config');
  const [{ initializeApp }, { getMessaging, getToken, onMessage }] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-messaging.js`),
  ]);
  const app = initializeApp(config.firebase);
  const messaging = getMessaging(app);
  const params = new URLSearchParams(config.firebase).toString();
  const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${params}`);
  return { messaging, getToken, onMessage, registration, vapidKey: config.vapidKey };
}

/** Pide permiso, obtiene el token de FCM y lo registra en el servidor. */
export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('No se concedió el permiso para mostrar notificaciones.');
  setupPromise ||= setup();
  const { messaging, getToken, onMessage, registration, vapidKey } = await setupPromise;
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('No se pudo obtener el token de notificaciones.');
  await api.post('/guardian/push/token', { token });
  localStorage.setItem(TOKEN_KEY, token);
  // Con la app abierta, FCM no muestra la notificación: la mostramos nosotros.
  onMessage(messaging, (payload) => {
    const { title, body } = payload.notification || {};
    if (title) registration.showNotification(title, { body, icon: '/img/logo.png' });
  });
  return token;
}

export async function disablePush() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) await api('DELETE', '/guardian/push/token', { token }).catch(() => {});
  localStorage.removeItem(TOKEN_KEY);
}
