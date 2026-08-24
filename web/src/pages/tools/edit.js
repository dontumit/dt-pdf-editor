/**
 * PDF Editor แบบมองเห็นผลจริง (spec ข้อ 26, 27)
 * เพิ่มข้อความ / รูป / ลายเซ็น / วันที่ / ช่องติ๊ก / ไฮไลต์ / เส้นใต้
 * รองรับ undo-redo, บันทึกอัตโนมัติลง IndexedDB และกู้คืนเมื่อเบราว์เซอร์ปิดกลางคัน
 *
 * ใช้เป็นหน้าเดียวกับเครื่องมือ "เซ็นเอกสาร" โดยเปิดแผงลายเซ็นให้ตั้งแต่ต้น
 */
import { toolHeader, createProgress, resultBox, errorBox } from '../../ui/workflow.js';
import { createDropzone } from '../../ui/dropzone.js';
import { openDocument } from '../../pdf/render.js';
import { createPlacementCanvas, createSignaturePad } from './placement.js';
import { runPdfTask, releaseWorker } from '../../pdf/worker-client.js';
import { fileToBytes } from '../../pdf/ops-core.js';
import { downloadBytes, revokeAll } from '../../utils/download.js';
import { outputName, formatBytes, formatDate, escapeHtml } from '../../utils/format.js';
import { startClientJob, completeClientJob } from '../../services/jobs.js';
import { toastError, toastSuccess, toastInfo } from '../../ui/toast.js';
import { openModal } from '../../ui/modal.js';
import idb from '../../core/idb.js';
import icon from '../../ui/icons.js';

const TOOLBAR = [
  { id: 'select', label: 'เลือก', icon: 'drag' },
  { id: 'text', label: 'ข้อความ', icon: 'text' },
  { id: 'signature', label: 'ลายเซ็น', icon: 'sign' },
  { id: 'image', label: 'รูปภาพ', icon: 'image' },
  { id: 'date', label: 'วันที่', icon: 'calendar' },
  { id: 'checkbox', label: 'ช่องติ๊ก', icon: 'checkbox' },
  { id: 'highlight', label: 'ไฮไลต์', icon: 'watermark' },
  { id: 'line', label: 'ขีดเส้น', icon: 'edit' },
];

