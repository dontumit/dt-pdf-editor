/**
 * สแกนเอกสารด้วยกล้อง (spec ข้อ 13)
 * ถ่ายภาพ -> ปรับ 4 มุม -> ดัดภาพให้ตรง -> ปรับความคมชัด -> สร้าง PDF
 * ทุกขั้นตอนทำบนเครื่องผู้ใช้ ไม่มีการส่งภาพออกไปที่ใด
 */
import { getTool } from '../core/tools.js';
import { toolHeader, createProgress, resultBox, errorBox } from '../ui/workflow.js';
import { warpPerspective, enhance, guessCorners, SCAN_MODES } from '../scan/image-processing.js';
import { runPdfTask, releaseWorker } from '../pdf/worker-client.js';
import { downloadBytes, downloadBlob, revokeAll } from '../utils/download.js';
import { formatBytes } from '../utils/format.js';
import { startClientJob, completeClientJob } from '../services/jobs.js';
import { toastError, toastSuccess, toastInfo } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import icon from '../ui/icons.js';

export default async function ScanPage({ root }) {
  const tool = getTool('scan');
  const state = { stream: null, pages: [], mode: 'auto', capture: null, corners: null };

  root.innerHTML = `
    ${toolHeader(tool)}
    <div class="notice">${icon('lock', { size: 18 })}
      <div style="font-size:13px">ภาพจากกล้องประมวลผลบนเครื่องนี้เท่านั้น ไม่ถูกส่งขึ้นเซิร์ฟเวอร์</div></div>
    <div id="stage"></div>
    <div id="pages-area"></div>
    <div id="progress-area"></div>
    <div id="result-area"></div>`;

  const stage = root.querySelector('#stage');
  const pagesArea = root.querySelector('#pages-area');
  const progressArea = root.querySelector('#progress-area');
  const resultArea = root.querySelector('#result-area');

  renderStart();

  function renderStart() {
    stage.innerHTML = `
      <div class="card" style="text-align:center;padding:28px 18px">
        <div style="width:80px;height:80px;margin:0 auto 16px;border-radius:26px;display:grid;place-items:center;
          background:linear-gradient(145deg,#ffe9f5,#ffd9ec);color:#ec4899;
          box-shadow:0 0 26px -4px #ec489988">${icon('camera', { size: 38 })}</div>
        <h2 style="font-size:17px;margin-bottom:6px">สแกนเอกสารด้วยกล้อง</h2>
        <p class="card__hint" style="max-width:400px;margin:0 auto 18px">
          วางเอกสารบนพื้นสีเรียบที่ตัดกับสีกระดาษ แล้วถ่ายให้เห็นครบทั้งแผ่น ระบบจะดัดมุมและปรับความคมชัดให้อัตโนมัติ
        </p>
        <div style="display:flex;gap:9px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn--primary btn--lg" id="start-camera">${icon('camera', { size: 19 })} เปิดกล้อง</button>
          <button class="btn btn--lg" id="pick-image">${icon('upload', { size: 18 })} เลือกรูปจากเครื่อง</button>
        </div>
      </div>`;

    stage.querySelector('#start-camera').addEventListener('click', startCamera);
    stage.querySelector('#pick-image').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.addEventListener('change', async () => {
        for (const file of Array.from(input.files || [])) {
          const bitmap = await createImageBitmap(file);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          bitmap.close?.();
          state.capture = canvas;
          renderAdjust();
          break; // ปรับมุมทีละรูป
        }
      });
      input.click();
    });
  }

  async function startCamera() {
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (err) {
      const messages = {
        NotAllowedError: 'คุณปฏิเสธการเข้าถึงกล้อง กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์แล้วลองใหม่',
        NotFoundError: 'ไม่พบกล้องบนอุปกรณ์นี้ ลองใช้ปุ่ม "เลือกรูปจากเครื่อง" แทน',
        NotReadableError: 'กล้องกำลังถูกใช้งานโดยแอปอื่น กรุณาปิดแอปนั้นแล้วลองใหม่',
      };
      toastError(messages[err.name] || 'เปิดกล้องไม่สำเร็จ');
      return;
    }

    stage.innerHTML = `
      <div class="scanner">
        <video id="cam" autoplay playsinline muted></video>
        <div class="scanner__overlay">
          <div style="position:absolute;inset:8%;border:2px dashed rgba(255,255,255,.75);border-radius:12px"></div>
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="field" style="margin-bottom:12px">
          <label class="field__label">โหมดสแกน</label>
          <div class="choice-group" id="mode-group">
            ${Object.entries(SCAN_MODES).map(([key, preset]) => `
              <label class="choice"><input type="radio" name="mode" value="${key}" ${key === state.mode ? 'checked' : ''}>
              <span>${preset.th}</span></label>`).join('')}
          </div>
        </div>
        <div class="scanner__controls">
          <button class="btn" id="cancel-cam">ยกเลิก</button>
          <button class="shutter" id="shutter" aria-label="ถ่ายภาพ"></button>
          <button class="btn" id="flip-cam">${icon('refresh', { size: 17 })}</button>
        </div>
      </div>`;

    const video = stage.querySelector('#cam');
    video.srcObject = state.stream;

    stage.querySelector('#mode-group').addEventListener('change', (event) => { state.mode = event.target.value; });
    stage.querySelector('#cancel-cam').addEventListener('click', () => { stopCamera(); renderStart(); renderPages(); });
    stage.querySelector('#shutter').addEventListener('click', () => capture(video));
    stage.querySelector('#flip-cam').addEventListener('click', async () => {
      stopCamera();
      state.facing = state.facing === 'user' ? 'environment' : 'user';
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: state.facing || 'user' }, audio: false,
        });
        video.srcObject = state.stream;
      } catch { toastError('สลับกล้องไม่สำเร็จ'); }
    });
  }

  function capture(video) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    state.capture = canvas;
    stopCamera();
    renderAdjust();
  }

  function stopCamera() {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  /** หน้าปรับ 4 มุมก่อนดัดภาพ */
  function renderAdjust() {
    const source = state.capture;
    state.corners = guessCorners(source);

    const displayWidth = Math.min(560, stage.clientWidth || 560);
    const scale = displayWidth / source.width;
    const displayHeight = source.height * scale;

    stage.innerHTML = `
      <div class="card">
        <div class="card__title">ปรับให้กรอบครอบเอกสารพอดี</div>
        <div class="scanner" id="adjust-stage" style="position:relative;background:#111;width:${displayWidth}px;max-width:100%;margin:0 auto">
          <canvas id="preview" width="${source.width}" height="${source.height}"
            style="width:100%;height:auto;display:block"></canvas>
          <svg id="quad" viewBox="0 0 ${source.width} ${source.height}"
            style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">
            <polygon points="" fill="rgba(124,107,245,.18)" stroke="#a99bff" stroke-width="${Math.max(2, source.width / 300)}"/>
          </svg>
          <div class="scanner__overlay" id="handles"></div>
        </div>
        <div class="field" style="margin:14px 0 0">
          <label class="field__label">โหมดปรับภาพ</label>
          <div class="choice-group" id="mode-group2">
            ${Object.entries(SCAN_MODES).map(([key, preset]) => `
              <label class="choice"><input type="radio" name="mode2" value="${key}" ${key === state.mode ? 'checked' : ''}>
              <span>${preset.th}</span></label>`).join('')}
          </div>
        </div>
        <div style="display:flex;gap:9px;margin-top:14px;flex-wrap:wrap">
          <button class="btn" id="retake" style="flex:1 1 120px">ถ่ายใหม่</button>
          <button class="btn" id="full-page" style="flex:1 1 120px">ใช้ทั้งภาพ</button>
          <button class="btn btn--primary" id="apply-scan" style="flex:2 1 160px">${icon('check', { size: 18 })} ใช้ภาพนี้</button>
        </div>
      </div>`;

    const preview = stage.querySelector('#preview');
    preview.getContext('2d').drawImage(source, 0, 0);
    const handlesLayer = stage.querySelector('#handles');
    const polygon = stage.querySelector('#quad polygon');

    function drawQuad() {
      polygon.setAttribute('points', state.corners.map((c) => `${c.x},${c.y}`).join(' '));
      handlesLayer.innerHTML = state.corners.map((corner, index) => `
        <span class="scanner__corner" data-corner="${index}"
          style="left:${(corner.x / source.width) * 100}%;top:${(corner.y / source.height) * 100}%"></span>`).join('');

      handlesLayer.querySelectorAll('[data-corner]').forEach((handle) => {
        const index = Number(handle.dataset.corner);
        handle.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          handle.setPointerCapture(event.pointerId);
          const rect = stage.querySelector('#adjust-stage').getBoundingClientRect();
          const move = (moveEvent) => {
            const x = ((moveEvent.clientX - rect.left) / rect.width) * source.width;
            const y = ((moveEvent.clientY - rect.top) / rect.height) * source.height;
            state.corners[index] = {
              x: Math.max(0, Math.min(source.width, x)),
              y: Math.max(0, Math.min(source.height, y)),
            };
            polygon.setAttribute('points', state.corners.map((c) => `${c.x},${c.y}`).join(' '));
            handle.style.left = `${(state.corners[index].x / source.width) * 100}%`;
            handle.style.top = `${(state.corners[index].y / source.height) * 100}%`;
          };
          const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
          };
          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', up);
        });
      });
    }
    drawQuad();

    stage.querySelector('#mode-group2').addEventListener('change', (event) => { state.mode = event.target.value; });
    stage.querySelector('#retake').addEventListener('click', () => { state.capture = null; startCamera(); });
    stage.querySelector('#full-page').addEventListener('click', () => {
      state.corners = [
        { x: 0, y: 0 }, { x: source.width, y: 0 },
        { x: source.width, y: source.height }, { x: 0, y: source.height },
      ];
      drawQuad();
    });
    stage.querySelector('#apply-scan').addEventListener('click', applyScan);
  }

  async function applyScan() {
    toastInfo('กำลังปรับภาพ...');
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const warped = warpPerspective(state.capture, state.corners);
      enhance(warped, state.mode);
      const blob = await new Promise((resolve) => warped.toBlob(resolve, 'image/jpeg', 0.9));

      state.pages.push({
        blob,
        thumbnail: warped.toDataURL('image/jpeg', 0.5),
        width: warped.width,
        height: warped.height,
      });
      warped.width = 0;
      warped.height = 0;
      state.capture = null;

      renderStart();
      renderPages();
      toastSuccess(`เพิ่มหน้าที่ ${state.pages.length} แล้ว`);
    } catch (err) {
      toastError('ปรับภาพไม่สำเร็จ กรุณาลองใหม่');
      console.error(err);
    }
  }

  function renderPages() {
    if (!state.pages.length) { pagesArea.innerHTML = ''; return; }

    pagesArea.innerHTML = `
      <div class="section-title"><h2>หน้าที่สแกนแล้ว (${state.pages.length})</h2>
        <button class="btn btn--sm" id="clear-pages">ล้างทั้งหมด</button></div>
      <div class="page-grid">
        ${state.pages.map((page, index) => `
          <div class="page-thumb" style="border-color:var(--brand)">
            <img src="${page.thumbnail}" alt="หน้าที่ ${index + 1}">
            <span class="page-thumb__num">${index + 1}</span>
            <span class="page-thumb__tools">
              <button type="button" data-remove="${index}" aria-label="ลบหน้านี้">${icon('trash', { size: 13 })}</button>
            </span>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:9px;margin-top:15px;flex-wrap:wrap">
        <button class="btn btn--primary btn--lg" id="make-pdf" style="flex:2 1 200px">
          ${icon('file', { size: 19 })} สร้างไฟล์ PDF (${state.pages.length} หน้า)</button>
        <button class="btn btn--lg" id="save-images" style="flex:1 1 150px">
          ${icon('image', { size: 18 })} บันทึกเป็นรูป</button>
      </div>`;

    pagesArea.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        state.pages.splice(Number(button.dataset.remove), 1);
        renderPages();
      });
    });
    pagesArea.querySelector('#clear-pages').addEventListener('click', async () => {
      if (await confirmDialog({ title: 'ล้างหน้าที่สแกน', message: 'หน้าที่สแกนไว้ทั้งหมดจะถูกลบ', danger: true })) {
        state.pages = [];
        renderPages();
        resultArea.innerHTML = '';
      }
    });
    pagesArea.querySelector('#make-pdf').addEventListener('click', buildPdf);
    pagesArea.querySelector('#save-images').addEventListener('click', async () => {
      const { createZip } = await import('../pdf/ops-core.js');
      if (state.pages.length === 1) {
        downloadBlob(state.pages[0].blob, 'สแกน_001.jpg');
        return;
      }
      const zip = await createZip(state.pages.map((page, index) => ({
        name: `สแกน_${String(index + 1).padStart(3, '0')}.jpg`, blob: page.blob,
      })));
      downloadBlob(zip, 'เอกสารที่สแกน.zip');
    });
  }

  async function buildPdf() {
    resultArea.innerHTML = '';
    const progress = createProgress();
    progressArea.innerHTML = '';
    progressArea.appendChild(progress.element);

    const bytesIn = state.pages.reduce((sum, page) => sum + page.blob.size, 0);
    const gate = await startClientJob('scan', { fileCount: state.pages.length, bytesIn });
    if (!gate.allowed) { progress.remove(); toastError(gate.reason); return; }

    const startedAt = performance.now();
    try {
      const images = [];
      for (const page of state.pages) {
        images.push({ bytes: new Uint8Array(await page.blob.arrayBuffer()), mime: 'image/jpeg' });
      }
      const task = runPdfTask('imagesToPdf', {
        images,
        options: { pageSize: 'A4', orientation: 'auto', margin: 0, fit: 'contain' },
      }, { onProgress: (value, stageText) => progress.update(value, stageText) });

      const { bytes } = await task.promise;
      progress.done('เสร็จเรียบร้อย');
      setTimeout(() => progress.remove(), 800);

      const name = `เอกสารที่สแกน_${new Date().toISOString().slice(0, 10)}.pdf`;
      await completeClientJob(gate.jobId, {
        status: 'SUCCESS', bytesOut: bytes.byteLength,
        processingMs: Math.round(performance.now() - startedAt), filename: name,
        fileCount: state.pages.length,
      });

      resultArea.appendChild(resultBox({
        title: 'สร้างไฟล์ PDF สำเร็จ',
        files: [{ name }],
        stats: [
          { label: 'จำนวนหน้า', value: `${state.pages.length} หน้า` },
          { label: 'ขนาดไฟล์', value: formatBytes(bytes.byteLength) },
        ],
        actions: [
          { label: 'ดาวน์โหลด', variant: 'primary', icon: 'download', onClick: () => downloadBytes(bytes, name) },
          { label: 'สแกนเพิ่ม', icon: 'camera', onClick: () => { resultArea.innerHTML = ''; startCamera(); } },
        ],
      }));
      toastSuccess('สร้างไฟล์ PDF สำเร็จ');
    } catch (err) {
      progress.remove();
      await completeClientJob(gate.jobId, {
        status: 'FAILED', errorCode: err?.code, message: err?.message,
        processingMs: Math.round(performance.now() - startedAt),
      });
      resultArea.appendChild(errorBox(err, { onRetry: buildPdf }));
      toastError(err.message || 'สร้างไฟล์ไม่สำเร็จ');
    }
  }

  return () => {
    stopCamera();
    state.pages = [];
    if (state.capture) { state.capture.width = 0; state.capture.height = 0; }
    revokeAll();
    releaseWorker();
  };
}
