/**
 * Web Worker สำหรับงาน PDF ที่ใช้ CPU สูง (spec ข้อ 36)
 * งานที่ใช้ pdf-lib ล้วน ๆ (ไม่ต้องใช้ canvas) จะรันที่นี่ เพื่อไม่ให้ UI ค้าง
 *
 * โปรโตคอล:
 *   main -> worker : { id, op, payload }
 *   worker -> main : { id, type: 'progress'|'done'|'error', ... }
 */
import {
  mergeDocuments, buildFromPages, splitDocument, loadPdf, savePdf,
} from '../pdf/ops-core.js';
import {
  addTextWatermark, addImageWatermark, addPageNumbers, cropPages, applyElements,
} from '../pdf/ops-content.js';
import { imagesToPdf } from '../pdf/ops-images.js';

const cancelled = new Set();

function makeProgress(id) {
  return (progress, stage) => {
    if (cancelled.has(id)) throw Object.assign(new Error('ยกเลิกงานแล้ว'), { code: 'CANCELLED' });
    self.postMessage({ id, type: 'progress', progress, stage });
  };
}

const OPERATIONS = {
  async merge({ items }, onProgress) {
    const bytes = await mergeDocuments(items, { onProgress });
    return { bytes };
  },
  async organize({ bytes, pages }, onProgress) {
    return { bytes: await buildFromPages(bytes, pages, { onProgress }) };
  },
  async split({ bytes, options }, onProgress) {
    const files = await splitDocument(bytes, { ...options, onProgress });
    return { files };
  },
  async watermarkText({ bytes, options }, onProgress) {
    return addTextWatermark(bytes, { ...options, onProgress });
  },
  async watermarkImage({ bytes, options }, onProgress) {
    return addImageWatermark(bytes, { ...options, onProgress });
  },
  async pageNumbers({ bytes, options }, onProgress) {
    return addPageNumbers(bytes, { ...options, onProgress });
  },
  async crop({ bytes, options }, onProgress) {
    return cropPages(bytes, { ...options, onProgress });
  },
  async applyElements({ bytes, elements }, onProgress) {
    return applyElements(bytes, elements, { onProgress });
  },
  async imagesToPdf({ images, options }, onProgress) {
    return { bytes: await imagesToPdf(images, { ...options, onProgress }) };
  },
  async info({ bytes }) {
    const doc = await loadPdf(bytes, { ignoreEncryption: true });
    const pages = doc.getPages().map((page, index) => {
      const size = page.getSize();
      return { index, width: size.width, height: size.height, rotation: page.getRotation().angle };
    });
    return { pageCount: pages.length, pages };
  },
  async resave({ bytes }) {
    const doc = await loadPdf(bytes);
    return { bytes: await savePdf(doc) };
  },
};

self.addEventListener('message', async (event) => {
  const { id, op, payload } = event.data || {};

  if (op === 'cancel') {
    cancelled.add(payload?.targetId);
    return;
  }

  const handler = OPERATIONS[op];
  if (!handler) {
    self.postMessage({ id, type: 'error', error: { message: `ไม่รู้จักคำสั่ง: ${op}`, code: 'UNKNOWN_OP' } });
    return;
  }

  try {
    const result = await handler(payload, makeProgress(id));
    // ส่งคืนแบบ transferable เพื่อไม่ต้องคัดลอกหน่วยความจำ
    const transfers = [];
    if (result.bytes?.buffer) transfers.push(result.bytes.buffer);
    if (Array.isArray(result.files)) {
      result.files.forEach((file) => { if (file.bytes?.buffer) transfers.push(file.bytes.buffer); });
    }
    self.postMessage({ id, type: 'done', result }, transfers);
  } catch (err) {
    self.postMessage({
      id,
      type: 'error',
      error: {
        message: err?.message || 'ประมวลผลไม่สำเร็จ',
        code: err?.code || (cancelled.has(id) ? 'CANCELLED' : 'PROCESSING_FAILED'),
      },
    });
  } finally {
    cancelled.delete(id);
  }
});
