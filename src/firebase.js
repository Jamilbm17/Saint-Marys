const fs = require('node:fs');
const path = require('node:path');

let cached;

/** Lee la cuenta de servicio desde JSON en una variable (Render) o desde un archivo local. */
function readServiceAccount() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    const text = inline.trim().startsWith('{') ? inline : Buffer.from(inline, 'base64').toString('utf8');
    return JSON.parse(text);
  }
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file) return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  return null;
}

/** Hay credenciales de Firebase (o emulador de Firestore) configuradas. */
function hasFirebaseCredentials() {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.FIRESTORE_EMULATOR_HOST,
  );
}

/** Devuelve { firestore(), messaging() } con firebase-admin inicializado, o null si no hay credenciales. */
function getAdmin() {
  if (cached !== undefined) return cached;
  if (!hasFirebaseCredentials()) {
    cached = null;
    return cached;
  }
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { getMessaging } = require('firebase-admin/messaging');
  let app = getApps()[0];
  if (!app) {
    const account = readServiceAccount();
    app = initializeApp(
      account
        ? { credential: cert(account), projectId: account.project_id }
        : { projectId: process.env.FIREBASE_PROJECT_ID || 'saint-marys-local' },
    );
  }
  const firestore = getFirestore(app);
  try {
    firestore.settings({ ignoreUndefinedProperties: true });
  } catch {
    /* ya inicializado */
  }
  cached = { app, firestore: () => firestore, messaging: () => getMessaging(app) };
  return cached;
}

/** Configuración pública de la app web de Firebase (la usa el navegador para registrar notificaciones push). */
function webConfig() {
  const { FIREBASE_WEB_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_WEB_APP_ID, FIREBASE_VAPID_KEY } =
    process.env;
  if (!FIREBASE_WEB_API_KEY || !FIREBASE_PROJECT_ID || !FIREBASE_MESSAGING_SENDER_ID || !FIREBASE_WEB_APP_ID || !FIREBASE_VAPID_KEY) {
    return null;
  }
  return {
    firebase: {
      apiKey: FIREBASE_WEB_API_KEY,
      projectId: FIREBASE_PROJECT_ID,
      messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
      appId: FIREBASE_WEB_APP_ID,
    },
    vapidKey: FIREBASE_VAPID_KEY,
  };
}

module.exports = { getAdmin, hasFirebaseCredentials, webConfig };
