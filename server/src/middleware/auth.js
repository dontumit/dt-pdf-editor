/**
 * Session + Authentication
 * - ผู้เยี่ยมชมทุกคนได้ session id (guest) เพื่อให้นับสถิติและ rate limit ได้
 * - ผู้ที่ login ผ่าน LINE จะได้ JWT ใน httpOnly cookie
 */
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import db from '../db/index.js';
import config from '../config/index.js';
import { newId } from '../utils/id.js';
import { getUserById } from '../services/users.js';
import { classifyUserAgent } from '../services/analytics.js';
import { CSRF_COOKIE } from './security.js';
import { ApiError } from '../utils/http.js';

const GUEST_COOKIE = 'dtpdf_sid';
const COOKIE_MAX_AGE = 400 * 86400 * 1000; // ~13 เดือน (เพดานของเบราว์เซอร์)

function cookieOptions(maxAge = COOKIE_MAX_AGE) {
  return {
    httpOnly: true,
    secure: config.security.cookieSecure,
    sameSite: 'lax',
    maxAge,
    path: '/',
  };
}

export function signSessionToken(payload) {
  return jwt.sign(payload, config.security.jwtSecret, {
    expiresIn: config.security.jwtTtlSeconds,
    issuer: 'dt-pdf-editor',
  });
}

function verifySessionToken(token) {
  try {
    return jwt.verify(token, config.security.jwtSecret, { issuer: 'dt-pdf-editor' });
  } catch { return null; }
}

function ensureSessionRow(sessionId, req, userId, userType) {
  const now = Date.now();
  const { device, browser, os } = classifyUserAgent(req.get('user-agent'));
  const isLiff = /Line\//i.test(req.get('user-agent') || '') || req.get('X-DTPDF-Client') === 'liff';
  const existing = db.get('SELECT id FROM sessions WHERE id = ?', sessionId);
  if (existing) {
    db.run(
      'UPDATE sessions SET last_seen_at = ?, user_id = COALESCE(?, user_id), user_type = ? WHERE id = ?',
      now, userId || null, userType, sessionId,
    );
  } else {
    db.run(
      `INSERT INTO sessions (id, user_id, user_type, device, browser, os, is_liff, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sessionId, userId || null, userType, device, browser, os, isLiff ? 1 : 0, now, now,
    );
  }
}

/**
 * ติดตั้ง req.session / req.user ให้ทุก request
 * ไม่บังคับให้ login — ผู้ใช้ทั่วไป (guest) ใช้เครื่องมือพื้นฐานได้ (spec ข้อ 46)
 */
export function sessionContext(req, res, next) {
  // 1) CSRF token (double submit) — ต้องอ่านได้จาก JS จึงไม่ใช้ httpOnly
  if (!req.cookies?.[CSRF_COOKIE]) {
    const csrf = crypto.randomBytes(24).toString('base64url');
    res.cookie(CSRF_COOKIE, csrf, {
      httpOnly: false, secure: config.security.cookieSecure, sameSite: 'lax', maxAge: COOKIE_MAX_AGE, path: '/',
    });
    req.csrfToken = csrf;
  } else {
    req.csrfToken = req.cookies[CSRF_COOKIE];
  }

  // 2) session ของผู้เยี่ยมชม
  let sessionId = req.cookies?.[GUEST_COOKIE];
  if (!sessionId || !/^sess_[a-z0-9]{16,}$/.test(sessionId)) {
    sessionId = newId('sess');
    res.cookie(GUEST_COOKIE, sessionId, cookieOptions());
  }

  // 3) ผู้ใช้ที่ login แล้ว
  let user = null;
  const token = req.cookies?.[config.security.cookieName];
  if (token) {
    const claims = verifySessionToken(token);
    if (claims?.sub) {
      const found = getUserById(claims.sub);
      if (found) user = found;
    }
  }

  const userType = user ? (user.role === 'admin' ? 'admin' : (user.provider === 'line' ? 'line' : 'user')) : 'guest';
  ensureSessionRow(sessionId, req, user?.id, userType);

  req.session = { id: sessionId, userType };
  req.user = user;
  next();
}

export function setAuthCookie(res, user) {
  const token = signSessionToken({ sub: user.id, role: user.role, ref: user.public_ref });
  res.cookie(config.security.cookieName, token, cookieOptions(config.security.jwtTtlSeconds * 1000));
  return token;
}

export function clearAuthCookie(res) {
  res.clearCookie(config.security.cookieName, { path: '/' });
}

/** บังคับให้ต้อง login */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return next(new ApiError(401, 'AUTH_REQUIRED', 'กรุณาเข้าสู่ระบบก่อนใช้งานส่วนนี้'));
  }
  return next();
}

/** บังคับให้ต้องเป็นผู้ดูแลระบบ */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return next(new ApiError(403, 'FORBIDDEN', 'เฉพาะผู้ดูแลระบบเท่านั้น'));
  }
  return next();
}

/**
 * บังคับให้เพิ่มเพื่อน LINE OA ก่อนใช้งาน (เปิด/ปิดด้วย REQUIRE_LINE_FRIEND)
 * ใช้กับ endpoint ที่ต้องเป็นสมาชิกจริงเท่านั้น
 */
export function requireLineFriend(req, res, next) {
  if (!config.line.requireFriend) return next();
  if (!req.user) return next(new ApiError(401, 'AUTH_REQUIRED', 'กรุณาเข้าสู่ระบบด้วย LINE ก่อน'));
  if (req.user.provider === 'line' && !req.user.is_friend) {
    return next(new ApiError(403, 'LINE_FRIEND_REQUIRED', 'กรุณาเพิ่มเพื่อนบัญชีทางการของเราก่อนใช้งาน', {
      addFriendUrl: config.line.addFriendUrl,
    }));
  }
  return next();
}
