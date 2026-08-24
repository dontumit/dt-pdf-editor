/**
 * ส่วนประกอบร่วมของทุกหน้าเครื่องมือ (spec ข้อ 101)
 * โครงเดียวกันหมด: หัวข้อ -> อัปโหลด -> ตั้งค่า -> ประมวลผล -> ผลลัพธ์
 */
import icon from './icons.js';
import { escapeHtml, formatBytes, formatDuration, formatPercent } from '../utils/format.js';

export function toolHeader(tool, lang = 'th') {
  return `
    <div class="tool-header" style="--tool-color:${tool.color};--tool-shadow:${tool.color}80">
      <span class="tool-header__icon" aria-hidden="true">${icon(tool.icon, { size: 26 })}</span>
      <div style="flex:1;min-width:0">
        <h1>${escapeHtml(tool.name[lang] || tool.name.th)}</h1>
        <p>${escapeHtml(tool.desc[lang] || tool.desc.th)}</p>
      </div>
    </div>`;
}

export function stepsBar(steps, activeIndex) {
  return `<div class="steps" role="list">${steps.map((label, index) => `
    <div class="step" role="listitem" data-state="${index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo'}">
      <span class="step__num">${index < activeIndex ? '&#10003;' : index + 1}</span>
      <span>${escapeHtml(label)}</span>
    </div>`).join('')}</div>`;
}

/** แถบความคืบหน้าที่บอกขั้นตอนเป็นข้อความด้วย ไม่ใช่แค่ spinner (spec ข้อ 88) */
export function createProgress({ onCancel } = {}) {
  const element = document.createElement('div');
  element.className = 'progress';
  element.innerHTML = `
    <div class="progress__bar"><div class="progress__fill" role="progressbar"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div></div>
    <div class="progress__meta">
      <span class="progress__stage">กำลังเตรียมข้อมูล...</span>
      <span style="display:flex;align-items:center;gap:10px">
        <span class="progress__percent">0%</span>
        ${onCancel ? '<button type="button" class="progress__cancel" style="color:var(--danger);font-size:13px;font-weight:600">ยกเลิก</button>' : ''}
      </span>
    </div>`;

  const fill = element.querySelector('.progress__fill');
  const stageEl = element.querySelector('.progress__stage');
  const percentEl = element.querySelector('.progress__percent');
  element.querySelector('.progress__cancel')?.addEventListener('click', () => onCancel?.());

  return {
    element,
    update(progress, stage) {
      const value = Math.max(0, Math.min(100, Math.round(progress || 0)));
      fill.style.width = `${value}%`;
      fill.setAttribute('aria-valuenow', String(value));
      percentEl.textContent = `${value}%`;
      if (stage) stageEl.textContent = stage;
    },
    done(message = 'เสร็จสิ้น') {
      fill.style.width = '100%';
      percentEl.textContent = '100%';
      stageEl.textContent = message;
    },
    remove: () => element.remove(),
  };
}

