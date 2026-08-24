/**
 * Queue + Worker (spec ข้อ 52, 36)
 * ใช้ SQLite เป็น queue เพื่อไม่ต้องพึ่ง Redis ในการติดตั้งพื้นฐาน
 * โครงสร้าง processor แยกเป็นโมดูล — ย้ายไป BullMQ/Redis ได้โดยไม่ต้องแก้ processor
 */
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/index.js';
import * as jobs from '../services/jobs.js';
import { getSetting } from '../services/settings.js';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/http.js';

import pdfToWord from './processors/pdfToWord.js';
import ocr from './processors/ocr.js';
import pdfPassword from './processors/pdfPassword.js';
import pdfCompress from './processors/pdfCompress.js';

const PROCESSORS = {
  'pdf-to-word': pdfToWord,
  ocr,
  'pdf-protect': (ctx) => pdfPassword({ ...ctx, mode: 'protect' }),
  'pdf-unlock': (ctx) => pdfPassword({ ...ctx, mode: 'unlock' }),
  'pdf-compress-server': pdfCompress,
};

/**
 * ความลับของงาน (เช่น รหัสผ่าน PDF) เก็บในหน่วยความจำเท่านั้น
 * ไม่เขียนลงฐานข้อมูล ไม่เขียนลง log และถูกลบทิ้งเมื่องานจบ (spec ข้อ 113)
 */
const jobSecrets = new Map();
const cancelledJobs = new Set();

let running = false;
let timer = null;
let wakeUp = null;

export function notifyJobQueued(jobId, secrets = {}) {
  if (secrets && Object.keys(secrets).length) jobSecrets.set(jobId, secrets);
  if (wakeUp) wakeUp();
}

export function markCancelled(jobId) {
  cancelledJobs.add(jobId);
  jobSecrets.delete(jobId);
}

function progressReporter(jobId) {
  let last = 0;
  return (progress, stage) => {
    if (cancelledJobs.has(jobId)) throw new ApiError(499, 'CANCELLED', 'งานถูกยกเลิก');
    const value = Math.max(0, Math.min(99, Math.round(progress)));
    // เขียน DB เฉพาะเมื่อเปลี่ยนอย่างมีนัยสำคัญ ลด write ที่ไม่จำเป็น
    if (value - last >= 2 || stage) {
      last = value;
      jobs.updateJob(jobId, { progress: value, ...(stage ? { stage } : {}) });
    }
  };
}

