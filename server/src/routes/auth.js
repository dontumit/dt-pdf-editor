/**
 * Authentication routes — LINE Login (OAuth code flow) และ LIFF (access token)
 */
import express from 'express';
import crypto from 'node:crypto';
import config from '../config/index.js';
import { ok, fail, asyncRoute, ApiError } from '../utils/http.js';
import { str } from '../utils/validate.js';
import * as line from '../services/line.js';
import { upsertUser, toPublicUser, updatePreferences, setFriendStatus } from '../services/users.js';
import { setAuthCookie, clearAuthCookie, requireAuth } from '../middleware/auth.js';
import { burstLimit } from '../middleware/rateLimit.js';
import { audit } from '../services/audit.js';
import { timingSafeEqual } from '../utils/id.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// เก็บ state ของ OAuth ไว้ชั่วคราวในหน่วยความจำ (หมดอายุใน 10 นาที)
const pendingStates = new Map();
setInterval(() => {
  const cutoff = Date.now() - 600000;
  for (const [key, value] of pendingStates) if (value.createdAt < cutoff) pendingStates.delete(key);
}, 60000).unref();

/** ข้อมูลสาธารณะสำหรับ frontend — ไม่มี secret */
router.get('/config', (req, res) => ok(res, {
  appName: config.appName,
  orgName: config.orgName,
  cacheVersion: config.cacheVersion,
  line: {
    enabled: config.line.enabled,
    liffId: config.line.liffId,
    requireFriend: config.line.requireFriend,
    addFriendUrl: config.line.addFriendUrl,
  },
  heartbeatInterval: config.presence.heartbeatInterval,
  limits: {
    maxFileSizeMb: config.limits.maxFileSizeMb,
    maxPdfPages: config.limits.maxPdfPages,
  },
  csrfToken: req.csrfToken,
}));

/** ผู้ใช้ปัจจุบัน */
router.get('/me', (req, res) => ok(res, {
  authenticated: Boolean(req.user),
  user: toPublicUser(req.user),
  sessionId: req.session.id,
  userType: req.session.userType,
  csrfToken: req.csrfToken,
  requiresFriend: Boolean(config.line.requireFriend && req.user?.provider === 'line' && !req.user.is_friend),
  addFriendUrl: config.line.addFriendUrl,
}));

/** เริ่มขั้นตอน LINE Login (เปิดบนเบราว์เซอร์ทั่วไป) */
router.get('/line/start', (req, res) => {
  if (!config.line.enabled) {
    return fail(res, 503, 'LINE_NOT_CONFIGURED', 'ระบบยังไม่ได้ตั้งค่า LINE Login');
  }
  const state = crypto.randomBytes(16).toString('base64url');
  const nonce = crypto.randomBytes(16).toString('base64url');
  const next = str(req.query.next, { name: 'next', max: 200 }) || '/';
  pendingStates.set(state, { nonce, next: next.startsWith('/') ? next : '/', createdAt: Date.now() });
  return res.redirect(line.buildAuthorizeUrl({ state, nonce }));
});

/** LINE เรียกกลับมาที่นี่พร้อม authorization code */
router.get('/line/callback', asyncRoute(async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    logger.warn('line login cancelled', { error, errorDescription });
    return res.redirect('/?login=cancelled');
  }
  const pending = pendingStates.get(String(state || ''));
  if (!pending) return res.redirect('/?login=expired');
  pendingStates.delete(String(state));

  const tokenSet = await line.exchangeCode(String(code));
  const claims = await line.verifyIdToken(tokenSet.id_token, pending.nonce);
  const profile = await line.getProfile(tokenSet.access_token);
  const isFriend = await line.getFriendshipStatus(tokenSet.access_token);

  const user = upsertUser({
    provider: 'line',
    providerUserId: claims.sub,
    displayName: profile.displayName || claims.name,
    pictureUrl: profile.pictureUrl || claims.picture,
    email: claims.email || null,
    isFriend: isFriend === null ? true : isFriend, // ตรวจไม่ได้ = ไม่บล็อกผู้ใช้
  });

  setAuthCookie(res, user);
  audit({ actorId: user.id, actorRef: user.public_ref, action: 'auth.login', target: 'line', result: 'success' });

  const needsFriend = config.line.requireFriend && isFriend === false;
  return res.redirect(needsFriend ? '/?gate=addfriend' : pending.next);
}));

