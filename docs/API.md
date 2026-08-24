# API Reference

Base URL: `https://<โดเมนของคุณ>`
รูปแบบข้อมูล: JSON ทั้งหมด ยกเว้นการอัปโหลดไฟล์ที่ใช้ `multipart/form-data`

## รูปแบบคำตอบมาตรฐาน

สำเร็จ
```json
{ "success": true, "jobId": "job_a1b2c3", "status": "PROCESSING", "progress": 45 }
```

ล้มเหลว
```json
{ "success": false, "errorCode": "PDF_INVALID", "message": "ไม่สามารถเปิดไฟล์ PDF ได้" }
```

`message` เป็นภาษาไทยที่แสดงให้ผู้ใช้เห็นได้ทันที
`errorCode` เป็นภาษาอังกฤษสำหรับให้โปรแกรมตรวจสอบ

## การยืนยันตัวตนและ CSRF

- Session ของผู้เยี่ยมชมอยู่ในคุกกี้ `dtpdf_sid` (สร้างอัตโนมัติ)
- ผู้ที่เข้าสู่ระบบได้คุกกี้ `dtpdf_session` เป็น JWT แบบ `HttpOnly`
- **ทุก request ที่เปลี่ยนสถานะ (POST/PUT/PATCH/DELETE) ต้องแนบ header**

  ```
  X-CSRF-Token: <ค่าจากคุกกี้ dtpdf_csrf>
  ```

  ยกเว้น `/api/auth/line/callback`

---

## Authentication

### `GET /api/auth/config`
ค่าตั้งสาธารณะสำหรับ frontend (ไม่มีความลับใด ๆ)

```json
{
  "success": true,
  "appName": "DT PDF Editor",
  "line": { "enabled": true, "liffId": "1234567890-abcdEFGH", "requireFriend": true, "addFriendUrl": "https://line.me/R/ti/p/@123abcd" },
  "limits": { "maxFileSizeMb": 100, "maxPdfPages": 500 },
  "csrfToken": "..."
}
```

### `GET /api/auth/me`
ข้อมูลผู้ใช้ปัจจุบัน `authenticated: false` ถ้ายังไม่ได้เข้าสู่ระบบ

### `GET /api/auth/line/start?next=/tool/merge`
พาไปหน้าเข้าสู่ระบบของ LINE (ตอบกลับเป็น 302)

### `GET /api/auth/line/callback`
LINE เรียกกลับมาที่นี่ ระบบตั้งคุกกี้แล้ว redirect ไปยัง `next`

### `POST /api/auth/line/liff`
เข้าสู่ระบบจากภายในแอป LINE

```json
{ "accessToken": "<liff.getAccessToken()>" }
```

### `POST /api/auth/line/refresh-friend`
ตรวจสถานะการเพิ่มเพื่อนอีกครั้ง (ใช้กับปุ่ม "เพิ่มเพื่อนแล้ว")

### `POST /api/auth/admin/login`
เข้าสู่ระบบผู้ดูแลแบบ local ใช้เมื่อยังไม่ได้ตั้งค่า LINE หรือใช้กู้ระบบ

```json
{ "username": "admin", "password": "..." }
```

### `POST /api/auth/logout`
### `PATCH /api/auth/preferences`
```json
{ "theme": "dark", "language": "th", "settings": { "favoriteTools": ["merge"] } }
```

---

## Telemetry และสถิติสาธารณะ

### `POST /api/heartbeat`
เรียกทุก ~25 วินาที เพื่อให้ระบบนับว่ากำลังใช้งานอยู่

```json
{ "page": "/tool/merge", "device": "mobile", "browser": "line" }
```
ตอบกลับ `{ "success": true, "online": 128, "nextHeartbeatIn": 25 }`

### `POST /api/visit`
บันทึกการเข้าชม 1 ครั้ง (ไม่เก็บ IP address)

### `POST /api/vitals`
ส่ง Core Web Vitals เมื่อผู้ใช้กำลังจะออกจากหน้า

```json
{ "metrics": [{ "name": "LCP", "value": 1820, "rating": "good", "page": "/" }] }
```

### `GET /api/stats/public`
ตัวเลขที่แสดงบนหน้าแรก — มาจากฐานข้อมูลจริงทั้งหมด

```json
{
  "success": true,
  "online": { "total": 128, "guest": 96, "user": 12, "line": 20 },
  "today":  { "visits": 4892, "visitors": 3421, "jobs": 8532, "files": 12045 },
  "total":  { "visits": 152340, "visitors": 41203, "users": 892, "lineUsers": 761 }
}
```

