import db from '../db/index.js';
import config from '../config/index.js';
import { newId, publicRef } from '../utils/id.js';

/** ตัดสินว่าเป็นผู้ดูแลระบบหรือไม่ จาก allowlist ใน environment */
export function resolveRole({ provider, providerUserId, email }) {
  if (provider === 'local') return 'admin';
  if (providerUserId && config.admin.lineUserIds.includes(providerUserId)) return 'admin';
  if (email && config.admin.emails.includes(String(email).toLowerCase())) return 'admin';
  return 'user';
}

/** สร้างหรืออัปเดตผู้ใช้จากข้อมูลผู้ให้บริการ (LINE) */
export function upsertUser({ provider, providerUserId, displayName, pictureUrl, email, isFriend }) {
  const now = Date.now();
  const existing = db.get('SELECT * FROM users WHERE provider = ? AND provider_user_id = ?', provider, providerUserId);
  const role = resolveRole({ provider, providerUserId, email });

  if (existing) {
    db.run(
      `UPDATE users SET display_name = ?, picture_url = ?, email = COALESCE(?, email),
       role = ?, is_friend = ?, last_login_at = ? WHERE id = ?`,
      displayName ?? existing.display_name,
      pictureUrl ?? existing.picture_url,
      email ?? null,
      role,
      isFriend === undefined ? existing.is_friend : (isFriend ? 1 : 0),
      now,
      existing.id,
    );
    return db.get('SELECT * FROM users WHERE id = ?', existing.id);
  }

  const id = newId('uid');
  db.run(
    `INSERT INTO users (id, provider, provider_user_id, public_ref, display_name, picture_url, email, role, is_friend, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, provider, providerUserId, publicRef(providerUserId),
    displayName ?? null, pictureUrl ?? null, email ?? null, role,
    isFriend ? 1 : 0, now, now,
  );
  return db.get('SELECT * FROM users WHERE id = ?', id);
}

export const getUserById = (id) => db.get('SELECT * FROM users WHERE id = ?', id);

export function setFriendStatus(userId, isFriend) {
  db.run('UPDATE users SET is_friend = ? WHERE id = ?', isFriend ? 1 : 0, userId);
}

export function updatePreferences(userId, { language, theme, settings }) {
  const user = getUserById(userId);
  if (!user) return null;
  const merged = { ...JSON.parse(user.settings_json || '{}'), ...(settings || {}) };
  db.run(
    'UPDATE users SET language = ?, theme = ?, settings_json = ? WHERE id = ?',
    language || user.language, theme || user.theme, JSON.stringify(merged), userId,
  );
  return getUserById(userId);
}

/** ข้อมูลผู้ใช้ที่ปลอดภัยพอจะส่งให้ frontend — ไม่ส่ง LINE userId ดิบ (spec ข้อ 11) */
export function toPublicUser(user) {
  if (!user) return null;
  return {
    ref: user.public_ref,
    displayName: user.display_name,
    pictureUrl: user.picture_url,
    role: user.role,
    provider: user.provider,
    isFriend: Boolean(user.is_friend),
    language: user.language,
    theme: user.theme,
    settings: JSON.parse(user.settings_json || '{}'),
    createdAt: user.created_at,
  };
}
