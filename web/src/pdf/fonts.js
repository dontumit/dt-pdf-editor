/**
 * ฝังฟอนต์ไทยลงไฟล์ PDF (spec ข้อ 66)
 *
 * pdf-lib รองรับเฉพาะ WinAnsi ในฟอนต์มาตรฐาน ถ้าไม่ฝังฟอนต์จริง
 * ข้อความภาษาไทยจะกลายเป็นกล่องว่างหรือทำให้ไลบรารีโยน error
 * ระบบจึงโหลด Sarabun (สัญญาอนุญาต SIL OFL) แล้วฝังแบบ subset
 * เพื่อให้ไฟล์ผลลัพธ์ไม่ใหญ่เกินจำเป็น
 */
import { loadFontkit, loadPdfLib } from './loader.js';

const FONT_FILES = {
  regular: '/assets/fonts/Sarabun-Regular.ttf',
  bold: '/assets/fonts/Sarabun-Bold.ttf',
};

const cache = new Map();

async function fetchFontBytes(variant) {
  if (cache.has(variant)) return cache.get(variant);
  const promise = fetch(FONT_FILES[variant])
    .then((res) => {
      if (!res.ok) throw new Error('ไม่พบไฟล์ฟอนต์ไทยบนเซิร์ฟเวอร์');
      return res.arrayBuffer();
    })
    .catch((err) => { cache.delete(variant); throw err; });
  cache.set(variant, promise);
  return promise;
}

// อักขระที่อยู่นอกช่วง Latin-1 (เช่น ภาษาไทย) ต้องใช้ฟอนต์ที่ฝังเท่านั้น
const NON_LATIN1 = /[^\u0000-\u00ff]/;

/** true เมื่อข้อความมีอักขระที่ฟอนต์มาตรฐานวาดไม่ได้ */
export function needsUnicodeFont(text) {
  return NON_LATIN1.test(String(text || ''));
}

/**
 * ฝังฟอนต์ลงเอกสาร พร้อม fallback เป็นฟอนต์มาตรฐานถ้าโหลดฟอนต์ไทยไม่สำเร็จ
 * @returns {Promise<{font: object, isUnicode: boolean, warning: string|null}>}
 */
export async function embedTextFont(pdfDoc, { bold = false, requireUnicode = true } = {}) {
  const { StandardFonts } = await loadPdfLib();

  if (!requireUnicode) {
    const font = await pdfDoc.embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
    return { font, isUnicode: false, warning: null };
  }

  try {
    const fontkit = await loadFontkit();
    pdfDoc.registerFontkit(fontkit);
    const bytes = await fetchFontBytes(bold ? 'bold' : 'regular');
    const font = await pdfDoc.embedFont(bytes, { subset: true });
    return { font, isUnicode: true, warning: null };
  } catch {
    const font = await pdfDoc.embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
    return {
      font,
      isUnicode: false,
      warning: 'โหลดฟอนต์ไทยไม่สำเร็จ ข้อความภาษาไทยอาจแสดงไม่ถูกต้อง',
    };
  }
}

/** แทนที่อักขระที่ฟอนต์มาตรฐานวาดไม่ได้ เพื่อไม่ให้ pdf-lib โยน error */
export function sanitizeForStandardFont(text) {
  return String(text || '').replace(new RegExp(NON_LATIN1.source, 'g'), '?');
}

/** เตรียมข้อความให้ปลอดภัยกับฟอนต์ที่กำลังใช้อยู่ */
export function prepareText(text, isUnicode) {
  return isUnicode ? String(text || '') : sanitizeForStandardFont(text);
}

/** ตัดข้อความให้พอดีความกว้างที่กำหนด แล้วเติมจุดไข่ปลา */
export function fitText(text, font, size, maxWidth) {
  let value = String(text || '');
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  while (value.length > 1 && font.widthOfTextAtSize(`${value}…`, size) > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

/**
 * ตัดข้อความเป็นหลายบรรทัดตามความกว้างที่กำหนด
 * ภาษาไทยไม่มีช่องว่างระหว่างคำ จึงตัดทีละอักขระเมื่อไม่พบช่องว่าง
 */
export function wrapText(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of String(text || '').split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let current = '';
    const tokens = paragraph.includes(' ') ? paragraph.split(/(\s+)/) : Array.from(paragraph);
    for (const token of tokens) {
      const candidate = current + token;
      if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current.trimEnd());
        current = token.trimStart();
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}
