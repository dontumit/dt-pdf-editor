# ตั้งค่า LINE สำหรับ DT PDF Editor

คู่มือนี้พาตั้งค่าตั้งแต่ศูนย์จนผู้ใช้เปิดระบบจากแชท LINE แล้วเข้าสู่ระบบได้อัตโนมัติ

> ## ⚠️ อ่านก่อน: การเก็บรักษาความลับ
>
> **Channel Secret และ Channel Access Token คือรหัสผ่านของบัญชี LINE ของคุณ**
> ใครที่ได้ค่าเหล่านี้ไปสามารถส่งข้อความในนามบัญชีทางการของคุณ และปลอมเป็นระบบของคุณได้
>
> - ห้ามส่งภาพหน้าจอที่มีค่าเหล่านี้ให้ใคร รวมถึงในแชท อีเมล หรือกลุ่มงาน
> - ห้าม commit เข้า git — ค่าทั้งหมดอยู่ในไฟล์ `.env` ซึ่งถูก `.gitignore` ไว้แล้ว
> - ห้ามใส่ใน `.env.example` (ไฟล์นั้นเป็นตัวอย่างที่ commit เข้า git)
> - ห้ามใส่ในโค้ดฝั่ง frontend — ระบบนี้ส่งให้ browser เห็นเพียง `LIFF ID` เท่านั้น
> - **หากเผลอเปิดเผยไปแล้ว ให้ออกค่าใหม่ทันที** ที่ LINE Developers Console
>   (Basic settings → Channel secret → **Issue**, และ Messaging API → Channel access token → **Reissue**)
>   ค่าเดิมจะใช้งานไม่ได้ทันทีที่ออกค่าใหม่

---

## ภาพรวม: ต้องมี 2 Channel

ระบบนี้ใช้ทั้งสองอย่างร่วมกัน และทั้งคู่ต้องอยู่ใน **Provider เดียวกัน**

| Channel | ชนิด | ใช้ทำอะไร | ค่าที่นำมาใส่ `.env` |
|---|---|---|---|
| ① เข้าสู่ระบบ | **LINE Login** | ยืนยันตัวตนผู้ใช้ + เปิดผ่าน LIFF | `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `LINE_LIFF_ID` |
| ② บัญชีทางการ | **Messaging API** | Rich Menu, เพิ่มเพื่อน, ตรวจสถานะเพื่อน | `LINE_MESSAGING_CHANNEL_SECRET`, `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`, `LINE_OA_BASIC_ID` |

**ทั้งสอง Channel ต้องถูก Link เข้าหากัน** มิฉะนั้นระบบจะตรวจไม่ได้ว่าผู้ใช้เพิ่มเพื่อนแล้วหรือยัง

---

## ขั้นที่ 1 — สร้าง Provider

1. เข้า https://developers.line.biz/console/
2. กด **Create a new provider** → ตั้งชื่อเป็นชื่อหน่วยงาน เช่น `Don Tum Hospital`
3. Provider นี้จะเป็นบ้านของทั้งสอง Channel

---

## ขั้นที่ 2 — สร้าง Channel ชนิด Messaging API (บัญชีทางการ)

1. ใน Provider กด **Create a new channel** → เลือก **Messaging API**
2. กรอกชื่อบัญชี รูปโปรไฟล์ หมวดหมู่ และข้อมูลผู้ติดต่อ
3. เมื่อสร้างเสร็จ ให้จดค่าต่อไปนี้
   - แท็บ **Basic settings** → `Channel secret` → ใส่ใน `LINE_MESSAGING_CHANNEL_SECRET`
   - แท็บ **Messaging API** → `Channel access token (long-lived)` กด **Issue** → ใส่ใน `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`
   - แท็บ **Messaging API** → `Bot basic ID` (ขึ้นต้นด้วย `@`) → ใส่ใน `LINE_OA_BASIC_ID`
4. ที่แท็บ **Messaging API** ให้ตั้งค่า
   - **Auto-reply messages** → ปิด (Disabled)
   - **Greeting messages** → เปิด แล้วเขียนข้อความต้อนรับพร้อมลิงก์ LIFF
   - **Webhook** → เปิดเฉพาะเมื่อคุณจะใช้ webhook (ระบบนี้ไม่บังคับ)

---

## ขั้นที่ 3 — สร้าง Channel ชนิด LINE Login

1. ใน Provider **เดิม** กด **Create a new channel** → เลือก **LINE Login**
2. เลือก App type เป็น **Web app**
3. แท็บ **Basic settings**
   - `Channel ID` → ใส่ใน `LINE_CHANNEL_ID`
   - `Channel secret` → ใส่ใน `LINE_CHANNEL_SECRET`
4. แท็บ **LINE Login** → **Callback URL** ใส่ให้ตรงกับโดเมนจริงของคุณ

   ```
   https://pdf.example.ac.th/api/auth/line/callback
   ```

   ถ้าทดสอบบนเครื่องตัวเองให้เพิ่มอีกบรรทัด

   ```
   http://localhost:8080/api/auth/line/callback
   ```

   > URL ต้องตรงกับ `PUBLIC_BASE_URL` + `LINE_CALLBACK_PATH` ใน `.env` **ทุกตัวอักษร**
   > รวมถึงมี/ไม่มี `www` และ `https` — ต่างกันแม้ตัวเดียว LINE จะปฏิเสธการเข้าสู่ระบบ

---

## ขั้นที่ 4 — Link สอง Channel เข้าด้วยกัน

ขั้นนี้จำเป็นสำหรับการตรวจสถานะ "เพิ่มเพื่อนแล้วหรือยัง"

1. เปิด Channel ชนิด **LINE Login** → แท็บ **Basic settings**
2. เลื่อนลงไปที่หัวข้อ **Linked LINE Official Account**
3. กด **Edit** แล้วเลือกบัญชีทางการที่สร้างไว้ในขั้นที่ 2
4. บันทึก

หากไม่ทำขั้นนี้ ระบบจะเรียก `/friendship/v1/status` ไม่ได้
โค้ดจัดการไว้แล้วโดย **ไม่บล็อกผู้ใช้** (ถือว่าผ่าน) เพื่อไม่ให้ระบบใช้งานไม่ได้ทั้งหมด
แต่ฟีเจอร์บังคับเพิ่มเพื่อนจะไม่ทำงาน

---

## ขั้นที่ 5 — สร้าง LIFF App

1. เปิด Channel ชนิด **LINE Login** → แท็บ **LIFF** → **Add**
2. ตั้งค่า

   | ช่อง | ค่า |
   |---|---|
   | LIFF app name | `DT PDF Editor` |
   | Size | **Full** |
   | Endpoint URL | `https://pdf.example.ac.th/` |
   | Scopes | `profile`, `openid` |
   | Bot link feature | **On (Aggressive)** — ชวนเพิ่มเพื่อนตั้งแต่ตอน login |
   | Scan QR | เปิด (ถ้าต้องการให้สแกน QR ได้) |

