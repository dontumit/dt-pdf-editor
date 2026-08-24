/**
 * ครอบตัดขอบ PDF (spec ข้อ 23)
 * เลือกพื้นที่ด้วยเมาส์หรือนิ้ว มีปุ่มตรวจหาขอบขาวอัตโนมัติ
 */
import { toolHeader, createProgress, resultBox, errorBox, field, choiceGroup } from '../../ui/workflow.js';
import { createDropzone } from '../../ui/dropzone.js';
import { openDocument, renderPageToCanvas } from '../../pdf/render.js';
import { detectContentBounds } from '../../pdf/ops-content.js';
import { runPdfTask, releaseWorker } from '../../pdf/worker-client.js';
import { fileToBytes } from '../../pdf/ops-core.js';
import { downloadBytes, revokeAll } from '../../utils/download.js';
import { outputName, formatBytes } from '../../utils/format.js';
import { startClientJob, completeClientJob } from '../../services/jobs.js';
import { toastError, toastSuccess, toastInfo } from '../../ui/toast.js';
import icon from '../../ui/icons.js';

export default async function CropPage({ root, tool }) {
  const state = {
    file: null, bytes: null, pdfDoc: null, pageNumber: 1,
    crop: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
    scope: 'all', canvas: null,
  };

  root.innerHTML = `
    ${toolHeader(tool)}
    <div class="notice">${icon('lock', { size: 18 })}
      <div style="font-size:13px">ไฟล์ของคุณประมวลผลบนเครื่องนี้ทั้งหมด</div></div>
    <div id="upload-area"></div>
    <div id="workspace" hidden></div>
    <div id="progress-area"></div>
    <div id="result-area"></div>`;

  const uploadArea = root.querySelector('#upload-area');
  const workspace = root.querySelector('#workspace');
  const progressArea = root.querySelector('#progress-area');
  const resultArea = root.querySelector('#result-area');

  const dropzone = createDropzone({
    accept: 'application/pdf,.pdf',
    acceptKinds: ['pdf'],
    multiple: false,
    title: 'ลากไฟล์ PDF มาวางที่นี่',
    onFiles: async (files) => loadFile(files[0]),
  });
  uploadArea.appendChild(dropzone);

  async function loadFile(file) {
    try {
      state.file = file;
      state.bytes = await fileToBytes(file);
      state.pdfDoc = await openDocument(state.bytes.slice());
      uploadArea.hidden = true;
      workspace.hidden = false;
      renderWorkspace();
      await renderPreview();
    } catch (err) {
      toastError(err.message || 'เปิดไฟล์ไม่สำเร็จ');
      resultArea.appendChild(errorBox(err, { onNewFile: () => { uploadArea.hidden = false; dropzone.openPicker(); } }));
    }
  }

  function renderWorkspace() {
    workspace.innerHTML = `
      <div class="card">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn btn--sm" id="prev-page">${icon('arrowLeft', { size: 15 })}</button>
          <span style="font-size:13.5px">หน้า <strong id="page-label">1</strong> / ${state.pdfDoc.numPages}</span>
          <button class="btn btn--sm" id="next-page">${icon('arrowRight', { size: 15 })}</button>
          <button class="btn btn--sm btn--primary" id="auto-detect" style="margin-left:auto">
            ${icon('zoomIn', { size: 15 })} ตรวจหาขอบอัตโนมัติ
          </button>
          <button class="btn btn--sm" id="reset-crop">รีเซ็ต</button>
        </div>
        <div id="crop-stage" style="position:relative;background:var(--surface-3);border-radius:16px;padding:12px;display:grid;place-items:center;overflow:auto">
          <div id="crop-holder" style="position:relative;line-height:0"></div>
        </div>
      </div>
      <div class="card">
        <div class="card__title">ตั้งค่า</div>
        ${field('ใช้กับหน้าไหน', choiceGroup('scope', [
          { value: 'all', label: 'ทุกหน้า' },
          { value: 'current', label: 'หน้านี้' },
          { value: 'odd', label: 'หน้าคี่' },
          { value: 'even', label: 'หน้าคู่' },
        ], state.scope))}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${['top', 'bottom', 'left', 'right'].map((side) => `
            <div class="field" style="margin:0">
              <label class="field__label">${{ top: 'บน', bottom: 'ล่าง', left: 'ซ้าย', right: 'ขวา' }[side]}
                <span data-out="${side}" style="color:var(--brand);font-weight:700">${Math.round(state.crop[side] * 100)}%</span></label>
              <input type="range" data-side="${side}" min="0" max="45" value="${Math.round(state.crop[side] * 100)}">
            </div>`).join('')}
        </div>
      </div>
      <button class="btn btn--primary btn--lg btn--block" id="apply-btn" style="margin-top:14px">
        ${icon('crop', { size: 19 })} ครอบตัดและบันทึก
      </button>`;

    workspace.querySelectorAll('[data-side]').forEach((input) => {
      input.addEventListener('input', () => {
        const side = input.dataset.side;
        state.crop[side] = Number(input.value) / 100;
        workspace.querySelector(`[data-out="${side}"]`).textContent = `${input.value}%`;
        drawOverlay();
      });
    });
    workspace.querySelector('[name="scope"]')?.closest('.choice-group')
      ?.addEventListener('change', (event) => { state.scope = event.target.value; });

    workspace.querySelector('#prev-page').addEventListener('click', async () => {
      if (state.pageNumber > 1) { state.pageNumber -= 1; await renderPreview(); }
    });
    workspace.querySelector('#next-page').addEventListener('click', async () => {
      if (state.pageNumber < state.pdfDoc.numPages) { state.pageNumber += 1; await renderPreview(); }
    });
    workspace.querySelector('#reset-crop').addEventListener('click', () => {
      state.crop = { top: 0, right: 0, bottom: 0, left: 0 };
      syncSliders();
      drawOverlay();
    });
    workspace.querySelector('#auto-detect').addEventListener('click', autoDetect);
    workspace.querySelector('#apply-btn').addEventListener('click', apply);
  }

  function syncSliders() {
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const input = workspace.querySelector(`[data-side="${side}"]`);
      if (input) input.value = String(Math.round(state.crop[side] * 100));
      const out = workspace.querySelector(`[data-out="${side}"]`);
      if (out) out.textContent = `${Math.round(state.crop[side] * 100)}%`;
    }
  }

  async function renderPreview() {
    const holder = workspace.querySelector('#crop-holder');
    holder.innerHTML = '<div class="skeleton" style="width:320px;height:452px"></div>';
    const { canvas } = await renderPageToCanvas(state.pdfDoc, state.pageNumber, { scale: 1, maxWidth: 520 });
    state.canvas = canvas;
    holder.innerHTML = '';
    holder.appendChild(canvas);

    const overlay = document.createElement('div');
    overlay.id = 'crop-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    holder.appendChild(overlay);

    workspace.querySelector('#page-label').textContent = String(state.pageNumber);
    drawOverlay();
  }

  function drawOverlay() {
    const overlay = workspace.querySelector('#crop-overlay');
    if (!overlay) return;
    const { top, right, bottom, left } = state.crop;
    overlay.innerHTML = `
      <div style="position:absolute;inset:0;
        box-shadow: inset 0 ${top * 100}% 0 rgba(15,23,42,.55),
                    inset 0 -${bottom * 100}% 0 rgba(15,23,42,.55),
                    inset ${left * 100}% 0 0 rgba(15,23,42,.55),
                    inset -${right * 100}% 0 0 rgba(15,23,42,.55);"></div>
      <div style="position:absolute;
        top:${top * 100}%;bottom:${bottom * 100}%;left:${left * 100}%;right:${right * 100}%;
        border:2px dashed #7c6bf5;border-radius:5px;
        box-shadow:0 0 18px rgba(124,107,245,.55)"></div>`;
  }

  async function autoDetect() {
    if (!state.canvas) return;
    toastInfo('กำลังตรวจหาขอบของเนื้อหา...');
    const bounds = detectContentBounds(state.canvas, { threshold: 245, padding: 6 });
    state.crop = {
      top: Math.max(0, Math.min(0.45, bounds.top)),
      right: Math.max(0, Math.min(0.45, bounds.right)),
      bottom: Math.max(0, Math.min(0.45, bounds.bottom)),
      left: Math.max(0, Math.min(0.45, bounds.left)),
    };
    syncSliders();
    drawOverlay();
    toastSuccess('ตรวจหาขอบเรียบร้อย ปรับเพิ่มได้ตามต้องการ');
  }

  async function apply() {
    resultArea.innerHTML = '';
    const progress = createProgress();
    progressArea.innerHTML = '';
    progressArea.appendChild(progress.element);

    const gate = await startClientJob(tool.id, { fileCount: 1, bytesIn: state.bytes.byteLength });
    if (!gate.allowed) { progress.remove(); toastError(gate.reason); return; }

    const startedAt = performance.now();
    try {
      const task = runPdfTask('crop', {
        bytes: state.bytes.slice(),
        options: { crop: state.crop, scope: state.scope, currentPage: state.pageNumber - 1 },
      }, { onProgress: (value, stageText) => progress.update(value, stageText) });

      const result = await task.promise;
      progress.done('เสร็จเรียบร้อย');
      setTimeout(() => progress.remove(), 800);

      const name = outputName(state.file.name, 'cropped', 'pdf');
      await completeClientJob(gate.jobId, {
        status: 'SUCCESS', bytesOut: result.bytes.byteLength,
        processingMs: Math.round(performance.now() - startedAt), filename: name,
      });

      resultArea.appendChild(resultBox({
        title: 'ครอบตัดสำเร็จ',
        files: [{ name }],
        stats: [
          { label: 'หน้าที่ครอบตัด', value: `${result.pagesAffected} หน้า` },
          { label: 'ขนาดไฟล์', value: formatBytes(result.bytes.byteLength) },
        ],
        actions: [
          { label: 'ดาวน์โหลด', variant: 'primary', icon: 'download', onClick: () => downloadBytes(result.bytes, name) },
          { label: 'ปรับใหม่', icon: 'refresh', onClick: () => { resultArea.innerHTML = ''; } },
        ],
      }));
      toastSuccess('ครอบตัดสำเร็จ');
    } catch (err) {
      progress.remove();
      await completeClientJob(gate.jobId, {
        status: 'FAILED', errorCode: err?.code, message: err?.message,
        processingMs: Math.round(performance.now() - startedAt),
      });
      resultArea.appendChild(errorBox(err, { onRetry: apply }));
      toastError(err.message || 'ครอบตัดไม่สำเร็จ');
    }
  }

  return async () => {
    dropzone.destroy?.();
    await state.pdfDoc?.destroy?.();
    state.pdfDoc = null;
    state.bytes = null;
    if (state.canvas) { state.canvas.width = 0; state.canvas.height = 0; }
    revokeAll();
    releaseWorker();
  };
}
