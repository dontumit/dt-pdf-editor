/**
 * PDF -> Word (spec ข้อ 28)
 * ต้องทำฝั่ง server เพราะต้องประกอบโครงสร้างเอกสารใหม่
 *
 * ขั้นตอน:
 *   1) อ่านข้อความพร้อมพิกัดด้วย pdfjs-dist
 *   2) จัดกลุ่มเป็นบรรทัด -> ย่อหน้า จากพิกัด Y/X และขนาดฟอนต์
 *   3) ถ้าหน้าไหนไม่มีข้อความ (เป็นภาพสแกน) จะเรียก OCR ให้อัตโนมัติ
 *   4) สร้าง .docx ด้วย library docx
 */
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from '../../utils/http.js';
import { safeFilename } from '../../utils/validate.js';
import { getSetting } from '../../services/settings.js';
import { logger } from '../../utils/logger.js';

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/** จัดกลุ่ม text item เป็นบรรทัดตามพิกัด Y */
function groupIntoLines(items, tolerance = 3) {
  const lines = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const size = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12;

    let line = lines.find((l) => Math.abs(l.y - y) <= tolerance);
    if (!line) {
      line = { y, items: [], maxSize: size, minX: x };
      lines.push(line);
    }
    line.items.push({ x, text: item.str, size, fontName: item.fontName, width: item.width });
    line.maxSize = Math.max(line.maxSize, size);
    line.minX = Math.min(line.minX, x);
  }

  lines.sort((a, b) => b.y - a.y); // PDF นับ Y จากล่างขึ้นบน
  return lines.map((line) => {
    line.items.sort((a, b) => a.x - b.x);
    let text = '';
    let prev = null;
    for (const item of line.items) {
      if (prev) {
        const gap = item.x - (prev.x + (prev.width || 0));
        // เว้นวรรคเมื่อช่องว่างกว้างพอ — ภาษาไทยไม่มีเว้นวรรคระหว่างคำจึงใช้เกณฑ์กว้างกว่า
        if (gap > prev.size * 0.28) text += ' ';
      }
      text += item.text;
      prev = item;
    }
    return { y: line.y, x: line.minX, size: line.maxSize, text: text.replace(/\s+/g, ' ').trim(), fontName: line.items[0]?.fontName || '' };
  }).filter((l) => l.text);
}

/** รวมบรรทัดเป็นย่อหน้า และเดาระดับหัวข้อจากขนาดฟอนต์ */
function buildBlocks(lines) {
  if (!lines.length) return [];
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] || 12;

  const blocks = [];
  let current = null;
  let previousY = null;

  for (const line of lines) {
    const isHeading = line.size >= bodySize * 1.25;
    const gap = previousY === null ? 0 : previousY - line.y;
    const startsNewBlock = isHeading || !current || gap > line.size * 1.8;

    if (startsNewBlock) {
      if (current) blocks.push(current);
      current = {
        type: isHeading ? 'heading' : 'paragraph',
        level: isHeading ? (line.size >= bodySize * 1.6 ? 1 : 2) : 0,
        size: line.size,
        bold: /bold/i.test(line.fontName),
        text: line.text,
      };
    } else {
      current.text += `${current.text.endsWith('-') ? '' : ' '}${line.text}`;
    }
    previousY = line.y;
  }
  if (current) blocks.push(current);
  return blocks;
}

