/**
 * Job API
 * - งานที่ประมวลผลบนเครื่องผู้ใช้: client แจ้ง start/complete เพื่อเก็บสถิติ ไม่มีการอัปโหลดไฟล์
 * - งานที่ต้องใช้ server: อัปโหลดไฟล์ชั่วคราว เข้าคิว แล้วดาวน์โหลดผลลัพธ์
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import config from '../config/index.js';
import { ok, asyncRoute, ApiError } from '../utils/http.js';
import { str, int, safeFilename } from '../utils/validate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireLineFriend } from '../middleware/auth.js';
import { detectType } from '../utils/fileSignature.js';
import { getSetting } from '../services/settings.js';
import * as jobs from '../services/jobs.js';
import { createShareLink } from '../services/share.js';
import { audit } from '../services/audit.js';
import { notifyJobQueued } from '../workers/queue.js';

const router = express.Router();

export const CLIENT_TOOLS = [
  'scan', 'merge', 'organize', 'split', 'compress', 'pdf-to-image', 'image-to-pdf',
  'image-compress', 'page-number', 'watermark', 'crop', 'sign', 'edit', 'rotate',
  'delete-pages', 'extract-pages', 'ocr-client',
];
const ALL_TOOLS = [...CLIENT_TOOLS, ...jobs.SERVER_TOOLS];

// เก็บไฟล์อัปโหลดลงดิสก์ชั่วคราว (ไม่เก็บใน RAM เพื่อรองรับไฟล์ใหญ่)
const uploadStorage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(config.storage.dir, 'tmp', req.session.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  },
});

// multer ต้องการเพดานคงที่ จึงตั้งเพดานแข็งไว้ที่ระดับ absolute
// แล้วบังคับค่าจริงจาก system_settings อีกชั้นใน handleServerJob (แก้ได้จากหน้า admin)
const HARD_UPLOAD_CAP_BYTES = 2048 * 1024 * 1024;
const uploadHandler = multer({
  storage: uploadStorage,
  limits: { fileSize: HARD_UPLOAD_CAP_BYTES, files: 30, fields: 40 },
}).array('files', 30);

/** เริ่มงานที่ประมวลผลบนเครื่องผู้ใช้ (นับสถิติ + ตรวจโควตา) */
router.post('/client/start', rateLimit('job'), asyncRoute(async (req, res) => {
  const tool = str(req.body?.tool, { name: 'เครื่องมือ', allow: ALL_TOOLS, required: true, max: 40 });
  const fileCount = int(req.body?.fileCount, { name: 'จำนวนไฟล์', min: 0, max: 500, fallback: 1 });
  const bytesIn = int(req.body?.bytesIn, { name: 'ขนาดข้อมูล', min: 0, max: 50 * 1024 ** 3, fallback: 0 });

  const maxFiles = req.user ? getSetting('USER_MAX_FILES') : getSetting('GUEST_MAX_FILES');
  if (fileCount > maxFiles) {
    throw new ApiError(400, 'TOO_MANY_FILES',
      `เลือกได้สูงสุด ${maxFiles} ไฟล์ต่อครั้ง${req.user ? '' : ' — เข้าสู่ระบบเพื่อเพิ่มจำนวนไฟล์'}`,
      { maxFiles });
  }

  const job = jobs.createJob({
    tool, mode: 'client', userId: req.user?.id, sessionId: req.session.id,
    userType: req.session.userType, params: req.body?.params || {}, fileCount, bytesIn,
  });
  return ok(res, { jobId: job.id, status: job.status, maxFiles });
}));

/** client แจ้งผลเมื่อประมวลผลบนเครื่องเสร็จ/ล้มเหลว */
router.post('/client/complete', asyncRoute(async (req, res) => {
  const jobId = str(req.body?.jobId, { name: 'jobId', required: true, max: 40 });
  const job = jobs.getJob(jobId);
  if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'ไม่พบงานที่ระบุ');
  if (job.session_id !== req.session.id && job.user_id !== req.user?.id) {
    throw new ApiError(403, 'FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึงงานนี้');
  }

  const status = str(req.body?.status, { name: 'สถานะ', allow: ['SUCCESS', 'FAILED', 'CANCELLED'], required: true, max: 20 });
  const updated = jobs.completeJob(jobId, {
    status,
    bytesOut: int(req.body?.bytesOut, { name: 'ขนาดผลลัพธ์', min: 0, max: 50 * 1024 ** 3, fallback: 0 }),
    processingMs: int(req.body?.processingMs, { name: 'เวลาที่ใช้', min: 0, max: 86400000, fallback: 0 }),
    errorCode: str(req.body?.errorCode, { name: 'errorCode', max: 40 }) || null,
    errorMessage: str(req.body?.message, { name: 'message', max: 300 }) || null,
    filename: safeFilename(req.body?.filename, ''),
    fileCount: req.body?.fileCount !== undefined
      ? int(req.body.fileCount, { name: 'จำนวนไฟล์', min: 0, max: 500, fallback: job.file_count })
      : null,
  });
  return ok(res, jobs.toPublicJob(updated));
}));

/** ส่งงานให้ server ประมวลผล (เฉพาะเครื่องมือที่ทำบน browser ไม่ได้) */
router.post('/server', requireLineFriend, rateLimit('job'), (req, res, next) => {
  uploadHandler(req, res, (err) => (err ? next(err) : handleServerJob(req, res, next)));
});