/** กล่องแสดงผลลัพธ์ พร้อมปุ่มดาวน์โหลด/แชร์/ทำใหม่ (spec ข้อ 73) */
export function resultBox({
  title = 'เสร็จเรียบร้อย',
  files = [],
  stats = [],
  actions = [],
  note = '',
}) {
  const element = document.createElement('div');
  element.className = 'result';
  element.innerHTML = `
    <div class="result__head">
      <span class="result__check">${icon('check', { size: 20 })}</span>
      <div><strong style="font-size:16px">${escapeHtml(title)}</strong>
      ${files.length > 1 ? `<div style="font-size:13px;color:var(--text-muted)">ได้ไฟล์ทั้งหมด ${files.length} ไฟล์</div>` : ''}</div>
    </div>
    ${files.length === 1 ? `<div style="font-size:13.5px;margin-bottom:10px;word-break:break-all">
      ${icon('file', { size: 15 })} ${escapeHtml(files[0].name)}</div>` : ''}
    ${stats.length ? `<dl class="result__stats">${stats.map((stat) => `
      <div class="result__stat"><dt>${escapeHtml(stat.label)}</dt><dd>${escapeHtml(stat.value)}</dd></div>`).join('')}</dl>` : ''}
    ${note ? `<p class="card__hint" style="margin-bottom:12px">${escapeHtml(note)}</p>` : ''}
    <div class="result__actions"></div>`;

  const actionsEl = element.querySelector('.result__actions');
  actions.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn ${action.variant ? `btn--${action.variant}` : ''}`;
    button.innerHTML = `${action.icon ? icon(action.icon, { size: 17 }) : ''}<span>${escapeHtml(action.label)}</span>`;
    button.addEventListener('click', () => action.onClick(button));
    actionsEl.appendChild(button);
  });

  return element;
}

/** สถิติมาตรฐานสำหรับการบีบอัด */
export function compressionStats(originalSize, newSize, processingMs) {
  const saved = originalSize > 0 ? (originalSize - newSize) / originalSize : 0;
  return [
    { label: 'ขนาดเดิม', value: formatBytes(originalSize) },
    { label: 'ขนาดใหม่', value: formatBytes(newSize) },
    { label: saved >= 0 ? 'ลดลง' : 'เพิ่มขึ้น', value: formatPercent(Math.abs(saved)) },
    ...(processingMs ? [{ label: 'เวลาที่ใช้', value: formatDuration(processingMs) }] : []),
  ];
}

/** กล่อง error ที่บอกสาเหตุและทางแก้ (spec ข้อ 38, 74) */
export function errorBox(error, { onRetry, onNewFile } = {}) {
  const element = document.createElement('div');
  element.className = 'error-box';

  const HINTS = {
    PDF_INVALID: 'ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ ลองเปิดไฟล์ด้วยโปรแกรมอ่าน PDF แล้วบันทึกใหม่',
    PDF_ENCRYPTED: 'ไฟล์นี้ถูกล็อกด้วยรหัสผ่าน ใช้เครื่องมือ "ปลดล็อก PDF" ก่อนแล้วลองใหม่',
    OUT_OF_MEMORY: 'ไฟล์ใหญ่เกินกว่าที่เบราว์เซอร์จะประมวลผลไหว ลองลดจำนวนหน้า หรือใช้คอมพิวเตอร์ที่มีหน่วยความจำมากกว่า',
    RATE_LIMITED: 'ใช้งานครบโควตาของชั่วโมงนี้แล้ว รอสักครู่หรือเข้าสู่ระบบเพื่อเพิ่มโควตา',
    NETWORK_ERROR: 'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่',
    WRONG_PASSWORD: 'รหัสผ่านไม่ถูกต้อง ตรวจสอบตัวพิมพ์เล็ก-ใหญ่แล้วลองอีกครั้ง',
    NO_TEXT_FOUND: 'ไม่พบข้อความในไฟล์ หากเป็นเอกสารสแกน ให้ใช้เครื่องมือ OCR ก่อน',
    CANCELLED: 'งานถูกยกเลิกแล้ว',
  };
  const code = error?.code || error?.errorCode;

  element.innerHTML = `
    <div class="error-box__title">${icon('alert', { size: 18 })} ${escapeHtml(error?.message || 'ดำเนินการไม่สำเร็จ')}</div>
    ${HINTS[code] ? `<p style="font-size:13.5px;margin:0">${escapeHtml(HINTS[code])}</p>` : ''}
    <div class="error-box__actions"></div>`;

  const actionsEl = element.querySelector('.error-box__actions');
  if (onRetry) {
    const button = document.createElement('button');
    button.className = 'btn btn--sm btn--primary';
    button.textContent = 'ลองใหม่';
    button.addEventListener('click', onRetry);
    actionsEl.appendChild(button);
  }
  if (onNewFile) {
    const button = document.createElement('button');
    button.className = 'btn btn--sm';
    button.textContent = 'เลือกไฟล์ใหม่';
    button.addEventListener('click', onNewFile);
    actionsEl.appendChild(button);
  }
  return element;
}

/** ช่วยสร้างฟอร์มตัวเลือกแบบสั้น ๆ */
export const field = (label, control, hint = '') => `
  <div class="field">
    <label class="field__label">${escapeHtml(label)}</label>
    ${control}
    ${hint ? `<div class="field__hint">${escapeHtml(hint)}</div>` : ''}
  </div>`;

export const choiceGroup = (name, options, selectedValue) => `
  <div class="choice-group">${options.map((option) => `
    <label class="choice">
      <input type="radio" name="${name}" value="${escapeHtml(option.value)}" ${option.value === selectedValue ? 'checked' : ''}>
      <span>${escapeHtml(option.label)}</span>
    </label>`).join('')}</div>`;

export const switchRow = (id, label, checked = false, hint = '') => `
  <div class="switch">
    <div><div style="font-weight:600;font-size:14px">${escapeHtml(label)}</div>
    ${hint ? `<div class="field__hint" style="margin:0">${escapeHtml(hint)}</div>` : ''}</div>
    <span class="switch__control">
      <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
      <span class="switch__track"></span>
    </span>
  </div>`;
