# DT PDF Editor

เครื่องมือจัดการ PDF และเอกสารออนไลน์แบบครบวงจร ใช้งานง่าย รวดเร็ว รองรับมือถือ คอมพิวเตอร์ และ LINE

**หลักการสำคัญ:** *Process Locally Whenever Possible, Upload Only When Necessary*
เครื่องมือ 15 จาก 18 ตัวประมวลผลบนเบราว์เซอร์ของผู้ใช้ทั้งหมด เอกสารจึงไม่ออกจากเครื่อง
เหมาะกับเอกสารสำคัญ เช่น บัตรประชาชน เวชระเบียน เอกสารราชการ และเอกสารทางการเงิน

---

## เริ่มใช้งานใน 3 คำสั่ง

```bash
cp .env.example .env                       # แก้ค่าตามระบบของคุณ (อย่างน้อย JWT_SECRET)
cd server && npm install                   # ติดตั้ง dependency + เตรียมไลบรารีฝั่ง browser
npm start                                  # เปิดที่ http://localhost:8080
```

สร้าง `JWT_SECRET` ด้วย `openssl rand -hex 32`

### ด้วย Docker

```bash
cp .env.example .env
docker compose up -d                       # app + worker
docker compose --profile proxy up -d       # เพิ่ม nginx สำหรับ TLS
```

---

## เครื่องมือทั้งหมด

| เครื่องมือ | ประมวลผลที่ | ใช้ออฟไลน์ |
|---|---|---|
| สแกนเอกสาร (กล้อง + ดัดมุม + ปรับคมชัด) | เบราว์เซอร์ | ได้ |
| รวมไฟล์ PDF | เบราว์เซอร์ | ได้ |
| จัดหน้า PDF (เรียง / หมุน / ลบ / ทำสำเนา / แยกหน้า) | เบราว์เซอร์ | ได้ |
| แยกไฟล์ PDF (ทีละหน้า / ทุก N หน้า / ตามช่วง) | เบราว์เซอร์ | ได้ |
| **ลดขนาดเอกสาร** (อัตโนมัติ / คงข้อความ / กำหนดขนาดเป้าหมาย) | เบราว์เซอร์ | ได้ |
| PDF → JPG / PNG / WEBP | เบราว์เซอร์ | ได้ |
| JPG / PNG → PDF | เบราว์เซอร์ | ได้ |
| ลดขนาดไฟล์ภาพ | เบราว์เซอร์ | ได้ |
| ใส่เลขหน้า (รองรับเลขไทย ๑๒๓) | เบราว์เซอร์ | ได้ |
| ใส่ลายน้ำ (ข้อความไทย / รูปภาพ) | เบราว์เซอร์ | ได้ |
| ครอบตัดขอบ (มีตรวจหาขอบอัตโนมัติ) | เบราว์เซอร์ | ได้ |
| เซ็นเอกสาร (วาด / อัปโหลด / พิมพ์) | เบราว์เซอร์ | ได้ |
| เพิ่มข้อมูลใน PDF (ข้อความ / รูป / วันที่ / ช่องติ๊ก / ไฮไลต์) | เบราว์เซอร์ | ได้ |
| อ่านข้อความจากภาพ (OCR ไทย–อังกฤษ) | เบราว์เซอร์ | ครั้งแรกต้องต่อเน็ต |
| ใส่รหัสผ่าน PDF | เซิร์ฟเวอร์ (qpdf) | ไม่ได้ |
| ปลดล็อก PDF | เซิร์ฟเวอร์ (qpdf) | ไม่ได้ |
| PDF → Word (.docx) | เซิร์ฟเวอร์ | ไม่ได้ |
| บีบอัด PDF คุณภาพสูง | เซิร์ฟเวอร์ (Ghostscript) | ไม่ได้ |

การ์ดที่มี **จุดสีส้ม** บนหน้าแรก = ใช้ทรัพยากรเครื่องสูง หรือต้องเชื่อมต่ออินเทอร์เน็ต

---

## โครงสร้างโปรเจกต์

