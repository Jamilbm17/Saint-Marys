const { matches, inRange, hydrateId, Cache } = require('./common');

const BATCH_LIMIT = 400; // Firestore admite 500 operaciones por lote
const IN_LIMIT = 30; // máximo de valores en una consulta `in`
const COUNTERS = '_meta/counters';

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Almacén sobre Cloud Firestore (firebase-admin).
 * Las consultas usan solo filtros de igualdad (o un único rango), de modo que no hacen falta índices compuestos.
 */
class FirestoreStore {
  constructor(firestore) {
    this.kind = 'firestore';
    this.db = firestore;
    this.cache = new Cache();
  }

  hydrate(snapshot) {
    return { ...snapshot.data(), id: hydrateId(snapshot.id) };
  }

  async get(col, id) {
    const snapshot = await this.db.collection(col).doc(String(id)).get();
    return snapshot.exists ? this.hydrate(snapshot) : null;
  }

  async getMany(col, ids) {
    const unique = [...new Set(ids)];
    const out = [];
    for (const part of chunk(unique, 100)) {
      const snapshots = await this.db.getAll(...part.map((id) => this.db.collection(col).doc(String(id))));
      out.push(...snapshots.filter((s) => s.exists).map((s) => this.hydrate(s)));
    }
    return out;
  }

  async find(col, { where = {}, range } = {}) {
    let query = this.db.collection(col);
    if (range) {
      // Igualdad + rango sobre campos distintos exigiría un índice compuesto: la igualdad se aplica en memoria.
      if (range.gt !== undefined) query = query.where(range.field, '>', range.gt);
      if (range.gte !== undefined) query = query.where(range.field, '>=', range.gte);
      if (range.lt !== undefined) query = query.where(range.field, '<', range.lt);
      if (range.lte !== undefined) query = query.where(range.field, '<=', range.lte);
    } else {
      for (const [field, value] of Object.entries(where)) query = query.where(field, '==', value);
    }
    const snapshot = await query.get();
    const docs = snapshot.docs.map((d) => this.hydrate(d));
    return range ? docs.filter((doc) => matches(doc, where) && inRange(doc, range)) : docs;
  }

  async findOne(col, where) {
    let query = this.db.collection(col);
    for (const [field, value] of Object.entries(where)) query = query.where(field, '==', value);
    const snapshot = await query.limit(1).get();
    return snapshot.empty ? null : this.hydrate(snapshot.docs[0]);
  }

  async findIn(col, field, values, where = {}) {
    const out = [];
    const parts = chunk([...new Set(values)], IN_LIMIT);
    const results = await Promise.all(
      parts.map((part) => this.db.collection(col).where(field, 'in', part).get()),
    );
    for (const snapshot of results) out.push(...snapshot.docs.map((d) => this.hydrate(d)));
    return out.filter((doc) => matches(doc, where));
  }

  async allocIds(col, count) {
    const ref = this.db.doc(COUNTERS);
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const current = (snapshot.exists && snapshot.data()[col]) || 0;
      tx.set(ref, { [col]: current + count }, { merge: true });
      return Array.from({ length: count }, (_, i) => current + 1 + i);
    });
  }

  async insert(col, data) {
    const [id] = await this.allocIds(col, 1);
    await this.db.collection(col).doc(String(id)).set(data);
    return id;
  }

  async set(col, id, data) {
    await this.db.collection(col).doc(String(id)).set(data);
  }

  async update(col, id, patch) {
    try {
      await this.db.collection(col).doc(String(id)).update(patch);
    } catch (error) {
      if (error.code !== 5) throw error; // 5 = NOT_FOUND: igual que un UPDATE sin filas
    }
  }

  async remove(col, id) {
    await this.db.collection(col).doc(String(id)).delete();
  }

  async removeWhere(col, where) {
    const docs = await this.find(col, { where });
    await this.commit(docs.map((doc) => ({ type: 'delete', col, id: doc.id })));
  }

  async commit(ops) {
    for (const part of chunk(ops, BATCH_LIMIT)) {
      const batch = this.db.batch();
      for (const op of part) {
        const ref = this.db.collection(op.col).doc(String(op.id));
        if (op.type === 'set') batch.set(ref, op.data);
        else if (op.type === 'update') batch.update(ref, op.data);
        else if (op.type === 'delete') batch.delete(ref);
      }
      await batch.commit();
    }
  }

  async bulkLoad(col, docs) {
    await this.commit(docs.map(({ id, ...data }) => ({ type: 'set', col, id, data })));
    const numeric = docs.map((d) => d.id).filter((id) => typeof id === 'number');
    if (numeric.length) {
      await this.db.doc(COUNTERS).set({ [col]: Math.max(...numeric) }, { merge: true });
    }
  }

  async wipe() {
    for (const ref of await this.db.listCollections()) await this.db.recursiveDelete(ref);
    this.cache.clear();
  }

  cached(key, ttlMs, loader) {
    return this.cache.get(key, ttlMs, loader);
  }

  clearCache(prefix) {
    this.cache.clear(prefix);
  }
}

module.exports = { FirestoreStore };