### `GET /api/stats/online`
เฉพาะจำนวนออนไลน์ สำหรับ polling ถี่ ๆ

---

## Jobs

### `POST /api/jobs/client/start`
แจ้งว่ากำลังจะประมวลผลบนเครื่องผู้ใช้ ใช้ตรวจโควตาและเริ่มนับสถิติ
**ไม่มีการอัปโหลดไฟล์**

```json
{ "tool": "merge", "fileCount": 3, "bytesIn": 5242880, "params": { "outputName": "รวมเอกสาร" } }
```

ตอบกลับ `{ "success": true, "jobId": "job_...", "maxFiles": 50 }`
หากเกินโควตาจะได้ `429` พร้อม `errorCode: "RATE_LIMITED"`

### `POST /api/jobs/client/complete`
แจ้งผลเมื่อประมวลผลเสร็จ

```json
{ "jobId": "job_...", "status": "SUCCESS", "bytesOut": 3145728, "processingMs": 812, "filename": "merged.pdf" }
```

### `POST /api/jobs/server`
ส่งงานที่เบราว์เซอร์ทำไม่ได้ (`multipart/form-data`)

| ฟิลด์ | ค่า |
|---|---|
| `tool` | `pdf-protect` \| `pdf-unlock` \| `pdf-to-word` \| `ocr` \| `pdf-compress-server` |
| `files` | ไฟล์ (สูงสุด 30) |
| อื่น ๆ | พารามิเตอร์ของเครื่องมือ เช่น `password`, `langs`, `level` |

ตอบกลับ `202 Accepted` พร้อม `jobId` และสถานะคิว

```bash
curl -X POST https://pdf.example.ac.th/api/jobs/server \
  -H "X-CSRF-Token: $CSRF" -b cookies.txt \
  -F "tool=pdf-protect" -F "password=ความลับ1234" \
  -F "allowPrint=true" -F "allowCopy=false" \
  -F "files=@เอกสาร.pdf"
```

### `GET /api/jobs/:id`
ติดตามสถานะ

```json
{
  "success": true, "jobId": "job_...", "status": "PROCESSING",
  "progress": 45, "stage": "กำลังอ่านหน้า 5/12",
  "files": [{ "fileId": "jf_...", "filename": "เอกสาร.docx", "size": 24576, "downloadUrl": "/api/files/jf_..." }]
}
```

สถานะที่เป็นไปได้: `WAITING` `PROCESSING` `SUCCESS` `FAILED` `CANCELLED` `EXPIRED`

### `DELETE /api/jobs/:id`
ยกเลิกงานและลบไฟล์ทันที

### `POST /api/jobs/:id/share`
สร้างลิงก์แชร์ชั่วคราว

```json
{ "fileId": "jf_..." }
```
ตอบกลับ `{ "url": "https://.../s/<token>", "expiresAt": 1730000000000, "maxDownloads": 3 }`

---

## Files

### `GET /api/files/:fileId`
ดาวน์โหลดไฟล์ผลลัพธ์ (เฉพาะเจ้าของงาน) — ตอบกลับพร้อม `Cache-Control: no-store`
เพิ่ม `?inline=true` เพื่อเปิดในเบราว์เซอร์แทนการดาวน์โหลด

### `DELETE /api/files/job/:jobId`
ลบไฟล์ของงานทันที frontend เรียกให้อัตโนมัติหลังดาวน์โหลดสำเร็จ

### `GET /s/:token`
ลิงก์แชร์สาธารณะ มีวันหมดอายุและจำกัดจำนวนครั้งดาวน์โหลด

---

## History

### `GET /api/history?limit=50&offset=0`
เก็บเฉพาะ metadata ไม่มีไฟล์

### `GET /api/history/recent-tools`
เครื่องมือที่ใช้ล่าสุด สำหรับส่วน "ใช้ล่าสุด" บนหน้าแรก

### `DELETE /api/history` · `DELETE /api/history/:id`
ล้างประวัติทั้งหมด หรือลบทีละรายการ

---

## Health และ Status

### `GET /api/health`
สำหรับ load balancer ตอบ `200` เมื่อปกติ `503` เมื่อผิดปกติ

### `GET /api/status`
ข้อมูลสำหรับหน้า `/status` — สถานะรายส่วนประกอบ คิวงาน และประกาศ

### `GET /api/capabilities`
บอกว่าเครื่องมือฝั่งเซิร์ฟเวอร์ตัวไหนพร้อมใช้งาน

