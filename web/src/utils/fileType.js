/** ตรวจชนิดไฟล์จาก magic number ฝั่ง browser (spec ข้อ 55) */
const SIGNATURES = [
  { ext: 'pdf', mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },
  { ext: 'png', mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'jpg', mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { ext: 'gif', mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
];

const startsWith = (bytes, magic, offset = 0) =>
  magic.every((byte, index) => bytes[offset + index] === byte);

export async function detectFileType(file) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  for (const signature of SIGNATURES) {
    if (startsWith(head, signature.magic)) return { ext: signature.ext, mime: signature.mime };
  }
  return null;
}

export const isPdf = (detected) => detected?.ext === 'pdf';
export const isImage = (detected) => ['png', 'jpg', 'webp', 'gif'].includes(detected?.ext);
