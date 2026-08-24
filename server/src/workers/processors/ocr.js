/**
 * OCR ฝั่ง server (spec ข้อ 29) — รองรับภาษาไทยและอังกฤษ
 *
 * หมายเหตุสถาปัตยกรรม:
 *   OCR ภาษาไทยกินหน่วยความจำสูง ระบบจึงให้ตัวเลือก 2 ทาง
 *   1) OCR บนเครื่องผู้ใช้ (Tesseract.js ใน Web Worker) — ค่าเริ่มต้น เอกสารไม่ออกจากเครื่อง
 *   2) OCR บนเซิร์ฟเวอร์ (ไฟล์นี้) — สำหรับเครื่องที่แรงไม่พอ หรือไฟล์หลายร้อยหน้า
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../../config/index.js';
import { ApiError } from '../../utils/http.js';
import { safeFilename } from '../../utils/validate.js';
import { getSetting } from '../../services/settings.js';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

/** แปลงหน้า PDF เป็น PNG ด้วย pdftoppm (poppler-utils) */
async function renderPages(filePath, pageNumbers, dpi = 200) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtpdf-ocr-'));
  const outputs = [];
  for (const pageNo of pageNumbers) {
    const prefix = path.join(tmpDir, `page-${pageNo}`);
    try {
      await execFileAsync('pdftoppm', [
        '-png', '-r', String(dpi), '-f', String(pageNo), '-l', String(pageNo), filePath, prefix,
      ], { timeout: 60000 });
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new ApiError(503, 'POPPLER_UNAVAILABLE',
          'เซิร์ฟเวอร์ยังไม่ได้ติดตั้ง poppler-utils จึงทำ OCR จากไฟล์ PDF ไม่ได้');
      }
      throw err;
    }
    const produced = fs.readdirSync(tmpDir).filter((f) => f.startsWith(`page-${pageNo}`) && f.endsWith('.png'));
    if (produced.length) outputs.push({ pageNo, imagePath: path.join(tmpDir, produced[0]) });
  }
  return { tmpDir, outputs };
}

async function getWorker(langs) {
  let tesseract;
  try {
    tesseract = await import('tesseract.js');
  } catch {
    throw new ApiError(503, 'OCR_UNAVAILABLE',
      'เซิร์ฟเวอร์ยังไม่ได้ติดตั้งโมดูล OCR — กรุณาใช้ OCR บนเครื่องแทน');
  }
  return tesseract.createWorker(langs.split('+'), 1, { legacyCore: false, legacyLang: false });
}

/** OCR เฉพาะหน้าที่ระบุ — ใช้โดย pdfToWord ด้วย */
export async function ocrPdfPages({ filePath, pageNumbers, langs = 'tha+eng', onProgress = () => {} }) {
  if (!pageNumbers.length) return [];
  const { tmpDir, outputs } = await renderPages(filePath, pageNumbers);
  const worker = await getWorker(langs);
  const results = [];

  try {
    for (let i = 0; i < outputs.length; i += 1) {
      const { pageNo, imagePath } = outputs[i];
      const { data } = await worker.recognize(imagePath);
      results.push({ pageNo, text: data.text || '', confidence: data.confidence });
      onProgress((i + 1) / outputs.length, `OCR หน้า ${pageNo}`);
    }
  } finally {
    await worker.terminate().catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return results;
}

export default async function ocr({ inputs, outDir, params, onProgress, job }) {
  const input = inputs[0];
  if (!input) throw new ApiError(400, 'NO_FILE', 'ไม่พบไฟล์ที่ต้องประมวลผล');

  const langs = String(params.langs || config.ocrLangs || 'tha+eng')
    .split('+').filter((l) => ['tha', 'eng'].includes(l)).join('+') || 'tha+eng';
  const outputFormat = params.format === 'pdf' ? 'pdf' : 'txt';

  onProgress(8, 'กำลังเตรียมไฟล์');

  const isPdf = (input.mime || '').includes('pdf');
  let results;

  if (isPdf) {
    // หาจำนวนหน้าจาก pdfinfo หรือ default
    let pageCount = 1;
    try {
      const { stdout } = await execFileAsync('pdfinfo', [input.storage_path], { timeout: 15000 });
      const match = stdout.match(/Pages:\s+(\d+)/);
      if (match) pageCount = Number(match[1]);
    } catch { /* ใช้ค่าเริ่มต้น */ }

    const maxPages = Math.min(pageCount, getSetting('MAX_PDF_PAGES'), 100);
    const pageNumbers = Array.from({ length: maxPages }, (_, i) => i + 1);
    results = await ocrPdfPages({
      filePath: input.storage_path,
      pageNumbers,
      langs,
      onProgress: (ratio, stage) => onProgress(10 + ratio * 80, stage),
    });
  } else {
    const worker = await getWorker(langs);
    try {
      const { data } = await worker.recognize(input.storage_path);
      results = [{ pageNo: 1, text: data.text || '', confidence: data.confidence }];
      onProgress(90, 'อ่านข้อความเสร็จแล้ว');
    } finally {
      await worker.terminate().catch(() => {});
    }
  }

  const text = results.map((r) => `--- หน้า ${r.pageNo} ---\n${r.text.trim()}`).join('\n\n');
  if (!text.replace(/---.*---/g, '').trim()) {
    throw new ApiError(422, 'NO_TEXT_FOUND', 'ไม่พบข้อความในไฟล์นี้ ลองเพิ่มความคมชัดของภาพแล้วสแกนใหม่');
  }

  const base = safeFilename(input.filename, 'document').replace(/\.[^.]+$/, '');
  const files = [];

  if (outputFormat === 'txt') {
    const outPath = path.join(outDir, `${base}_ocr.txt`);
    fs.writeFileSync(outPath, text, 'utf8');
    files.push({ path: outPath, filename: `${base}_ocr.txt`, mime: 'text/plain; charset=utf-8' });
  } else {
    const { Document, Packer, Paragraph, TextRun } = await import('docx');
    const doc = new Document({
      creator: 'DT PDF Editor',
      sections: [{
        children: results.flatMap((r) => [
          new Paragraph({ children: [new TextRun({ text: `หน้า ${r.pageNo}`, bold: true, font: 'Sarabun' })] }),
          ...r.text.split(/\n/).filter(Boolean).map((lineText) => new Paragraph({
            children: [new TextRun({ text: lineText, font: 'Sarabun', size: 28 })],
          })),
        ]),
      }],
    });
    const outPath = path.join(outDir, `${base}_ocr.docx`);
    fs.writeFileSync(outPath, await Packer.toBuffer(doc));
    files.push({
      path: outPath, filename: `${base}_ocr.docx`,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  const avgConfidence = results.reduce((sum, r) => sum + (r.confidence || 0), 0) / results.length;
  logger.info('ocr finished', { jobId: job.id, pages: results.length, confidence: Math.round(avgConfidence) });

  onProgress(98, 'เสร็จสิ้น');
  return { files, meta: { pages: results.length, confidence: avgConfidence } };
}
