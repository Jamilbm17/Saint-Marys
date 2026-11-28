const crypto = require('node:crypto');
const { getAdmin } = require('./firebase');
const { toIsoDateTime } = require('./util');

const COLLECTION = 'device_tokens';
const tokenId = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** FCM se activa solo si hay credenciales de Firebase y no se desactiva con FCM_ENABLED=false. */
const pushEnabled = () => process.env.FCM_ENABLED !== 'false' && Boolean(getAdmin()) && process.env.NODE_ENV !== 'test';

async function registerToken(store, guardianId, token, userAgent = '') {
  await store.set(COLLECTION, tokenId(token), {
    guardian_id: guardianId,
    token,
    user_agent: String(userAgent).slice(0, 200),
    created_at: toIsoDateTime(new Date()),
  });
}

async function unregisterToken(store, token) {
  await store.remove(COLLECTION, tokenId(token));
}

/**
 * Envía la notificación push (Firebase Cloud Messaging) a los dispositivos del apoderado.
 * Nunca lanza: un fallo de FCM no debe impedir que se guarde la asistencia, la nota o la incidencia.
 */
async function sendToGuardian(store, guardianId, { title, body, kind }) {
  if (!pushEnabled()) return { sent: 0 };
  try {
    const devices = await store.find(COLLECTION, { where: { guardian_id: guardianId } });
    if (!devices.length) return { sent: 0 };
    const response = await getAdmin().messaging().sendEachForMulticast({
      tokens: devices.map((d) => d.token),
      notification: { title, body: body.length > 180 ? `${body.slice(0, 177)}…` : body },
      data: { kind: kind || '' },
      webpush: { fcmOptions: { link: '/#/avisos' } },
    });
    const dead = [];
    response.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        dead.push({ type: 'delete', col: COLLECTION, id: devices[i].id });
      }
    });
    if (dead.length) await store.commit(dead);
    return { sent: response.successCount };
  } catch (error) {
    console.error('FCM:', error.message);
    return { sent: 0 };
  }
}

module.exports = { registerToken, unregisterToken, sendToGuardian, pushEnabled };
