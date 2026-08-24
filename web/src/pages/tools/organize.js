/**
 * จัดหน้า PDF — เรียงลำดับ หมุน ลบ ทำสำเนา และแยกหน้าออกมา (spec ข้อ 15)
 * เรนเดอร์ thumbnail แบบ lazy เฉพาะหน้าที่มองเห็น เพื่อรองรับไฟล์หลายร้อยหน้า
 */
import { toolHeader, stepsBar, createProgress, resultBox, errorBox } from '../../ui/workflow.js';
import { createDropzone } from '../../ui/dropzone.js';
import { openDocument, createLazyRenderer } from '../../pdf/render.js';
import { runPdfTask, releaseWorker } from '../../pdf/worker-client.js';
import { fileToBytes, createZip } from '../../pdf/ops-core.js';
import { downloadBytes, downloadBlob, revokeAll } from '../../utils/download.js';
import { outputName, formatBytes, escapeHtml } from '../../utils/format.js';
import { startClientJob, completeClientJob } from '../../services/jobs.js';
import { toastError, toastSuccess, toastInfo } from '../../ui/toast.js';
import { confirmDialog } from '../../ui/modal.js';
import icon from '../../ui/icons.js';

export default async function OrganizePage({ root, tool }) {
  const state = { file: null, bytes: null, pdfDoc: null, pages: [], renderer: null, selected: new Set() };

  root.innerHTML = `
    ${toolHeader(tool)}
    <div id="steps"></div>
    <div class="notice">${icon('lock', { size: 18 })}
      <div style="font-size:13px">ไฟล์ของคุณประมวลผลบนเครื่องนี้ทั้งหมด ไม่มีการอัปโหลดขึ้นเซิร์ฟเวอร์</div></div>
    <div id="upload-area"></div>
    <div id="workspace" hidden></div>
    <div id="progress-area"></div>
    <div id="result-area"></div>`;

  const stepsEl = root.querySelector('#steps');
  const uploadArea = root.querySelector('#upload-area');
  const workspace = root.querySelector('#workspace');
  const progressArea = root.querySelector('#progress-area');
  const resultArea = root.querySelector('#result-area');

  const STEPS = ['เลือกไฟล์', 'จัดหน้า', 'บันทึก'];
  const renderSteps = (index) => { stepsEl.innerHTML = stepsBar(STEPS, index); };
  renderSteps(0);

  const dropzone = createDropzone({
    accept: 'application/pdf,.pdf',
    acceptKinds: ['pdf'],
    multiple: false,
    title: 'ลากไฟล์ PDF มาวางที่นี่',
    onFiles: async (files) => { await loadFile(files[0]); },
  });
  uploadArea.appendChild(dropzone);

  async function loadFile(file) {
    try {
      state.file = file;
      state.bytes = await fileToBytes(file);
      state.pdfDoc = await openDocument(state.bytes.slice());
      state.pages = Array.from({ length: state.pdfDoc.numPages }, (_, index) => ({
        id: `p${index}`,
        sourceIndex: index,
        rotation: 0,
        deleted: false,
      }));
      state.selected.clear();
      uploadArea.hidden = true;
      workspace.hidden = false;
      renderSteps(1);
      renderWorkspace();
    } catch (err) {
      toastError(err.message || 'เปิดไฟล์ไม่สำเร็จ');
      resultArea.appendChild(errorBox(err, { onNewFile: () => { uploadArea.hidden = false; dropzone.openPicker(); } }));
    }
  }

  function renderWorkspace() {
    const activePages = state.pages.filter((page) => !page.deleted);
    workspace.innerHTML = `
      <div class="card" style="position:sticky;top:calc(var(--header-height) + 8px);z-index:20">
        <div style="display:flex;flex-wrap:wrap;gap:7px;align-items:center">
          <span style="font-size:13px;color:var(--text-muted);margin-right:auto">
            เลือกอยู่ <strong id="sel-count">${state.selected.size}</strong> หน้า · เหลือ ${activePages.length} หน้า
          </span>
          <button class="btn btn--sm" data-bulk="all">เลือกทั้งหมด</button>
          <button class="btn btn--sm" data-bulk="none">ล้างที่เลือก</button>
          <button class="btn btn--sm" data-bulk="rotate-left">${icon('rotate', { size: 15 })} หมุนซ้าย</button>
          <button class="btn btn--sm" data-bulk="rotate-right">${icon('rotate', { size: 15 })} หมุนขวา</button>
          <button class="btn btn--sm" data-bulk="duplicate">${icon('copy', { size: 15 })} ทำสำเนา</button>
          <button class="btn btn--sm btn--danger" data-bulk="delete">${icon('trash', { size: 15 })} ลบ</button>
        </div>
      </div>
      <div class="page-grid" id="page-grid" style="margin-top:14px"></div>
      <div style="display:flex;gap:9px;margin-top:18px;flex-wrap:wrap">
        <button class="btn btn--primary btn--lg" id="save-btn" style="flex:2 1 200px">
          ${icon('check', { size: 19 })} บันทึกเป็นไฟล์ใหม่
        </button>
        <button class="btn btn--lg" id="extract-btn" style="flex:1 1 160px">
          ${icon('split', { size: 18 })} แยกหน้าที่เลือก
        </button>
        <button class="btn btn--lg" id="reset-btn" style="flex:1 1 120px">
          ${icon('refresh', { size: 18 })} เริ่มใหม่
        </button>
      </div>`;

    const grid = workspace.querySelector('#page-grid');
    state.renderer?.disconnect();
    state.renderer = createLazyRenderer(state.pdfDoc, { maxWidth: 200 });

    state.pages.forEach((page, position) => {
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb';
      thumb.dataset.index = String(position);
      thumb.dataset.page = String(page.sourceIndex + 1);
      thumb.dataset.selected = String(state.selected.has(page.id));
      thumb.dataset.deleted = String(page.deleted);
      thumb.setAttribute('draggable', 'true');
      thumb.setAttribute('role', 'button');
      thumb.setAttribute('tabindex', '0');
      thumb.setAttribute('aria-label', `หน้า ${position + 1}${page.deleted ? ' (ลบแล้ว)' : ''}`);
      thumb.innerHTML = `
        <div class="page-thumb__skeleton" style="transform:rotate(${page.rotation}deg)"></div>
        <span class="page-thumb__num">${position + 1}</span>
        <span class="page-thumb__tools">
          <button type="button" data-act="rotate" aria-label="หมุนหน้านี้">${icon('rotate', { size: 13 })}</button>
          <button type="button" data-act="delete" aria-label="${page.deleted ? 'กู้คืนหน้านี้' : 'ลบหน้านี้'}">
            ${icon(page.deleted ? 'refresh' : 'trash', { size: 13 })}
          </button>
        </span>`;

      thumb.addEventListener('click', (event) => {
        if (event.target.closest('[data-act]')) return;
        if (state.selected.has(page.id)) state.selected.delete(page.id);
        else state.selected.add(page.id);
        thumb.dataset.selected = String(state.selected.has(page.id));
        workspace.querySelector('#sel-count').textContent = String(state.selected.size);
      });
      thumb.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); thumb.click(); }
      });
      thumb.querySelector('[data-act="rotate"]').addEventListener('click', () => {
        page.rotation = (page.rotation + 90) % 360;
        const media = thumb.querySelector('img, .page-thumb__skeleton');
        if (media) media.style.transform = `rotate(${page.rotation}deg)`;
      });
      thumb.querySelector('[data-act="delete"]').addEventListener('click', () => {
        page.deleted = !page.deleted;
        renderWorkspace();
      });

      grid.appendChild(thumb);
      state.renderer.observe(thumb);
    });

    // ลากเพื่อจัดลำดับ
    import('../../ui/dropzone.js').then(({ makeSortable }) => {
      makeSortable(grid, {
        itemSelector: '.page-thumb',
        onReorder: (from, to) => {
          const [moved] = state.pages.splice(from, 1);
          state.pages.splice(to, 0, moved);
          renderWorkspace();
        },
      });
    });

    workspace.querySelectorAll('[data-bulk]').forEach((button) => {
      button.addEventListener('click', () => handleBulk(button.dataset.bulk));
    });
    workspace.querySelector('#save-btn').addEventListener('click', () => save('save'));
    workspace.querySelector('#extract-btn').addEventListener('click', () => save('extract'));
    workspace.querySelector('#reset-btn').addEventListener('click', async () => {
      if (await confirmDialog({ title: 'เริ่มใหม่', message: 'การเปลี่ยนแปลงทั้งหมดจะหายไป ต้องการดำเนินการต่อหรือไม่' })) {
        await loadFile(state.file);
      }
    });
  }

  function handleBulk(action) {
    const targets = state.pages.filter((page) => state.selected.has(page.id));
    if (action === 'all') { state.pages.forEach((page) => state.selected.add(page.id)); renderWorkspace(); return; }
    if (action === 'none') { state.selected.clear(); renderWorkspace(); return; }
    if (!targets.length) { toastInfo('กรุณาเลือกหน้าที่ต้องการก่อน'); return; }

    if (action === 'rotate-left') targets.forEach((page) => { page.rotation = (page.rotation + 270) % 360; });
    if (action === 'rotate-right') targets.forEach((page) => { page.rotation = (page.rotation + 90) % 360; });
    if (action === 'delete') targets.forEach((page) => { page.deleted = true; });
    if (action === 'duplicate') {
      targets.forEach((page) => {
        const position = state.pages.indexOf(page);
        state.pages.splice(position + 1, 0, { ...page, id: `${page.id}_copy${Date.now()}${position}` });
      });
    }
    if (action === 'delete') state.selected.clear();
    renderWorkspace();
  }

  async function save(mode) {
    const source = mode === 'extract'
      ? state.pages.filter((page) => state.selected.has(page.id) && !page.deleted)
      : state.pages.filter((page) => !page.deleted);

    if (!source.length) {
      toastError(mode === 'extract' ? 'กรุณาเลือกหน้าที่ต้องการแยกออกมา' : 'ต้องเหลืออย่างน้อย 1 หน้า');
      return;
    }

    renderSteps(2);
    resultArea.innerHTML = '';
    const progress = createProgress();
    progressArea.innerHTML = '';
    progressArea.appendChild(progress.element);

    const gate = await startClientJob(tool.id, { fileCount: 1, bytesIn: state.bytes.byteLength });
    if (!gate.allowed) {
      progress.remove();
      toastError(gate.reason);
      return;
    }

    const startedAt = performance.now();
    try {
      const task = runPdfTask('organize', {
        bytes: state.bytes.slice(),
        pages: source.map((page) => ({ index: page.sourceIndex, rotation: page.rotation })),
      }, { onProgress: (value, stage) => progress.update(value, stage) });

      const { bytes } = await task.promise;
      progress.done('เสร็จเรียบร้อย');
      setTimeout(() => progress.remove(), 800);

      const name = outputName(state.file.name, mode === 'extract' ? 'extracted' : 'organized', 'pdf');
      await completeClientJob(gate.jobId, {
        status: 'SUCCESS', bytesOut: bytes.byteLength,
        processingMs: Math.round(performance.now() - startedAt), filename: name,
      });

      resultArea.appendChild(resultBox({
        title: mode === 'extract' ? 'แยกหน้าสำเร็จ' : 'บันทึกไฟล์สำเร็จ',
        files: [{ name }],
        stats: [
          { label: 'จำนวนหน้า', value: `${source.length} หน้า` },
          { label: 'ขนาดไฟล์', value: formatBytes(bytes.byteLength) },
        ],
        actions: [
          { label: 'ดาวน์โหลด', variant: 'primary', icon: 'download', onClick: () => downloadBytes(bytes, name) },
          { label: 'แก้ไขต่อ', icon: 'edit', onClick: () => { renderSteps(1); resultArea.innerHTML = ''; } },
        ],
      }));
      toastSuccess('บันทึกไฟล์สำเร็จ');
    } catch (err) {
      progress.remove();
      renderSteps(1);
      await completeClientJob(gate.jobId, {
        status: 'FAILED', errorCode: err?.code || 'PROCESSING_FAILED', message: err?.message,
        processingMs: Math.round(performance.now() - startedAt),
      });
      resultArea.appendChild(errorBox(err, { onRetry: () => save(mode) }));
      toastError(err.message || 'บันทึกไฟล์ไม่สำเร็จ');
    }
  }

  return async () => {
    state.renderer?.disconnect();
    dropzone.destroy?.();
    await state.pdfDoc?.destroy?.();
    state.pdfDoc = null;
    state.bytes = null;
    state.pages = [];
    revokeAll();
    releaseWorker();
  };
}
