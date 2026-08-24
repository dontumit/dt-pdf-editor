/**
 * Dropzone: ลากวาง / เลือกไฟล์ / วางจากคลิปบอร์ด (spec ข้อ 63)
 * ตรวจชนิดไฟล์จาก magic number ก่อนรับเข้า ไม่เชื่อ MIME type อย่างเดียว
 */
import icon from './icons.js';
import { toastError, toastWarning } from './toast.js';
import { formatBytes } from '../utils/format.js';
import { detectFileType } from '../utils/fileType.js';
import bootstrap from '../core/bootstrap.js';

export function createDropzone({
  accept = 'application/pdf',
  acceptKinds = ['pdf'],
  multiple = false,
  maxFiles = 20,
  title = 'ลากไฟล์มาวางที่นี่',
  hint = 'หรือแตะเพื่อเลือกไฟล์จากเครื่อง',
  onFiles,
}) {
  const element = document.createElement('div');
  element.className = 'dropzone';
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');
  element.setAttribute('aria-label', `${title} ${hint}`);
  element.innerHTML = `
    <div class="dropzone__icon">${icon('upload', { size: 38, stroke: 1.6 })}</div>
    <div class="dropzone__title">${title}</div>
    <div class="dropzone__hint">${hint}</div>
    <div class="dropzone__hint" style="margin-top:6px;font-size:12px">
      สูงสุด ${bootstrap.maxFileSizeMb} MB ต่อไฟล์${multiple ? ` · เลือกได้ถึง ${maxFiles} ไฟล์` : ''}
    </div>
    <input type="file" accept="${accept}" ${multiple ? 'multiple' : ''} aria-hidden="true" tabindex="-1">`;

  const input = element.querySelector('input');

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    if (!multiple && files.length > 1) {
      toastWarning('เครื่องมือนี้รับได้ครั้งละ 1 ไฟล์ ระบบจะใช้ไฟล์แรก');
      files.length = 1;
    }
    if (files.length > maxFiles) {
      toastWarning(`เลือกได้สูงสุด ${maxFiles} ไฟล์ ระบบจะใช้ ${maxFiles} ไฟล์แรก`);
      files.length = maxFiles;
    }

    const maxBytes = bootstrap.maxFileSizeMb * 1024 * 1024;
    const accepted = [];
    for (const file of files) {
      if (file.size > maxBytes) {
        toastError(`"${file.name}" ใหญ่เกิน ${bootstrap.maxFileSizeMb} MB`);
        continue;
      }
      if (file.size === 0) {
        toastError(`"${file.name}" เป็นไฟล์ว่าง`);
        continue;
      }
      const detected = await detectFileType(file);
      if (!detected) {
        toastError(`"${file.name}" ไม่ใช่ไฟล์ที่ระบบรองรับ`);
        continue;
      }
      const kind = detected.ext === 'pdf' ? 'pdf' : 'image';
      if (!acceptKinds.includes(kind)) {
        toastError(`"${file.name}" ไม่ใช่ชนิดไฟล์ที่เครื่องมือนี้รองรับ`);
        continue;
      }
      accepted.push(Object.assign(file, { detectedType: detected }));
    }

    if (accepted.length) await onFiles?.(accepted);
    input.value = '';
  }

  element.addEventListener('click', () => input.click());
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
  });
  input.addEventListener('change', (event) => handleFiles(event.target.files));

  ['dragenter', 'dragover'].forEach((type) => {
    element.addEventListener(type, (event) => {
      event.preventDefault();
      element.dataset.dragging = 'true';
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    element.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === 'dragleave' && element.contains(event.relatedTarget)) return;
      element.dataset.dragging = 'false';
    });
  });
  element.addEventListener('drop', (event) => {
    event.preventDefault();
    handleFiles(event.dataTransfer?.files);
  });

  // วางไฟล์จากคลิปบอร์ด
  const onPaste = (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const files = items.filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); handleFiles(files); }
  };
  document.addEventListener('paste', onPaste);
  element.destroy = () => document.removeEventListener('paste', onPaste);
  element.openPicker = () => input.click();

  return element;
}