```
dt-pdf-editor/
├── server/                       Backend (Express + SQLite)
│   └── src/
│       ├── config/               อ่านค่าจาก environment ทั้งหมด
│       ├── db/                   schema + adapter (better-sqlite3 / node:sqlite)
│       ├── middleware/           security headers, CSRF, auth, rate limit
│       ├── routes/               auth, telemetry, jobs, files, history, admin, health
│       ├── services/             line, users, presence, analytics, jobs, share, settings, audit
│       ├── workers/              queue, cleanup + processors (pdf-to-word, ocr, password, compress)
│       └── utils/                logger, id, validate, file signature
├── web/                          Frontend (ไม่ต้อง build)
│   ├── index.html  admin.html
│   ├── service-worker.js
│   ├── assets/
│   │   ├── css/                  ระบบดีไซน์พาสเทล รองรับ light/dark
│   │   ├── fonts/                Sarabun (SIL OFL) สำหรับฝังลง PDF
│   │   └── vendor/               pdf-lib, pdf.js, fontkit, JSZip (self-host ทั้งหมด)
│   └── src/
│       ├── core/                 router, api, state, tools registry, IndexedDB
│       ├── pdf/                  เครื่องยนต์ PDF ทั้งหมด
│       ├── pages/                หน้าแต่ละหน้า (โหลดแบบ lazy)
│       ├── scan/                 ประมวลผลภาพสำหรับสแกนเอกสาร
│       ├── admin/                แผงผู้ดูแลระบบ + กราฟ SVG
│       └── line/                 LIFF integration
├── scripts/                      build-vendor, fetch-fonts, build-thai-font
├── deploy/nginx/                 reverse proxy config
└── docs/                         สถาปัตยกรรม / API / การติดตั้ง / ตั้งค่า LINE
```

---

## เอกสารเพิ่มเติม

| ไฟล์ | เนื้อหา |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | สถาปัตยกรรม วงจรชีวิตไฟล์ กลยุทธ์แคช การจัดการหน่วยความจำ |
| [docs/API.md](docs/API.md) | รายการ API ทั้งหมดพร้อมตัวอย่าง |
| [docs/DATABASE.md](docs/DATABASE.md) | โครงสร้างฐานข้อมูลและเหตุผลการออกแบบ |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | วิธีติดตั้งบน Docker / VPS / Cloud Run และการดูแลระบบ |
| [docs/LINE-SETUP.md](docs/LINE-SETUP.md) | ตั้งค่า LINE Login, LIFF, Official Account และ Rich Menu |
| [docs/TESTING.md](docs/TESTING.md) | ผลการทดสอบและวิธีทดสอบซ้ำ |

---

## ความปลอดภัยและความเป็นส่วนตัว

- ไฟล์ที่ประมวลผลบนเบราว์เซอร์ **ไม่ถูกอัปโหลดขึ้นเซิร์ฟเวอร์เลย**
- ไฟล์ที่ต้องใช้เซิร์ฟเวอร์เป็น temporary file เสมอ ลบอัตโนมัติภายใน 30 นาที (ปรับได้)
- ไฟล์ต้นฉบับที่อัปโหลดถูกลบทันทีที่ประมวลผลเสร็จ ไม่รอ TTL
- รหัสผ่านที่ผู้ใช้กรอกอยู่ในหน่วยความจำของ worker เท่านั้น ไม่เขียนลงฐานข้อมูลและไม่เขียนลง log
- ตรวจชนิดไฟล์จาก magic number ไม่เชื่อ MIME type จากเบราว์เซอร์
- มี CSP, CSRF (double-submit cookie), HSTS, rate limit และ processing timeout
- Analytics ไม่เก็บ IP address และไม่เก็บ user agent ดิบ — เก็บเฉพาะหมวดอุปกรณ์/เบราว์เซอร์
- LINE userId ถูกแปลงเป็นค่าอ้างอิงแบบ HMAC ก่อนแสดงผลหรือบันทึก log

---

## ข้อกำหนดระบบ

- Node.js 20.11 ขึ้นไป (แนะนำ 22 LTS)
- ทางเลือกเสริมฝั่งเซิร์ฟเวอร์: `qpdf`, `ghostscript`, `poppler-utils`
  (ไม่มีก็ใช้งานได้ ระบบจะปิดเฉพาะเครื่องมือที่เกี่ยวข้องและแสดงสถานะที่หน้า `/status`)
- เบราว์เซอร์: Chrome / Edge / Firefox / Safari รุ่นปัจจุบัน

---

## สัญญาอนุญาต

ซอร์สโค้ด: MIT
ไลบรารีและฟอนต์ที่รวมมา: ดู [web/assets/vendor/THIRD-PARTY.txt](web/assets/vendor/THIRD-PARTY.txt)
