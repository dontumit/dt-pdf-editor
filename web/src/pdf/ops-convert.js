/**
 * การแปลงไฟล์: PDF -> รูปภาพ, รูปภาพ -> PDF, บีบอัด PDF, บีบอัดรูปภาพ
 * ใช้ Canvas API ทั้งหมด ทำงานบนเครื่องผู้ใช้
 */
import { openDocument, renderPageToBlob } from './render.js';
import { createPdf, savePdf, loadPdf, toFriendlyError } from './ops-core.js';
export { imagesToPdf, PAPER_SIZES } from './ops-images.js';

export const DPI_PRESETS = [
  { value: 72, th: '72 DPI — สำหรับดูบนจอ' },
  { value: 150, th: '150 DPI — คุณภาพทั่วไป (แนะนำ)' },
  { value: 200, th: '200 DPI — คุณภาพสูง' },
  { value: 300, th: '300 DPI — สำหรับพิมพ์' },
];

export const IMAGE_FORMATS = [
  { value: 'image/jpeg', ext: 'jpg', th: 'JPG — ไฟล์เล็ก เหมาะกับรูปถ่าย' },
  { value: 'image/png', ext: 'png', th: 'PNG — คมชัด รองรับพื้นหลังโปร่ง' },
  { value: 'image/webp', ext: 'webp', th: 'WEBP — เล็กที่สุด (เบราว์เซอร์ใหม่)' },
];

