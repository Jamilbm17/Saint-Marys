const { matches, inRange, hydrateId, Cache } = require('./common');

/** Almacén en memoria: pruebas y desarrollo local sin credenciales de Firebase. */
class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.collections = new Map();
    this.counters = new Map();
    this.cache = new Cache();
  }

  table(col) {
    if (!this.collections.has(col)) this.collections.set(col, new Map());
    return this.collections.get(col);
  }

  hydrate(id, data) {
    return { ...structuredClone(data), id: hydrateId(id) };
  }

  async get(col, id) {
    const data = this.table(col).get(String(id));
    return data ? this.hydrate(String(id), data) : null;
  }

  async getMany(col, ids) {
    return (await Promise.all([...new Set(ids)].map((id) => this.get(col, id)))).filter(Boolean);
  }

  async find(col, { where = {}, range } = {}) {
    const out = [];
    for (const [id, data] of this.table(col)) {
      if (matches(data, where) && inRange(data, range)) out.push(this.hydrate(id, data));
    }
    return out;
  }

  async findOne(col, where) {
    return (await this.find(col, { where }))[0] || null;
  }

  async findIn(col, field, values, where = {}) {
    const wanted = new Set(values);
    return (await this.find(col, { where })).filter((doc) => wanted.has(doc[field]));
  }

  async allocIds(col, count) {
    const start = (this.counters.get(col) || 0) + 1;
    this.counters.set(col, start + count - 1);
    return Array.from({ length: count }, (_, i) => start + i);
  }

  async insert(col, data) {
    const [id] = await this.allocIds(col, 1);
    this.table(col).set(String(id), structuredClone(data));
    return id;
  }

  async set(col, id, data) {
    this.table(col).set(String(id), structuredClone(data));
  }

  async update(col, id, patch) {
    const current = this.table(col).get(String(id));
    if (current) this.table(col).set(String(id), { ...current, ...structuredClone(patch) });
  }

  async remove(col, id) {
    this.table(col).delete(String(id));
  }

  async removeWhere(col, where) {
    for (const doc of await this.find(col, { where })) this.table(col).delete(String(doc.id));
  }

  async commit(ops) {
    for (const op of ops) {
      if (op.type === 'set') await this.set(op.col, op.id, op.data);
      else if (op.type === 'update') await this.update(op.col, op.id, op.data);
      else if (op.type === 'delete') await this.remove(op.col, op.id);
    }
  }

  async bulkLoad(col, docs) {
    for (const { id, ...data } of docs) {
      this.table(col).set(String(id), structuredClone(data));
      if (typeof id === 'number') this.counters.set(col, Math.max(this.counters.get(col) || 0, id));
    }
  }

  async wipe() {
    this.collections.clear();
    this.counters.clear();
    this.cache.clear();
  }

  cached(key, ttlMs, loader) {
    return this.cache.get(key, ttlMs, loader);
  }

  clearCache(prefix) {
    this.cache.clear(prefix);
  }
}

module.exports = { MemoryStore };
