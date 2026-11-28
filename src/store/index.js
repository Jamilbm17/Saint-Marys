const { getAdmin } = require('../firebase');
const { MemoryStore } = require('./memory');
const { FirestoreStore } = require('./firestore');

/**
 * DATA_STORE=firestore | memory. Sin definirlo: Firestore si hay credenciales, memoria si no.
 */
function openStore() {
  const wanted = process.env.DATA_STORE || (getAdmin() ? 'firestore' : 'memory');
  if (wanted === 'firestore') {
    const admin = getAdmin();
    if (!admin) {
      throw new Error('DATA_STORE=firestore pero faltan credenciales: define FIREBASE_SERVICE_ACCOUNT_PATH o FIREBASE_SERVICE_ACCOUNT_JSON.');
    }
    return new FirestoreStore(admin.firestore());
  }
  return new MemoryStore();
}

module.exports = { openStore, MemoryStore, FirestoreStore };
