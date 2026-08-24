/**
 * การใส่เนื้อหาลงบน PDF: ลายน้ำ เลขหน้า ครอบตัด ลายเซ็น และ element ของ editor
 * ทั้งหมดรันบนเครื่องผู้ใช้ และรองรับภาษาไทยผ่านฟอนต์ที่ฝังไว้
 */
import { loadPdfLib } from './loader.js';
import { loadPdf, savePdf, toFriendlyError } from './ops-core.js';
import { embedTextFont, prepareText, wrapText } from './fonts.js';

export { PAPER_SIZES } from './ops-images.js';

/** ตำแหน่ง 9 จุดบนหน้ากระดาษ */
export const POSITIONS = [
  { id: 'top-left', th: 'บนซ้าย' }, { id: 'top-center', th: 'บนกลาง' }, { id: 'top-right', th: 'บนขวา' },
  { id: 'middle-left', th: 'กลางซ้าย' }, { id: 'center', th: 'กึ่งกลาง' }, { id: 'middle-right', th: 'กลางขวา' },
  { id: 'bottom-left', th: 'ล่างซ้าย' }, { id: 'bottom-center', th: 'ล่างกลาง' }, { id: 'bottom-right', th: 'ล่างขวา' },
];

/** คำนวณพิกัดจากตำแหน่งที่เลือก (พิกัด PDF นับจากมุมล่างซ้าย) */
export function resolvePosition(position, { pageWidth, pageHeight, contentWidth, contentHeight, margin = 36 }) {
  const [vertical, horizontal] = position.split('-').length === 2
    ? position.split('-')
    : ['middle', 'center'];

  let x;
  if (position === 'center') x = (pageWidth - contentWidth) / 2;
  else if (horizontal === 'left') x = margin;
  else if (horizontal === 'right') x = pageWidth - contentWidth - margin;
  else x = (pageWidth - contentWidth) / 2;

  let y;
  if (position === 'center') y = (pageHeight - contentHeight) / 2;
  else if (vertical === 'top') y = pageHeight - contentHeight - margin;
  else if (vertical === 'bottom') y = margin;
  else y = (pageHeight - contentHeight) / 2;

  return { x, y };
}

/**
 * จัดตำแหน่งเนื้อหาที่ถูกหมุน
 *
 * pdf-lib หมุนรอบจุดเริ่มต้น (x, y) ไม่ใช่รอบจุดกึ่งกลางของเนื้อหา
 * ถ้าคำนวณตำแหน่งแบบไม่หมุน ลายน้ำที่หมุน 45 องศาจะเลื่อนออกนอกหน้า
 * ฟังก์ชันนี้จึงหาจุดกึ่งกลางที่ต้องการก่อน แล้วถอยกลับไปหาจุดเริ่มต้นที่ถูกต้อง
 *
 * @param {number} anchorOffsetY ระยะจากจุดเริ่มต้นถึงกึ่งกลางแนวตั้งของเนื้อหา
 */
export function resolveRotatedPosition(position, {
  pageWidth, pageHeight, contentWidth, contentHeight, rotation = 0, margin = 36, anchorOffsetY = null,
}) {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // ขนาดของกรอบสี่เหลี่ยมที่ครอบเนื้อหาหลังหมุน
  const boxWidth = Math.abs(contentWidth * cos) + Math.abs(contentHeight * sin);
  const boxHeight = Math.abs(contentWidth * sin) + Math.abs(contentHeight * cos);

  const spot = resolvePosition(position, {
    pageWidth, pageHeight, contentWidth: boxWidth, contentHeight: boxHeight, margin,
  });
  const centerX = spot.x + boxWidth / 2;
  const centerY = spot.y + boxHeight / 2;

  const halfHeight = anchorOffsetY === null ? contentHeight / 2 : anchorOffsetY;
  return {
    x: centerX - (contentWidth / 2) * cos + halfHeight * sin,
    y: centerY - (contentWidth / 2) * sin - halfHeight * cos,
  };
}