async function runJob(job) {
  const processor = PROCESSORS[job.tool];
  const started = Date.now();

  if (!processor) {
    jobs.completeJob(job.id, {
      status: jobs.JOB_STATUS.FAILED,
      errorCode: 'TOOL_NOT_SUPPORTED',
      errorMessage: 'ยังไม่รองรับเครื่องมือนี้บนเซิร์ฟเวอร์',
    });
    return;
  }

  const timeoutMs = getSetting('PROCESSING_TIMEOUT_SECONDS') * 1000;
  const inputs = jobs.listJobFiles(job.id, 'input');
  const outDir = path.join(jobs.jobStorageDir(job.id), 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const context = {
    job,
    params: JSON.parse(job.params_json || '{}'),
    secrets: jobSecrets.get(job.id) || {},
    inputs,
    outDir,
    onProgress: progressReporter(job.id),
    signal: null,
  };

  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new ApiError(504, 'PROCESSING_TIMEOUT',
        'ประมวลผลนานเกินกำหนด ระบบยกเลิกงานเพื่อรักษาเสถียรภาพ กรุณาลดขนาดไฟล์แล้วลองใหม่')),
      timeoutMs,
    );
  });

  try {
    const result = await Promise.race([processor(context), timeout]);
    const outputs = Array.isArray(result?.files) ? result.files : [];
    let bytesOut = 0;
    for (const file of outputs) {
      const size = fs.statSync(file.path).size;
      bytesOut += size;
      jobs.addJobFile({
        jobId: job.id, kind: 'output', filename: file.filename,
        mime: file.mime, sizeBytes: size, storagePath: file.path,
      });
    }
    jobs.completeJob(job.id, {
      status: jobs.JOB_STATUS.SUCCESS,
      bytesOut,
      processingMs: Date.now() - started,
      filename: outputs[0]?.filename || null,
      fileCount: outputs.length || job.file_count,
    });
    logger.info('job completed', { jobId: job.id, tool: job.tool, ms: Date.now() - started, outputs: outputs.length });
  } catch (err) {
    const cancelled = cancelledJobs.has(job.id) || err.errorCode === 'CANCELLED';
    jobs.completeJob(job.id, {
      status: cancelled ? jobs.JOB_STATUS.CANCELLED : jobs.JOB_STATUS.FAILED,
      processingMs: Date.now() - started,
      errorCode: err.errorCode || 'PROCESSING_FAILED',
      errorMessage: err.message || 'ประมวลผลไม่สำเร็จ',
    });
    logger.warn('job failed', { jobId: job.id, tool: job.tool, code: err.errorCode, message: err.message });
    // งานล้มเหลว: ลบไฟล์ทันที ไม่เก็บไว้บนเซิร์ฟเวอร์
    jobs.deleteJobFiles(job.id);
  } finally {
    clearTimeout(timeoutHandle);
    jobSecrets.delete(job.id);
    cancelledJobs.delete(job.id);
    // ลบไฟล์ input เสมอเมื่องานจบ — เก็บเฉพาะ output ตาม TTL
    for (const input of inputs) {
      try { fs.rmSync(input.storage_path, { force: true }); } catch { /* ignore */ }
      // mark ว่าถูกลบแล้วเพื่อไม่ให้ cleanup นับซ้ำ
    }
  }
}

async function tick() {
  if (!running) return;
  let processed = 0;
  try {
    let job = jobs.claimNextJob();
    while (job && running) {
      await runJob(job);
      processed += 1;
      job = jobs.claimNextJob();
    }
  } catch (err) {
    logger.error('queue tick error', { message: err.message });
  }
  return processed;
}

/** เริ่ม worker ในโปรเซสเดียวกับ API (เหมาะกับการติดตั้งขนาดเล็ก) */
export function startQueue({ intervalMs = 2000 } = {}) {
  if (running) return;
  running = true;
  const loop = async () => {
    await tick();
    if (running) timer = setTimeout(loop, intervalMs);
  };
  wakeUp = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    setImmediate(loop);
  };
  timer = setTimeout(loop, 500);
  if (timer.unref) timer.unref();
  logger.info('job queue worker started');
}

export function stopQueue() {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  wakeUp = null;
}

/**
 * กู้สถานะงานค้างเมื่อ server รีสตาร์ทกลางคัน
 * งานที่ค้างสถานะ PROCESSING จะถูกส่งกลับเข้าคิว หรือทำเครื่องหมายล้มเหลวถ้าลองมาหลายครั้งแล้ว
 */
export function recoverStuckJobs() {
  const stuck = db.all(
    "SELECT id, attempts FROM jobs WHERE status = 'PROCESSING' AND mode = 'server'",
  );
  let requeued = 0;
  let failed = 0;
  for (const row of stuck) {
    if (row.attempts >= 2) {
      jobs.completeJob(row.id, {
        status: jobs.JOB_STATUS.FAILED,
        errorCode: 'WORKER_RESTARTED',
        errorMessage: 'ระบบรีสตาร์ทระหว่างประมวลผล กรุณาส่งงานใหม่',
      });
      jobs.deleteJobFiles(row.id);
      failed += 1;
    } else {
      jobs.updateJob(row.id, { status: jobs.JOB_STATUS.WAITING, progress: 0, stage: 'รอเข้าคิวอีกครั้ง' });
      requeued += 1;
    }
  }
  if (requeued || failed) logger.info('recovered stuck jobs', { requeued, failed });
  return { requeued, failed };
}
