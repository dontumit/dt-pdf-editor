import crypto from 'node:crypto';
import config from '../config/index.js';

const ALPHABET = 'abcdefghijkmnopqrstuvwxyz0123456789';

/** id สั้นแบบสุ่มปลอดภัย ใช้กับ job/session/file */
export function shortId(length = 16) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export const newId = (prefix, length = 16) => prefix + '_' + shortId(length);

/** token สำหรับลิงก์แชร์ — เดาไม่ได้ */
export const secureToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/**
 * แปลง LINE userId เป็น reference แบบ hash
 * ใช้แสดงผล/บันทึก log แทนการเปิดเผย userId จริง (PDPA)
 */
export function publicRef(providerUserId) {
  return crypto
    .createHmac('sha256', config.security.jwtSecret)
    .update(String(providerUserId))
    .digest('hex')
    .slice(0, 20);
}

/** เปรียบเทียบ string แบบคงเวลา ป้องกัน timing attack */
export function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