function hexToRgbComponents(hex) {
  const value = String(hex || '#000000').replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

/** เลือกหน้าที่จะถูกดำเนินการ */
export function resolveTargetPages(scope, { pageCount, currentPage = 0, selected = [] }) {
  if (scope === 'current') return [currentPage];
  if (scope === 'selected') return selected.slice();
  if (scope === 'odd') return Array.from({ length: pageCount }, (_, i) => i).filter((i) => i % 2 === 0);
  if (scope === 'even') return Array.from({ length: pageCount }, (_, i) => i).filter((i) => i % 2 === 1);
  return Array.from({ length: pageCount }, (_, i) => i);
}

// ---------------------------------------------------------------- ลายน้ำ

export async function addTextWatermark(bytes, options) {
  const {
    text = 'CONFIDENTIAL', fontSize = 48, color = '#ff0000', opacity = 0.25,
    rotation = 45, position = 'center', bold = false, scope = 'all',
    selected = [], onProgress = () => {},
  } = options;

  if (!String(text).trim()) {
    const error = new Error('กรุณากรอกข้อความลายน้ำ');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  try {
    const { rgb, degrees } = await loadPdfLib();
    const doc = await loadPdf(bytes);
    const { font, isUnicode, warning } = await embedTextFont(doc, { bold });
    const safeText = prepareText(text, isUnicode);
    const { r, g, b } = hexToRgbComponents(color);

    const pages = doc.getPages();
    const targets = resolveTargetPages(scope, { pageCount: pages.length, selected });

    targets.forEach((pageIndex, position2) => {
      const page = pages[pageIndex];
      if (!page) return;
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(safeText, fontSize);
      const textHeight = font.heightAtSize(fontSize);
      const spot = resolveRotatedPosition(position, {
        pageWidth: width, pageHeight: height,
        contentWidth: textWidth, contentHeight: textHeight,
        rotation,
        // จุดเริ่มต้นของข้อความอยู่ที่เส้นฐาน กึ่งกลางตัวอักษรจึงสูงจากเส้นฐานราว 35%
        anchorOffsetY: textHeight * 0.35,
      });

      page.drawText(safeText, {
        x: spot.x,
        y: spot.y,
        size: fontSize,
        font,
        color: rgb(r, g, b),
        opacity,
        rotate: degrees(rotation),
      });
      if (position2 % 20 === 0) onProgress((position2 / targets.length) * 92, `ใส่ลายน้ำหน้า ${position2 + 1}/${targets.length}`);
    });

    onProgress(96, 'กำลังสร้างไฟล์ผลลัพธ์');
    return { bytes: await savePdf(doc), warning, pagesAffected: targets.length };
  } catch (err) {
    throw toFriendlyError(err);
  }
}

export async function addImageWatermark(bytes, options) {
  const {
    imageBytes, imageMime, opacity = 0.3, scale = 0.4, position = 'center',
    rotation = 0, scope = 'all', selected = [], onProgress = () => {},
  } = options;

  try {
    const { degrees } = await loadPdfLib();
    const doc = await loadPdf(bytes);
    const image = imageMime === 'image/png' ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
    const pages = doc.getPages();
    const targets = resolveTargetPages(scope, { pageCount: pages.length, selected });

    targets.forEach((pageIndex, position2) => {
      const page = pages[pageIndex];
      if (!page) return;
      const { width, height } = page.getSize();
      const drawWidth = width * scale;
      const drawHeight = (image.height / image.width) * drawWidth;
      const spot = resolveRotatedPosition(position, {
        pageWidth: width, pageHeight: height,
        contentWidth: drawWidth, contentHeight: drawHeight, rotation,
      });
      page.drawImage(image, {
        x: spot.x, y: spot.y, width: drawWidth, height: drawHeight,
        opacity, rotate: degrees(rotation),
      });
      if (position2 % 20 === 0) onProgress((position2 / targets.length) * 92, `ใส่ลายน้ำหน้า ${position2 + 1}/${targets.length}`);
    });

    onProgress(96, 'กำลังสร้างไฟล์ผลลัพธ์');
    return { bytes: await savePdf(doc), warning: null, pagesAffected: targets.length };
  } catch (err) {
    throw toFriendlyError(err);
  }
}

// ---------------------------------------------------------------- เลขหน้า

export const PAGE_NUMBER_FORMATS = {
  plain: { th: '1, 2, 3', build: (n) => String(n) },
  ofTotal: { th: 'หน้า 1 จาก 10', build: (n, total) => `หน้า ${n} จาก ${total}` },
  ofTotalEn: { th: 'Page 1 of 10', build: (n, total) => `Page ${n} of ${total}` },
  dash: { th: '- 1 -', build: (n) => `- ${n} -` },
  thai: { th: 'หน้าที่ ๑', build: (n) => `หน้าที่ ${toThaiDigits(n)}` },
};

export function toThaiDigits(value) {
  const digits = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];
  return String(value).replace(/\d/g, (digit) => digits[Number(digit)]);
}

export async function addPageNumbers(bytes, options) {
  const {
    format = 'plain', position = 'bottom-center', fontSize = 11, color = '#333333',
    margin = 30, startAt = 1, skipFirst = false, bold = false, prefix = '',
    onProgress = () => {},
  } = options;

  try {
    const { rgb } = await loadPdfLib();
    const doc = await loadPdf(bytes);
    const pages = doc.getPages();
    const builder = PAGE_NUMBER_FORMATS[format]?.build || PAGE_NUMBER_FORMATS.plain.build;

    const sample = `${prefix}${builder(pages.length + startAt, pages.length)}`;
    const { font, isUnicode, warning } = await embedTextFont(doc, {
      bold, requireUnicode: true,
    });
    const { r, g, b } = hexToRgbComponents(color);

    pages.forEach((page, index) => {
      if (skipFirst && index === 0) return;
      const label = prepareText(`${prefix}${builder(index + startAt, pages.length + startAt - 1)}`, isUnicode);
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(label, fontSize);
      const spot = resolvePosition(position, {
        pageWidth: width, pageHeight: height,
        contentWidth: textWidth, contentHeight: fontSize, margin,
      });
      page.drawText(label, { x: spot.x, y: spot.y, size: fontSize, font, color: rgb(r, g, b) });
      if (index % 20 === 0) onProgress((index / pages.length) * 92, `ใส่เลขหน้า ${index + 1}/${pages.length}`);
    });

    onProgress(96, 'กำลังสร้างไฟล์ผลลัพธ์');
    return { bytes: await savePdf(doc), warning, pagesAffected: pages.length - (skipFirst ? 1 : 0), sample };
  } catch (err) {
    throw toFriendlyError(err);
  }
}

// ---------------------------------------------------------------- ครอบตัด

/**
 * ครอบตัดหน้า
 * @param {{top:number,right:number,bottom:number,left:number}} crop สัดส่วน 0-1 ของแต่ละด้านที่ต้องการตัดออก
 */
export async function cropPages(bytes, { crop, scope = 'all', selected = [], currentPage = 0, onProgress = () => {} }) {
  try {
    const doc = await loadPdf(bytes);
    const pages = doc.getPages();
    const targets = resolveTargetPages(scope, { pageCount: pages.length, selected, currentPage });

    targets.forEach((pageIndex, position) => {
      const page = pages[pageIndex];
      if (!page) return;
      const box = page.getMediaBox();
      const cutLeft = box.width * crop.left;
      const cutRight = box.width * crop.right;
      const cutTop = box.height * crop.top;
      const cutBottom = box.height * crop.bottom;

      const newWidth = box.width - cutLeft - cutRight;
      const newHeight = box.height - cutTop - cutBottom;
      if (newWidth <= 10 || newHeight <= 10) {
        const error = new Error('พื้นที่ที่เหลือหลังครอบตัดเล็กเกินไป กรุณาปรับขอบใหม่');
        error.code = 'CROP_TOO_SMALL';
        throw error;
      }
      page.setCropBox(box.x + cutLeft, box.y + cutBottom, newWidth, newHeight);
      page.setMediaBox(box.x + cutLeft, box.y + cutBottom, newWidth, newHeight);
      if (position % 20 === 0) onProgress((position / targets.length) * 92, `ครอบตัดหน้า ${position + 1}/${targets.length}`);
    });

    onProgress(96, 'กำลังสร้างไฟล์ผลลัพธ์');
    return { bytes: await savePdf(doc), pagesAffected: targets.length };
  } catch (err) {
    throw toFriendlyError(err);
  }
}

/** ตรวจหาขอบขาวอัตโนมัติจาก canvas ที่เรนเดอร์แล้ว */
export function detectContentBounds(canvas, { threshold = 245, padding = 4 } = {}) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4;
      const luminance = (data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114);
      if (luminance < threshold) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return { top: 0, right: 0, bottom: 0, left: 0 };

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width, maxX + padding);
  maxY = Math.min(height, maxY + padding);

  return {
    left: minX / width,
    right: (width - maxX) / width,
    top: minY / height,
    bottom: (height - maxY) / height,
  };
}

