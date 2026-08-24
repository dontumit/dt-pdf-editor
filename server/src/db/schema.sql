-- ============================================================
-- DT PDF Editor — Database Schema (SQLite)
-- หลักการ: เก็บเฉพาะ metadata ห้ามเก็บเนื้อหาเอกสารของผู้ใช้
-- ชนิดข้อมูลเลือกให้ย้ายไป PostgreSQL/MySQL ได้โดยแก้เพียงเล็กน้อย
-- (INTEGER epoch ms -> BIGINT, TEXT -> VARCHAR/TEXT)
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- ผู้ใช้ ----------
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,              -- uid_xxxxx (ภายในระบบ)
  provider          TEXT NOT NULL,                 -- 'line' | 'local'
  provider_user_id  TEXT NOT NULL,                 -- LINE userId (เก็บเพื่อ map บัญชี)
  public_ref        TEXT NOT NULL UNIQUE,          -- hash ที่ปลอดภัยสำหรับแสดงผล/ log
  display_name      TEXT,
  picture_url       TEXT,
  email             TEXT,
  role              TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'admin'
  is_friend         INTEGER NOT NULL DEFAULT 0,    -- เพิ่มเพื่อน LINE OA แล้วหรือยัง
  language          TEXT NOT NULL DEFAULT 'th',
  theme             TEXT NOT NULL DEFAULT 'system',
  settings_json     TEXT NOT NULL DEFAULT '{}',
  created_at        INTEGER NOT NULL,
  last_login_at     INTEGER,
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at);

-- ---------- Session (ใช้คู่กับ JWT เพื่อให้ revoke ได้) ----------
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,                  -- sess_xxxxx
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  user_type     TEXT NOT NULL DEFAULT 'guest',     -- 'guest' | 'user' | 'line' | 'admin'
  device        TEXT,
  browser       TEXT,
  os            TEXT,
  is_liff       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  revoked_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------- Presence: heartbeat ล่าสุดของแต่ละ session ----------
