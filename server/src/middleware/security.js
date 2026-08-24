/**
 * Security headers (spec ข้อ 55, 94)
 * ไม่ใช้ helmet เพื่อลด dependency และให้ควบคุม CSP ได้ตรงกับที่ frontend ต้องการ
 */
import config from '../config/index.js';

/**
 * โฮสต์ภายนอกที่จำเป็นจริง ๆ เท่านั้น
 * ไลบรารี PDF ทั้งหมด self-host อยู่ใน /assets/vendor แล้ว
 * เหลือเพียง Tesseract.js (ใช้ตอน OCR บนเครื่อง) และ LINE SDK/รูปโปรไฟล์
 */
const OCR_CDN = 'https://cdn.jsdelivr.net';
const LINE_HOSTS = 'https://static.line-scdn.net https://profile.line-scdn.net https://api.line.me';

export function securityHeaders(req, res, next) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${OCR_CDN} ${LINE_HOSTS} blob:`,
    `worker-src 'self' blob:`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${LINE_HOSTS}`,
    `connect-src 'self' ${OCR_CDN} ${LINE_HOSTS} blob: data:`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://liff.line.me",
    'upgrade-insecure-requests',
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (config.isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

/** CORS แบบ allowlist — ค่าเริ่มต้นคือ same-origin เท่านั้น */
export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && config.security.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Session-Id');
    res.setHeader('Access-Control-Max-Age', '600');
    return res.status(204).end();
  }
  return next();
}

/**
 * CSRF: double-submit cookie
 * ทุก request ที่เปลี่ยนสถานะต้องแนบ header X-CSRF-Token ให้ตรงกับ cookie
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_COOKIE = 'dtpdf_csrf';

export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  // เส้นทางที่ไม่ผูกกับ cookie session (เช่น callback ของ LINE) ยกเว้นได้
  if (req.path.startsWith('/api/auth/line/callback') || req.path.startsWith('/api/line/webhook')) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get('X-CSRF-Token');
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      success: false,
      errorCode: 'CSRF_INVALID',
      message: 'คำขอไม่ผ่านการตรวจสอบความปลอดภัย กรุณารีเฟรชหน้าเว็บแล้วลองใหม่',
    });
  }
  return next();
}
