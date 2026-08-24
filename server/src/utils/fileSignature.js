/**
 * ตรวจชนิดไฟล์จาก magic number — ห้ามเชื่อ MIME type ที่ browser ส่งมาอย่างเดียว (spec ข้อ 55)
 */
import fs from 'node:fs';

const SIGNATURES = [
  { ext: 'pdf', mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },
  { ext: 'png', mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: 'jpg', mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { ext: 'gif', mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  { ext: 'zip', mime: 'application/zip', magic: [0x50, 0x4b, 0x03, 0x04] },
];

function matches(buffer, magic, offset = 0) {
  if (buffer.length < offset + magic.length) return false;
  return magic.every((byte, i) => buffer[offset + i] === byte);
}

export function detectType(buffer) {
  // WEBP มีรูปแบบ RIFF....WEBP
  if (matches(buffer, [0x52, 0x49, 0x46, 0x46]) && matches(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  for (const sig of SIGNATURES) {
    if (matches(buffer, sig.magic)) return { ext: sig.ext, mime: sig.mime };
  }
  return null;
}

export function detectFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    return detectType(head);
  } finally {
    fs.closeSync(fd);
  }
}

/** คืนค่าชนิดไฟล์เมื่ออยู่ในรายการที่อนุญาต มิฉะนั้นคืน null */
export function assertAllowed(buffer, allowedExts) {
  const detected = detectType(buffer);
  return detected && allowedExts.includes(detected.ext) ? detected : null;
}
