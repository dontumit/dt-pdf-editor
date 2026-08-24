/**
 * บีบอัด PDF ฝั่ง server ด้วย Ghostscript (คงข้อความไว้ — ต่างจากการ rasterize บน browser)
 * ใช้เมื่อไฟล์ใหญ่เกินกำลัง browser หรือผู้ใช้ต้องการคุณภาพสูงสุด
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../../config/index.js';
import { ApiError } from '../../utils/http.js';
import { safeFilename } from '../../utils/validate.js';

const execFileAsync = promisify(execFile);

const PRESETS = {
  low: { setting: '/prepress', dpi: 300 },
  medium: { setting: '/ebook', dpi: 150 },
  high: { setting: '/screen', dpi: 96 },
};

export default async function pdfCompress({ inputs, outDir, params, onProgress }) {
  const input = inputs[0];
  if (!input) throw new ApiError(400, 'NO_FILE', 'ไม่พบไฟล์ที่ต้องประมวลผล');

  const preset = PRESETS[params.level] || PRESETS.medium;
  const base = safeFilename(input.filename, 'document.pdf').replace(/\.pdf$/i, '');
  const outName = `${base}_compressed.pdf`;
  const outPath = path.join(outDir, outName);

  onProgress(15, 'กำลังบีบอัดไฟล์');

  try {
    await execFileAsync(config.bin.ghostscript, [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.7',
      `-dPDFSETTINGS=${preset.setting}`,
      '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dSAFER',
      '-dDetectDuplicateImages=true',
      '-dCompressFonts=true',
      '-dSubsetFonts=true',
      '-dColorImageDownsampleType=/Bicubic',
      `-dColorImageResolution=${preset.dpi}`,
      '-dGrayImageDownsampleType=/Bicubic',
      `-dGrayImageResolution=${preset.dpi}`,
      '-dMonoImageDownsampleType=/Subsample',
      `-dMonoImageResolution=${Math.max(preset.dpi * 2, 300)}`,
      `-sOutputFile=${outPath}`,
      input.storage_path,
    ], { timeout: 150000, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new ApiError(503, 'GHOSTSCRIPT_UNAVAILABLE',
        'เซิร์ฟเวอร์ยังไม่ได้ติดตั้ง Ghostscript — กรุณาใช้การบีบอัดบนเครื่องแทน');
    }
    throw new ApiError(500, 'PROCESSING_FAILED', 'บีบอัดไฟล์ไม่สำเร็จ ไฟล์อาจเสียหาย');
  }

  onProgress(90, 'ตรวจสอบผลลัพธ์');
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new ApiError(500, 'PROCESSING_FAILED', 'บีบอัดไฟล์ไม่สำเร็จ');
  }

  // ถ้าบีบแล้วใหญ่กว่าเดิม ให้คืนไฟล์ต้นฉบับแทน
  const originalSize = fs.statSync(input.storage_path).size;
  if (fs.statSync(outPath).size >= originalSize) {
    fs.copyFileSync(input.storage_path, outPath);
  }

  return { files: [{ path: outPath, filename: outName, mime: 'application/pdf' }] };
}
