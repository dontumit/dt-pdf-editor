/** รูปแบบ response มาตรฐานของ API (spec ข้อ 77) */
export function ok(res, payload = {}, status = 200) {
  return res.status(status).json({ success: true, ...payload });
}

export function fail(res, status, errorCode, message, extra = {}) {
  return res.status(status).json({ success: false, errorCode, message, ...extra });
}

/** ครอบ async handler ให้ error ไหลไป error middleware เสมอ */
export const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export class ApiError extends Error {
  constructor(status, errorCode, message, extra = {}) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.extra = extra;
  }
}
