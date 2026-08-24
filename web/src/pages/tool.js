/**
 * หน้าเครื่องมือแบบรวม — ใช้โครงเดียวกันทุกเครื่องมือ (spec ข้อ 101)
 * เลือกไฟล์ -> ตั้งค่า -> ประมวลผล -> ดาวน์โหลด (3 ขั้นตอนหลัก ตาม spec ข้อ 100)
 *
 * เครื่องมือที่ต้องมีหน้าจอโต้ตอบเฉพาะทาง (จัดหน้า/เซ็น/แก้ไข/ครอบตัด)
 * จะถูกโหลดเป็นโมดูลแยกแบบ lazy
 */
import { getTool, acceptAttr } from '../core/tools.js';
import { navigate } from '../core/router.js';
import appState from '../core/state.js';
import icon from '../ui/icons.js';
import { toolHeader, stepsBar, createProgress, resultBox, errorBox } from '../ui/workflow.js';
import { createDropzone } from '../ui/dropzone.js';
import { toastError, toastSuccess, toastWarning } from '../ui/toast.js';
import { revokeAll } from '../utils/download.js';
import { releaseWorker } from '../pdf/worker-client.js';
import { escapeHtml } from '../utils/format.js';

/** เครื่องมือที่มีหน้าจอเฉพาะของตัวเอง */
const CUSTOM_PAGES = {
  organize: () => import('./tools/organize.js'),
  sign: () => import('./tools/sign.js'),
  edit: () => import('./tools/edit.js'),
  crop: () => import('./tools/crop.js'),
};

