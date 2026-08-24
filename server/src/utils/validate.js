import { ApiError } from './http.js';

/** ตรวจสอบ input ฝั่ง server เสมอ — ห้ามเชื่อค่าที่ส่งมาจาก client */
export function str(value, { name, max = 255, required = false, pattern = null, allow = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, 'VALIDATION_ERROR', `ต้องระบุ ${name}`);
    return '';
  }
  const text = String(value).trim();
  if (text.length > max) throw new ApiError(400, 'VALIDATION_ERROR', `${name} ยาวเกิน ${max} ตัวอักษร`);
  if (pattern && !pattern.test(text)) throw new ApiError(400, 'VALIDATION_ERROR', `รูปแบบของ ${name} ไม่ถูกต้อง`);
  if (allow && !allow.includes(text)) throw new ApiError(400, 'VALIDATION_ERROR', `ค่าของ ${name} ไม่อยู่ในรายการที่รองรับ`);
  return text;
}

export function int(value, { name, min = -Infinity, max = Infinity, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== null) return fallback;
    throw new ApiError(400, 'VALIDATION_ERROR', `ต้องระบุ ${name}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new ApiError(400, 'VALIDATION_ERROR', `${name} ต้องเป็นตัวเลข`);
  const truncated = Math.trunc(parsed);
  if (truncated < min || truncated > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${name} ต้องอยู่ระหว่าง ${min} ถึง ${max}`);
  }
  return truncated;
}

export const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'on';
};

// อักขระควบคุมและอักขระต้องห้ามในชื่อไฟล์ (Windows + POSIX)
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f<>:"|?*\\/]/g;

/** ทำชื่อไฟล์ให้ปลอดภัย ป้องกัน path traversal และชื่อไฟล์อันตราย */
export function safeFilename(name, fallback = 'file') {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const cleaned = base
    .replace(UNSAFE_FILENAME_CHARS, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}

/** ตัดค่าให้อยู่ในช่วงที่กำหนด */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
