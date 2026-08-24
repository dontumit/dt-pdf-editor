/** ตัวช่วยเรื่องเวลา — วันตามเขตเวลาไทย เพื่อให้สถิติรายวันตรงกับผู้ใช้ */
const TZ = process.env.STATS_TIMEZONE || 'Asia/Bangkok';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

export const dayKey = (ts = Date.now()) => dayFormatter.format(new Date(ts));

export function lastNDays(n, endTs = Date.now()) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(dayKey(endTs - i * 86400000));
  return out;
}

export const seconds = (n) => n * 1000;
export const minutes = (n) => n * 60000;
export const hours = (n) => n * 3600000;
export const days = (n) => n * 86400000;
