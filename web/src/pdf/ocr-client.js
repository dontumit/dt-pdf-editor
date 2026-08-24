/**
 * OCR บนเครื่องผู้ใช้ด้วย Tesseract.js
 * เอกสารไม่ถูกส่งออกจากเครื่อง — ดาวน์โหลดเฉพาะข้อมูลภาษาจาก CDN ครั้งแรกเท่านั้น
 */
import { loadTesseract } from './loader.js';
import { openDocument, renderPageToBlob } from './render.js';

export async function runClientOcr(file, { langs = 'tha+eng', dpi = 200, onProgress = () => {}, signal = null }) {
  onProgress(3, 'กำลังเตรียมโมดูลอ่านข้อความ');
  const Tesseract = await loadTesseract();

  onProgress(8, 'กำลังโหลดข้อมูลภาษา (ครั้งแรกอาจใช้เวลาสักครู่)');
  const worker = await Tesseract.createWorker(langs.split('+'), 1, {
    logger: (message) => {
      if (message.status === 'recognizing text') {
        onProgress(30 + message.progress * 60, `กำลังอ่านข้อความ ${Math.round(message.progress * 100)}%`);
      } else if (message.status?.includes('loading')) {
        onProgress(10 + (message.progress || 0) * 15, 'กำลังโหลดข้อมูลภาษา');
      }
    },
  });

  try {
    const isPdf = file.detectedType?.ext === 'pdf' || file.type === 'application/pdf';
    const results = [];

    if (isPdf) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await openDocument(bytes);
      try {
        const pageCount = Math.min(doc.numPages, 50);
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          if (signal?.aborted) throw Object.assign(new Error('ยกเลิกงานแล้ว'), { code: 'CANCELLED' });
          onProgress(20 + ((pageNumber - 1) / pageCount) * 10, `กำลังเตรียมหน้า ${pageNumber}/${pageCount}`);
          const { blob } = await renderPageToBlob(doc, pageNumber, { dpi, format: 'image/png', quality: 1 });
          const { data } = await worker.recognize(blob);
          results.push({ pageNumber, text: data.text || '', confidence: data.confidence || 0 });
        }
      } finally {
        await doc.destroy();
      }
    } else {
      const { data } = await worker.recognize(file);
      results.push({ pageNumber: 1, text: data.text || '', confidence: data.confidence || 0 });
    }

    onProgress(95, 'กำลังรวบรวมผลลัพธ์');
    const text = results.length > 1
      ? results.map((item) => `--- หน้า ${item.pageNumber} ---\n${item.text.trim()}`).join('\n\n')
      : (results[0]?.text || '').trim();

    if (!text.replace(/---.*---/g, '').trim()) {
      throw Object.assign(
        new Error('ไม่พบข้อความในไฟล์นี้ ลองสแกนใหม่ให้คมชัดขึ้นหรือเพิ่มความละเอียด'),
        { code: 'NO_TEXT_FOUND' },
      );
    }

    return {
      text,
      pages: results.length,
      confidence: results.reduce((sum, item) => sum + item.confidence, 0) / results.length,
    };
  } finally {
    await worker.terminate().catch(() => {});
  }
}