// ---------------------------------------------------------------- ลายเซ็น / element

/**
 * วาง element ที่ผู้ใช้จัดไว้ใน editor ลงบน PDF จริง
 * element ใช้พิกัดแบบสัดส่วน (0-1) ของหน้ากระดาษ จึงคงตำแหน่งได้ทุกขนาดจอ
 */
export async function applyElements(bytes, elements, { onProgress = () => {} } = {}) {
  try {
    const { rgb, degrees } = await loadPdfLib();
    const doc = await loadPdf(bytes);
    const pages = doc.getPages();

    const needsFont = elements.some((el) => ['text', 'date', 'checkbox'].includes(el.type));
    let fontContext = { font: null, isUnicode: false, warning: null };
    let boldFontContext = null;
    if (needsFont) fontContext = await embedTextFont(doc, {});

    const imageCache = new Map();
    async function embedImage(dataUrl) {
      if (imageCache.has(dataUrl)) return imageCache.get(dataUrl);
      const response = await fetch(dataUrl);
      const buffer = new Uint8Array(await response.arrayBuffer());
      const image = dataUrl.startsWith('data:image/png')
        ? await doc.embedPng(buffer)
        : await doc.embedJpg(buffer);
      imageCache.set(dataUrl, image);
      return image;
    }

    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      const page = pages[element.pageIndex];
      if (!page) continue;
      const { width: pw, height: ph } = page.getSize();

      const x = element.x * pw;
      const width = (element.width || 0) * pw;
      const height = (element.height || 0) * ph;
      // แปลงพิกัดจากระบบ CSS (นับจากบน) เป็นระบบ PDF (นับจากล่าง)
      const y = ph - (element.y * ph) - height;

      if (element.type === 'image' || element.type === 'signature') {
        const image = await embedImage(element.src);
        page.drawImage(image, {
          x, y, width, height,
          opacity: element.opacity ?? 1,
          rotate: element.rotation ? degrees(element.rotation) : undefined,
        });
      } else if (element.type === 'text' || element.type === 'date') {
        const size = element.fontSize || 14;
        const useBold = Boolean(element.bold);
        if (useBold && !boldFontContext) boldFontContext = await embedTextFont(doc, { bold: true });
        const active = useBold ? boldFontContext : fontContext;
        const value = prepareText(element.text || '', active.isUnicode);
        const lines = wrapText(value, active.font, size, width || pw - x - 20);
        lines.forEach((line, lineIndex) => {
          page.drawText(line, {
            x,
            y: ph - (element.y * ph) - size * (lineIndex + 1) * 1.25,
            size,
            font: active.font,
            color: (() => { const c = hexToRgbComponents(element.color || '#111111'); return rgb(c.r, c.g, c.b); })(),
            opacity: element.opacity ?? 1,
          });
        });
      } else if (element.type === 'checkbox') {
        const size = element.fontSize || 16;
        const boxY = ph - (element.y * ph) - size;
        page.drawRectangle({
          x, y: boxY, width: size, height: size,
          borderColor: rgb(0.15, 0.18, 0.25), borderWidth: 1.2,
        });
        if (element.checked) {
          // วาดเครื่องหมายถูกด้วยเส้นตรง 2 เส้น แทนการใช้อักขระ
          // เพราะฟอนต์ที่ subset แล้วอาจไม่มีสัญลักษณ์ถูก และจะกลายเป็นช่องว่าง
          const tick = rgb(0.05, 0.42, 0.20);
          const thickness = Math.max(1.2, size * 0.13);
          page.drawLine({
            start: { x: x + size * 0.22, y: boxY + size * 0.52 },
            end: { x: x + size * 0.42, y: boxY + size * 0.26 },
            thickness, color: tick, lineCap: 1,
          });
          page.drawLine({
            start: { x: x + size * 0.42, y: boxY + size * 0.26 },
            end: { x: x + size * 0.80, y: boxY + size * 0.76 },
            thickness, color: tick, lineCap: 1,
          });
        }
      } else if (element.type === 'rect') {
        const colors = hexToRgbComponents(element.color || '#facc15');
        page.drawRectangle({
          x, y, width, height,
          color: rgb(colors.r, colors.g, colors.b),
          opacity: element.opacity ?? 0.35,
        });
      } else if (element.type === 'line') {
        const colors = hexToRgbComponents(element.color || '#111111');
        page.drawLine({
          start: { x, y: y + height },
          end: { x: x + width, y: y + height },
          thickness: element.thickness || 1.4,
          color: rgb(colors.r, colors.g, colors.b),
          opacity: element.opacity ?? 1,
        });
      }
      onProgress(((index + 1) / elements.length) * 92, `วางองค์ประกอบ ${index + 1}/${elements.length}`);
    }

    onProgress(96, 'กำลังสร้างไฟล์ผลลัพธ์');
    return { bytes: await savePdf(doc), warning: fontContext.warning };
  } catch (err) {
    throw toFriendlyError(err);
  }
}

/** เพิ่มบล็อกข้อมูลผู้เซ็นใต้ลายเซ็น (ชื่อ / วันที่ / ตำแหน่ง) */
export function buildSignatureBlock({ name, role, date, pageIndex, x, y, width, fontSize = 10 }) {
  const lines = [name, role, date].filter(Boolean);
  return lines.map((text, index) => ({
    type: 'text',
    pageIndex,
    x,
    y: y + (index * (fontSize * 1.5)) / 842,
    width,
    text,
    fontSize,
    color: '#334155',
  }));
}
