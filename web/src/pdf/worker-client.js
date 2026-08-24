/**
 * ตัวเรียกใช้ Web Worker สำหรับงาน PDF
 * - ถ้าเบราว์เซอร์ไม่รองรับ module worker จะ fallback ไปทำงานบน main thread อัตโนมัติ
 * - ทุกงานยกเลิกได้ และปล่อยหน่วยความจำเมื่อจบ (spec ข้อ 69, 70)
 */
let worker = null;
let workerBroken = false;
let sequence = 0;
const pending = new Map();

function ensureWorker() {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/pdf.worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => {
      const { id, type, progress, stage, result, error } = event.data || {};
      const task = pending.get(id);
      if (!task) return;
      if (type === 'progress') { task.onProgress?.(progress, stage); return; }
      pending.delete(id);
      if (type === 'done') task.resolve(result);
      else task.reject(Object.assign(new Error(error?.message || 'ประมวลผลไม่สำเร็จ'), { code: error?.code }));
    });
    worker.addEventListener('error', (event) => {
      console.warn('pdf worker error, falling back to main thread', event.message);
      workerBroken = true;
      for (const task of pending.values()) task.reject(new Error('worker unavailable'));
      pending.clear();
      worker?.terminate();
      worker = null;
    });
    return worker;
  } catch (err) {
    console.warn('worker unavailable', err);
    workerBroken = true;
    return null;
  }
}

/** ทำงานบน main thread เมื่อ worker ใช้ไม่ได้ */
async function runInline(op, payload, onProgress) {
  const core = await import('./ops-core.js');
  const content = await import('./ops-content.js');
  const images = await import('./ops-images.js');

  switch (op) {
    case 'merge': return { bytes: await core.mergeDocuments(payload.items, { onProgress }) };
    case 'organize': return { bytes: await core.buildFromPages(payload.bytes, payload.pages, { onProgress }) };
    case 'split': return { files: await core.splitDocument(payload.bytes, { ...payload.options, onProgress }) };
    case 'watermarkText': return content.addTextWatermark(payload.bytes, { ...payload.options, onProgress });
    case 'watermarkImage': return content.addImageWatermark(payload.bytes, { ...payload.options, onProgress });
    case 'pageNumbers': return content.addPageNumbers(payload.bytes, { ...payload.options, onProgress });
    case 'crop': return content.cropPages(payload.bytes, { ...payload.options, onProgress });
    case 'applyElements': return content.applyElements(payload.bytes, payload.elements, { onProgress });
    case 'imagesToPdf': return { bytes: await images.imagesToPdf(payload.images, { ...payload.options, onProgress }) };
    case 'info': {
      const doc = await core.loadPdf(payload.bytes, { ignoreEncryption: true });
      const pages = doc.getPages().map((page, index) => {
        const size = page.getSize();
        return { index, width: size.width, height: size.height, rotation: page.getRotation().angle };
      });
      return { pageCount: pages.length, pages };
    }
    case 'resave': {
      const doc = await core.loadPdf(payload.bytes);
      return { bytes: await core.savePdf(doc) };
    }
    default: throw new Error(`ไม่รู้จักคำสั่ง: ${op}`);
  }
}

/**
 * สั่งงาน PDF
 * @returns {{promise: Promise<any>, cancel: () => void, id: string}}
 */
export function runPdfTask(op, payload, { onProgress } = {}) {
  const id = `task_${++sequence}_${Date.now().toString(36)}`;
  const instance = ensureWorker();

  if (!instance) {
    const controller = { cancelled: false };
    const promise = runInline(op, payload, (progress, stage) => {
      if (controller.cancelled) throw Object.assign(new Error('ยกเลิกงานแล้ว'), { code: 'CANCELLED' });
      onProgress?.(progress, stage);
    });
    return { id, promise, cancel: () => { controller.cancelled = true; } };
  }

  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    // ส่ง ArrayBuffer แบบ transfer เพื่อลดการคัดลอกหน่วยความจำ
    const transfers = [];
    if (payload.bytes?.buffer) transfers.push(payload.bytes.buffer);
    if (Array.isArray(payload.items)) {
      payload.items.forEach((item) => { if (item.bytes?.buffer) transfers.push(item.bytes.buffer); });
    }
    if (Array.isArray(payload.images)) {
      payload.images.forEach((item) => { if (item.bytes?.buffer) transfers.push(item.bytes.buffer); });
    }
    try {
      instance.postMessage({ id, op, payload }, transfers);
    } catch {
      // บาง payload transfer ไม่ได้ ให้ส่งแบบ copy แทน
      instance.postMessage({ id, op, payload });
    }
  });

  return {
    id,
    promise,
    cancel() {
      instance.postMessage({ id: `cancel_${id}`, op: 'cancel', payload: { targetId: id } });
      const task = pending.get(id);
      if (task) {
        pending.delete(id);
        task.reject(Object.assign(new Error('ยกเลิกงานแล้ว'), { code: 'CANCELLED' }));
      }
    },
  };
}

/** ปิด worker และคืนหน่วยความจำ — เรียกเมื่อออกจากหน้าเครื่องมือ */
export function releaseWorker() {
  if (!worker) return;
  for (const task of pending.values()) {
    task.reject(Object.assign(new Error('ยกเลิกงานแล้ว'), { code: 'CANCELLED' }));
  }
  pending.clear();
  worker.terminate();
  worker = null;
}
