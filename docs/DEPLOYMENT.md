# คู่มือติดตั้งและดูแลระบบ

## เลือกวิธีติดตั้ง

| สถานการณ์ | วิธีที่แนะนำ |
|---|---|
| ทดลองใช้ / เครื่องเดียว / ผู้ใช้ไม่เกิน ~100 | ติดตั้งตรงบน VPS ด้วย systemd |
| ต้องการแยกส่วนชัดเจน อัปเดตง่าย | Docker Compose |
| มีคนใช้เยอะ ต้องขยายได้ | Docker + nginx + แยก worker |

---

## เตรียมก่อนติดตั้ง

```bash
# 1) สร้างไฟล์ตั้งค่า
cp .env.example .env

# 2) สร้างกุญแจลับ (สำคัญมาก)
openssl rand -hex 32
# นำค่าที่ได้ไปใส่ JWT_SECRET ใน .env

# 3) กำหนดค่าอย่างน้อยเหล่านี้
#    PUBLIC_BASE_URL   = URL จริงที่ผู้ใช้เข้า (ต้องเป็น https ใน production)
#    JWT_SECRET        = ค่าจากข้อ 2
#    ADMIN_LOCAL_PASSWORD = รหัสผ่านผู้ดูแลชั่วคราวสำหรับเข้าครั้งแรก
```

> **ห้าม** ปล่อย `JWT_SECRET` เป็นค่าตัวอย่าง — เซิร์ฟเวอร์จะปฏิเสธการเริ่มทำงานใน production

---

## วิธีที่ 1: Docker Compose

```bash
cp .env.example .env && nano .env
docker compose up -d

docker compose ps
docker compose logs -f app
```

เปิด `http://localhost:8080` (หรือผ่าน nginx ถ้าเปิด profile)

### เพิ่ม nginx สำหรับ HTTPS

```bash
mkdir -p deploy/nginx/certs
# วางไฟล์ fullchain.pem และ privkey.pem ไว้ในโฟลเดอร์นี้
nano deploy/nginx/dt-pdf-editor.conf   # แก้ server_name เป็นโดเมนของคุณ
docker compose --profile proxy up -d
```

ออกใบรับรองด้วย Let's Encrypt

```bash
docker run --rm -p 80:80 \
  -v "$PWD/deploy/nginx/certs:/etc/letsencrypt/live/temp" \
  certbot/certbot certonly --standalone -d pdf.example.ac.th
```

### อัปเดตเวอร์ชัน

```bash
git pull
# เปลี่ยน CACHE_VERSION ใน .env เพื่อบังคับให้เบราว์เซอร์โหลด asset ใหม่
docker compose build && docker compose up -d
```

---

## วิธีที่ 2: ติดตั้งตรงบน Ubuntu/Debian

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# เครื่องมือฝั่งเซิร์ฟเวอร์ (ไม่บังคับ แต่แนะนำให้ครบ)
sudo apt-get install -y qpdf ghostscript poppler-utils fonts-thai-tlwg