/** PDF -> รูปภาพทีละหน้า */
export async function pdfToImages(bytes, {
  dpi = 150, format = 'image/jpeg', quality = 0.85, pages = null,
  baseName = 'page', onProgress = () => {}, signal = null,
}) {
  const doc = await openDocument(bytes);
  try {
    const targets = pages || Array.from({ length: doc.numPages }, (_, i) => i + 1);
    const extension = IMAGE_FORMATS.find((f) => f.value === format)?.ext || 'jpg';
    const results = [];

    for (let index = 0; index < targets.length; index += 1) {
      if (signal?.aborted) throw Object.assign(new Error('ยกเลิกงานแล้ว'), { code: 'CANCELLED' });
      const pageNumber = targets[index];
      const { blob, width, height } = await renderPageToBlob(doc, pageNumber, { dpi, format, quality });
      results.push({
        name: `${baseName}_${String(pageNumber).padStart(3, '0')}.${extension}`,
        blob, width, height, pageNumber,
      });
      onProgress(((index + 1) / targets.length) * 95, `แปลงหน้า ${index + 1} จาก ${targets.length}`);
      // คืนคิวให้ UI ได้หายใจทุก 3 หน้า
      if (index % 3 === 2) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return results;
  } finally {
    await doc.destroy();
  }
}

export const COMPRESSION_LEVELS = {
  low: { dpi: 200, quality: 0.85, th: 'ต่ำ — คงคุณภาพไว้มากที่สุด' },
  medium: { dpi: 140, quality: 0.72, th: 'ปานกลาง — สมดุลระหว่างขนาดกับคุณภาพ (แนะนำ)' },
  high: { dpi: 100, quality: 0.58, th: 'สูง — ไฟล์เล็กที่สุด' },
};

// ขั้นของการบีบอัดที่ใช้ไล่หาเมื่อผู้ใช้กำหนดขนาดเป้าหมาย เรียงจากคุณภาพดีที่สุดไปเล็กที่สุด
const TARGET_STEPS = [
  { dpi: 200, quality: 0.85 },
  { dpi: 170, quality: 0.78 },
  { dpi: 140, quality: 0.72 },
  { dpi: 120, quality: 0.64 },
  { dpi: 100, quality: 0.56 },
  { dpi: 85, quality: 0.48 },
  { dpi: 72, quality: 0.40 },
  { dpi: 60, quality: 0.34 },
];

/** บันทึกไฟล์ใหม่ด้วย object stream — ข้อความยังเลือก/ค้นหาได้ */
async function resaveLossless(bytes) {
  const doc = await loadPdf(bytes);
  return savePdf(doc);
}

/** เรนเดอร์ทุกหน้าเป็นภาพแล้วประกอบเป็น PDF ใหม่ */
async function rasterize(pdfDoc, { dpi, quality, onProgress = () => {}, signal = null, progressFrom = 0, progressTo = 90 }) {
  const output = await createPdf();
  const total = pdfDoc.numPages;

  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    if (signal?.aborted) throw Object.assign(new Error('ยกเลิกงานแล้ว'), { code: 'CANCELLED' });
    const { blob, width, height } = await renderPageToBlob(pdfDoc, pageNumber, {
      dpi, format: 'image/jpeg', quality,
    });
    const imageBytes = new Uint8Array(await blob.arrayBuffer());
    const embedded = await output.embedJpg(imageBytes);
    const page = output.addPage([width, height]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });

    const span = progressTo - progressFrom;
    onProgress(progressFrom + (pageNumber / total) * span, `บีบอัดหน้า ${pageNumber} จาก ${total}`);
    if (pageNumber % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return savePdf(output);
}

/**
 * ลดขนาดไฟล์ PDF บนเครื่องผู้ใช้
 *
 * โหมดการทำงาน
 *   'smart'     : ลองแบบคงข้อความก่อน ถ้าลดได้ไม่พอจึงแปลงหน้าเป็นภาพ (ค่าเริ่มต้น)
 *   'lossless'  : จัดโครงสร้างไฟล์ใหม่อย่างเดียว ข้อความยังเลือก/ค้นหาได้
 *   'rasterize' : แปลงทุกหน้าเป็นภาพ ลดได้มากที่สุดแต่ข้อความจะเลือกไม่ได้
 *
 * ถ้ากำหนด targetSizeMb ระบบจะไล่ลดคุณภาพทีละขั้นจนได้ตามเป้า
 * เหมาะกับระบบรับเอกสารออนไลน์ที่จำกัดขนาดไฟล์ เช่น ไม่เกิน 2 MB หรือ 5 MB
 */
export async function compressPdf(bytes, {
  level = 'medium', mode = 'smart', targetSizeMb = 0,
  onProgress = () => {}, signal = null,
}) {
  // pdf.js ย้าย ArrayBuffer ไปให้ worker (transfer) ทำให้ตัวแปรเดิมถูก detach
  // จึงต้องสำเนาไว้ก่อน เพื่อให้คืนไฟล์ต้นฉบับได้เมื่อบีบอัดแล้วไม่เล็กลง
  const original = bytes.slice();
  const originalSize = original.byteLength;
  const targetBytes = targetSizeMb > 0 ? targetSizeMb * 1024 * 1024 : 0;

  const finish = (result, strategy, textPreserved) => {
    const smaller = result && result.byteLength < originalSize;
    return {
      bytes: smaller ? result : original,
      originalSize,
      newSize: smaller ? result.byteLength : originalSize,
      mode: strategy,
      textPreserved: smaller ? textPreserved : true,
      grewInstead: !smaller,
      targetMet: targetBytes ? (smaller ? result.byteLength : originalSize) <= targetBytes : null,
    };
  };

  // ---------- ขั้นที่ 1: จัดโครงสร้างไฟล์ใหม่ (ไม่เสียคุณภาพ) ----------
  if (mode === 'lossless' || mode === 'smart') {
    onProgress(mode === 'smart' ? 8 : 25, 'กำลังจัดโครงสร้างไฟล์ใหม่');
    const lossless = await resaveLossless(bytes.slice());
    const enough = targetBytes
      ? lossless.byteLength <= targetBytes
      : lossless.byteLength <= originalSize * 0.9;

    if (mode === 'lossless' || enough) {
      onProgress(96, 'เสร็จสิ้น');
      return finish(lossless, 'lossless', true);
    }
    onProgress(15, 'ลดได้ไม่พอ กำลังลองวิธีที่ลดได้มากกว่า');
  }

  // ---------- ขั้นที่ 2: แปลงหน้าเป็นภาพ ----------
  const source = await openDocument(bytes);
  try {
    // ไม่ได้กำหนดขนาดเป้าหมาย: ใช้ระดับที่ผู้ใช้เลือกรอบเดียว
    if (!targetBytes) {
      const preset = COMPRESSION_LEVELS[level] || COMPRESSION_LEVELS.medium;
      const out = await rasterize(source, {
        dpi: preset.dpi, quality: preset.quality, onProgress, signal,
        progressFrom: 15, progressTo: 92,
      });
      onProgress(96, 'กำลังสร้างไฟล์ผลลัพธ์');
      return finish(out, 'rasterize', false);
    }

    // กำหนดขนาดเป้าหมาย: ไล่ลดคุณภาพทีละขั้นจนได้ตามเป้า
    let best = null;
    for (let step = 0; step < TARGET_STEPS.length; step += 1) {
      if (signal?.aborted) throw Object.assign(new Error('ยกเลิกงานแล้ว'), { code: 'CANCELLED' });
      const preset = TARGET_STEPS[step];
      const from = 15 + (step / TARGET_STEPS.length) * 75;
      const to = 15 + ((step + 1) / TARGET_STEPS.length) * 75;

      onProgress(from, `กำลังลองที่ ${preset.dpi} DPI (รอบที่ ${step + 1})`);
      const out = await rasterize(source, {
        dpi: preset.dpi, quality: preset.quality, onProgress, signal,
        progressFrom: from, progressTo: to,
      });

      if (!best || out.byteLength < best.byteLength) best = out;
      if (out.byteLength <= targetBytes) {
        onProgress(95, `ได้ขนาดตามเป้าแล้วที่ ${preset.dpi} DPI`);
        return finish(out, 'rasterize', false);
      }
    }

    onProgress(95, 'ลดได้เล็กที่สุดเท่าที่ทำได้แล้ว');
    return finish(best, 'rasterize', false);
  } finally {
    await source.destroy();
  }
}

/** บีบอัดรูปภาพด้วย Canvas */
export async function compressImage(file, {
  quality = 0.8, maxWidth = null, maxHeight = null, format = null, maxSizeKb = null,
}) {
  const bitmap = await createImageBitmap(file);
  const bitmapWidth = bitmap.width;
  const bitmapHeight = bitmap.height;
  let { width, height } = bitmap;

  if (maxWidth && width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
  if (maxHeight && height > maxHeight) { width = Math.round((width * maxHeight) / height); height = maxHeight; }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const outputFormat = format || (file.type === 'image/png' ? 'image/png' : 'image/jpeg');
  if (outputFormat !== 'image/png') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const encode = (q) => new Promise((resolve) => canvas.toBlob(resolve, outputFormat, q));
  let blob = await encode(quality);

  // ถ้ากำหนดขนาดสูงสุดไว้ ให้ลดคุณภาพลงทีละขั้นจนกว่าจะได้ตามเป้า
  if (maxSizeKb && blob && blob.size > maxSizeKb * 1024 && outputFormat !== 'image/png') {
    let currentQuality = quality;
    for (let attempt = 0; attempt < 6 && blob.size > maxSizeKb * 1024 && currentQuality > 0.15; attempt += 1) {
      currentQuality = Math.max(0.15, currentQuality - 0.12);
      blob = await encode(currentQuality);
    }
  }

  canvas.width = 0;
  canvas.height = 0;

  // การเข้ารหัสใหม่อาจทำให้ไฟล์ใหญ่ขึ้น โดยเฉพาะ PNG ที่เป็นภาพสีเรียบ
  // ถ้าไม่ได้เปลี่ยนรูปแบบไฟล์และไม่ได้ย่อขนาด ให้คืนไฟล์เดิมแทน
  const unchangedShape = width === bitmapWidth && height === bitmapHeight;
  const sameFormat = outputFormat === file.type;
  if (blob && blob.size >= file.size && sameFormat && unchangedShape) {
    return {
      blob: file,
      width,
      height,
      originalSize: file.size,
      newSize: file.size,
      format: outputFormat,
      keptOriginal: true,
    };
  }

  return {
    blob,
    width,
    height,
    originalSize: file.size,
    newSize: blob?.size || 0,
    format: outputFormat,
    keptOriginal: false,
  };
}
