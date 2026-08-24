/**
 * การทำงานกับโครงสร้าง PDF (รวม / แยก / จัดหน้า)
 * ทั้งหมดรันบนเครื่องผู้ใช้ด้วย pdf-lib — ไฟล์ไม่ถูกอัปโหลดขึ้นเซิร์ฟเวอร์
 */
import { loadPdfLib, loadJsZip } from './loader.js';

/** ข้อความ error ที่ผู้ใช้เข้าใจได้ แทน error ดิบของไลบรารี */
export function toFriendlyError(err) {
  const message = String(err?.message || '');
  if (/encrypted|password/i.test(message)) {
    const error = new Error('ไฟล์นี้ถูกล็อกด้วยรหัสผ่าน กรุณาปลดล็อกก่อนใช้งานเครื่องมือนี้');
    error.code = 'PDF_ENCRYPTED';
    return error;
  }
  if (/Failed to parse|Invalid PDF|No PDF header/i.test(message)) {
    const error = new Error('ไม่สามารถเปิดไฟล์ PDF ได้ ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ');
    error.code = 'PDF_INVALID';
    return error;
  }
  if (/out of memory|Array buffer allocation/i.test(message)) {
    const error = new Error('ไฟล์ใหญ่เกินกว่าหน่วยความจำที่เบราว์เซอร์ประมวลผลได้ กรุณาลดจำนวนหน้าหรือใช้การประมวลผลบนเซิร์ฟเวอร์');
    error.code = 'OUT_OF_MEMORY';
    return error;
  }
  return err instanceof Error ? err : new Error('ประมวลผลไม่สำเร็จ');
}

/** เปิดไฟล์ PDF ด้วย pdf-lib */
export async function loadPdf(bytes, { ignoreEncryption = false } = {}) {
  const { PDFDocument } = await loadPdfLib();
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption, updateMetadata: false });
  } catch (err) {
    throw toFriendlyError(err);
  }
}

export async function createPdf() {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setProducer('DT PDF Editor');
  doc.setCreator('DT PDF Editor');
  return doc;
}

export async function fileToBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

export async function savePdf(doc, { fast = false } = {}) {
  const bytes = await doc.save({
    useObjectStreams: !fast,       // object stream ช่วยลดขนาดไฟล์
    addDefaultPage: false,
  });
  return bytes;
}

export const bytesToBlob = (bytes, mime = 'application/pdf') =>
  new Blob([bytes], { type: mime });

/**
 * รวมไฟล์ PDF และ/หรือรูปภาพเป็นไฟล์เดียว
 * @param {Array<{bytes: Uint8Array, kind: 'pdf'|'image', mime?: string, rotation?: number}>} items
 */
export async function mergeDocuments(items, { onProgress = () => {} } = {}) {
  const output = await createPdf();
  let processed = 0;

  for (const item of items) {
    if (item.kind === 'image') {
      const image = item.mime === 'image/png'
        ? await output.embedPng(item.bytes)
        : await output.embedJpg(item.bytes);
      const page = output.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      if (item.rotation) page.setRotation({ type: 'degrees', angle: item.rotation });
    } else {
      const source = await loadPdf(item.bytes, { ignoreEncryption: false });
      const indices = source.getPageIndices();
      const copied = await output.copyPages(source, indices);
      copied.forEach((page) => {
        if (item.rotation) {
          const current = page.getRotation().angle;
          page.setRotation({ type: 'degrees', angle: (current + item.rotation) % 360 });
        }
        output.addPage(page);
      });
    }
    processed += 1;
    onProgress((processed / items.length) * 95, `รวมไฟล์ที่ ${processed} จาก ${items.length}`);
  }

  onProgress(97, 'กำลังสร้างไฟล์ผลลัพธ์');
  return savePdf(output);
}

/**
 * สร้างเอกสารใหม่จากรายการหน้าที่กำหนด (ใช้กับจัดหน้า / แยก / ลบหน้า)
 * @param {Uint8Array} bytes ไฟล์ต้นทาง
 * @param {Array<{index: number, rotation?: number}>} pages ลำดับหน้าใหม่ (0-based)
 */
