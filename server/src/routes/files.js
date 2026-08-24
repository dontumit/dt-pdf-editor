/**
 * ดาวน์โหลดไฟล์ผลลัพธ์ของงานฝั่ง server
 * ไฟล์เป็น temporary เสมอ — หมดอายุตาม TTL และถูกลบโดย cleanup worker
 */
import express from 'express';
import fs from 'node:fs';
import { ok, asyncRoute, ApiError } from '../utils/http.js';
import { str, bool } from '../utils/validate.js';
import * as jobs from '../services/jobs.js';
import { consumeShareLink } from '../services/share.js';
import { audit } from '../services/audit.js';

const router = express.Router();

function sendFile(res, file, { asAttachment = true } = {}) {
  if (!fs.existsSync(file.storage_path)) {
    throw new ApiError(410, 'FILE_EXPIRED', 'ไฟล์ถูกลบไปแล้วตามนโยบายความปลอดภัย กรุณาประมวลผลใหม่');
  }
  const stat = fs.statSync(file.storage_path);
  res.setHeader('Content-Type', file.mime || 'application/octet-stream');
  res.setHeader('Content-Length', String(stat.size));
  // ห้าม cache ไฟล์ของผู้ใช้เด็ดขาด (spec ข้อ 33, 97)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const encoded = encodeURIComponent(file.filename);
  res.setHeader(
    'Content-Disposition',
    `${asAttachment ? 'attachment' : 'inline'}; filename="${file.filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encoded}`,
  );
  fs.createReadStream(file.storage_path).pipe(res);
}

/** ดาวน์โหลดโดยเจ้าของงาน */
router.get('/:fileId', asyncRoute(async (req, res) => {
  const file = jobs.getJobFile(str(req.params.fileId, { name: 'fileId', required: true, max: 40 }));
  if (!file) throw new ApiError(404, 'FILE_NOT_FOUND', 'ไม่พบไฟล์ หรือไฟล์หมดอายุแล้ว');
  if (file.expires_at < Date.now()) throw new ApiError(410, 'FILE_EXPIRED', 'ไฟล์หมดอายุแล้ว กรุณาประมวลผลใหม่');

  const job = jobs.getJob(file.job_id);
  if (!job || (job.session_id !== req.session.id && job.user_id !== req.user?.id && req.user?.role !== 'admin')) {
    throw new ApiError(403, 'FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึงไฟล์นี้');
  }
  audit({ actorId: req.user?.id, action: 'file.download', target: file.id, result: 'success' });
  return sendFile(res, file, { asAttachment: !bool(req.query.inline) });
}));

/** ลบไฟล์ทันทีหลังดาวน์โหลดเสร็จ (spec ข้อ 72) */
router.delete('/job/:jobId', asyncRoute(async (req, res) => {
  const job = jobs.getJob(str(req.params.jobId, { name: 'jobId', required: true, max: 40 }));
  if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'ไม่พบงานที่ระบุ');
  if (job.session_id !== req.session.id && job.user_id !== req.user?.id) {
    throw new ApiError(403, 'FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึงงานนี้');
  }
  const result = jobs.deleteJobFiles(job.id);
  return ok(res, { removed: result.count, freedBytes: result.freed });
}));

export const shareRouter = express.Router();

/** ลิงก์แชร์สาธารณะแบบมีอายุ /s/:token */
shareRouter.get('/:token', asyncRoute(async (req, res) => {
  const token = str(req.params.token, { name: 'token', required: true, max: 120 });
  const result = consumeShareLink(token);
  const messages = {
    SHARE_NOT_FOUND: 'ไม่พบลิงก์นี้',
    SHARE_REVOKED: 'ลิงก์นี้ถูกยกเลิกแล้ว',
    SHARE_EXPIRED: 'ลิงก์หมดอายุแล้ว',
    SHARE_LIMIT_REACHED: 'ลิงก์นี้ถูกใช้ครบจำนวนครั้งที่กำหนดแล้ว',
    FILE_EXPIRED: 'ไฟล์ถูกลบไปแล้วตามนโยบายความปลอดภัย',
  };
  if (result.error) throw new ApiError(410, result.error, messages[result.error] || 'ลิงก์ใช้งานไม่ได้');
  audit({ action: 'file.share_download', target: result.file.id, result: 'success' });
  return sendFile(res, result.file);
}));

export default router;
