# โครงสร้างฐานข้อมูล

ไฟล์ schema จริง: `server/src/db/schema.sql`

## หลักการออกแบบ

1. **เก็บเฉพาะ metadata** — ไม่มีตารางใดเก็บเนื้อหาเอกสารของผู้ใช้
2. **ทุกอย่างมีวันหมดอายุ** — ไฟล์ ลิงก์แชร์ session และข้อมูลดิบ ถูกลบตามกำหนด
3. **ย้ายฐานข้อมูลได้** — ใช้ชนิดข้อมูลพื้นฐาน ย้ายไป PostgreSQL/MySQL ได้โดยแก้เล็กน้อย
   (`INTEGER` epoch ms → `BIGINT`, `TEXT` → `VARCHAR`/`TEXT`)

## ตารางทั้งหมด

| ตาราง | เก็บอะไร | อายุข้อมูล |
|---|---|---|
| `users` | ผู้ใช้ LINE และผู้ดูแล (`provider_user_id` มีคู่ hash ใน `public_ref`) | ถาวรจนกว่าจะลบ |
| `sessions` | เซสชันของผู้เยี่ยมชม | 30 วันหลังไม่ใช้งาน (เฉพาะที่ไม่ผูกบัญชี) |
| `presence` | heartbeat ล่าสุดของแต่ละเซสชัน | ~5 นาที |
| `visits` | การเข้าชมรายครั้ง (ไม่มี IP) | ตาม `ANALYTICS_RETENTION_DAYS` |
| `daily_stats` | สรุปรายวัน | ถาวร (ขนาดเล็กมาก) |
| `jobs` | งานทั้งฝั่งเบราว์เซอร์และเซิร์ฟเวอร์ | ถาวร (metadata) |
| `job_files` | ไฟล์ชั่วคราวของงานฝั่งเซิร์ฟเวอร์ | ตาม `TEMP_FILE_TTL` |
| `history` | ประวัติการใช้งานของผู้ใช้ | จนกว่าผู้ใช้จะลบ |
| `tool_usage` | สถิติการใช้เครื่องมือรายวัน | ถาวร |
| `rate_limits` | ตัวนับโควตารายชั่วโมง | 3 ชั่วโมง |
| `share_links` | ลิงก์แชร์ชั่วคราว | ตาม `SHARE_LINK_TTL` |
| `system_settings` | ค่าตั้งที่ผู้ดูแลแก้ได้ | ถาวร |
| `audit_logs` | ใครทำอะไร เมื่อไหร่ | ถาวร |
| `cleanup_logs` | บันทึกการล้างไฟล์ | ถาวร |
| `web_vitals` | Core Web Vitals จากเบราว์เซอร์จริง | ตาม `ANALYTICS_RETENTION_DAYS` |

## สิ่งที่ระบบ **ไม่** เก็บ

- เนื้อหาไฟล์ PDF, DOCX หรือรูปภาพ
- รหัสผ่านที่ผู้ใช้ตั้งให้ไฟล์ PDF
- ข้อมูลลายเซ็น
- IP address ของผู้ใช้
- User agent แบบเต็ม (เก็บเฉพาะหมวด: mobile/desktop, chrome/safari, windows/android)
- LINE userId ในรูปแบบดิบเมื่อแสดงผลหรือบันทึก log

## คำสั่งที่ใช้บ่อย

```bash
# ดูตารางทั้งหมด
sqlite3 data/dtpdf.db ".tables"

# ขนาดของแต่ละตาราง
sqlite3 data/dtpdf.db "SELECT name, (SELECT COUNT(*) FROM pragma_table_info(name)) cols FROM sqlite_master WHERE type='table';"

# ผู้ใช้ออนไลน์ตอนนี้
sqlite3 data/dtpdf.db "SELECT COUNT(*) FROM presence WHERE last_seen >= (strftime('%s','now')*1000 - 75000);"

# เครื่องมือยอดนิยม 7 วัน
sqlite3 data/dtpdf.db "SELECT tool, SUM(count) c FROM tool_usage WHERE day >= date('now','-7 days') GROUP BY tool ORDER BY c DESC;"

# ไฟล์ชั่วคราวที่ยังไม่ถูกลบ
sqlite3 data/dtpdf.db "SELECT COUNT(*), SUM(size_bytes) FROM job_files WHERE deleted_at IS NULL;"

# บีบไฟล์ฐานข้อมูลหลังลบข้อมูลจำนวนมาก
sqlite3 data/dtpdf.db "VACUUM;"
```

## การย้ายไป PostgreSQL

แก้เฉพาะไฟล์ `server/src/db/index.js` (ประมาณ 40 บรรทัด) และปรับ schema

```sql
-- ตัวอย่างการแปลง
INTEGER (epoch ms)  →  BIGINT
TEXT PRIMARY KEY    →  VARCHAR(64) PRIMARY KEY
INTEGER (boolean)   →  BOOLEAN
AUTOINCREMENT       →  GENERATED ALWAYS AS IDENTITY
```

โค้ดส่วนอื่นทั้งหมดเรียกผ่าน `db.get/all/run/transaction` จึงไม่ต้องแก้