/**
 * เข้าสู่ระบบจากภายใน LINE (LIFF)
 * frontend เรียก liff.getAccessToken() แล้วส่งมาให้ server ตรวจสอบ
 */
router.post('/line/liff', burstLimit({ windowMs: 60000, max: 20 }), asyncRoute(async (req, res) => {
  if (!config.line.enabled) throw new ApiError(503, 'LINE_NOT_CONFIGURED', 'ระบบยังไม่ได้ตั้งค่า LINE Login');
  const accessToken = str(req.body?.accessToken, { name: 'accessToken', max: 2000, required: true });

  await line.verifyAccessToken(accessToken);
  const profile = await line.getProfile(accessToken);
  const isFriend = await line.getFriendshipStatus(accessToken);

  const user = upsertUser({
    provider: 'line',
    providerUserId: profile.userId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl,
    isFriend: isFriend === null ? true : isFriend,
  });

  setAuthCookie(res, user);
  audit({ actorId: user.id, actorRef: user.public_ref, action: 'auth.login', target: 'liff', result: 'success' });

  return ok(res, {
    user: toPublicUser(user),
    requiresFriend: Boolean(config.line.requireFriend && isFriend === false),
    addFriendUrl: config.line.addFriendUrl,
  });
}));

/** ตรวจสถานะเพิ่มเพื่อนอีกครั้ง (ใช้ปุ่ม "ฉันเพิ่มเพื่อนแล้ว") */
router.post('/line/refresh-friend', requireAuth, asyncRoute(async (req, res) => {
  const accessToken = str(req.body?.accessToken, { name: 'accessToken', max: 2000 });
  if (!accessToken) {
    // ไม่มี token (เปิดบนเบราว์เซอร์) — ให้ login ใหม่เพื่อดึงสถานะล่าสุด
    return ok(res, { isFriend: Boolean(req.user.is_friend), needsRelogin: true });
  }
  await line.verifyAccessToken(accessToken);
  const isFriend = await line.getFriendshipStatus(accessToken);
  if (isFriend !== null) setFriendStatus(req.user.id, isFriend);
  return ok(res, { isFriend: isFriend === null ? true : isFriend, needsRelogin: false });
}));

/** เข้าสู่ระบบผู้ดูแลแบบ local (ใช้เมื่อยังไม่ได้ตั้งค่า LINE หรือใช้กู้ระบบ) */
router.post('/admin/login', burstLimit({ windowMs: 300000, max: 10 }), asyncRoute(async (req, res) => {
  if (!config.admin.localPassword) {
    throw new ApiError(403, 'ADMIN_LOCAL_DISABLED', 'ปิดการเข้าสู่ระบบผู้ดูแลแบบ local อยู่');
  }
  const username = str(req.body?.username, { name: 'ชื่อผู้ใช้', max: 64, required: true });
  const password = String(req.body?.password || '');
  const okUser = timingSafeEqual(username, config.admin.localUsername);
  const okPass = password.length === config.admin.localPassword.length
    && timingSafeEqual(password, config.admin.localPassword);

  if (!okUser || !okPass) {
    audit({ actorRef: 'local', action: 'auth.admin_login', target: username, result: 'failed' });
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  const user = upsertUser({
    provider: 'local', providerUserId: config.admin.localUsername,
    displayName: 'ผู้ดูแลระบบ', isFriend: true,
  });
  setAuthCookie(res, user);
  audit({ actorId: user.id, actorRef: user.public_ref, action: 'auth.admin_login', result: 'success' });
  return ok(res, { user: toPublicUser(user) });
}));

router.post('/logout', (req, res) => {
  if (req.user) audit({ actorId: req.user.id, actorRef: req.user.public_ref, action: 'auth.logout', result: 'success' });
  clearAuthCookie(res);
  return ok(res, { loggedOut: true });
});

/** บันทึกการตั้งค่าส่วนตัว (ธีม/ภาษา/เครื่องมือโปรด) */
router.patch('/preferences', requireAuth, asyncRoute(async (req, res) => {
  const language = str(req.body?.language, { name: 'ภาษา', allow: ['th', 'en'], max: 5 });
  const theme = str(req.body?.theme, { name: 'ธีม', allow: ['light', 'dark', 'system'], max: 10 });
  const settings = typeof req.body?.settings === 'object' ? req.body.settings : {};
  const updated = updatePreferences(req.user.id, { language, theme, settings });
  return ok(res, { user: toPublicUser(updated) });
}));

export default router;
