/**
 * ลิงก์แชร์ชั่วคราว (spec ข้อ 82)
 * token สุ่มเดาไม่ได้ + มีวันหมดอายุ + จำกัดจำนวนครั้งดาวน์โหลด
 */
import db from '../db/index.js';
import config from '../config/index.js';
import { secureToken } from '../utils/id.js';
import { getSetting } from './settings.js';

export function createShareLink({ jobFileId, createdBy, maxDownloads = 3 }) {
  const token = secureToken(24);
  const now = Date.now();
  const ttl = getSetting('SHARE_LINK_TTL') * 1000;
  db.run(
    `INSERT INTO share_links (token, job_file_id, created_by, max_downloads, downloads, created_at, expires_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    token, jobFileId, createdBy || null, maxDownloads, now, now + ttl,
  );
  return {
    token,
    url: `${config.publicBaseUrl}/s/${token}`,
    expiresAt: now + ttl,
    maxDownloads,
  };
}

export function consumeShareLink(token) {
  const link = db.get('SELECT * FROM share_links WHERE token = ?', token);
  if (!link) return { error: 'SHARE_NOT_FOUND' };
  if (link.revoked_at) return { error: 'SHARE_REVOKED' };
  if (link.expires_at < Date.now()) return { error: 'SHARE_EXPIRED' };
  if (link.downloads >= link.max_downloads) return { error: 'SHARE_LIMIT_REACHED' };

  const file = db.get('SELECT * FROM job_files WHERE id = ? AND deleted_at IS NULL', link.job_file_id);
  if (!file) return { error: 'FILE_EXPIRED' };

  db.run('UPDATE share_links SET downloads = downloads + 1 WHERE token = ?', token);
  return { file, link };
}

export function pruneShareLinks() {
  return db.run('DELETE FROM share_links WHERE expires_at < ?', Date.now()).changes;
}
