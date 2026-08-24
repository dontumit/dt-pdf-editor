/**
 * ผูกงานที่ประมวลผลบนเครื่องเข้ากับสถิติฝั่งเซิร์ฟเวอร์
 * ไฟล์ไม่ถูกส่งไปไหน — ส่งเฉพาะ metadata (เครื่องมือ, จำนวนไฟล์, ขนาด, เวลาที่ใช้)
 */
import api from '../core/api.js';

/** แจ้งเริ่มงาน + ตรวจโควตา ถ้าเซิร์ฟเวอร์ไม่ตอบก็ยังทำงานต่อได้ (offline first) */
export async function startClientJob(tool, { fileCount = 1, bytesIn = 0, params = {} } = {}) {
  try {
    const res = await api.post('/api/jobs/client/start', { tool, fileCount, bytesIn, params }, { timeout: 12000 });
    return { jobId: res.jobId, allowed: true, maxFiles: res.maxFiles };
  } catch (err) {
    if (err.errorCode === 'RATE_LIMITED' || err.errorCode === 'TOO_MANY_FILES') {
      return { jobId: null, allowed: false, reason: err.message, errorCode: err.errorCode, data: err.data };
    }
    // ออฟไลน์หรือเซิร์ฟเวอร์ล่ม: เครื่องมือที่ทำงานบนเครื่องยังใช้ได้ต่อ
    return { jobId: null, allowed: true, offline: true };
  }
}

export async function completeClientJob(jobId, payload) {
  if (!jobId) return null;
  try {
    return await api.post('/api/jobs/client/complete', { jobId, ...payload }, { timeout: 12000 });
  } catch { return null; }
}

/** ส่งงานให้เซิร์ฟเวอร์ประมวลผล (เฉพาะเครื่องมือที่ browser ทำไม่ได้) */
export async function submitServerJob(tool, files, params = {}, { onProgress } = {}) {
  const formData = new FormData();
  formData.append('tool', tool);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') formData.append(key, value);
  }
  files.forEach((file) => formData.append('files', file, file.name));

  onProgress?.(5, 'กำลังอัปโหลดไฟล์');
  const res = await api.upload('/api/jobs/server', formData);
  return res;
}

/** ติดตามสถานะงานฝั่งเซิร์ฟเวอร์จนกว่าจะเสร็จ */
export async function pollJob(jobId, { onProgress, signal, intervalMs = 1200, timeoutMs = 300000 } = {}) {
  const startedAt = Date.now();
  let delay = intervalMs;

  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error('ยกเลิกงานแล้ว'), { errorCode: 'CANCELLED' });
    if (Date.now() - startedAt > timeoutMs) {
      throw Object.assign(new Error('งานใช้เวลานานเกินไป กรุณาลองใหม่'), { errorCode: 'TIMEOUT' });
    }

    const res = await api.get(`/api/jobs/${jobId}`, { timeout: 15000 });
    onProgress?.(res.progress || 0, res.stage || 'กำลังประมวลผล');

    if (res.status === 'SUCCESS') return res;
    if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(res.status)) {
      throw Object.assign(new Error(res.message || 'ประมวลผลไม่สำเร็จ'), { errorCode: res.errorCode || res.status });
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.15, 3000); // ถอยห่างขึ้นเรื่อย ๆ ลดภาระเซิร์ฟเวอร์
  }
}

export async function cancelServerJob(jobId) {
  try { return await api.del(`/api/jobs/${jobId}`); } catch { return null; }
}

/** ลบไฟล์ผลลัพธ์บนเซิร์ฟเวอร์ทันทีหลังดาวน์โหลด (spec ข้อ 72) */
export async function purgeJobFiles(jobId) {
  try { return await api.del(`/api/files/job/${jobId}`); } catch { return null; }
}

export async function createShareLink(jobId, fileId) {
  return api.post(`/api/jobs/${jobId}/share`, { fileId });
}
