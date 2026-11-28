/**
 * Utilidades compartidas por las implementaciones del almacén de datos.
 *
 * Contrato del almacén (async). Cada "tabla" es una colección:
 *   get(col, id)                      -> doc | null
 *   getMany(col, ids)                 -> docs (sin los inexistentes)
 *   find(col, { where, range })       -> docs. `where`: igualdad por campo; `range`: { field, gt, gte, lt, lte }
 *   findOne(col, where)               -> doc | null
 *   findIn(col, field, values, where) -> docs cuyo `field` está en `values`
 *   insert(col, data)                 -> id numérico autoincremental
 *   allocIds(col, n)                  -> n ids numéricos nuevos (para escrituras en lote)
 *   commit(ops)                       -> aplica en lote [{ type: 'set'|'update'|'delete', col, id, data }]
 *   set / update / remove / removeWhere
 *   bulkLoad(col, docs)               -> carga masiva de docs con id explícito (siembra)
 *   wipe()                            -> borra todo
 *   cached(key, ttlMs, loader) / clearCache()
 */

/** Los ids numéricos se guardan como texto en Firestore; los de texto (token, código de bimestre) se conservan. */
const hydrateId = (rawId) => (/^\d+$/.test(rawId) ? Number(rawId) : rawId);

function matches(doc, where = {}) {
  return Object.entries(where).every(([field, value]) => (doc[field] ?? null) === value);
}

function inRange(doc, range) {
  if (!range) return true;
  const value = doc[range.field];
  if (value === undefined || value === null) return false;
  if (range.gt !== undefined && !(value > range.gt)) return false;
  if (range.gte !== undefined && !(value >= range.gte)) return false;
  if (range.lt !== undefined && !(value < range.lt)) return false;
  if (range.lte !== undefined && !(value <= range.lte)) return false;
  return true;
}

/** Caché en proceso para datos casi estáticos (bimestres, cursos) y reportes pesados. */
class Cache {
  constructor() {
    this.entries = new Map();
  }

  async get(key, ttlMs, loader) {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await loader();
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  clear(prefix = '') {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
  }
}

module.exports = { hydrateId, matches, inRange, Cache };
