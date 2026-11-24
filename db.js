// db.js — armazenamento local persistente (IndexedDB). Nada aqui depende de internet.
const DB_NAME = 'dispensa-compra';
export const STORES = ['kv', 'markets', 'spaces', 'items', 'list', 'prices', 'pantry', 'recipes', 'plan', 'purchases'];
let _db;

export function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      for (const s of STORES)
        if (!r.result.objectStoreNames.contains(s))
          r.result.createObjectStore(s, { keyPath: s === 'kv' ? 'key' : 'id' });
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}

// Executa uma operação simples e resolve quando a transação confirma (commit).
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
export const all = s => tx(s, 'readonly', st => st.getAll());
export const put = (s, v) => tx(s, 'readwrite', st => st.put(v));
export const del = (s, id) => tx(s, 'readwrite', st => st.delete(id));

// Várias gravações em UMA transação: ou tudo grava, ou nada (evita estado pela metade).
// ops: [{store, put: obj} | {store, del: id}]
export async function batch(ops) {
  if (!ops.length) return;
  const db = await open();
  const stores = [...new Set(ops.map(o => o.store))];
  return new Promise((res, rej) => {
    const t = db.transaction(stores, 'readwrite');
    for (const o of ops) {
      const st = t.objectStore(o.store);
      if ('del' in o) st.delete(o.del); else st.put(o.put);
    }
    t.oncomplete = () => res();
    t.onerror = t.onabort = () => rej(t.error);
  });
}

// Backup: exporta tudo / restaura tudo (substitui os dados atuais, de forma atômica).
export async function dump() {
  const out = { app: 'dispensa-compra', v: 1, at: new Date().toISOString() };
  for (const s of STORES) out[s] = await all(s);
  return out;
}
export async function restore(obj) {
  if (!obj || obj.app !== 'dispensa-compra') throw new Error('Arquivo de backup inválido');
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORES, 'readwrite');
    for (const s of STORES) {
      const st = t.objectStore(s);
      st.clear();
      for (const row of obj[s] || []) st.put(row);
    }
    t.oncomplete = () => res();
    t.onerror = t.onabort = () => rej(t.error);
  });
}
