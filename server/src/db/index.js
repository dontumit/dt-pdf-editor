/**
 * DB adapter.
 * ใช้ better-sqlite3 ถ้าติดตั้งสำเร็จ (เร็วและเสถียรที่สุด)
 * ถ้าไม่มีจะ fallback ไปใช้ node:sqlite ที่ติดมากับ Node 22+
 * ทั้งสองตัวเป็น synchronous API เหมือนกัน จึงใช้ interface เดียวกันได้
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let raw = null;
let driver = 'unknown';

async function openDatabase() {
  try {
    const mod = await import('better-sqlite3');
    const Database = mod.default;
    driver = 'better-sqlite3';
    return new Database(config.db.file);
  } catch {
    const { DatabaseSync } = await import('node:sqlite');
    driver = 'node:sqlite';
    return new DatabaseSync(config.db.file);
  }
}

/** ครอบ statement ให้ทั้งสอง driver เรียกเหมือนกัน */
function wrapStatement(stmt) {
  return {
    get: (...args) => stmt.get(...args) ?? undefined,
    all: (...args) => stmt.all(...args) ?? [],
    run: (...args) => {
      const res = stmt.run(...args);
      return {
        changes: Number(res?.changes ?? 0),
        lastInsertRowid: Number(res?.lastInsertRowid ?? 0),
      };
    },
  };
}

const statementCache = new Map();

export const db = {
  get driver() { return driver; },
  /** เตรียม statement พร้อม cache — ลด overhead ของการ parse SQL ซ้ำ */
  prepare(sql) {
    let cached = statementCache.get(sql);
    if (!cached) {
      cached = wrapStatement(raw.prepare(sql));
      statementCache.set(sql, cached);
    }
    return cached;
  },
  get: (sql, ...args) => db.prepare(sql).get(...args),
  all: (sql, ...args) => db.prepare(sql).all(...args),
  run: (sql, ...args) => db.prepare(sql).run(...args),
  exec: (sql) => raw.exec(sql),
  /** ธุรกรรมแบบง่าย — rollback อัตโนมัติเมื่อเกิด error */
  transaction(fn) {
    return (...args) => {
      raw.exec('BEGIN');
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        try { raw.exec('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      }
    };
  },
  close() {
    statementCache.clear();
    try { raw?.close(); } catch { /* ignore */ }
    raw = null;
  },
};

export async function initDatabase() {
  if (raw) return db;
  fs.mkdirSync(path.dirname(config.db.file), { recursive: true });
  raw = await openDatabase();
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec('PRAGMA busy_timeout = 5000;');
  raw.exec('PRAGMA synchronous = NORMAL;');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  raw.exec(schema);
  db.run('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 1, Date.now());
  logger.info('database ready', { driver, file: config.db.file });
  return db;
}

export default db;
