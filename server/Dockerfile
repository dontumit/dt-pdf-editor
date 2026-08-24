# ---------- Stage 1: ติดตั้ง dependency ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app/server

# better-sqlite3 ต้องคอมไพล์ native module จึงต้องมี build tool ในขั้นนี้
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# ---------- Stage 2: image สำหรับรันจริง ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# เครื่องมือฝั่ง server ที่จำเป็น
#   qpdf      = ใส่/ปลดรหัสผ่าน PDF
#   ghostscript = บีบอัด PDF คุณภาพสูงโดยคงข้อความ
#   poppler-utils = แปลงหน้า PDF เป็นภาพสำหรับ OCR
#   fonts-thai-tlwg = ฟอนต์ไทยสำหรับการเรนเดอร์ฝั่ง server
RUN apt-get update && apt-get install -y --no-install-recommends \
      qpdf ghostscript poppler-utils fonts-thai-tlwg tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8080 \
    STORAGE_DIR=/data/storage \
    DATABASE_URL=file:/data/db/dtpdf.db

COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY web ./web
COPY scripts ./scripts

# รันด้วยผู้ใช้ที่ไม่ใช่ root
RUN mkdir -p /data/storage /data/db \
    && chown -R node:node /data /app
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/src/index.js"]
