/**
 * ดาวน์โหลดไฟล์และคืนหน่วยความจำทันที (spec ข้อ 70)
 * ทุก Blob URL ต้องถูก revoke ไม่งั้นหน่วยความจำรั่วเมื่อทำงานหลายรอบ
 */
const pendingUrls = new Set();

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  pendingUrls.add(url);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // ให้เบราว์เซอร์เริ่มดาวน์โหลดก่อนค่อยคืนหน่วยความจำ
  setTimeout(() => {
    URL.revokeObjectURL(url);
    pendingUrls.delete(url);
  }, 4000);
}

export const downloadBytes = (bytes, filename, mime = 'application/pdf') =>
  downloadBlob(new Blob([bytes], { type: mime }), filename);

/** สร้าง object URL ที่จัดการอายุให้เอง */
export function createManagedUrl(blob) {
  const url = URL.createObjectURL(blob);
  pendingUrls.add(url);
  return {
    url,
    revoke() {
      URL.revokeObjectURL(url);
      pendingUrls.delete(url);
    },
  };
}

/** คืนหน่วยความจำทั้งหมด — เรียกตอนออกจากหน้าเครื่องมือ */
export function revokeAll() {
  for (const url of pendingUrls) URL.revokeObjectURL(url);
  pendingUrls.clear();
}
