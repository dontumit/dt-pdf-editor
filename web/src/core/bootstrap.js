/** ค่าที่เซิร์ฟเวอร์ฉีดมาให้ตอนเสิร์ฟ HTML — ทำให้หน้าแรกไม่ต้องรอเรียก API */
const raw = window.__DTPDF_BOOTSTRAP__ || {};

export const bootstrap = {
  appName: raw.appName || 'DT PDF Editor',
  orgName: raw.orgName || '',
  creditText: raw.creditText || '',
  cacheVersion: raw.cacheVersion || '1.0.0',
  csrfToken: raw.csrfToken || '',
  liffId: raw.liffId || '',
  lineEnabled: Boolean(raw.lineEnabled),
  requireFriend: Boolean(raw.requireFriend),
  addFriendUrl: raw.addFriendUrl || '',
  heartbeatInterval: Number(raw.heartbeatInterval) || 25,
  maxFileSizeMb: Number(raw.maxFileSizeMb) || 100,
  maxPdfPages: Number(raw.maxPdfPages) || 500,
  announcement: raw.announcement || '',
};

export default bootstrap;
