/** หน้าเข้าสู่ระบบด้วย LINE + ขั้นตอนเพิ่มเพื่อน */
import bootstrap from '../core/bootstrap.js';
import appState from '../core/state.js';
import { startLineLogin } from '../services/auth.js';
import { navigate } from '../core/router.js';
import icon from '../ui/icons.js';
import { escapeHtml } from '../utils/format.js';
import { toastSuccess, toastWarning, toastError } from '../ui/toast.js';

export default async function LoginPage({ root, query }) {
  const state = appState.get();

  if (state.authenticated && !state.requiresFriend) {
    navigate('/', { replace: true });
    return null;
  }

  const needsFriend = state.requiresFriend || query.gate === 'addfriend';

  root.innerHTML = `
    <div class="gate">
      <div class="gate__logo">${icon(needsFriend ? 'line' : 'user', { size: 34 })}</div>
      <h1>${needsFriend ? 'อีกขั้นเดียวก็ใช้งานได้' : `ยินดีต้อนรับสู่ ${escapeHtml(bootstrap.appName)}`}</h1>
      <p>${needsFriend
        ? 'เพิ่มเพื่อนบัญชีทางการของเรา แล้วกลับมากดปุ่มด้านล่างเพื่อเริ่มใช้งาน'
        : 'เข้าสู่ระบบด้วย LINE เพื่อเก็บประวัติการใช้งาน เพิ่มโควตาไฟล์ และใช้เครื่องมือได้ครบทุกตัว'}</p>

      <div class="gate__steps">
        <div class="gate__step" data-done="${state.authenticated}">
          <span class="gate__step-num">${state.authenticated ? '&#10003;' : '1'}</span>
          <div><strong>เข้าสู่ระบบด้วย LINE</strong>
          <div style="color:var(--text-muted);font-size:12.5px">ระบบเห็นเพียงชื่อและรูปโปรไฟล์ของคุณเท่านั้น</div></div>
        </div>
        <div class="gate__step" data-done="${state.authenticated && !needsFriend}">
          <span class="gate__step-num">${state.authenticated && !needsFriend ? '&#10003;' : '2'}</span>
          <div><strong>เพิ่มเพื่อนบัญชีทางการ</strong>
          <div style="color:var(--text-muted);font-size:12.5px">เพื่อรับลิงก์เข้าใช้งานและการแจ้งเตือนจากระบบ</div></div>
        </div>
        <div class="gate__step">
          <span class="gate__step-num">3</span>
          <div><strong>เริ่มใช้เครื่องมือ PDF</strong>
          <div style="color:var(--text-muted);font-size:12.5px">รวม แยก ลดขนาด แปลงไฟล์ เซ็นเอกสาร และอื่น ๆ</div></div>
        </div>
      </div>

      <div id="gate-actions" style="display:flex;flex-direction:column;gap:9px"></div>

      <p style="margin-top:18px;font-size:12.5px;color:var(--text-faint)">
        การเข้าสู่ระบบถือว่ายอมรับ<a href="/privacy" data-link>นโยบายความเป็นส่วนตัว</a>
      </p>
      <a href="/" data-link style="display:inline-block;margin-top:10px;font-size:13.5px">ใช้งานแบบไม่เข้าสู่ระบบ</a>
    </div>`;

  const actions = root.querySelector('#gate-actions');

  if (!bootstrap.lineEnabled) {
    actions.innerHTML = `<div class="notice notice--warn"><div style="font-size:13px">
      ผู้ดูแลระบบยังไม่ได้ตั้งค่า LINE Login — ขณะนี้ใช้งานได้แบบไม่เข้าสู่ระบบเท่านั้น</div></div>
      <a class="btn btn--primary btn--block" href="/" data-link>เข้าใช้งานเลย</a>`;
    return null;
  }

  if (!state.authenticated) {
    actions.innerHTML = `<button class="btn btn--line btn--lg btn--block" id="line-login">
      ${icon('line', { size: 20 })} เข้าสู่ระบบด้วย LINE</button>`;
    actions.querySelector('#line-login').addEventListener('click', () => startLineLogin('/'));
    return null;
  }

  actions.innerHTML = `
    ${state.addFriendUrl ? `<a class="btn btn--line btn--lg btn--block" href="${state.addFriendUrl}" target="_blank" rel="noopener">
      ${icon('line', { size: 20 })} เพิ่มเพื่อนบัญชีทางการ</a>` : ''}
    <button class="btn btn--lg btn--block" id="recheck">เพิ่มเพื่อนแล้ว เริ่มใช้งาน</button>`;

  actions.querySelector('#recheck')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'กำลังตรวจสอบ...';
    try {
      const { recheckFriendship } = await import('../line/liff.js');
      const res = await recheckFriendship();
      if (res.isFriend) { toastSuccess('เริ่มใช้งานได้เลย'); navigate('/'); return; }
      if (res.needsRelogin) {
        toastWarning('กรุณาเข้าสู่ระบบอีกครั้งเพื่ออัปเดตสถานะ');
        startLineLogin('/');
        return;
      }
      toastWarning('ยังไม่พบการเพิ่มเพื่อน กรุณาลองอีกครั้ง');
    } catch (err) {
      toastError(err.message || 'ตรวจสอบไม่สำเร็จ');
    } finally {
      button.disabled = false;
      button.textContent = 'เพิ่มเพื่อนแล้ว เริ่มใช้งาน';
    }
  });

  return null;
}