export function fileListItem(file, { index, onRemove, onMoveUp, onMoveDown, thumbnail = null, draggable = true }) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.index = String(index);
  if (draggable) item.setAttribute('draggable', 'true');
  item.innerHTML = `
    ${draggable ? `<span class="file-item__handle" aria-hidden="true">${icon('drag', { size: 18 })}</span>` : ''}
    <span class="file-item__thumb">${thumbnail ? `<img src="${thumbnail}" alt="">` : icon('file', { size: 20 })}</span>
    <span class="file-item__info">
      <span class="file-item__name"></span>
      <span class="file-item__meta">${formatBytes(file.size)}${file.pageCount ? ` · ${file.pageCount} หน้า` : ''}</span>
    </span>
    <span class="file-item__actions">
      ${onMoveUp ? `<button type="button" data-action="up" aria-label="เลื่อนขึ้น">${icon('arrowLeft', { size: 16, className: 'rot90' })}</button>` : ''}
      ${onMoveDown ? `<button type="button" data-action="down" aria-label="เลื่อนลง">${icon('arrowRight', { size: 16 })}</button>` : ''}
      ${onRemove ? `<button type="button" data-action="remove" aria-label="ลบไฟล์นี้">${icon('trash', { size: 16 })}</button>` : ''}
    </span>`;
  item.querySelector('.file-item__name').textContent = file.name;
  item.querySelector('[data-action="remove"]')?.addEventListener('click', () => onRemove(index));
  item.querySelector('[data-action="up"]')?.addEventListener('click', () => onMoveUp(index));
  item.querySelector('[data-action="down"]')?.addEventListener('click', () => onMoveDown(index));
  return item;
}

/** ทำให้รายการเรียงลำดับใหม่ได้ด้วยการลาก (ใช้ได้ทั้งเมาส์และนิ้ว) */
export function makeSortable(container, { itemSelector = '.file-item', onReorder }) {
  let dragIndex = null;

  container.addEventListener('dragstart', (event) => {
    const item = event.target.closest(itemSelector);
    if (!item) return;
    dragIndex = Number(item.dataset.index);
    item.dataset.dragging = 'true';
    event.dataTransfer.effectAllowed = 'move';
    try { event.dataTransfer.setData('text/plain', String(dragIndex)); } catch { /* ignore */ }
  });

  container.addEventListener('dragend', () => {
    container.querySelectorAll(`${itemSelector}[data-dragging]`).forEach((el) => delete el.dataset.dragging);
    container.querySelectorAll(`${itemSelector}[data-dropzone]`).forEach((el) => delete el.dataset.dropzone);
    dragIndex = null;
  });

  container.addEventListener('dragover', (event) => {
    event.preventDefault();
    const item = event.target.closest(itemSelector);
    container.querySelectorAll(`${itemSelector}[data-dropzone]`).forEach((el) => delete el.dataset.dropzone);
    if (item && Number(item.dataset.index) !== dragIndex) item.dataset.dropzone = 'true';
  });

  container.addEventListener('drop', (event) => {
    event.preventDefault();
    const item = event.target.closest(itemSelector);
    if (!item || dragIndex === null) return;
    const targetIndex = Number(item.dataset.index);
    if (targetIndex !== dragIndex) onReorder(dragIndex, targetIndex);
    dragIndex = null;
  });

  // รองรับการลากด้วยนิ้วบนมือถือ
  let touchDrag = null;
  container.addEventListener('touchstart', (event) => {
    const handle = event.target.closest('.file-item__handle, .page-thumb');
    if (!handle) return;
    const item = handle.closest(itemSelector);
    if (!item) return;
    touchDrag = { index: Number(item.dataset.index), item };
    item.dataset.dragging = 'true';
  }, { passive: true });

  container.addEventListener('touchmove', (event) => {
    if (!touchDrag) return;
    event.preventDefault();
    const touch = event.touches[0];
    const under = document.elementFromPoint(touch.clientX, touch.clientY)?.closest(itemSelector);
    container.querySelectorAll(`${itemSelector}[data-dropzone]`).forEach((el) => delete el.dataset.dropzone);
    if (under && Number(under.dataset.index) !== touchDrag.index) under.dataset.dropzone = 'true';
  }, { passive: false });

  container.addEventListener('touchend', (event) => {
    if (!touchDrag) return;
    const touch = event.changedTouches[0];
    const under = document.elementFromPoint(touch.clientX, touch.clientY)?.closest(itemSelector);
    delete touchDrag.item.dataset.dragging;
    container.querySelectorAll(`${itemSelector}[data-dropzone]`).forEach((el) => delete el.dataset.dropzone);
    if (under) {
      const targetIndex = Number(under.dataset.index);
      if (targetIndex !== touchDrag.index) onReorder(touchDrag.index, targetIndex);
    }
    touchDrag = null;
  });
}