export default async function EditPage({ root, tool, query, signatureFirst = false }) {
  const state = { file: null, bytes: null, pdfDoc: null, canvas: null, projectId: null, autosaveTimer: null };

  root.innerHTML = `
    ${toolHeader(tool)}
    <div class="notice">${icon('lock', { size: 18 })}
      <div style="font-size:13px">การแก้ไขทั้งหมดทำบนเครื่องนี้ ไฟล์ไม่ถูกอัปโหลดขึ้นเซิร์ฟเวอร์ และระบบบันทึกงานค้างไว้ในเครื่องให้อัตโนมัติ</div></div>
    <div id="upload-area"></div>
    <div id="workspace" hidden>
      <div class="editor">
        <div>
          <div class="editor__toolbar" id="toolbar" role="toolbar" aria-label="เครื่องมือแก้ไข"></div>
          <div class="card" id="inspector" style="margin-top:10px"></div>
        </div>
        <div>
          <div style="display:flex;gap:7px;margin-bottom:9px;flex-wrap:wrap">
            <button class="btn btn--sm" id="undo-btn">${icon('undo', { size: 15 })} ย้อนกลับ</button>
            <button class="btn btn--sm" id="redo-btn">${icon('redo', { size: 15 })} ทำซ้ำ</button>
            <button class="btn btn--sm btn--danger" id="delete-btn">${icon('trash', { size: 15 })} ลบที่เลือก</button>
            <button class="btn btn--sm btn--primary" id="save-btn" style="margin-left:auto">${icon('check', { size: 15 })} บันทึกไฟล์</button>
          </div>
          <div id="stage"></div>
        </div>
      </div>
    </div>
    <div id="progress-area"></div>
    <div id="result-area"></div>`;

  const uploadArea = root.querySelector('#upload-area');
  const workspace = root.querySelector('#workspace');
  const stage = root.querySelector('#stage');
  const inspector = root.querySelector('#inspector');
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
      toastInfo('กำลังเปิดเอกสาร...');
      state.file = file;
      state.bytes = await fileToBytes(file);
      state.pdfDoc = await openDocument(state.bytes.slice());
      state.projectId = `proj_${Date.now().toString(36)}`;

      uploadArea.hidden = true;
      workspace.hidden = false;

      state.canvas = createPlacementCanvas({
        pdfDoc: state.pdfDoc,
        container: stage,
        onChange: () => { scheduleAutosave(); renderInspector(state.canvas.state.elements.find((el) => el.id === state.canvas.state.selectedId)); },
        onSelect: renderInspector,
      });
      await state.canvas.renderPages();

      renderToolbar();
      renderInspector(null);
      if (signatureFirst) setTimeout(openSignatureDialog, 400);
    } catch (err) {
      toastError(err.message || 'เปิดไฟล์ไม่สำเร็จ');
      resultArea.appendChild(errorBox(err, { onNewFile: () => { uploadArea.hidden = false; dropzone.openPicker(); } }));
    }
  }

  function renderToolbar() {
    const toolbar = root.querySelector('#toolbar');
    toolbar.innerHTML = TOOLBAR.map((item) => `
      <button class="editor__tool" type="button" data-tool="${item.id}" aria-pressed="false">
        ${icon(item.icon, { size: 17 })}<span>${item.label}</span>
      </button>`).join('');

    toolbar.querySelectorAll('[data-tool]').forEach((button) => {
      button.addEventListener('click', () => handleToolClick(button.dataset.tool));
    });

    root.querySelector('#undo-btn').addEventListener('click', () => state.canvas.undo());
    root.querySelector('#redo-btn').addEventListener('click', () => state.canvas.redo());
    root.querySelector('#delete-btn').addEventListener('click', () => {
      if (state.canvas.state.selectedId) state.canvas.removeElement(state.canvas.state.selectedId);
      else toastInfo('เลือกองค์ประกอบที่ต้องการลบก่อน');
    });
    root.querySelector('#save-btn').addEventListener('click', save);
  }

  const currentPage = () => state.canvas.state.currentPage || 0;

  async function handleToolClick(toolId) {
    if (toolId === 'select') { state.canvas.select(null); return; }

    if (toolId === 'text') {
      state.canvas.addElement({
        type: 'text', pageIndex: currentPage(), x: 0.12, y: 0.12,
        width: 0.4, height: 0.05, text: 'ข้อความใหม่', fontSize: 16, color: '#111827',
      });
      return;
    }
    if (toolId === 'date') {
      state.canvas.addElement({
        type: 'text', pageIndex: currentPage(), x: 0.62, y: 0.12,
        width: 0.28, height: 0.04, text: formatDate(Date.now(), { withTime: false }), fontSize: 14, color: '#111827',
      });
      return;
    }
    if (toolId === 'checkbox') {
      state.canvas.addElement({
        type: 'checkbox', pageIndex: currentPage(), x: 0.12, y: 0.2,
        width: 0.03, height: 0.022, fontSize: 16, checked: true,
      });
      return;
    }
    if (toolId === 'highlight') {
      state.canvas.addElement({
        type: 'rect', pageIndex: currentPage(), x: 0.12, y: 0.3,
        width: 0.4, height: 0.03, color: '#fde047', opacity: 0.4,
      });
      return;
    }
    if (toolId === 'line') {
      state.canvas.addElement({
        type: 'line', pageIndex: currentPage(), x: 0.12, y: 0.4,
        width: 0.4, height: 0.001, color: '#111827', thickness: 1.4,
      });
      return;
    }
    if (toolId === 'image') { pickImage(); return; }
    if (toolId === 'signature') { openSignatureDialog(); }
  }

  function pickImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      const image = new Image();
      image.onload = () => {
        const width = 0.3;
        state.canvas.addElement({
          type: 'image', pageIndex: currentPage(), x: 0.15, y: 0.15,
          width, height: width * (image.height / image.width) * 0.707, src: dataUrl,
        });
      };
      image.src = dataUrl;
    });
    input.click();
  }

  function openSignatureDialog() {
    const pad = createSignaturePad({});
    openModal({
      title: 'สร้างลายเซ็น',
      body: pad,
      actions: [
        { label: 'ยกเลิก' },
        {
          label: 'ใช้ลายเซ็นนี้',
          variant: 'primary',
          onClick: ({ close }) => {
            const signature = pad.getSignature();
            if (!signature) { toastError('กรุณาวาด อัปโหลด หรือพิมพ์ลายเซ็นก่อน'); return false; }
            const width = 0.26;
            state.canvas.addElement({
              type: 'signature', pageIndex: currentPage(), x: 0.6, y: 0.75,
              width, height: width * (signature.height / signature.width) * 0.707, src: signature.dataUrl,
            });
            close(true);
            toastSuccess('เพิ่มลายเซ็นแล้ว ลากเพื่อจัดตำแหน่งได้');
            return true;
          },
        },
      ],
    });
  }

  function renderInspector(element) {
    if (!element) {
      inspector.innerHTML = `
        <div class="card__title">คุณสมบัติ</div>
        <p class="card__hint" style="margin:0">แตะองค์ประกอบบนเอกสารเพื่อแก้ไขคุณสมบัติ<br>
        ใช้ปุ่มลูกศรเพื่อขยับทีละน้อย · Ctrl+Z ย้อนกลับ · Delete ลบ</p>`;
      return;
    }

    const isText = element.type === 'text';
    inspector.innerHTML = `
      <div class="card__title">คุณสมบัติ</div>
      ${isText ? `
        <div class="field">
          <label class="field__label">ข้อความ</label>
          <textarea id="prop-text" rows="3">${escapeHtml(element.text || '')}</textarea>
        </div>
        <div class="field">
          <label class="field__label">ขนาดตัวอักษร <span id="prop-size-out" style="color:var(--brand);font-weight:700">${element.fontSize || 14}</span> pt</label>
          <input type="range" id="prop-size" min="7" max="60" value="${element.fontSize || 14}">
        </div>` : ''}
      ${element.type === 'checkbox' ? `
        <div class="switch"><div style="font-weight:600;font-size:14px">ติ๊กถูก</div>
          <span class="switch__control"><input type="checkbox" id="prop-checked" ${element.checked ? 'checked' : ''}>
          <span class="switch__track"></span></span></div>` : ''}
      ${['text', 'rect', 'line'].includes(element.type) ? `
        <div class="field"><label class="field__label">สี</label>
          <input type="color" id="prop-color" value="${element.color || '#111827'}" style="width:64px;height:40px;padding:3px;border-radius:12px"></div>` : ''}
      <div class="field">
        <label class="field__label">ความทึบ <span id="prop-opacity-out" style="color:var(--brand);font-weight:700">${Math.round((element.opacity ?? 1) * 100)}%</span></label>
        <input type="range" id="prop-opacity" min="10" max="100" value="${Math.round((element.opacity ?? 1) * 100)}">
      </div>
      <div class="field">
        <label class="field__label">หน้าที่ ${element.pageIndex + 1}</label>
        <div class="field__hint" style="margin:0">ลากองค์ประกอบไปยังหน้าอื่นได้โดยเพิ่มใหม่ในหน้านั้น</div>
      </div>
      <button class="btn btn--sm btn--danger btn--block" id="prop-delete">${icon('trash', { size: 15 })} ลบองค์ประกอบนี้</button>`;

    inspector.querySelector('#prop-text')?.addEventListener('input', (event) => {
      state.canvas.updateElement(element.id, { text: event.target.value }, { history: false });
    });
    inspector.querySelector('#prop-size')?.addEventListener('input', (event) => {
      inspector.querySelector('#prop-size-out').textContent = event.target.value;
      state.canvas.updateElement(element.id, { fontSize: Number(event.target.value) }, { history: false });
    });
    inspector.querySelector('#prop-color')?.addEventListener('input', (event) => {
      state.canvas.updateElement(element.id, { color: event.target.value }, { history: false });
    });
    inspector.querySelector('#prop-opacity')?.addEventListener('input', (event) => {
      inspector.querySelector('#prop-opacity-out').textContent = `${event.target.value}%`;
      state.canvas.updateElement(element.id, { opacity: Number(event.target.value) / 100 }, { history: false });
    });
    inspector.querySelector('#prop-checked')?.addEventListener('change', (event) => {
      state.canvas.updateElement(element.id, { checked: event.target.checked });
    });
    inspector.querySelector('#prop-delete')?.addEventListener('click', () => state.canvas.removeElement(element.id));
  }

  /** บันทึกอัตโนมัติลง IndexedDB (spec ข้อ 106) */
  function scheduleAutosave() {
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(async () => {
      try {
        await idb.saveProject(state.projectId, {
          toolId: tool.id,
          toolName: tool.name.th,
          fileName: state.file?.name,
          elements: state.canvas.getElements(),
          completed: false,
        });
      } catch { /* โควตาเต็มก็ไม่ต้องรบกวนผู้ใช้ */ }
    }, 1200);
  }

  async function save() {
    const elements = state.canvas.getElements();
    if (!elements.length) { toastInfo('ยังไม่มีองค์ประกอบที่จะบันทึก'); return; }

    resultArea.innerHTML = '';
    const progress = createProgress();
    progressArea.innerHTML = '';
    progressArea.appendChild(progress.element);

    const gate = await startClientJob(tool.id, { fileCount: 1, bytesIn: state.bytes.byteLength });
    if (!gate.allowed) { progress.remove(); toastError(gate.reason); return; }

    const startedAt = performance.now();
    try {
      const task = runPdfTask('applyElements', {
        bytes: state.bytes.slice(),
        elements,
      }, { onProgress: (value, stageText) => progress.update(value, stageText) });

      const result = await task.promise;
      progress.done('เสร็จเรียบร้อย');
      setTimeout(() => progress.remove(), 800);

      const name = outputName(state.file.name, tool.id === 'sign' ? 'signed' : 'edited', 'pdf');
      await completeClientJob(gate.jobId, {
        status: 'SUCCESS', bytesOut: result.bytes.byteLength,
        processingMs: Math.round(performance.now() - startedAt), filename: name,
      });
      await idb.saveProject(state.projectId, { toolId: tool.id, completed: true });

      resultArea.appendChild(resultBox({
        title: 'บันทึกไฟล์สำเร็จ',
        files: [{ name }],
        stats: [
          { label: 'องค์ประกอบ', value: `${elements.length} รายการ` },
          { label: 'ขนาดไฟล์', value: formatBytes(result.bytes.byteLength) },
        ],
        actions: [
          { label: 'ดาวน์โหลด', variant: 'primary', icon: 'download', onClick: () => downloadBytes(result.bytes, name) },
          { label: 'แก้ไขต่อ', icon: 'edit', onClick: () => { resultArea.innerHTML = ''; } },
        ],
      }));
      if (result.warning) toastError(result.warning);
      toastSuccess('บันทึกไฟล์สำเร็จ');
    } catch (err) {
      progress.remove();
      await completeClientJob(gate.jobId, {
        status: 'FAILED', errorCode: err?.code, message: err?.message,
        processingMs: Math.round(performance.now() - startedAt),
      });
      resultArea.appendChild(errorBox(err, { onRetry: save }));
      toastError(err.message || 'บันทึกไฟล์ไม่สำเร็จ');
    }
  }

  // กู้คืนงานค้าง
  if (query?.restore) {
    const project = await idb.getProject(query.restore);
    if (project?.data?.elements?.length) {
      toastInfo('กรุณาเลือกไฟล์เดิมอีกครั้งเพื่อกู้คืนงานที่ค้างไว้');
      const pendingElements = project.data.elements;
      const originalLoad = loadFile;
      // หลังผู้ใช้เลือกไฟล์ ค่อยใส่องค์ประกอบเดิมกลับเข้าไป
      dropzone.addEventListener('change', () => {}, { once: true });
      setTimeout(async () => {
        const waitForCanvas = setInterval(() => {
          if (state.canvas) {
            clearInterval(waitForCanvas);
            state.canvas.setElements(pendingElements);
            toastSuccess('กู้คืนงานที่ค้างไว้แล้ว');
          }
        }, 400);
        setTimeout(() => clearInterval(waitForCanvas), 60000);
      }, 100);
      void originalLoad;
    }
  }

  return async () => {
    clearTimeout(state.autosaveTimer);
    // ไม่มีองค์ประกอบ = ไม่มีอะไรให้กู้คืน ลบทิ้งเพื่อไม่ให้ค้างในเครื่องผู้ใช้
    if (state.projectId && !state.canvas?.getElements().length) {
      await idb.deleteProject(state.projectId).catch(() => {});
    }
    state.canvas?.destroy();
    dropzone.destroy?.();
    await state.pdfDoc?.destroy?.();
    state.pdfDoc = null;
    state.bytes = null;
    revokeAll();
    releaseWorker();
  };
}