export default async function ToolPage({ root, params, query }) {
  const tool = getTool(params.id);
  if (!tool) {
    navigate('/tools', { replace: true });
    return null;
  }

  // เครื่องมือที่ทำงานบนเซิร์ฟเวอร์ ต้องออนไลน์เท่านั้น
  const state = appState.get();
  if (tool.runsOn === 'server' && !state.online) {
    root.innerHTML = `
      ${toolHeader(tool, state.language)}
      <div class="notice notice--warn">${icon('alert', { size: 20 })}
        <div><strong>เครื่องมือนี้ต้องเชื่อมต่ออินเทอร์เน็ต</strong>
        <p style="margin:4px 0 0;font-size:13px">ขณะนี้อุปกรณ์ของคุณออฟไลน์อยู่ เครื่องมือที่ประมวลผลบนเครื่อง เช่น รวม แยก และแปลงรูป ยังใช้งานได้ตามปกติ</p></div>
      </div>
      <a class="btn btn--primary btn--block" href="/tools" data-link>ดูเครื่องมือที่ใช้ออฟไลน์ได้</a>`;
    return null;
  }

  if (CUSTOM_PAGES[tool.id]) {
    const module = await CUSTOM_PAGES[tool.id]();
    return module.default({ root, tool, query });
  }

  const { createRunner } = await import('./tool-runners.js');
  const runner = createRunner(tool);

  const ctx = {
    tool,
    files: [],
    options: { ...(runner.defaults || {}) },
    result: null,
    currentTask: null,
    lang: state.language,
  };

  root.innerHTML = `
    ${toolHeader(tool, ctx.lang)}
    <div id="steps"></div>
    ${tool.runsOn === 'server' ? `
      <div class="notice">${icon('info', { size: 18 })}
        <div style="font-size:13px">เครื่องมือนี้ต้องส่งไฟล์ไปประมวลผลบนเซิร์ฟเวอร์
        ไฟล์จะถูกลบอัตโนมัติภายใน 30 นาที และไม่ถูกเก็บถาวร</div></div>` : `
      <div class="notice">${icon('lock', { size: 18 })}
        <div style="font-size:13px">ไฟล์ของคุณประมวลผลบนเครื่องนี้ทั้งหมด ไม่มีการอัปโหลดขึ้นเซิร์ฟเวอร์</div></div>`}
    <div id="upload-area"></div>
    <div id="file-area"></div>
    <div id="options-area"></div>
    <div id="run-area"></div>
    <div id="progress-area"></div>
    <div id="result-area"></div>`;

  const stepsEl = root.querySelector('#steps');
  const uploadArea = root.querySelector('#upload-area');
  const fileArea = root.querySelector('#file-area');
  const optionsArea = root.querySelector('#options-area');
  const runArea = root.querySelector('#run-area');
  const progressArea = root.querySelector('#progress-area');
  const resultArea = root.querySelector('#result-area');

  const STEPS = runner.steps || ['เลือกไฟล์', 'ตั้งค่า', 'ดาวน์โหลด'];
  const renderSteps = (index) => { stepsEl.innerHTML = stepsBar(STEPS, index); };
  renderSteps(0);

  const dropzone = createDropzone({
    accept: acceptAttr(tool),
    acceptKinds: tool.accept || ['pdf'],
    multiple: Boolean(tool.multiple),
    maxFiles: tool.multiple ? 30 : 1,
    title: tool.multiple ? 'ลากไฟล์มาวางที่นี่' : 'ลากไฟล์มาวางที่นี่',
    hint: 'หรือแตะเพื่อเลือกไฟล์จากเครื่อง',
    onFiles: async (files) => {
      ctx.files = tool.multiple ? [...ctx.files, ...files] : files.slice(0, 1);
      await refresh();
    },
  });
  uploadArea.appendChild(dropzone);

  async function refresh() {
    resultArea.innerHTML = '';
    progressArea.innerHTML = '';
    ctx.result = null;

    if (!ctx.files.length) {
      renderSteps(0);
      fileArea.innerHTML = '';
      optionsArea.innerHTML = '';
      runArea.innerHTML = '';
      uploadArea.hidden = false;
      return;
    }

    renderSteps(1);
    uploadArea.hidden = !tool.multiple;
    await renderFiles();
    await renderOptions();
    renderRunButton();
  }

  async function renderFiles() {
    const { fileListItem, makeSortable } = await import('../ui/dropzone.js');
    fileArea.innerHTML = `<div class="section-title"><h2>ไฟล์ที่เลือก (${ctx.files.length})</h2>
      ${ctx.files.length > 1 ? '<span style="font-size:12.5px;color:var(--text-muted)">ลากเพื่อจัดลำดับ</span>' : ''}</div>
      <div class="file-list" id="file-list"></div>`;
    const list = fileArea.querySelector('#file-list');

    ctx.files.forEach((file, index) => {
      list.appendChild(fileListItem(file, {
        index,
        draggable: ctx.files.length > 1,
        onRemove: async (i) => { ctx.files.splice(i, 1); await refresh(); },
        onMoveUp: ctx.files.length > 1 && index > 0
          ? async (i) => { [ctx.files[i - 1], ctx.files[i]] = [ctx.files[i], ctx.files[i - 1]]; await refresh(); }
          : null,
        onMoveDown: ctx.files.length > 1 && index < ctx.files.length - 1
          ? async (i) => { [ctx.files[i + 1], ctx.files[i]] = [ctx.files[i], ctx.files[i + 1]]; await refresh(); }
          : null,
      }));
    });

    if (ctx.files.length > 1) {
      makeSortable(list, {
        onReorder: async (from, to) => {
          const [moved] = ctx.files.splice(from, 1);
          ctx.files.splice(to, 0, moved);
          await refresh();
        },
      });
    }
  }

  async function renderOptions() {
    optionsArea.innerHTML = '';
    if (!runner.renderOptions) return;
    const panel = document.createElement('div');
    panel.className = 'card';
    panel.innerHTML = '<div class="card__title">ตั้งค่า</div>';
    const body = document.createElement('div');
    panel.appendChild(body);
    optionsArea.appendChild(panel);
    await runner.renderOptions(body, ctx, { refresh });
  }

  function renderRunButton() {
    runArea.innerHTML = `
      <button class="btn btn--primary btn--lg btn--block" id="run-btn" style="margin-top:14px">
        ${icon(tool.icon, { size: 19 })}<span>${escapeHtml(runner.actionLabel || 'เริ่มประมวลผล')}</span>
      </button>`;
    runArea.querySelector('#run-btn').addEventListener('click', run);
  }

  async function run() {
    const runButton = runArea.querySelector('#run-btn');
    runButton.disabled = true;
    resultArea.innerHTML = '';
    renderSteps(2);

    const progress = createProgress({
      onCancel: () => {
        ctx.currentTask?.cancel?.();
        toastWarning('ยกเลิกงานแล้ว');
      },
    });
    progressArea.innerHTML = '';
    progressArea.appendChild(progress.element);

    const startedAt = performance.now();
    try {
      const output = await runner.run(ctx, {
        onProgress: (value, stage) => progress.update(value, stage),
        setTask: (task) => { ctx.currentTask = task; },
      });

      progress.done('เสร็จเรียบร้อย');
      setTimeout(() => progress.remove(), 900);

      const box = resultBox({
        title: output.title || 'เสร็จเรียบร้อย',
        files: output.files || [],
        stats: output.stats || [],
        note: output.note || '',
        actions: buildActions(output),
      });
      resultArea.innerHTML = '';
      resultArea.appendChild(box);
      ctx.result = output;
      renderSteps(3);
      toastSuccess('ประมวลผลสำเร็จ');

      if (output.warning) toastWarning(output.warning, { duration: 7000 });
      console.info(`[${tool.id}] ใช้เวลา ${Math.round(performance.now() - startedAt)} ms`);
    } catch (err) {
      progress.remove();
      renderSteps(1);
      if (err?.code === 'CANCELLED' || err?.errorCode === 'CANCELLED') {
        resultArea.innerHTML = '';
      } else {
        console.error(`[${tool.id}] failed`, err);
        resultArea.appendChild(errorBox(err, {
          onRetry: () => run(),
          onNewFile: async () => { ctx.files = []; await refresh(); dropzone.openPicker(); },
        }));
        toastError(err?.message || 'ประมวลผลไม่สำเร็จ');
      }
    } finally {
      ctx.currentTask = null;
      runButton.disabled = false;
    }
  }

  function buildActions(output) {
    const actions = [];
    if (output.onDownload) {
      actions.push({
        label: output.downloadLabel || 'ดาวน์โหลด',
        variant: 'primary',
        icon: 'download',
        onClick: () => output.onDownload(),
      });
    }
    if (output.onShare) {
      actions.push({ label: 'แชร์', icon: 'share', onClick: () => output.onShare() });
    }
    actions.push({
      label: 'ทำอีกครั้ง',
      icon: 'refresh',
      onClick: async () => { await refresh(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    });
    actions.push({
      label: 'ไฟล์ใหม่',
      icon: 'plus',
      onClick: async () => { ctx.files = []; await refresh(); dropzone.openPicker(); },
    });
    return actions;
  }

  // เปิดหน้าต่างเลือกไฟล์ให้อัตโนมัติเมื่อมาจากปุ่มลัด
  if (query.pick === '1') setTimeout(() => dropzone.openPicker(), 250);

  // cleanup: ยกเลิกงานค้าง คืน Blob URL และปิด worker (spec ข้อ 70)
  return () => {
    ctx.currentTask?.cancel?.();
    dropzone.destroy?.();
    revokeAll();
    releaseWorker();
    ctx.files = [];
    ctx.result = null;
  };
}
