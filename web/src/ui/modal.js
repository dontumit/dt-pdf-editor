/** Modal / bottom sheet พร้อม focus trap และรองรับคีย์บอร์ด */
import icon from './icons.js';
import { escapeHtml } from '../utils/format.js';

let openCount = 0;

export function openModal({ title, body, actions = [], dismissible = true, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const previouslyFocused = document.activeElement;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" ${title ? 'aria-labelledby="modal-title"' : ''}>
      ${title ? `<h2 class="modal__title" id="modal-title">${escapeHtml(title)}</h2>` : ''}
      <div class="modal__body"></div>
      ${actions.length ? '<div class="modal__actions"></div>' : ''}
    </div>`;

  const modal = backdrop.querySelector('.modal');
  const bodyEl = backdrop.querySelector('.modal__body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body instanceof Node) bodyEl.appendChild(body);

  let closed = false;
  const close = (result) => {
    // กันการปิดซ้ำ: ปุ่มบางตัวเรียก close() เองแล้ว handler ยังเรียกซ้ำอีกรอบ
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    backdrop.remove();
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) document.body.style.overflow = '';
    previouslyFocused?.focus?.();
    onClose?.(result);
  };

  const actionsEl = backdrop.querySelector('.modal__actions');
  actions.forEach((action) => {
    const button = document.createElement('button');
    button.className = `btn ${action.variant ? `btn--${action.variant}` : ''}`;
    button.textContent = action.label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (action.onClick) {
          const result = await action.onClick({ close, modal });
          // คืนค่า false = ไม่ผ่านการตรวจสอบ ให้เปิดหน้าต่างค้างไว้
          if (result === false) return;
        }
        if (action.keepOpen) return;
        close(action.value ?? action.label);
      } finally {
        button.disabled = false;
      }
    });
    actionsEl.appendChild(button);
  });

  function onKeydown(event) {
    if (event.key === 'Escape' && dismissible) { event.preventDefault(); close(null); return; }
    if (event.key !== 'Tab') return;
    // focus trap
    const focusable = modal.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  if (dismissible) {
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(null); });
  }
  document.addEventListener('keydown', onKeydown, true);

  root.appendChild(backdrop);
  openCount += 1;
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    const target = modal.querySelector('input, textarea, select, button');
    target?.focus();
  }, 60);

  return { close, modal, body: bodyEl };
}

export function confirmDialog({ title, message, confirmLabel = 'ยืนยัน', cancelLabel = 'ยกเลิก', danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p style="color:var(--text-muted)">${escapeHtml(message)}</p>`,
      actions: [
        { label: cancelLabel, value: false },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', value: true },
      ],
      onClose: (result) => resolve(result === true),
    });
  });
}

export function alertDialog({ title, message, label = 'เข้าใจแล้ว' }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p style="color:var(--text-muted)">${escapeHtml(message)}</p>`,
      actions: [{ label, variant: 'primary', value: true }],
      onClose: () => resolve(true),
    });
  });
}

export { icon };