const handleServerJob = asyncRoute(async (req, res) => {
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => { try { fs.rmSync(f.path, { force: true }); } catch { /* ignore */ } });

  try {
    const tool = str(req.body?.tool, { name: 'เครื่องมือ', allow: [...jobs.SERVER_TOOLS], required: true, max: 40 });
    if (!files.length) throw new ApiError(400, 'NO_FILE', 'กรุณาเลือกไฟล์อย่างน้อย 1 ไฟล์');

    const maxBytes = getSetting('MAX_FILE_SIZE_MB') * 1024 * 1024;
    let bytesIn = 0;
    for (const file of files) {
      if (file.size > maxBytes) {
        throw new ApiError(413, 'FILE_TOO_LARGE', `ไฟล์ "${file.originalname}" ใหญ่เกิน ${getSetting('MAX_FILE_SIZE_MB')} MB`);
      }
      // ตรวจ magic number — ห้ามเชื่อ MIME จาก browser
      const head = Buffer.alloc(16);
      const fd = fs.openSync(file.path, 'r');
      fs.readSync(fd, head, 0, 16, 0);
      fs.closeSync(fd);
      const detected = detectType(head);
      const allowed = tool === 'ocr' ? ['pdf', 'png', 'jpg', 'webp'] : ['pdf'];
      if (!detected || !allowed.includes(detected.ext)) {
        throw new ApiError(415, 'UNSUPPORTED_FILE',
          `ไฟล์ "${file.originalname}" ไม่ใช่ชนิดที่รองรับสำหรับเครื่องมือนี้`);
      }
      file.detected = detected;
      bytesIn += file.size;
    }

    const params = {};
    for (const [key, value] of Object.entries(req.body || {})) {
      if (key === 'tool') continue;
      params[key] = typeof value === 'string' ? value.slice(0, 500) : value;
    }

    const job = jobs.createJob({
      tool, mode: 'server', userId: req.user?.id, sessionId: req.session.id,
      userType: req.session.userType, params, fileCount: files.length, bytesIn,
    });

    // ย้ายไฟล์เข้าโฟลเดอร์ของ job แล้วบันทึกลง DB
    const jobDir = jobs.jobStorageDir(job.id);
    fs.mkdirSync(jobDir, { recursive: true });
    for (const file of files) {
      const name = safeFilename(file.originalname, `input.${file.detected.ext}`);
      const dest = path.join(jobDir, `in-${path.basename(file.path)}-${name}`);
      fs.renameSync(file.path, dest);
      jobs.addJobFile({
        jobId: job.id, kind: 'input', filename: name,
        mime: file.detected.mime, sizeBytes: file.size, storagePath: dest,
      });
    }

    // เก็บความลับ (เช่น รหัสผ่าน PDF) ไว้ในหน่วยความจำของคิวเท่านั้น ไม่เขียนลง DB
    const secrets = {};
    if (req.body?.password) secrets.password = String(req.body.password);
    if (req.body?.ownerPassword) secrets.ownerPassword = String(req.body.ownerPassword);

    audit({
      actorId: req.user?.id, actorRef: req.user?.public_ref, action: 'job.submit',
      target: tool, result: 'queued', detail: { jobId: job.id, files: files.length },
    });
    notifyJobQueued(job.id, secrets);

    return ok(res, { ...jobs.toPublicJob(job), queue: jobs.queueDepth() }, 202);
  } catch (err) {
    cleanup();
    throw err;
  }
});

/** ติดตามสถานะงาน */
router.get('/:id', asyncRoute(async (req, res) => {
  const job = jobs.getJob(str(req.params.id, { name: 'jobId', max: 40, required: true }));
  if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'ไม่พบงานที่ระบุ หรืองานหมดอายุแล้ว');
  if (job.session_id !== req.session.id && job.user_id !== req.user?.id && req.user?.role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึงงานนี้');
  }
  return ok(res, jobs.toPublicJob(job, jobs.listJobFiles(job.id, 'output')));
}));

/** ยกเลิกงานและลบไฟล์ทันที (spec ข้อ 69) */
router.delete('/:id', asyncRoute(async (req, res) => {
  const job = jobs.getJob(str(req.params.id, { name: 'jobId', max: 40, required: true }));
  if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'ไม่พบงานที่ระบุ');
  if (job.session_id !== req.session.id && job.user_id !== req.user?.id && req.user?.role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึงงานนี้');
  }
  const cancelled = jobs.cancelJob(job.id);
  audit({ actorId: req.user?.id, action: 'job.cancel', target: job.id, result: 'success' });
  return ok(res, jobs.toPublicJob(cancelled));
}));

/** สร้างลิงก์แชร์ชั่วคราวของไฟล์ผลลัพธ์ */
router.post('/:id/share', asyncRoute(async (req, res) => {
  const job = jobs.getJob(str(req.params.id, { name: 'jobId', max: 40, required: true }));
  if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'ไม่พบงานที่ระบุ');
  if (job.session_id !== req.session.id && job.user_id !== req.user?.id) {
    throw new ApiError(403, 'FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึงงานนี้');
  }
  const fileId = str(req.body?.fileId, { name: 'fileId', required: true, max: 40 });
  const file = jobs.getJobFile(fileId);
  if (!file || file.job_id !== job.id) throw new ApiError(404, 'FILE_NOT_FOUND', 'ไม่พบไฟล์ผลลัพธ์');

  const link = createShareLink({ jobFileId: file.id, createdBy: req.user?.id || req.session.id, maxDownloads: 3 });
  audit({ actorId: req.user?.id, action: 'file.share', target: file.id, result: 'success' });
  return ok(res, link);
}));

export default router;
