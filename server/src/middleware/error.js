import { ApiError } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

export function notFound(req, res) {
  res.status(404).json({
    success: false,
    errorCode: 'NOT_FOUND',
    message: 'ไม่พบเส้นทางที่ร้องขอ',
  });
}

/** แปลง error ทุกชนิดเป็น response มาตรฐาน และไม่รั่ว stack trace ออกไป */
export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false, errorCode: err.errorCode, message: err.message, ...err.extra,
    });
  }
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      errorCode: 'FILE_TOO_LARGE',
      message: `ไฟล์มีขนาดใหญ่เกินกำหนด (สูงสุด ${config.limits.maxFileSizeMb} MB)`,
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, errorCode: 'BAD_JSON', message: 'รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง' });
  }

  logger.error('unhandled error', { path: req.path, method: req.method, message: err?.message, stack: err?.stack });
  return res.status(500).json({
    success: false,
    errorCode: 'INTERNAL_ERROR',
    message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
  });
}