# ติดตั้งแอป
sudo mkdir -p /opt/dt-pdf-editor && sudo chown $USER /opt/dt-pdf-editor
git clone <repo> /opt/dt-pdf-editor
cd /opt/dt-pdf-editor
cp .env.example .env && nano .env
cd server && npm ci --omit=dev
```

### สร้าง service ด้วย systemd

```ini
# /etc/systemd/system/dt-pdf-editor.service
[Unit]
Description=DT PDF Editor
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/dt-pdf-editor
ExecStart=/usr/bin/node server/src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# ความปลอดภัยระดับ service
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/dt-pdf-editor/data /opt/dt-pdf-editor/storage

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /opt/dt-pdf-editor/data /opt/dt-pdf-editor/storage
sudo systemctl daemon-reload
sudo systemctl enable --now dt-pdf-editor
sudo systemctl status dt-pdf-editor
```

### แยก worker เป็น service ต่างหาก (ทางเลือก)

ตั้ง `RUN_INLINE_WORKER=false` ใน `.env` แล้วสร้าง service เพิ่ม

```ini
# /etc/systemd/system/dt-pdf-worker.service
[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/dt-pdf-editor
ExecStart=/usr/bin/node server/src/workers/standalone.js
Restart=always
```

---

## วิธีที่ 3: Cloud Run / Container platform

```bash
gcloud builds submit --tag gcr.io/PROJECT/dt-pdf-editor
gcloud run deploy dt-pdf-editor \
  --image gcr.io/PROJECT/dt-pdf-editor \
  --region asia-southeast1 \
  --memory 1Gi --cpu 1 --timeout 300 \
  --set-env-vars "NODE_ENV=production,PUBLIC_BASE_URL=https://..." \
  --set-secrets "JWT_SECRET=jwt-secret:latest,LINE_CHANNEL_SECRET=line-secret:latest"
```

> **ข้อควรระวัง:** ระบบไฟล์ของ Cloud Run เป็นแบบชั่วคราวและไม่แชร์ระหว่าง instance
> หากใช้เครื่องมือฝั่งเซิร์ฟเวอร์ ต้องตั้ง `--max-instances=1` หรือย้ายฐานข้อมูลไป Cloud SQL
> และย้ายไฟล์ชั่วคราวไป Cloud Storage ก่อน
> ถ้าใช้เฉพาะเครื่องมือที่ทำงานบนเบราว์เซอร์ จะขยายกี่ instance ก็ได้

---

## หลังติดตั้งเสร็จ

### 1. ตรวจสุขภาพระบบ

```bash
curl https://pdf.example.ac.th/api/health
curl https://pdf.example.ac.th/api/capabilities
```

เปิด `/status` ในเบราว์เซอร์ — ทุกส่วนควรขึ้น "ทำงานปกติ"
ส่วนที่ขึ้น "ไม่ได้เปิดใช้งาน" คือเครื่องมือที่ยังไม่ได้ติดตั้ง binary หรือยังไม่ได้ตั้งค่า LINE

### 2. เข้าแผงผู้ดูแลระบบ

เปิด `/admin` → เข้าสู่ระบบด้วย `ADMIN_LOCAL_USERNAME` / `ADMIN_LOCAL_PASSWORD`

ปรับค่าที่ควรตั้งแต่แรก
- `MAX_FILE_SIZE_MB` — ต้องไม่เกิน `client_max_body_size` ของ nginx
- `RATE_LIMIT_GUEST` / `RATE_LIMIT_USER` — ตามปริมาณผู้ใช้จริง
- `TEMP_FILE_TTL` — ยิ่งสั้นยิ่งปลอดภัย ค่าเริ่มต้น 30 นาทีเหมาะกับงานทั่วไป
- `ANNOUNCEMENT` — ข้อความประกาศบนหน้าแรก

### 3. เปลี่ยนไปใช้ผู้ดูแลผ่าน LINE

หลังตั้งค่า LINE เสร็จ (ดู [LINE-SETUP.md](LINE-SETUP.md))
ให้ใส่ LINE userId ของคุณใน `ADMIN_LINE_USER_IDS`
แล้ว **ลบ `ADMIN_LOCAL_PASSWORD` ออกจาก `.env`** เพื่อปิดช่องทางเข้าแบบรหัสผ่าน

---

## การสำรองข้อมูล

สิ่งที่ต้องสำรองมีเพียงฐานข้อมูล — ไฟล์ใน `storage/` เป็นของชั่วคราวทั้งหมด

```bash
#!/bin/bash
# /opt/dt-pdf-editor/backup.sh
BACKUP_DIR=/var/backups/dt-pdf-editor
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)

# ใช้ .backup ของ sqlite3 เพื่อสำรองแบบปลอดภัยขณะระบบทำงานอยู่
sqlite3 /opt/dt-pdf-editor/data/dtpdf.db ".backup '$BACKUP_DIR/dtpdf-$STAMP.db'"
gzip "$BACKUP_DIR/dtpdf-$STAMP.db"

