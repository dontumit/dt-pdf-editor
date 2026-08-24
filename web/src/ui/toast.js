/** Toast notification (spec ข้อ 103) */
import icon from './icons.js';
import { escapeHtml } from '../utils/format.js';

const ICONS = { success: 'check', error: 'close', warning: 'alert', info: 'info' };
const DEFAULT_DURATION = { success: 3200, info: 3200, warning: 5000, error: 7000 };

export function toast(message, type = 'info', { duration, action } = {}) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return () => {};

  const element = document.createElement('div');
  element.className = 'toast';
  element.dataset.type = type;
  element.innerHTML = `
    <span style="color:var(--${type === 'error' ? 'danger' : type === 'warning' ? 'warning' : type === 'success' ? 'success' : 'brand'})">
      ${icon(ICONS[type] || 'info', { size: 19 })}
    </span>
    <span style="flex:1">${escapeHtml(message)}</span>
    ${action ? `<button class="btn btn--sm" data-toast-action style="min-height:32px">${escapeHtml(action.label)}</button>` : ''}
    <button class="toast__close" aria-label="ปิดการแจ้งเตือน">${icon('close', { size: 16 })}</button>`;

  const remove = () => {
    element.style.transition = 'opacity .15s, transform .15s';
    element.style.opacity = '0';
    element.style.transform = 'translateY(8px)';
    setTimeout(() => element.remove(), 160);
  };

  element.querySelector('.toast__close').addEventListener('click', remove);
  element.querySelector('[data-toast-action]')?.addEventListener('click', () => {
    action.onClick?.();
    remove();
  });

  stack.appendChild(element);
  // จำกัดจำนวน toast ที่แสดงพร้อมกัน
  while (stack.children.length > 4) stack.firstElementChild.remove();

  const ms = duration ?? DEFAULT_DURATION[type] ?? 3500;
  if (ms > 0) setTimeout(remove, ms);
  return remove;
}

export const toastSuccess = (msg, opts) => toast(msg, 'success', opts);
export const toastError = (msg, opts) => toast(msg, 'error', opts);
export const toastWarning = (msg, opts) => toast(msg, 'warning', opts);
export const toastInfo = (msg, opts) => toast(msg, 'info', opts);
export default toast;