3. คัดลอก **LIFF ID** (รูปแบบ `1234567890-abcdEFGH`) → ใส่ใน `LINE_LIFF_ID`
4. LIFF URL ที่ได้จะเป็น `https://liff.line.me/<LIFF_ID>` — ใช้ลิงก์นี้ใน Rich Menu

---

## ขั้นที่ 6 — ใส่ค่าลงไฟล์ `.env`

```env
PUBLIC_BASE_URL=https://pdf.example.ac.th

# ① LINE Login channel
LINE_CHANNEL_ID=2011xxxxxx
LINE_CHANNEL_SECRET=<Channel secret ของ LINE Login>
LINE_LIFF_ID=2011xxxxxx-abcdEFGH
LINE_CALLBACK_PATH=/api/auth/line/callback

# ② Messaging API channel (บัญชีทางการ)
LINE_MESSAGING_CHANNEL_SECRET=<Channel secret ของ Messaging API>
LINE_MESSAGING_CHANNEL_ACCESS_TOKEN=<Channel access token>
LINE_OA_BASIC_ID=@123abcd

# บังคับให้เพิ่มเพื่อนก่อนใช้เครื่องมือที่ต้องใช้เซิร์ฟเวอร์
REQUIRE_LINE_FRIEND=true

# ผู้ดูแลระบบ: ใส่ LINE userId ของคุณ (ดูวิธีหาด้านล่าง)
ADMIN_LINE_USER_IDS=U1234567890abcdef1234567890abcdef
```

รีสตาร์ทเซิร์ฟเวอร์แล้วเปิด `/status` — บรรทัด "การเชื่อมต่อ LINE" ต้องขึ้น **ทำงานปกติ**

### วิธีหา LINE userId ของตัวเองเพื่อตั้งเป็นผู้ดูแล

1. ตั้ง `ADMIN_LOCAL_PASSWORD` ใน `.env` แล้วเข้า `/admin` ด้วยบัญชี local ก่อน
2. เข้าสู่ระบบด้วย LINE หนึ่งครั้งจากหน้าเว็บหลัก
3. ที่ `/admin` → แท็บ **ผู้ใช้งาน** จะเห็นบัญชีของคุณ
4. หรือดูจากฐานข้อมูลโดยตรง

   ```bash
   sqlite3 data/dtpdf.db "SELECT provider_user_id, display_name FROM users WHERE provider='line';"
   ```

5. นำค่ามาใส่ `ADMIN_LINE_USER_IDS` แล้วรีสตาร์ท

---

## ขั้นที่ 7 — สร้าง Rich Menu

Rich Menu คือเมนูด้านล่างของแชท ผู้ใช้กดแล้วเปิดระบบได้ทันที

### วิธีง่าย: ผ่าน LINE Official Account Manager