export default async function pdfToWord({ inputs, outDir, params, onProgress, job }) {
  const input = inputs[0];
  if (!input) throw new ApiError(400, 'NO_FILE', 'ไม่พบไฟล์ที่ต้องประมวลผล');

  onProgress(5, 'กำลังอ่านไฟล์ PDF');
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(input.storage_path));

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true,
    }).promise;
  } catch (err) {
    if (/password/i.test(err?.message || '')) {
      throw new ApiError(400, 'PDF_ENCRYPTED', 'ไฟล์นี้มีรหัสผ่าน กรุณาปลดล็อกก่อนแปลงเป็น Word');
    }
    throw new ApiError(400, 'PDF_INVALID', 'ไม่สามารถเปิดไฟล์ PDF ได้ ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ');
  }

  const maxPages = Math.min(doc.numPages, getSetting('MAX_PDF_PAGES'));
  if (doc.numPages > maxPages) {
    logger.warn('pdf-to-word truncated', { jobId: job.id, pages: doc.numPages, maxPages });
  }

  const pages = [];
  let scannedPages = 0;

  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    const lines = groupIntoLines(content.items);

    if (!lines.length) scannedPages += 1;
    pages.push({ pageNo, blocks: buildBlocks(lines), hasText: lines.length > 0 });
    page.cleanup();

    onProgress(5 + (pageNo / maxPages) * 65, `กำลังอ่านหน้า ${pageNo}/${maxPages}`);
  }

  // หน้าที่ไม่มีข้อความ = ไฟล์สแกน ต้องใช้ OCR
  if (scannedPages > 0 && String(params.ocr ?? 'auto') !== 'off') {
    onProgress(72, `พบ ${scannedPages} หน้าที่เป็นภาพสแกน กำลังทำ OCR`);
    try {
      const { ocrPdfPages } = await import('./ocr.js');
      const ocrResults = await ocrPdfPages({
        filePath: input.storage_path,
        pageNumbers: pages.filter((p) => !p.hasText).map((p) => p.pageNo),
        langs: String(params.langs || 'tha+eng'),
        onProgress: (ratio, stage) => onProgress(72 + ratio * 15, stage),
      });
      for (const result of ocrResults) {
        const target = pages.find((p) => p.pageNo === result.pageNo);
        if (target && result.text.trim()) {
          target.blocks = result.text.split(/\n{2,}/).map((chunk) => ({
            type: 'paragraph', level: 0, size: 12, bold: false, text: chunk.replace(/\s*\n\s*/g, ' ').trim(),
          })).filter((b) => b.text);
          target.viaOcr = true;
        }
      }
    } catch (err) {
      logger.warn('ocr fallback failed', { jobId: job.id, message: err.message });
    }
  }

  await doc.destroy();
  onProgress(88, 'กำลังสร้างไฟล์ Word');

  const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } = await import('docx');
  const children = [];

  pages.forEach((page, index) => {
    if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    if (!page.blocks.length) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `[หน้า ${page.pageNo}: ไม่พบข้อความที่อ่านได้]`, italics: true, color: '888888', font: 'Sarabun' })],
      }));
      return;
    }
    for (const block of page.blocks) {
      if (block.type === 'heading') {
        children.push(new Paragraph({
          heading: block.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
          children: [new TextRun({ text: block.text, bold: true, font: 'Sarabun', size: Math.round(block.size * 2) })],
        }));
      } else {
        children.push(new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: block.text, bold: block.bold, font: 'Sarabun', size: 28 })],
        }));
      }
    }
  });

  if (!children.length) {
    throw new ApiError(422, 'NO_TEXT_FOUND',
      'ไม่พบข้อความในไฟล์นี้ หากเป็นเอกสารสแกน กรุณาเปิดตัวเลือก OCR แล้วลองใหม่');
  }

  const wordDoc = new Document({
    creator: 'DT PDF Editor',
    description: 'แปลงจากไฟล์ PDF',
    styles: {
      default: {
        document: { run: { font: 'Sarabun', size: 28 } },
      },
    },
    sections: [{ properties: {}, children }],
  });

  const base = safeFilename(input.filename, 'document.pdf').replace(/\.pdf$/i, '');
  const outName = `${base}.docx`;
  const outPath = path.join(outDir, outName);
  fs.writeFileSync(outPath, await Packer.toBuffer(wordDoc));

  onProgress(98, 'เสร็จสิ้น');
  return {
    files: [{
      path: outPath,
      filename: outName,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }],
    meta: { pages: pages.length, ocrPages: pages.filter((p) => p.viaOcr).length },
  };
}
