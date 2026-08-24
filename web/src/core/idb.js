/**
 * IndexedDB สำหรับข้อมูลชั่วคราว (spec ข้อ 34, 106, 107)
 * เก็บ: ไฟล์ที่กำลังทำงาน, สถานะโปรเจกต์ของ editor, งานที่ค้าง
 * ทุกอย่างมี expiresAt และถูกล้างอัตโนมัติ — ไม่มีการอัปโหลดขึ้นเซิร์ฟเวอร์
 */
const DB_NAME = 'dtpdf';
const DB_VERSION = 1;
const STORES = { files: 'files', projects: 'projects', meta: 'meta' };

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.files)) {
        const store = db.createObjectStore(STORES.files, { keyPath: 'id' });
        store.createIndex('expiresAt', 'expiresAt');
      }
      if (!db.objectStoreNames.contains(STORES.projects)) {
        const store = db.createObjectStore(STORES.projects, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function withStore(storeName, mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try { result = callback(store); } catch (err) { reject(err); return; }
    tx.oncomplete = () => resolve(result?.result !== undefined ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const TTL = 30 * 60 * 1000; // 30 นาที ตรงกับ TEMP_FILE_TTL ฝั่งเซิร์ฟเวอร์

export const idb = {
  async putFile(id, blob, meta = {}) {
    return withStore(STORES.files, 'readwrite', (store) =>
      store.put({ id, blob, meta, createdAt: Date.now(), expiresAt: Date.now() + TTL }));
  },
  async getFile(id) {
    const record = await withStore(STORES.files, 'readonly', (store) => store.get(id));
    if (!record) return null;
    if (record.expiresAt < Date.now()) { await idb.deleteFile(id); return null; }
    return record;
  },
  async deleteFile(id) {
    return withStore(STORES.files, 'readwrite', (store) => store.delete(id));
  },

  async saveProject(id, data) {
    return withStore(STORES.projects, 'readwrite', (store) =>
      store.put({ id, data, updatedAt: Date.now(), expiresAt: Date.now() + TTL * 4 }));
  },
  async getProject(id) {
    return withStore(STORES.projects, 'readonly', (store) => store.get(id));
  },
  async listProjects() {
    const all = await withStore(STORES.projects, 'readonly', (store) => store.getAll());
    return (all || []).filter((item) => item.expiresAt > Date.now())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async deleteProject(id) {
    return withStore(STORES.projects, 'readwrite', (store) => store.delete(id));
  },

  async setMeta(key, value) {
    return withStore(STORES.meta, 'readwrite', (store) => store.put({ key, value }));
  },
  async getMeta(key) {
    const record = await withStore(STORES.meta, 'readonly', (store) => store.get(key));
    return record?.value;
  },

  /** ล้างข้อมูลชั่วคราวที่หมดอายุ (spec ข้อ 72) */
  async cleanup() {
    let removed = 0;
    for (const storeName of [STORES.files, STORES.projects]) {
      const items = await withStore(storeName, 'readonly', (store) => store.getAll());
      const expired = (items || []).filter((item) => (item.expiresAt || 0) < Date.now());
      if (!expired.length) continue;
      await withStore(storeName, 'readwrite', (store) => {
        expired.forEach((item) => store.delete(item.id));
      });
      removed += expired.length;
    }
    return removed;
  },

  /** ล้างทั้งหมด — ใช้ตอน logout หรือผู้ใช้กดล้างข้อมูล */
  async clearAll() {
    for (const storeName of Object.values(STORES)) {
      await withStore(storeName, 'readwrite', (store) => store.clear());
    }
  },
};

export default idb;