1. เข้า https://manager.line.biz/ → เลือกบัญชีของคุณ
2. เมนู **Chat settings** → **Rich menus** → **Create**
3. เลือกเทมเพลตแบบ 6 ช่อง (2 แถว × 3 คอลัมน์) ขนาด 2500 × 1686
4. อัปโหลดรูปพื้นหลัง แล้วตั้ง Action ของแต่ละช่องเป็น **Link**

   | ช่อง | ข้อความ | ลิงก์ |
   |---|---|---|
   | 1 | 📄 เครื่องมือ PDF | `https://liff.line.me/<LIFF_ID>/tools/pdf` |
   | 2 | 🖼 เครื่องมือรูปภาพ | `https://liff.line.me/<LIFF_ID>/tools/image` |
   | 3 | ✍ เซ็นเอกสาร | `https://liff.line.me/<LIFF_ID>/tool/sign` |
   | 4 | 📷 สแกนเอกสาร | `https://liff.line.me/<LIFF_ID>/scan` |
   | 5 | 🕘 ประวัติ | `https://liff.line.me/<LIFF_ID>/history` |
   | 6 | ❓ ช่วยเหลือ | `https://liff.line.me/<LIFF_ID>/help` |

5. ตั้งเป็น **Default** แล้วเผยแพร่

### วิธีผ่าน API

โครงสร้าง Rich Menu สำเร็จรูปอยู่ที่ `server/src/services/line.js` (ตัวแปร `RICH_MENU_TEMPLATE`)
แทนที่ `LIFF_URL` ด้วย `https://liff.line.me/<LIFF_ID>` แล้วเรียก

```bash
curl -X POST https://api.line.me/v2/bot/richmenu \
  -H "Authorization: Bearer $LINE_MESSAGING_CHANNEL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @richmenu.json
```

---

## เส้นทางการใช้งานของผู้ใช้จริง

```
ผู้ใช้เปิด LINE
      ↓
สแกน QR หรือค้นหา @123abcd → เพิ่มเพื่อนบัญชีทางการ
      ↓
ได้รับข้อความต้อนรับ + เห็น Rich Menu ด้านล่างแชท
      ↓
กดเมนู → LIFF เปิดขึ้นภายในแอป LINE
      ↓
ระบบเรียก liff.getAccessToken() แล้วส่งให้เซิร์ฟเวอร์ตรวจสอบ
      ↓
เซิร์ฟเวอร์ยืนยันโทเคนกับ LINE → ดึงโปรไฟล์ → ตรวจสถานะเพิ่มเพื่อน
      ↓
ยังไม่เพิ่มเพื่อน → แสดงหน้าชวนเพิ่มเพื่อน (มีปุ่ม "เพิ่มเพื่อนแล้ว" ให้ตรวจซ้ำ)
เพิ่มเพื่อนแล้ว   → เข้าหน้าแรก เห็นตารางเครื่องมือทันที ไม่ต้องกรอกรหัสผ่าน
```

---

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุและวิธีแก้ |
|---|---|
| `400 Bad Request` ตอนกดเข้าสู่ระบบ | Callback URL ใน Console ไม่ตรงกับ `PUBLIC_BASE_URL` + `LINE_CALLBACK_PATH` ให้ตรวจทีละตัวอักษร |
| กลับมาแล้วขึ้น `?login=expired` | ผู้ใช้ใช้เวลานานเกิน 10 นาทีระหว่างขั้นตอน หรือ server รีสตาร์ทกลางทาง ให้ลองใหม่ |
| ตรวจสถานะเพิ่มเพื่อนไม่ได้ | ยังไม่ได้ Link สอง Channel เข้าด้วยกัน (ขั้นที่ 4) |
| เปิดใน LINE แล้วหน้าขาว | Endpoint URL ของ LIFF ไม่ใช่ HTTPS หรือใบรับรองไม่ถูกต้อง |
| หน้าเว็บถูกบล็อกใน LINE | ตรวจ CSP — ระบบอนุญาต `frame-ancestors 'self' https://liff.line.me` ไว้แล้ว หากใช้ reverse proxy ตัวอื่นทับ ให้ตรวจว่าไม่ได้ตั้ง `X-Frame-Options: DENY` |
| เข้า `/admin` ไม่ได้ทั้งที่ login แล้ว | `ADMIN_LINE_USER_IDS` ยังไม่มี userId ของคุณ หรือยังไม่ได้รีสตาร์ทเซิร์ฟเวอร์ |

---

## สิ่งที่ระบบนี้ **ไม่** เข้าถึงในบัญชี LINE ของผู้ใช้

- ไม่อ่านข้อความในแชท
- ไม่เข้าถึงรายชื่อเพื่อนหรือกลุ่ม
- ไม่เก็บ LINE userId ในรูปแบบดิบเมื่อแสดงผลหรือบันทึก log (ใช้ค่า HMAC แทน)
- ขอ scope เพียง `profile` และ `openid` เท่านั้น
