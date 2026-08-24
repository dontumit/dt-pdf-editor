/** ตั้งค่า / บัญชีผู้ใช้ */
import appState from '../core/state.js';
import bootstrap from '../core/bootstrap.js';
import api from '../core/api.js';
import idb from '../core/idb.js';
import { savePreferences, logout, startLineLogin } from '../services/auth.js';
import { switchRow } from '../ui/workflow.js';
import { confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastInfo } from '../ui/toast.js';
import icon from '../ui/icons.js';
import { escapeHtml, formatDate, formatBytes } from '../utils/format.js';

export default async function SettingsPage({ root }) {
  const state = appState.get();

  root.innerHTML = `
    <div class="section-title" style="margin-top:6px"><h2 style="font-size:19px">ตั้งค่า</h2></div>

    <div class="card">
      <div class="card__title">บัญชีผู้ใช้</div>
      <div id="account-box"></div>
    </div>

    <div class="card">
      <div class="card__title">การแสดงผล</div>
      <div class="field">
        <label class="field__label">ธีม</label>
        <div class="choice-group" id="theme-group">
          ${['system', 'light', 'dark'].map((value) => `
            <label class="choice"><input type="radio" name="theme" value="${value}" ${state.theme === value ? 'checked' : ''}>
            <span>${{ system: 'ตามระบบ', light: 'สว่าง', dark: 'มืด' }[value]}</span></label>`).join('')}
        </div>
      </div>
      <div class="field" style="margin-bottom:0">
        <label class="field__label">ภาษา</label>
        <div class="choice-group" id="lang-group">
          <label class="choice"><input type="radio" name="lang" value="th" ${state.language === 'th' ? 'checked' : ''}><span>ไทย</span></label>
          <label class="choice"><input type="radio" name="lang" value="en" ${state.language === 'en' ? 'checked' : ''}><span>English</span></label>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card__title">ข้อมูลในเครื่อง</div>
      <p class="card__hint">ระบบเก็บไฟล์ที่กำลังทำงานและงานที่ยังไม่บันทึกไว้ในเบราว์เซอร์ของคุณเท่านั้น</p>
      <div id="storage-info" style="font-size:13.5px;margin:10px 0"></div>
      <button class="btn btn--sm btn--danger" id="clear-local">${icon('trash', { size: 15 })} ล้างข้อมูลในเครื่อง</button>
    </div>

    <div class="card">
      <div class="card__title">ตรวจสอบความพร้อมของระบบ</div>
      <p class="card__hint">ทดสอบว่าเบราว์เซอร์นี้ประมวลผล PDF และฝังฟอนต์ไทยได้ครบถ้วนหรือไม่
      ใช้ตรวจหลังติดตั้งระบบ หรือเมื่อพบว่าภาษาไทยในไฟล์ผลลัพธ์แสดงไม่ถูกต้อง</p>
      <button class="btn btn--sm" id="run-selftest" style="margin-top:10px">
        ${icon('check', { size: 15 })} เริ่มตรวจสอบ</button>
      <div id="selftest-result" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <div class="card__title">เกี่ยวกับระบบ</div>
      <dl style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13.5px;margin:0">
        <dt style="color:var(--text-muted)">ชื่อระบบ</dt><dd style="margin:0">${escapeHtml(bootstrap.appName)}</dd>
        <dt style="color:var(--text-muted)">เวอร์ชัน</dt><dd style="margin:0">${escapeHtml(bootstrap.cacheVersion)}</dd>
        <dt style="color:var(--text-muted)">ขนาดไฟล์สูงสุด</dt><dd style="margin:0">${bootstrap.maxFileSizeMb} MB</dd>
        <dt style="color:var(--text-muted)">จำนวนหน้าสูงสุด</dt><dd style="margin:0">${bootstrap.maxPdfPages} หน้า</dd>
      </dl>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <a class="btn btn--sm" href="/status" data-link>สถานะระบบ</a>
        <a class="btn btn--sm" href="/privacy" data-link>ความเป็นส่วนตัว</a>
        <a class="btn btn--sm" href="/help" data-link>ช่วยเหลือ</a>
        ${state.user?.role === 'admin' ? '<a class="btn btn--sm btn--primary" href="/admin">แผงผู้ดูแลระบบ</a>' : ''}
      </div>
    </div>`;

  // ---- บัญชี ----
  const accountBox = root.querySelector('#account-box');
  if (state.authenticated && state.user) {
    accountBox.innerHTML = `
      <div style="display:flex;align-items:center;gap:13px;margin-bottom:14px">
        ${state.user.pictureUrl
          ? `<img src="${state.user.pictureUrl}" alt="" referrerpolicy="no-referrer"
               style="width:56px;height:56px;border-radius:50%;object-fit:cover;box-shadow:0 0 16px -3px var(--brand)">`
          : `<span style="width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand-strong)">${icon('user', { size: 26 })}</span>`}
        <div style="min-width:0">
          <div style="font-weight:700;font-size:16px">${escapeHtml(state.user.displayName || 'ผู้ใช้')}</div>
          <div style="font-size:12.5px;color:var(--text-muted)">
            ${state.user.provider === 'line' ? 'เข้าสู่ระบบด้วย LINE' : 'บัญชีผู้ดูแลระบบ'}
            ${state.user.role === 'admin' ? ' · ผู้ดูแลระบบ' : ''}
          </div>
          <div style="font-size:11.5px;color:var(--text-faint)">รหัสอ้างอิง ${escapeHtml(state.user.ref.slice(0, 10))} · สมัครเมื่อ ${formatDate(state.user.createdAt, { withTime: false })}</div>
        </div>
      </div>
      <button class="btn btn--sm" id="logout-btn">${icon('logout', { size: 15 })} ออกจากระบบ</button>`;

    accountBox.querySelector('#logout-btn').addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'ออกจากระบบ',
        message: 'ระบบจะล้างข้อมูลชั่วคราวในเครื่องนี้ด้วย ต้องการดำเนินการต่อหรือไม่',
        confirmLabel: 'ออกจากระบบ',
        danger: true,
      });
      if (!confirmed) return;
      await logout();
      toastSuccess('ออกจากระบบแล้ว');
      location.href = '/';
    });
  } else {
    accountBox.innerHTML = `
      <p class="card__hint">ยังไม่ได้เข้าสู่ระบบ — ใช้งานเครื่องมือพื้นฐานได้ แต่จะไม่มีการเก็บประวัติข้ามอุปกรณ์</p>
      ${bootstrap.lineEnabled
        ? '<button class="btn btn--line btn--block" id="login-btn" style="margin-top:10px">' + icon('line', { size: 18 }) + ' เข้าสู่ระบบด้วย LINE</button>'
        : '<div class="field__hint">ผู้ดูแลระบบยังไม่ได้ตั้งค่า LINE Login</div>'}`;
    accountBox.querySelector('#login-btn')?.addEventListener('click', () => startLineLogin('/settings'));
  }

  // ---- ธีม / ภาษา ----
  root.querySelector('#theme-group').addEventListener('change', async (event) => {
    await savePreferences({ theme: event.target.value });
    toastSuccess('บันทึกการตั้งค่าแล้ว');
  });
  root.querySelector('#lang-group').addEventListener('change', async (event) => {
    await savePreferences({ language: event.target.value });
    toastInfo('เปลี่ยนภาษาแล้ว — บางส่วนจะแสดงผลหลังโหลดหน้าใหม่');
  });

  // ---- พื้นที่จัดเก็บในเครื่อง ----
  (async () => {
    const info = root.querySelector('#storage-info');
    try {
      const projects = await idb.listProjects();
      const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
      info.innerHTML = `
        <div>งานที่ยังไม่บันทึก: <strong>${projects.length}</strong> รายการ</div>
        ${estimate ? `<div style="color:var(--text-muted)">ใช้พื้นที่ประมาณ ${formatBytes(estimate.usage || 0)} จาก ${formatBytes(estimate.quota || 0)}</div>` : ''}`;
    } catch {
      info.textContent = 'อ่านข้อมูลพื้นที่จัดเก็บไม่ได้';
    }
  })();

  // ---- ตรวจสอบความพร้อมของระบบ ----
  root.querySelector('#run-selftest').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const output = root.querySelector('#selftest-result');
    button.disabled = true;
    button.textContent = 'กำลังตรวจสอบ...';
    output.innerHTML = '<div class="skeleton" style="height:90px"></div>';

    const checks = [];
    const add = (label, ok, detail = '') => checks.push({ label, ok, detail });

    try {
      // 1) ตรวจว่า Web Worker ใช้ได้ และ pdf-lib + fontkit + ฟอนต์ไทยทำงานครบ
      const report = await new Promise((resolve) => {
        let worker;
        try {
          worker = new Worker('/src/workers/font-probe.worker.js', { type: 'module' });
        } catch (err) {
          resolve({ ok: false, error: 'เบราว์เซอร์นี้ไม่รองรับ module worker' });
          return;
        }
        worker.onmessage = (message) => { resolve(message.data); worker.terminate(); };
        worker.onerror = () => resolve({ ok: false, error: 'worker ทำงานไม่สำเร็จ' });
        worker.postMessage('run');
        setTimeout(() => resolve({ ok: false, error: 'ตรวจสอบใช้เวลานานเกินไป' }), 30000);
      });

      add('Web Worker (ประมวลผลไม่ให้หน้าจอค้าง)', report.pdfLib === 'ok');
      add('ไลบรารี PDF (pdf-lib)', report.pdfLib === 'ok');
      add('ไลบรารีฟอนต์ (fontkit)', report.fontkit === 'ok');
      add('ไฟล์ฟอนต์ไทย Sarabun', report.fontFetch === 200,
        report.fontBytes ? `${Math.round(report.fontBytes / 1024)} KB` : 'ไม่พบไฟล์ฟอนต์');
      add('สร้าง PDF ภาษาไทยได้', Boolean(report.ok && report.pdfBytes),
        report.pdfBytes ? `ไฟล์ทดสอบ ${Math.round(report.pdfBytes / 1024)} KB` : (report.error || ''));

      // 2) ตรวจความสามารถอื่นของเบราว์เซอร์
      add('Canvas (เรนเดอร์และแปลงรูป)', typeof document.createElement('canvas').getContext === 'function');
      add('IndexedDB (กู้คืนงานค้าง)', 'indexedDB' in window);
      add('Service Worker (ใช้งานออฟไลน์)', 'serviceWorker' in navigator);
      add('กล้อง (สแกนเอกสาร)', Boolean(navigator.mediaDevices?.getUserMedia),
        location.protocol === 'https:' || location.hostname === 'localhost' ? '' : 'ต้องใช้ผ่าน HTTPS');

      // 3) ตรวจเครื่องมือฝั่งเซิร์ฟเวอร์
      const caps = await api.get('/api/capabilities').catch(() => null);
      if (caps) {
        add('เซิร์ฟเวอร์: ใส่/ปลดรหัสผ่าน PDF (qpdf)', caps.capabilities.qpdf, caps.capabilities.qpdf ? '' : 'ยังไม่ได้ติดตั้ง');
        add('เซิร์ฟเวอร์: บีบอัดคุณภาพสูง (Ghostscript)', caps.capabilities.ghostscript, caps.capabilities.ghostscript ? '' : 'ยังไม่ได้ติดตั้ง');
        add('เซิร์ฟเวอร์: แปลงเป็น Word', caps.capabilities.pdfToWord);
        add('การเชื่อมต่อ LINE', caps.capabilities.line, caps.capabilities.line ? '' : 'ยังไม่ได้ตั้งค่า');
      }

      const failed = checks.filter((check) => !check.ok).length;
      output.innerHTML = `
        <div class="${failed ? 'notice notice--warn' : 'notice'}" style="margin-top:0">
          <div><strong>${failed ? `พบ ${failed} รายการที่ยังไม่พร้อม` : 'ระบบพร้อมใช้งานครบทุกส่วน'}</strong></div>
        </div>
        <div style="display:grid;gap:5px;font-size:13px">
          ${checks.map((check) => `
            <div style="display:flex;align-items:center;gap:9px">
              <span style="width:8px;height:8px;border-radius:50%;flex:none;
                background:${check.ok ? 'var(--accent-mint)' : 'var(--warning)'};
                box-shadow:0 0 8px 1px ${check.ok ? 'var(--accent-mint)' : 'var(--warning)'}"></span>
              <span style="flex:1">${escapeHtml(check.label)}</span>
              <span style="color:var(--text-faint);font-size:12px">${escapeHtml(check.detail)}</span>
            </div>`).join('')}
        </div>`;
      if (!failed) toastSuccess('ตรวจสอบเสร็จ ระบบพร้อมใช้งาน');
    } catch (err) {
      output.innerHTML = `<div class="error-box"><div class="error-box__title">ตรวจสอบไม่สำเร็จ</div>
        <p style="font-size:13.5px;margin:0">${escapeHtml(err.message)}</p></div>`;
    } finally {
      button.disabled = false;
      button.innerHTML = 'ตรวจสอบอีกครั้ง';
    }
  });

  root.querySelector('#clear-local').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'ล้างข้อมูลในเครื่อง',
      message: 'งานที่ยังไม่บันทึกและแคชทั้งหมดจะถูกลบ ต้องการดำเนินการต่อหรือไม่',
      confirmLabel: 'ล้างข้อมูล',
      danger: true,
    });
    if (!confirmed) return;

    await idb.clearAll();
    // ล้างเฉพาะแคชไฟล์ชั่วคราว ไม่แตะแคชของตัวแอป (spec ข้อ 71)
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.includes('temp')).map((name) => caches.delete(name)));
    }
    toastSuccess('ล้างข้อมูลในเครื่องเรียบร้อย');
    location.reload();
  });

  return null;
}
