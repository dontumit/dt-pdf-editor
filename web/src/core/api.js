/**
 * ตัวห่อ fetch สำหรับเรียก API
 * - แนบ CSRF token อัตโนมัติ
 * - แปลง error ให้เป็นข้อความภาษาไทยที่ผู้ใช้เข้าใจได้เสมอ
 * - มี timeout เพื่อไม่ให้ UI ค้างเมื่อเน็ตช้า
 */
import { bootstrap } from './bootstrap.js';

export class ApiError extends Error {
  constructor(message, { status = 0, errorCode = 'UNKNOWN', data = {} } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errorCode = errorCode;
    this.data = data;
  }
}

function readCsrfCookie() {
  const match = document.cookie.match(/(?:^|;\s*)dtpdf_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : bootstrap.csrfToken || '';
}

async function request(method, path, { body, formData, timeout = 30000, signal, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  const init = {
    method,
    credentials: 'same-origin',
    signal: controller.signal,
    headers: { Accept: 'application/json', ...headers },
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.headers['X-CSRF-Token'] = readCsrfCookie();
  }
  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new ApiError('การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง', { errorCode: 'TIMEOUT' });
    }
    throw new ApiError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต', { errorCode: 'NETWORK_ERROR' });
  }
  clearTimeout(timer);

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError('ระบบขัดข้องชั่วคราว กรุณาลองใหม่', { status: response.status, errorCode: 'BAD_RESPONSE' });
    }
    return response;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new ApiError(data.message || 'ดำเนินการไม่สำเร็จ', {
      status: response.status,
      errorCode: data.errorCode || 'REQUEST_FAILED',
      data,
    });
  }
  return data;
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  put: (path, body, options) => request('PUT', path, { ...options, body }),
  del: (path, options) => request('DELETE', path, options),
  upload: (path, formData, options) => request('POST', path, { ...options, formData, timeout: 300000 }),
  /**
   * ส่งข้อมูลสถิติแบบ fire-and-forget ไม่ทำให้ UI ค้าง และไม่โยน error
   * ใช้ fetch + keepalive แทน navigator.sendBeacon เพราะ sendBeacon
   * แนบ header เองไม่ได้ คำขอจึงไม่ผ่านการตรวจ CSRF ของเซิร์ฟเวอร์
   */
  beacon(path, payload) {
    try {
      fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': readCsrfCookie() },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch { /* สถิติล้มเหลวไม่ควรกระทบผู้ใช้ */ }
  },
};

export default api;
