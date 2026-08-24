/** ฟังก์ชันจัดรูปแบบข้อความ — ใช้ทั้งหน้าเว็บและหน้า admin */

export function formatBytes(bytes, decimals = 1) {
  const value = Number(bytes) || 0;
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** index;
  return `${size.toFixed(index === 0 ? 0 : decimals)} ${units[index]}`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat('th-TH').format(Number(value) || 0);
}

export function formatDuration(ms) {
  const value = Number(ms) || 0;
  if (value < 1000) return `${Math.round(value)} มิลลิวินาที`;
  if (value < 60000) return `${(value / 1000).toFixed(1)} วินาที`;
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return `${minutes} นาที ${seconds} วินาที`;
}

/** วันที่แบบไทย พ.ศ. */
export function formatDate(ts, { withTime = true } = {}) {
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

export function formatRelative(ts) {
  const diff = Date.now() - Number(ts);
  if (diff < 60000) return 'เมื่อสักครู่';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} นาทีที่แล้ว`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} ชั่วโมงที่แล้ว`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} วันที่แล้ว`;
  return formatDate(ts, { withTime: false });
}

export function formatPercent(ratio, decimals = 1) {
  return `${((Number(ratio) || 0) * 100).toFixed(decimals)}%`;
}

/** ป้องกัน XSS เมื่อแทรกข้อความของผู้ใช้ลง innerHTML */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ตั้งชื่อไฟล์ผลลัพธ์ตามมาตรฐานของระบบ (spec ข้อ 68) */
export function outputName(originalName, suffix, extension) {
  const base = String(originalName || 'document').replace(/\.[^.]+$/, '').slice(0, 80) || 'document';
  return `${base}${suffix ? `_${suffix}` : ''}.${extension}`;
}