# เก็บย้อนหลัง 30 วัน
find "$BACKUP_DIR" -name "dtpdf-*.db.gz" -mtime +30 -delete
```

```bash
sudo crontab -e
# สำรองทุกวันตี 2
0 2 * * * /opt/dt-pdf-editor/backup.sh
```

สำหรับ Docker

```bash
docker compose exec app sqlite3 /data/db/dtpdf.db ".backup '/data/db/backup.db'"
docker compose cp app:/data/db/backup.db ./backup-$(date +%F).db
```

---

## การดูแลประจำ

| ความถี่ | สิ่งที่ควรทำ |
|---|---|
| ทุกวัน | ดู `/admin` แท็บภาพรวม — อัตราความสำเร็จควรสูงกว่า 95% |
| ทุกสัปดาห์ | ดูแท็บสุขภาพระบบ — พื้นที่ดิสก์ หน่วยความจำ อัตราข้อผิดพลาด |
| ทุกเดือน | `npm audit` และอัปเดต dependency |
| เมื่อ deploy | เปลี่ยน `CACHE_VERSION` ทุกครั้ง |

### ระบบล้างไฟล์ให้เองอยู่แล้ว

Cleanup worker ทำงานทุก `CLEANUP_INTERVAL` วินาที (ค่าเริ่มต้น 300)
- ลบไฟล์ที่เกิน TTL
- ลบโฟลเดอร์อัปโหลดที่ค้าง
- ลบ session และ presence ที่หมดอายุ
- ลบ rate limit และลิงก์แชร์ที่หมดอายุ
- ลบข้อมูล analytics ดิบที่เกิน `ANALYTICS_RETENTION_DAYS`

สั่งล้างทันทีได้จาก `/admin` → ภาพรวม → **ล้างไฟล์ชั่วคราวทันที**

---

## แก้ปัญหา

| อาการ | ตรวจอะไร |
|---|---|
| เซิร์ฟเวอร์ไม่ยอมเริ่ม | `JWT_SECRET` สั้นกว่า 32 ตัวอักษร หรือยังเป็นค่าตัวอย่าง |
| `better-sqlite3` ติดตั้งไม่ผ่าน | ต้องมี `python3 make g++` — ระบบจะ fallback ไป `node:sqlite` ให้อัตโนมัติ |
| อัปโหลดไฟล์ใหญ่แล้ว 413 | `client_max_body_size` ที่ nginx ต้องมากกว่า `MAX_FILE_SIZE_MB` |
| ภาษาไทยใน PDF เป็นเครื่องหมายคำถาม | ไฟล์ฟอนต์หายไป — รัน `node scripts/fetch-fonts.mjs` |
| งานฝั่งเซิร์ฟเวอร์ค้างที่ WAITING | worker ไม่ทำงาน — ตรวจ `docker compose logs worker` หรือ `RUN_INLINE_WORKER` |
| ผู้ใช้เห็นเวอร์ชันเก่า | ยังไม่ได้เปลี่ยน `CACHE_VERSION` |
| เข้าสู่ระบบ LINE ไม่ได้ | Callback URL ไม่ตรง — ดู [LINE-SETUP.md](LINE-SETUP.md) |
| ตัวเลขผู้ใช้ออนไลน์เป็น 0 ตลอด | เบราว์เซอร์ส่ง heartbeat ไม่ได้ — ตรวจ CSRF และ reverse proxy |

### ดู log

```bash
# systemd
journalctl -u dt-pdf-editor -f

# docker
docker compose logs -f app worker

# เฉพาะ error
journalctl -u dt-pdf-editor | grep '"level":"error"'
```

Log เป็น JSON บรรทัดละรายการ พร้อมสำหรับส่งเข้าระบบรวม log ได้ทันที
ระบบปิดบังคีย์อ่อนไหว (รหัสผ่าน โทเคน ลายเซ็น อีเมล) โดยอัตโนมัติ

---

## ปรับแต่งประสิทธิภาพ

| สถานการณ์ | สิ่งที่ควรปรับ |
|---|---|
| ผู้ใช้บ่นว่าช้าตอนเปิดครั้งแรก | เปิด gzip/brotli ที่ nginx และตั้งแคช `/assets/vendor/` ให้ยาว |
| งานฝั่งเซิร์ฟเวอร์คิวยาว | เพิ่ม `MAX_CONCURRENT_JOBS` (ระวังหน่วยความจำ) หรือเพิ่ม worker container |
| ดิสก์เต็มบ่อย | ลด `TEMP_FILE_TTL` และ `CLEANUP_INTERVAL` |
| ฐานข้อมูลโตเร็ว | ลด `ANALYTICS_RETENTION_DAYS` — สรุปรายวันยังคงอยู่ครบ |
| ผู้ใช้ยิงถล่ม | ลด `RATE_LIMIT_GUEST` และปรับ `limit_req` ที่ nginx |
