/**
 * LINE LIFF integration (spec ข้อ 10, 11, 81)
 * โหลด SDK เฉพาะเมื่อเปิดจากภายในแอป LINE เท่านั้น
 */
import api from '../core/api.js';
import appState from '../core/state.js';
import bootstrap from '../core/bootstrap.js';

let liffPromise = null;

const inLineClient = () => /Line\//i.test(navigator.userAgent) || new URLSearchParams(location.search).has('liff.state');

function loadLiffSdk() {
  if (liffPromise) return liffPromise;
  liffPromise = new Promise((resolve, reject) => {
    if (window.liff) { resolve(window.liff); return; }
    const script = document.createElement('script');
    script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
    script.onload = () => resolve(window.liff);
    script.onerror = () => { liffPromise = null; reject(new Error('โหลด LINE SDK ไม่สำเร็จ')); };
    document.head.appendChild(script);
  });
  return liffPromise;
}

/**
 * เริ่มต้น LIFF ถ้าเปิดจาก LINE
 * @returns {Promise<{isLiff: boolean, loggedIn?: boolean, requiresFriend?: boolean}>}
 */
export async function initLiff() {
  if (!bootstrap.liffId || !inLineClient()) return { isLiff: false };

  try {
    const liff = await loadLiffSdk();
    await liff.init({ liffId: bootstrap.liffId });
    appState.set({ isLiff: true });

    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: location.href });
      return { isLiff: true, loggedIn: false };
    }

    const accessToken = liff.getAccessToken();
    if (!accessToken) return { isLiff: true, loggedIn: false };

    const res = await api.post('/api/auth/line/liff', { accessToken });
    appState.set({
      user: res.user,
      authenticated: true,
      userType: 'line',
      requiresFriend: Boolean(res.requiresFriend),
      addFriendUrl: res.addFriendUrl || bootstrap.addFriendUrl,
    });
    return { isLiff: true, loggedIn: true, requiresFriend: Boolean(res.requiresFriend) };
  } catch (err) {
    console.warn('liff init failed', err);
    return { isLiff: false, error: err.message };
  }
}

/** ตรวจสถานะเพิ่มเพื่อนอีกครั้ง หลังผู้ใช้กดปุ่ม "เพิ่มเพื่อนแล้ว" */
export async function recheckFriendship() {
  let accessToken = null;
  try {
    const liff = window.liff;
    if (liff?.isLoggedIn?.()) accessToken = liff.getAccessToken();
  } catch { /* ไม่ได้อยู่ใน LINE */ }

  const res = await api.post('/api/auth/line/refresh-friend', { accessToken });
  appState.set({ requiresFriend: !res.isFriend });
  return res;
}

/** แชร์ไฟล์ผ่าน LINE ด้วยลิงก์ชั่วคราว (spec ข้อ 82) */
export async function shareToLine({ url, title = 'ไฟล์จาก DT PDF Editor', text = '' }) {
  const message = [{
    type: 'text',
    text: `${title}\n${text ? `${text}\n` : ''}${url}\n\n(ลิงก์นี้มีอายุจำกัดและจะหมดอายุอัตโนมัติ)`,
  }];

  try {
    const liff = window.liff;
    if (liff?.isApiAvailable?.('shareTargetPicker')) {
      const result = await liff.shareTargetPicker(message);
      return { shared: Boolean(result), method: 'liff' };
    }
  } catch (err) {
    console.warn('shareTargetPicker failed', err);
  }

  // นอก LINE: ใช้ share sheet ของระบบ หรือคัดลอกลิงก์
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return { shared: true, method: 'web-share' };
    } catch { /* ผู้ใช้ยกเลิก */ }
  }
  await navigator.clipboard?.writeText(url);
  return { shared: false, method: 'clipboard' };
}

export function isInLineApp() {
  return inLineClient();
}