CREATE TABLE IF NOT EXISTS presence (
  session_id  TEXT PRIMARY KEY,
  user_id     TEXT,
  user_type   TEXT NOT NULL DEFAULT 'guest',
  page        TEXT,
  device      TEXT,
  browser     TEXT,
  last_seen   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON presence(last_seen);

-- ---------- Visitor analytics (ไม่เก็บ IP ดิบ / ไม่เก็บข้อมูลส่วนบุคคล) ----------
CREATE TABLE IF NOT EXISTS visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day         TEXT NOT NULL,                       -- YYYY-MM-DD (เวลาไทย)
  ts          INTEGER NOT NULL,
  session_id  TEXT NOT NULL,
  user_type   TEXT NOT NULL,                       -- guest | user | line
  page        TEXT,
  referrer    TEXT,
  device      TEXT,
  browser     TEXT,
  os          TEXT,
  is_liff     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_visits_day ON visits(day);
CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits(ts);
CREATE INDEX IF NOT EXISTS idx_visits_session_day ON visits(session_id, day);

-- ---------- สรุปรายวัน (rollup ให้ dashboard เร็ว และลบ raw ได้ตาม PDPA) ----------
CREATE TABLE IF NOT EXISTS daily_stats (
  day             TEXT PRIMARY KEY,
  visits          INTEGER NOT NULL DEFAULT 0,
  unique_sessions INTEGER NOT NULL DEFAULT 0,
  guest_sessions  INTEGER NOT NULL DEFAULT 0,
  user_sessions   INTEGER NOT NULL DEFAULT 0,
  line_sessions   INTEGER NOT NULL DEFAULT 0,
  new_users       INTEGER NOT NULL DEFAULT 0,
  jobs_total      INTEGER NOT NULL DEFAULT 0,
  jobs_success    INTEGER NOT NULL DEFAULT 0,
  jobs_failed     INTEGER NOT NULL DEFAULT 0,
  files_processed INTEGER NOT NULL DEFAULT 0,
  bytes_in        INTEGER NOT NULL DEFAULT 0,
  bytes_out       INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);

-- ---------- Jobs: ทั้งงานที่รันบน browser และงานที่รันบน server ----------
CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,                -- job_xxxxx
  tool            TEXT NOT NULL,                   -- merge | split | compress | pdf-to-word | ocr | ...
  mode            TEXT NOT NULL DEFAULT 'client',  -- 'client' (ประมวลผลบนเครื่องผู้ใช้) | 'server'
  status          TEXT NOT NULL DEFAULT 'WAITING', -- WAITING|PROCESSING|SUCCESS|FAILED|EXPIRED|CANCELLED
  progress        INTEGER NOT NULL DEFAULT 0,
  stage           TEXT,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id      TEXT,
  user_type       TEXT NOT NULL DEFAULT 'guest',
  params_json     TEXT NOT NULL DEFAULT '{}',      -- ตัวเลือกของเครื่องมือ (ไม่มีเนื้อหาไฟล์/รหัสผ่าน)
  file_count      INTEGER NOT NULL DEFAULT 0,
  bytes_in        INTEGER NOT NULL DEFAULT 0,
  bytes_out       INTEGER NOT NULL DEFAULT 0,
  error_code      TEXT,
  error_message   TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER,
  processing_ms   INTEGER,
  expires_at      INTEGER                          -- หลังเวลานี้ไฟล์ผลลัพธ์จะถูกลบ
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_expires ON jobs(expires_at);

-- ---------- ไฟล์ชั่วคราวที่ผูกกับ job (input/output) ----------
CREATE TABLE IF NOT EXISTS job_files (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                      -- 'input' | 'output'
  filename     TEXT NOT NULL,
  mime         TEXT,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_job_files_job ON job_files(job_id);
CREATE INDEX IF NOT EXISTS idx_job_files_expires ON job_files(expires_at, deleted_at);

-- ---------- ประวัติการใช้งาน (metadata เท่านั้น) ----------
CREATE TABLE IF NOT EXISTS history (
  id             TEXT PRIMARY KEY,
  user_id        TEXT REFERENCES users(id) ON DELETE CASCADE,
  session_id     TEXT,
  tool           TEXT NOT NULL,
  mode           TEXT NOT NULL DEFAULT 'client',
  filename       TEXT,
  file_count     INTEGER NOT NULL DEFAULT 1,
  size_in        INTEGER NOT NULL DEFAULT 0,
  size_out       INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL,
  processing_ms  INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_history_session ON history(session_id, created_at);

-- ---------- สถิติการใช้เครื่องมือ ----------
CREATE TABLE IF NOT EXISTS tool_usage (
  day        TEXT NOT NULL,
  tool       TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'client',
  count      INTEGER NOT NULL DEFAULT 0,
  success    INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  total_ms   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, tool, mode)
);

-- ---------- Rate limit (นับแบบ fixed window ต่อชั่วโมง) ----------
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key  TEXT NOT NULL,                       -- <subjectType>:<subjectId>:<scope>
  window_start INTEGER NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_window ON rate_limits(window_start);

-- ---------- ลิงก์แชร์ชั่วคราว (one-time / มีวันหมดอายุ) ----------
CREATE TABLE IF NOT EXISTS share_links (
  token       TEXT PRIMARY KEY,
  job_file_id TEXT NOT NULL REFERENCES job_files(id) ON DELETE CASCADE,
  created_by  TEXT,
  max_downloads INTEGER NOT NULL DEFAULT 1,
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_share_expires ON share_links(expires_at);

-- ---------- ค่าตั้งระบบที่ผู้ดูแลแก้ได้โดยไม่ต้องแก้โค้ด ----------
CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  value_type  TEXT NOT NULL DEFAULT 'string',      -- string | number | boolean | json
  label       TEXT,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT
);

-- ---------- Audit log (ใครทำอะไร เมื่อไหร่ — ไม่เก็บเนื้อหาเอกสาร) ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  actor_id    TEXT,
  actor_ref   TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  result      TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);

-- ---------- บันทึกการล้างไฟล์ ----------
CREATE TABLE IF NOT EXISTS cleanup_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  scope         TEXT NOT NULL,                     -- temp_files | sessions | analytics | share_links
  removed_count INTEGER NOT NULL DEFAULT 0,
  freed_bytes   INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_cleanup_ts ON cleanup_logs(ts);

-- ---------- ตัวชี้วัดประสิทธิภาพจาก client (Core Web Vitals) ----------
CREATE TABLE IF NOT EXISTS web_vitals (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,
  day      TEXT NOT NULL,
  metric   TEXT NOT NULL,                          -- LCP | INP | CLS | FCP | TTFB
  value    REAL NOT NULL,
  rating   TEXT,
  page     TEXT,
  device   TEXT
);
CREATE INDEX IF NOT EXISTS idx_vitals_day ON web_vitals(day, metric);

-- ---------- ตารางเวอร์ชัน schema ----------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