export async function buildFromPages(bytes, pages, { onProgress = () => {} } = {}) {
  const source = await loadPdf(bytes);
  const output = await createPdf();
  const indices = pages.map((page) => page.index);
  const copied = await output.copyPages(source, indices);

  copied.forEach((page, position) => {
    const rotation = pages[position].rotation || 0;
    if (rotation) {
      const current = page.getRotation().angle;
      page.setRotation({ type: 'degrees', angle: ((current + rotation) % 360 + 360) % 360 });
    }
    output.addPage(page);
    if (position % 20 === 0) onProgress((position / copied.length) * 90, `จัดหน้า ${position + 1}/${copied.length}`);
  });

  onProgress(95, 'กำลังสร้างไฟล์ผลลัพธ์');
  return savePdf(output);
}

/**
 * แยกไฟล์ PDF
 * @param {'each'|'ranges'|'every'|'selected'} mode
 */
export async function splitDocument(bytes, { mode = 'each', ranges = [], everyN = 1, selected = [], baseName = 'document', onProgress = () => {} }) {
  const source = await loadPdf(bytes);
  const total = source.getPageCount();
  const groups = [];

  if (mode === 'each') {
    for (let i = 0; i < total; i += 1) groups.push({ name: `${baseName}_หน้า_${i + 1}`, indices: [i] });
  } else if (mode === 'every') {
    const step = Math.max(1, everyN);
    for (let start = 0; start < total; start += step) {
      const indices = [];
      for (let i = start; i < Math.min(start + step, total); i += 1) indices.push(i);
      groups.push({ name: `${baseName}_${start + 1}-${Math.min(start + step, total)}`, indices });
    }
  } else if (mode === 'ranges') {
    ranges.forEach((range, position) => {
      const indices = [];
      for (let i = range.from - 1; i <= range.to - 1; i += 1) {
        if (i >= 0 && i < total) indices.push(i);
      }
      if (indices.length) groups.push({ name: `${baseName}_${range.from}-${range.to}`, indices, position });
    });
  } else if (mode === 'selected') {
    const indices = selected.filter((i) => i >= 0 && i < total);
    if (indices.length) groups.push({ name: `${baseName}_เลือก`, indices });
  }

  if (!groups.length) {
    const error = new Error('ไม่มีหน้าที่ตรงกับเงื่อนไขที่เลือก กรุณาตรวจสอบช่วงหน้าอีกครั้ง');
    error.code = 'NO_PAGES_SELECTED';
    throw error;
  }

  const results = [];
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const output = await createPdf();
    const copied = await output.copyPages(source, group.indices);
    copied.forEach((page) => output.addPage(page));
    results.push({ name: `${group.name}.pdf`, bytes: await savePdf(output), pages: group.indices.length });
    onProgress(((index + 1) / groups.length) * 95, `สร้างไฟล์ที่ ${index + 1}/${groups.length}`);
  }
  return results;
}

/** บีบไฟล์หลายไฟล์เป็น ZIP เดียว (spec ข้อ 67) */
export async function createZip(files, { onProgress = () => {} } = {}) {
  const JSZip = await loadJsZip();
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.bytes || file.blob);
  }
  return zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => onProgress(meta.percent, 'กำลังบีบอัดเป็น ZIP'),
  );
}

/** แปลงข้อความช่วงหน้า เช่น "1-3, 5, 8-10" ให้เป็นรายการช่วง */
export function parseRanges(text, maxPage) {
  const ranges = [];
  for (const chunk of String(text || '').split(',')) {
    const part = chunk.trim();
    if (!part) continue;
    const match = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!match) {
      const error = new Error(`รูปแบบช่วงหน้า "${part}" ไม่ถูกต้อง ตัวอย่างที่ถูกต้อง: 1-5, 8, 10-12`);
      error.code = 'INVALID_RANGE';
      throw error;
    }
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    if (from < 1 || to > maxPage || from > to) {
      const error = new Error(`ช่วงหน้า "${part}" อยู่นอกขอบเขต (เอกสารมี ${maxPage} หน้า)`);
      error.code = 'RANGE_OUT_OF_BOUNDS';
      throw error;
    }
    ranges.push({ from, to });
  }
  return ranges;
}
