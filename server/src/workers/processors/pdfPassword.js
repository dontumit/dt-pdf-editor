/**
 * ใส่รหัสผ่าน / ปลดรหัสผ่าน PDF (spec ข้อ 24)
 * ใช้ qpdf เพราะ pdf-lib ฝั่ง browser ยังเข้ารหัส PDF ไม่ได้
 * รหัสผ่านส่งผ่าน stdin ของ qpdf เท่านั้น — ไม่ปรากฏใน process list, ไม่ถูกบันทึกลง DB/log
 */
import path from 'node:path';
import { execFile } from 'node:child_process';
import config from '../../config/index.js';
import { ApiError } from '../../utils/http.js';
import { safeFilename } from '../../utils/validate.js';

function runQpdf(args, { passwords = [], timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(config.bin.qpdf, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // qpdf คืน exit code 3 เมื่อสำเร็จแต่มีคำเตือน — ถือว่าใช้ได้
        if (err && err.code !== 3) {
          reject(Object.assign(err, { stderr: String(stderr || '') }));
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    if (passwords.length) {
      child.stdin.write(passwords.join('\n'));
    }
    child.stdin.end();
  });
}

export default async function pdfPassword({ inputs, outDir, params, secrets, mode, onProgress }) {
  const input = inputs[0];
  if (!input) throw new ApiError(400, 'NO_FILE', 'ไม่พบไฟล์ที่ต้องประมวลผล');

  onProgress(10, mode === 'protect' ? 'กำลังใส่รหัสผ่าน' : 'กำลังปลดล็อกไฟล์');

  const base = safeFilename(input.filename, 'document.pdf').replace(/\.pdf$/i, '');
  const outName = mode === 'protect' ? `${base}_protected.pdf` : `${base}_unlocked.pdf`;
  const outPath = path.join(outDir, outName);

  try {
    if (mode === 'protect') {
      const userPassword = String(secrets.password || '');
      const ownerPassword = String(secrets.ownerPassword || userPassword);
      if (!userPassword) throw new ApiError(400, 'PASSWORD_REQUIRED', 'กรุณากำหนดรหัสผ่าน');
      if (userPassword.length < 4) throw new ApiError(400, 'PASSWORD_TOO_SHORT', 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร');

      // สิทธิ์การใช้งานตามที่ผู้ใช้เลือก
      const allow = (key, fallback = 'y') => (params[key] === undefined ? fallback : (params[key] === 'true' || params[key] === true ? 'y' : 'n'));
      const args = [
        '--encrypt', '@-', '@-', '256',
        `--print=${allow('allowPrint') === 'y' ? 'full' : 'none'}`,
        `--modify=${allow('allowEdit', 'n') === 'y' ? 'all' : 'none'}`,
        `--extract=${allow('allowCopy')}`,
        `--annotate=${allow('allowAnnotate')}`,
        '--', input.storage_path, outPath,
      ];
      await runQpdf(args, { passwords: [userPassword, ownerPassword] });
    } else {
      const password = String(secrets.password || '');
      const args = ['--password=@-', '--decrypt', '--', input.storage_path, outPath];
      await runQpdf(args, { passwords: [password] });
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const stderr = String(err.stderr || err.message || '');
    if (/invalid password|password.*incorrect/i.test(stderr)) {
      throw new ApiError(400, 'WRONG_PASSWORD', 'รหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่');
    }
    if (/ENOENT/.test(stderr) || err.code === 'ENOENT') {
      throw new ApiError(503, 'QPDF_UNAVAILABLE', 'เซิร์ฟเวอร์ยังไม่ได้ติดตั้ง qpdf จึงใช้เครื่องมือนี้ไม่ได้');
    }
    if (/damaged|not a pdf|unable to find/i.test(stderr)) {
      throw new ApiError(400, 'PDF_INVALID', 'ไฟล์ PDF เสียหายหรือมีรูปแบบที่ไม่รองรับ');
    }
    throw new ApiError(500, 'PROCESSING_FAILED', 'ประมวลผลไฟล์ไม่สำเร็จ');
  }

  onProgress(95, 'เสร็จสิ้น');
  return { files: [{ path: outPath, filename: outName, mime: 'application/pdf' }] };
}
