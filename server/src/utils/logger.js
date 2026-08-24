/**
 * Logger แบบ JSON line — log เฉพาะข้อมูลที่จำเป็น
 * ห้าม log: เนื้อหา PDF, รหัสผ่าน, ลายเซ็น, ข้อมูลส่วนบุคคล (spec ข้อ 85)
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

// คีย์ที่จะถูกปิดบังเสมอหากเผลอส่งเข้ามา
const REDACT = new Set([
  'password', 'ownerPassword', 'userPassword', 'secret', 'token', 'accessToken',
  'idToken', 'authorization', 'cookie', 'signature', 'signatureData',
  'channelSecret', 'jwt', 'email',
]);

function sanitize(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT.has(k) ? '[redacted]' : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

function emit(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, msg: message };
  if (meta && Object.keys(meta).length) line.meta = sanitize(meta);
  const text = JSON.stringify(line);
  if (level === 'error') process.stderr.write(text + '\n');
  else process.stdout.write(text + '\n');
}

export const logger = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
};

export default logger;