```json
{ "capabilities": { "qpdf": true, "ghostscript": true, "ocr": true, "pdfToWord": true, "line": true } }
```

---

## Admin (ต้องมีสิทธิ์ผู้ดูแลระบบ)

| Endpoint | หน้าที่ |
|---|---|
| `GET /api/admin/overview` | ตัวเลขภาพรวมทั้งหมดของ dashboard |
| `GET /api/admin/series?days=14` | ข้อมูลกราฟรายวัน |
| `GET /api/admin/tools?days=30` | อันดับเครื่องมือยอดนิยม |
| `GET /api/admin/system` | CPU, หน่วยความจำ, ดิสก์, คิว, Core Web Vitals |
| `GET /api/admin/jobs?limit=50&status=FAILED` | รายการงานล่าสุด |
| `DELETE /api/admin/jobs/:id` | ยกเลิกงานและลบไฟล์ |
| `GET /api/admin/users?limit=50` | รายชื่อผู้ใช้ (แสดงค่าอ้างอิง ไม่ใช่ LINE userId ดิบ) |
| `GET /api/admin/settings` | ค่าตั้งระบบพร้อม metadata |
| `PUT /api/admin/settings` | บันทึกค่าตั้ง มีผลทันทีไม่ต้องรีสตาร์ท |
| `DELETE /api/admin/settings/:key` | คืนค่าเริ่มต้นจาก environment |
| `POST /api/admin/cleanup` | สั่งล้างไฟล์ชั่วคราวทันที |
| `GET /api/admin/cleanup-logs` | บันทึกการล้างไฟล์ |
| `GET /api/admin/audit?limit=100` | บันทึกการใช้งาน (ใครทำอะไร เมื่อไหร่) |

ตัวอย่างการแก้ค่าตั้ง

```bash
curl -X PUT https://pdf.example.ac.th/api/admin/settings \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" -b cookies.txt \
  -d '{"settings": {"MAX_FILE_SIZE_MB": 200, "RATE_LIMIT_GUEST": 40}}'
```

---

## รหัสข้อผิดพลาด

| errorCode | HTTP | ความหมาย |
|---|---|---|
| `VALIDATION_ERROR` | 400 | ข้อมูลที่ส่งมาไม่ถูกต้อง |
| `PDF_INVALID` | 400 | เปิดไฟล์ PDF ไม่ได้ |
| `PDF_ENCRYPTED` | 400 | ไฟล์มีรหัสผ่าน ต้องปลดล็อกก่อน |
| `WRONG_PASSWORD` | 400 | รหัสผ่านไม่ถูกต้อง |
| `AUTH_REQUIRED` | 401 | ต้องเข้าสู่ระบบก่อน |
| `FORBIDDEN` | 403 | ไม่มีสิทธิ์เข้าถึง |
| `LINE_FRIEND_REQUIRED` | 403 | ต้องเพิ่มเพื่อนบัญชีทางการก่อน |
| `CSRF_INVALID` | 403 | ไม่มีหรือไม่ตรงกับ CSRF token |
| `JOB_NOT_FOUND` | 404 | ไม่พบงาน หรืองานหมดอายุ |
| `FILE_EXPIRED` | 410 | ไฟล์ถูกลบตามนโยบายแล้ว |
| `SHARE_EXPIRED` | 410 | ลิงก์แชร์หมดอายุ |
| `FILE_TOO_LARGE` | 413 | ไฟล์ใหญ่เกินกำหนด |
| `UNSUPPORTED_FILE` | 415 | ชนิดไฟล์ไม่รองรับ (ตรวจจาก magic number) |
| `NO_TEXT_FOUND` | 422 | ไม่พบข้อความในไฟล์ |
| `RATE_LIMITED` | 429 | ใช้งานเกินโควตาของชั่วโมงนี้ |
| `MAINTENANCE` | 503 | ระบบปิดปรับปรุง |
| `QPDF_UNAVAILABLE` | 503 | เซิร์ฟเวอร์ไม่ได้ติดตั้ง qpdf |
| `GHOSTSCRIPT_UNAVAILABLE` | 503 | เซิร์ฟเวอร์ไม่ได้ติดตั้ง Ghostscript |
| `OCR_UNAVAILABLE` | 503 | เซิร์ฟเวอร์ไม่ได้ติดตั้งโมดูล OCR |
| `PROCESSING_TIMEOUT` | 504 | ประมวลผลนานเกินกำหนด |
