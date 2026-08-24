/**
 * LINE Login / LIFF / Messaging integration (spec ข้อ 10, 11, 80)
 * Channel secret อยู่ฝั่ง server เท่านั้น — frontend เห็นแค่ LIFF ID และ Channel ID
 */
import crypto from 'node:crypto';
import config from '../config/index.js';
import { ApiError } from '../utils/http.js';
import { logger } from '../utils/logger.js';

const LINE_API = 'https://api.line.me';
const LINE_AUTH = 'https://access.line.me/oauth2/v2.1/authorize';

async function lineFetch(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) {
      logger.warn('line api error', { url, status: res.status, code: json?.error });
      throw new ApiError(502, 'LINE_API_ERROR', 'ติดต่อระบบ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', { status: res.status });
    }
    return json;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.name === 'AbortError') throw new ApiError(504, 'LINE_TIMEOUT', 'ระบบ LINE ตอบกลับช้าเกินไป กรุณาลองใหม่');
    throw new ApiError(502, 'LINE_API_ERROR', 'ติดต่อระบบ LINE ไม่สำเร็จ');
  }
}

export const redirectUri = () => `${config.publicBaseUrl}${config.line.callbackPath}`;

/** สร้าง URL สำหรับพาไปหน้า login ของ LINE พร้อม state ป้องกัน CSRF */
export function buildAuthorizeUrl({ state, nonce, redirectAfter }) {
  if (!config.line.enabled) throw new ApiError(503, 'LINE_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า LINE Login ในระบบ');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.line.channelId,
    redirect_uri: redirectUri(),
    state,
    scope: 'profile openid',
    nonce,
    bot_prompt: 'aggressive', // ชวนเพิ่มเพื่อน OA ตั้งแต่ตอน login
  });
  if (redirectAfter) params.set('prompt', 'consent');
  return `${LINE_AUTH}?${params.toString()}`;
}

/** แลก authorization code เป็น access token */
export async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: config.line.channelId,
    client_secret: config.line.channelSecret,
  });
  return lineFetch(`${LINE_API}/oauth2/v2.1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

/** ตรวจสอบ id_token ที่ได้จาก LINE (ใช้ endpoint ของ LINE เพื่อความถูกต้องของลายเซ็น) */
export async function verifyIdToken(idToken, nonce) {
  const body = new URLSearchParams({ id_token: idToken, client_id: config.line.channelId });
  if (nonce) body.set('nonce', nonce);
  return lineFetch(`${LINE_API}/oauth2/v2.1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

/** ตรวจสอบ access token ที่ LIFF ส่งมา ว่าออกให้ channel ของเราจริง */
export async function verifyAccessToken(accessToken) {
  const info = await lineFetch(`${LINE_API}/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`);
  if (info.client_id !== config.line.channelId) {
    throw new ApiError(401, 'LINE_TOKEN_MISMATCH', 'โทเคนไม่ตรงกับระบบนี้');
  }
  if (Number(info.expires_in) <= 0) {
    throw new ApiError(401, 'LINE_TOKEN_EXPIRED', 'โทเคนหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  return info;
}

export async function getProfile(accessToken) {
  return lineFetch(`${LINE_API}/v2/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
}

/**
 * ตรวจว่าผู้ใช้เพิ่มเพื่อน Official Account แล้วหรือยัง (spec: ต้องเพิ่มเพื่อนก่อนใช้งาน)
 * ต้องเป็น token ที่ออกจาก LINE Login channel ที่ผูกกับ Messaging API channel เดียวกัน
 */
export async function getFriendshipStatus(accessToken) {
  try {
    const res = await lineFetch(`${LINE_API}/friendship/v1/status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return Boolean(res.friendFlag);
  } catch (err) {
    // ถ้า channel ยังไม่ได้ link กับ Messaging API จะเรียกไม่ได้ — ไม่ควรบล็อกผู้ใช้
    logger.warn('friendship check unavailable', { message: err.message });
    return null;
  }
}

export async function revokeToken(accessToken) {
  if (!accessToken || !config.line.enabled) return;
  try {
    await lineFetch(`${LINE_API}/oauth2/v2.1/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: accessToken,
        client_id: config.line.channelId,
        client_secret: config.line.channelSecret,
      }),
    });
  } catch { /* ไม่ critical */ }
}

/** ตรวจลายเซ็น webhook ของ Messaging API */
export function verifyWebhookSignature(rawBody, signature) {
  if (!config.line.messagingSecret) return false;
  const expected = crypto
    .createHmac('sha256', config.line.messagingSecret)
    .update(rawBody)
    .digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Rich Menu ตาม spec ข้อ 12 — ใช้กับสคริปต์ตั้งค่า LINE OA */
export const RICH_MENU_TEMPLATE = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: 'DT PDF Editor Menu',
  chatBarText: 'เปิดเครื่องมือ PDF',
  areas: [
    { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: 'uri', label: 'PDF Tools', uri: 'LIFF_URL/tools/pdf' } },
    { bounds: { x: 833, y: 0, width: 834, height: 843 }, action: { type: 'uri', label: 'Image Tools', uri: 'LIFF_URL/tools/image' } },
    { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: { type: 'uri', label: 'Sign PDF', uri: 'LIFF_URL/tool/sign' } },
    { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: 'uri', label: 'My Files', uri: 'LIFF_URL/files' } },
    { bounds: { x: 833, y: 843, width: 834, height: 843 }, action: { type: 'uri', label: 'History', uri: 'LIFF_URL/history' } },
    { bounds: { x: 1667, y: 843, width: 833, height: 843 }, action: { type: 'uri', label: 'Help', uri: 'LIFF_URL/help' } },
  ],
};
