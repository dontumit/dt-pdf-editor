/**
 * ตรรกะของแต่ละเครื่องมือ: หน้าตัวเลือก + การประมวลผลจริง
 * ทุกตัวคืนผลในรูปแบบเดียวกันให้ tool.js นำไปแสดง
 */
import { runPdfTask } from '../pdf/worker-client.js';
import { fileToBytes, createZip, parseRanges } from '../pdf/ops-core.js';
import { downloadBlob, downloadBytes } from '../utils/download.js';
import { outputName, formatBytes, formatNumber, formatDuration, escapeHtml } from '../utils/format.js';
import { compressionStats, field, choiceGroup, switchRow } from '../ui/workflow.js';
import { startClientJob, completeClientJob, submitServerJob, pollJob, purgeJobFiles, createShareLink } from '../services/jobs.js';
import { toastError, toastWarning, toastInfo } from '../ui/toast.js';
import { POSITIONS } from '../pdf/ops-content.js';

/** ครอบการทำงานให้บันทึกสถิติเสมอ ไม่ว่าจะสำเร็จหรือไม่ */
async function withJobTracking(tool, ctx, work) {
  const bytesIn = ctx.files.reduce((sum, file) => sum + file.size, 0);
  const gate = await startClientJob(tool.id, { fileCount: ctx.files.length, bytesIn, params: ctx.options });

  if (!gate.allowed) {
    const error = new Error(gate.reason || 'ใช้งานเกินโควตาที่กำหนด');
    error.code = gate.errorCode;
    throw error;
  }

  const startedAt = performance.now();
  try {
    const output = await work();
    await completeClientJob(gate.jobId, {
      status: 'SUCCESS',
      bytesOut: output.bytesOut || 0,
      processingMs: Math.round(performance.now() - startedAt),
      filename: output.files?.[0]?.name || '',
      fileCount: output.files?.length || 1,
    });
    return { ...output, processingMs: Math.round(performance.now() - startedAt) };
  } catch (err) {
    await completeClientJob(gate.jobId, {
      status: err?.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
      processingMs: Math.round(performance.now() - startedAt),
      errorCode: err?.code || 'PROCESSING_FAILED',
      message: err?.message || '',
    });
    throw err;
  }
}

/** อ่านค่าจากฟอร์มลง ctx.options โดยอัตโนมัติ */
function bindOptions(container, ctx, onChange) {
  container.addEventListener('change', (event) => {
    const target = event.target;
    const key = target.dataset.option || target.name;
    if (!key) return;
    let value;
    if (target.type === 'checkbox') value = target.checked;
    else if (target.type === 'number' || target.type === 'range') value = Number(target.value);
    else value = target.value;
    ctx.options[key] = value;
    onChange?.(key, value);
  });
  container.addEventListener('input', (event) => {
    const target = event.target;
    if (target.type !== 'range') return;
    const output = container.querySelector(`[data-range-output="${target.dataset.option}"]`);
    if (output) output.textContent = target.dataset.suffix ? `${target.value}${target.dataset.suffix}` : target.value;
  });
}

const positionSelect = (selected) => `
  <select data-option="position">
    ${POSITIONS.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${p.th}</option>`).join('')}
  </select>`;

const scopeSelect = (selected = 'all') => `
  <select data-option="scope">
    <option value="all" ${selected === 'all' ? 'selected' : ''}>ทุกหน้า</option>
    <option value="odd" ${selected === 'odd' ? 'selected' : ''}>หน้าคี่</option>
    <option value="even" ${selected === 'even' ? 'selected' : ''}>หน้าคู่</option>
  </select>`;

// ======================================================================
// เครื่องมือแต่ละตัว
// ======================================================================

const RUNNERS = {
  // ---------------------------------------------------------------- รวม PDF
  merge: {
    actionLabel: 'รวมไฟล์เป็น PDF เดียว',
    steps: ['เลือกไฟล์', 'จัดลำดับ', 'รวมไฟล์', 'ดาวน์โหลด'],
    defaults: { outputName: 'merged' },
    async renderOptions(container, ctx) {
      container.innerHTML = `
        ${field('ชื่อไฟล์ผลลัพธ์', `<input type="text" data-option="outputName" value="${escapeHtml(ctx.options.outputName)}" maxlength="80">`, 'ระบบจะเติมนามสกุล .pdf ให้อัตโนมัติ')}
        <div class="field__hint">ลำดับการรวมจะเป็นไปตามลำดับไฟล์ด้านบน — ลากเพื่อจัดใหม่ได้</div>`;
      bindOptions(container, ctx);
    },
    async run(ctx, { onProgress, setTask }) {
      if (ctx.files.length < 2) {
        toastWarning('ต้องมีอย่างน้อย 2 ไฟล์จึงจะรวมได้');
        throw Object.assign(new Error('กรุณาเลือกไฟล์อย่างน้อย 2 ไฟล์'), { code: 'NOT_ENOUGH_FILES' });
      }
      return withJobTracking(ctx.tool, ctx, async () => {
        onProgress(4, 'กำลังอ่านไฟล์');
        const items = [];
        for (const file of ctx.files) {
          items.push({
            bytes: await fileToBytes(file),
            kind: file.detectedType?.ext === 'pdf' ? 'pdf' : 'image',
            mime: file.detectedType?.mime,
          });
        }
        const task = runPdfTask('merge', { items }, { onProgress });
        setTask(task);
        const { bytes } = await task.promise;
        const name = `${ctx.options.outputName || 'merged'}.pdf`;
        return {
          title: 'รวมไฟล์สำเร็จ',
          files: [{ name }],
          bytesOut: bytes.byteLength,
          stats: [
            { label: 'ไฟล์ที่รวม', value: `${ctx.files.length} ไฟล์` },
            { label: 'ขนาดผลลัพธ์', value: formatBytes(bytes.byteLength) },
          ],
          onDownload: () => downloadBytes(bytes, name),
        };
      });
    },
  },

  // ---------------------------------------------------------------- แยก PDF
  split: {
    actionLabel: 'แยกไฟล์',
    steps: ['เลือกไฟล์', 'เลือกวิธีแยก', 'แยกไฟล์', 'ดาวน์โหลด'],
    defaults: { mode: 'each', everyN: 2, ranges: '' },
    async renderOptions(container, ctx) {
      container.innerHTML = `
        ${field('วิธีแยกไฟล์', choiceGroup('mode', [
          { value: 'each', label: 'ทีละหน้า' },
          { value: 'every', label: 'ทุก N หน้า' },
          { value: 'ranges', label: 'ตามช่วงหน้า' },
        ], ctx.options.mode))}
        <div id="split-detail"></div>`;

      const detail = container.querySelector('#split-detail');
      const renderDetail = () => {
        if (ctx.options.mode === 'every') {
          detail.innerHTML = field('แยกทุกกี่หน้า',
            `<input type="number" data-option="everyN" min="1" max="500" value="${ctx.options.everyN}">`,
            'เช่น ใส่ 2 จะได้ไฟล์ละ 2 หน้า');
        } else if (ctx.options.mode === 'ranges') {
          detail.innerHTML = field('ระบุช่วงหน้า',
            `<input type="text" data-option="ranges" placeholder="1-5, 8, 10-12" value="${escapeHtml(ctx.options.ranges)}">`,
            'คั่นแต่ละช่วงด้วยเครื่องหมายจุลภาค เช่น 1-5, 8, 10-12');
        } else {
          detail.innerHTML = '<div class="field__hint">ทุกหน้าจะถูกแยกเป็นไฟล์ของตัวเอง แล้วรวมเป็นไฟล์ ZIP ให้ดาวน์โหลด</div>';
        }
      };
      renderDetail();
      bindOptions(container, ctx, (key) => { if (key === 'mode') renderDetail(); });
    },
    async run(ctx, { onProgress, setTask }) {
      return withJobTracking(ctx.tool, ctx, async () => {
        const file = ctx.files[0];
        const bytes = await fileToBytes(file);
        const baseName = file.name.replace(/\.pdf$/i, '');

        const options = { mode: ctx.options.mode, baseName, everyN: Number(ctx.options.everyN) || 2 };
        if (ctx.options.mode === 'ranges') {
          const info = await runPdfTask('info', { bytes: bytes.slice() }).promise;
          options.ranges = parseRanges(ctx.options.ranges, info.pageCount);
          if (!options.ranges.length) {
            throw Object.assign(new Error('กรุณาระบุช่วงหน้าอย่างน้อย 1 ช่วง'), { code: 'INVALID_RANGE' });
          }
        }

        const task = runPdfTask('split', { bytes, options }, { onProgress });
        setTask(task);
        const { files } = await task.promise;

        const totalBytes = files.reduce((sum, item) => sum + item.bytes.byteLength, 0);
        const single = files.length === 1;

        return {
          title: `แยกได้ ${files.length} ไฟล์`,
          files: files.map((item) => ({ name: item.name })),
          bytesOut: totalBytes,
          stats: [
            { label: 'จำนวนไฟล์', value: `${files.length} ไฟล์` },
            { label: 'ขนาดรวม', value: formatBytes(totalBytes) },
          ],
          downloadLabel: single ? 'ดาวน์โหลด' : 'ดาวน์โหลดทั้งหมด (ZIP)',
          onDownload: async () => {
            if (single) { downloadBytes(files[0].bytes, files[0].name); return; }
            toastInfo('กำลังบีบอัดเป็นไฟล์ ZIP...');
            const zip = await createZip(files.map((item) => ({ name: item.name, bytes: item.bytes })));
            downloadBlob(zip, `${baseName}_แยกไฟล์.zip`);
          },
        };
      });
    },
  },

  // ---------------------------------------------------------------- ลดขนาด PDF
  compress: {
    actionLabel: 'เริ่มลดขนาด',
    steps: ['เลือกไฟล์', 'เลือกวิธีลด', 'ลดขนาด', 'ดาวน์โหลด'],
    defaults: { mode: 'smart', level: 'medium', targetSizeMb: 0 },
    async renderOptions(container, ctx) {
      const renderAll = () => {
        container.innerHTML = `
          ${field('วิธีลดขนาด', choiceGroup('mode', [
            { value: 'smart', label: 'อัตโนมัติ' },
            { value: 'lossless', label: 'คงข้อความ' },
            { value: 'rasterize', label: 'ลดให้เล็กที่สุด' },
          ], ctx.options.mode),
          ctx.options.mode === 'smart'
            ? 'ระบบจะลองวิธีที่ไม่เสียคุณภาพก่อน ถ้าลดได้ไม่พอจึงเปลี่ยนเป็นแปลงหน้าเป็นภาพให้อัตโนมัติ'
            : ctx.options.mode === 'lossless'
              ? 'จัดโครงสร้างไฟล์ใหม่ให้กระชับขึ้น ข้อความยังเลือกและค้นหาได้ตามปกติ'
              : 'แปลงทุกหน้าเป็นภาพ ลดขนาดได้มากที่สุด เหมาะกับเอกสารสแกน แต่ข้อความจะเลือกไม่ได้')}

          ${field('ขนาดไฟล์เป้าหมาย', `
            <div class="choice-group" id="target-presets" style="margin-bottom:9px">
              ${[0, 1, 2, 5, 10].map((mb) => `
                <label class="choice"><input type="radio" name="targetPreset" value="${mb}"
                  ${Number(ctx.options.targetSizeMb) === mb ? 'checked' : ''}>
                <span>${mb === 0 ? 'ไม่กำหนด' : `${mb} MB`}</span></label>`).join('')}
            </div>
            <input type="number" data-option="targetSizeMb" min="0" max="500" step="0.5"
              value="${ctx.options.targetSizeMb}" placeholder="หรือพิมพ์ขนาดเอง (MB)">`,
          'ใส่ขนาดที่ระบบปลายทางกำหนด เช่น อัปโหลดได้ไม่เกิน 2 MB ระบบจะไล่ลดคุณภาพให้จนได้ตามเป้า')}

          ${ctx.options.mode === 'rasterize' && !Number(ctx.options.targetSizeMb)
            ? field('ระดับการบีบอัด', choiceGroup('level', [
              { value: 'low', label: 'ต่ำ' },
              { value: 'medium', label: 'ปานกลาง' },
              { value: 'high', label: 'สูง' },
            ], ctx.options.level), 'ยิ่งสูงไฟล์ยิ่งเล็ก แต่ความคมชัดลดลง')
            : ''}`;

        container.querySelector('#target-presets')?.addEventListener('change', (event) => {
          ctx.options.targetSizeMb = Number(event.target.value);
          renderAll();
        });
        bindOptions(container, ctx, (key) => {
          if (key === 'mode' || key === 'targetSizeMb') renderAll();
        });
      };
      renderAll();
    },
    async run(ctx, { onProgress, setTask }) {
      return withJobTracking(ctx.tool, ctx, async () => {
        const { compressPdf } = await import('../pdf/ops-convert.js');
        const file = ctx.files[0];
        const bytes = await fileToBytes(file);
        const controller = new AbortController();
        setTask({ cancel: () => controller.abort() });

        const result = await compressPdf(bytes, {
          level: ctx.options.level,
          mode: ctx.options.mode,
          targetSizeMb: Number(ctx.options.targetSizeMb) || 0,
          onProgress,
          signal: controller.signal,
        });

        const name = outputName(file.name, 'compressed', 'pdf');
        const strategyLabel = result.mode === 'lossless' ? 'คงข้อความไว้' : 'แปลงหน้าเป็นภาพ';

        let note;
        if (result.grewInstead) {
          note = 'ไฟล์นี้ถูกบีบอัดมาแล้ว ระบบจึงคืนไฟล์ต้นฉบับให้เพื่อไม่ให้คุณภาพลดลงโดยเปล่าประโยชน์'
            + ' — หากยังต้องการเล็กกว่านี้ ลองเลือกวิธี "ลดให้เล็กที่สุด"';
        } else if (result.targetMet === false) {
          note = 'ลดได้เล็กที่สุดเท่าที่คุณภาพยังพออ่านได้แล้ว แต่ยังไม่ถึงขนาดเป้าหมาย'
            + ' — ลองแยกเอกสารเป็นหลายไฟล์ หรือลดจำนวนหน้าลง';
        } else if (result.textPreserved) {
          note = 'ข้อความในเอกสารยังเลือกและค้นหาได้ตามปกติ';
        } else {
          note = 'ทุกหน้าถูกแปลงเป็นภาพเพื่อให้ไฟล์เล็กที่สุด ข้อความจึงเลือกหรือค้นหาไม่ได้';
        }

        return {
          title: result.grewInstead ? 'ไฟล์นี้เล็กที่สุดแล้ว'
            : result.targetMet === true ? 'ลดขนาดได้ตามเป้าหมายแล้ว' : 'ลดขนาดสำเร็จ',
          files: [{ name }],
          bytesOut: result.newSize,
          stats: [
            ...compressionStats(result.originalSize, result.newSize),
            { label: 'วิธีที่ใช้', value: strategyLabel },
          ],
          note,
          onDownload: () => downloadBytes(result.bytes, name),
        };
      });
    },
  },

  // ---------------------------------------------------------------- PDF -> รูป
  'pdf-to-image': {
    actionLabel: 'แปลงเป็นรูปภาพ',
    steps: ['เลือกไฟล์', 'ตั้งค่าภาพ', 'แปลงไฟล์', 'ดาวน์โหลด'],
    defaults: { dpi: 150, format: 'image/jpeg', quality: 85 },
    async renderOptions(container, ctx) {
      const { DPI_PRESETS, IMAGE_FORMATS } = await import('../pdf/ops-convert.js');
      container.innerHTML = `
        ${field('ความละเอียด', `<select data-option="dpi">${DPI_PRESETS.map((preset) => `
          <option value="${preset.value}" ${preset.value === ctx.options.dpi ? 'selected' : ''}>${preset.th}</option>`).join('')}</select>`)}
        ${field('รูปแบบไฟล์', `<select data-option="format">${IMAGE_FORMATS.map((item) => `
          <option value="${item.value}" ${item.value === ctx.options.format ? 'selected' : ''}>${item.th}</option>`).join('')}</select>`)}
        ${field('คุณภาพ <span data-range-output="quality" style="color:var(--brand);font-weight:700">' + ctx.options.quality + '%</span>',
          `<input type="range" data-option="quality" data-suffix="%" min="30" max="100" step="5" value="${ctx.options.quality}">`)}`;
      bindOptions(container, ctx);
    },
    async run(ctx, { onProgress, setTask }) {
      return withJobTracking(ctx.tool, ctx, async () => {
        const { pdfToImages } = await import('../pdf/ops-convert.js');
        const file = ctx.files[0];
        const bytes = await fileToBytes(file);
        const baseName = file.name.replace(/\.pdf$/i, '');
        const controller = new AbortController();
        setTask({ cancel: () => controller.abort() });

        const images = await pdfToImages(bytes, {
          dpi: Number(ctx.options.dpi),
          format: ctx.options.format,
          quality: Number(ctx.options.quality) / 100,
          baseName,
          onProgress,
          signal: controller.signal,
        });

        const totalBytes = images.reduce((sum, item) => sum + item.blob.size, 0);
        return {
          title: `แปลงได้ ${images.length} รูป`,
          files: images.map((item) => ({ name: item.name })),
          bytesOut: totalBytes,
          stats: [
            { label: 'จำนวนรูป', value: `${images.length} รูป` },
            { label: 'ขนาดรวม', value: formatBytes(totalBytes) },
            { label: 'ความละเอียด', value: `${ctx.options.dpi} DPI` },
          ],
          downloadLabel: images.length === 1 ? 'ดาวน์โหลด' : 'ดาวน์โหลดทั้งหมด (ZIP)',
          onDownload: async () => {
            if (images.length === 1) { downloadBlob(images[0].blob, images[0].name); return; }
            toastInfo('กำลังบีบอัดเป็นไฟล์ ZIP...');
            const zip = await createZip(images.map((item) => ({ name: item.name, blob: item.blob })));
            downloadBlob(zip, `${baseName}_รูปภาพ.zip`);
          },
        };
      });
    },
  },

  // ---------------------------------------------------------------- รูป -> PDF
  'image-to-pdf': {
    actionLabel: 'สร้างไฟล์ PDF',
    steps: ['เลือกรูป', 'ตั้งค่าหน้ากระดาษ', 'สร้าง PDF', 'ดาวน์โหลด'],
    defaults: { pageSize: 'A4', orientation: 'auto', margin: 20, fit: 'contain', outputName: 'images' },
    async renderOptions(container, ctx) {
      container.innerHTML = `
        ${field('ขนาดหน้ากระดาษ', `<select data-option="pageSize">
          <option value="A4" ${ctx.options.pageSize === 'A4' ? 'selected' : ''}>A4</option>
          <option value="A5" ${ctx.options.pageSize === 'A5' ? 'selected' : ''}>A5</option>
          <option value="Letter" ${ctx.options.pageSize === 'Letter' ? 'selected' : ''}>Letter</option>
          <option value="Legal" ${ctx.options.pageSize === 'Legal' ? 'selected' : ''}>Legal</option>
          <option value="original" ${ctx.options.pageSize === 'original' ? 'selected' : ''}>เท่าขนาดรูปเดิม</option>
        </select>`)}
        ${field('การวางแนว', choiceGroup('orientation', [
          { value: 'auto', label: 'อัตโนมัติ' },
          { value: 'portrait', label: 'แนวตั้ง' },
          { value: 'landscape', label: 'แนวนอน' },
        ], ctx.options.orientation))}
        ${field('ระยะขอบ <span data-range-output="margin" style="color:var(--brand);font-weight:700">' + ctx.options.margin + '</span> pt',
          `<input type="range" data-option="margin" min="0" max="60" step="5" value="${ctx.options.margin}">`)}
        ${field('ชื่อไฟล์ผลลัพธ์', `<input type="text" data-option="outputName" value="${escapeHtml(ctx.options.outputName)}" maxlength="80">`)}`;
      bindOptions(container, ctx);
    },
    async run(ctx, { onProgress, setTask }) {
      return withJobTracking(ctx.tool, ctx, async () => {
        onProgress(5, 'กำลังอ่านรูปภาพ');
        const images = [];
        for (const file of ctx.files) {
          let bytes = await fileToBytes(file);
          let mime = file.detectedType?.mime || file.type;
          // pdf-lib ฝังได้เฉพาะ JPG/PNG จึงต้องแปลง WEBP ก่อน
          if (mime === 'image/webp' || mime === 'image/gif') {
            const { compressImage } = await import('../pdf/ops-convert.js');
            const converted = await compressImage(file, { quality: 0.92, format: 'image/jpeg' });
            bytes = new Uint8Array(await converted.blob.arrayBuffer());
            mime = 'image/jpeg';
          }
          images.push({ bytes, mime });
        }

        const task = runPdfTask('imagesToPdf', {
          images,
          options: {
            pageSize: ctx.options.pageSize,
            orientation: ctx.options.orientation,
            margin: Number(ctx.options.margin),
            fit: ctx.options.fit,
          },
        }, { onProgress });
        setTask(task);
        const { bytes } = await task.promise;

        const name = `${ctx.options.outputName || 'images'}.pdf`;
        return {
          title: 'สร้างไฟล์ PDF สำเร็จ',
          files: [{ name }],
          bytesOut: bytes.byteLength,
          stats: [
            { label: 'จำนวนหน้า', value: `${images.length} หน้า` },
            { label: 'ขนาดไฟล์', value: formatBytes(bytes.byteLength) },
          ],
          onDownload: () => downloadBytes(bytes, name),
        };
      });
    },
  },

  // ---------------------------------------------------------------- ลดขนาดรูป
  'image-compress': {
    actionLabel: 'ลดขนาดรูปภาพ',
    steps: ['เลือกรูป', 'ตั้งค่า', 'ลดขนาด', 'ดาวน์โหลด'],
    defaults: { quality: 80, maxWidth: 0, maxSizeKb: 0, format: 'auto' },
    async renderOptions(container, ctx) {
      container.innerHTML = `
        ${field('คุณภาพ <span data-range-output="quality" style="color:var(--brand);font-weight:700">' + ctx.options.quality + '%</span>',
          `<input type="range" data-option="quality" data-suffix="%" min="20" max="100" step="5" value="${ctx.options.quality}">`)}
        ${field('ความกว้างสูงสุด (พิกเซล)', `<input type="number" data-option="maxWidth" min="0" max="10000" step="100" value="${ctx.options.maxWidth}" placeholder="0 = ไม่จำกัด">`, 'ใส่ 0 เพื่อคงขนาดเดิม')}
        ${field('ขนาดไฟล์สูงสุด (KB)', `<input type="number" data-option="maxSizeKb" min="0" max="20000" step="50" value="${ctx.options.maxSizeKb}" placeholder="0 = ไม่จำกัด">`, 'ระบบจะลดคุณภาพลงทีละขั้นจนได้ตามเป้า')}
        ${field('รูปแบบไฟล์', `<select data-option="format">
          <option value="auto" ${ctx.options.format === 'auto' ? 'selected' : ''}>คงรูปแบบเดิม</option>
          <option value="image/jpeg" ${ctx.options.format === 'image/jpeg' ? 'selected' : ''}>JPG</option>
          <option value="image/webp" ${ctx.options.format === 'image/webp' ? 'selected' : ''}>WEBP</option>
          <option value="image/png" ${ctx.options.format === 'image/png' ? 'selected' : ''}>PNG</option>
        </select>`)}`;
      bindOptions(container, ctx);
    },
    async run(ctx, { onProgress }) {
      return withJobTracking(ctx.tool, ctx, async () => {
        const { compressImage } = await import('../pdf/ops-convert.js');
        const results = [];
        let originalTotal = 0;
        let newTotal = 0;
        let keptCount = 0;

        for (let index = 0; index < ctx.files.length; index += 1) {
          const file = ctx.files[index];
          const result = await compressImage(file, {
            quality: Number(ctx.options.quality) / 100,
            maxWidth: Number(ctx.options.maxWidth) || null,
            maxSizeKb: Number(ctx.options.maxSizeKb) || null,
            format: ctx.options.format === 'auto' ? null : ctx.options.format,
          });
          const ext = result.format.split('/')[1].replace('jpeg', 'jpg');
          results.push({ name: outputName(file.name, 'compressed', ext), blob: result.blob });
          originalTotal += result.originalSize;
          newTotal += result.newSize;
          if (result.keptOriginal) keptCount += 1;
          onProgress(((index + 1) / ctx.files.length) * 95, `ลดขนาดรูปที่ ${index + 1}/${ctx.files.length}`);
        }

        return {
          title: keptCount === results.length ? 'รูปเหล่านี้เล็กที่สุดแล้ว' : `ลดขนาดสำเร็จ ${results.length} รูป`,
          files: results.map((item) => ({ name: item.name })),
          bytesOut: newTotal,
          stats: compressionStats(originalTotal, newTotal),
          note: keptCount
            ? `มี ${keptCount} รูปที่บีบอัดแล้วไม่เล็กลง ระบบจึงคืนไฟล์ต้นฉบับให้เพื่อไม่ให้คุณภาพเสียไปเปล่า ๆ — ลองเปลี่ยนรูปแบบไฟล์เป็น JPG หรือ WEBP เพื่อลดขนาดเพิ่ม`
            : '',
          downloadLabel: results.length === 1 ? 'ดาวน์โหลด' : 'ดาวน์โหลดทั้งหมด (ZIP)',
          onDownload: async () => {
            if (results.length === 1) { downloadBlob(results[0].blob, results[0].name); return; }
            const zip = await createZip(results.map((item) => ({ name: item.name, blob: item.blob })));
            downloadBlob(zip, 'รูปภาพที่ลดขนาด.zip');
          },
        };
      });
    },
  },

  // ---------------------------------------------------------------- เลขหน้า
  'page-number': {
    actionLabel: 'ใส่เลขหน้า',
    defaults: { format: 'plain', position: 'bottom-center', fontSize: 11, color: '#333333', startAt: 1, skipFirst: false, prefix: '' },
    async renderOptions(container, ctx) {
      const { PAGE_NUMBER_FORMATS } = await import('../pdf/ops-content.js');
      container.innerHTML = `
        ${field('รูปแบบเลขหน้า', `<select data-option="format">${Object.entries(PAGE_NUMBER_FORMATS).map(([key, value]) => `
          <option value="${key}" ${key === ctx.options.format ? 'selected' : ''}>${value.th}</option>`).join('')}</select>`)}
        ${field('ตำแหน่ง', positionSelect(ctx.options.position))}
        ${field('ขนาดตัวอักษร <span data-range-output="fontSize" style="color:var(--brand);font-weight:700">' + ctx.options.fontSize + '</span> pt',
          `<input type="range" data-option="fontSize" min="7" max="24" value="${ctx.options.fontSize}">`)}
        ${field('สีตัวอักษร', `<input type="color" data-option="color" value="${ctx.options.color}" style="width:64px;height:42px;padding:3px;border-radius:12px">`)}
        ${field('เริ่มนับจากหมายเลข', `<input type="number" data-option="startAt" min="1" max="9999" value="${ctx.options.startAt}">`)}
        ${switchRow('skip-first', 'ไม่ใส่เลขหน้าแรก', ctx.options.skipFirst, 'เหมาะกับเอกสารที่มีหน้าปก')}`;
      container.querySelector('#skip-first').dataset.option = 'skipFirst';
      bindOptions(container, ctx);
    },
    async run(ctx, { onProgress, setTask }) {
      return withJobTracking(ctx.tool, ctx, async () => {
        const file = ctx.files[0];
        const bytes = await fileToBytes(file);
        const task = runPdfTask('pageNumbers', {
          bytes,
          options: {
            format: ctx.options.format,
            position: ctx.options.position,
            fontSize: Number(ctx.options.fontSize),
            color: ctx.options.color,
            startAt: Number(ctx.options.startAt),
            skipFirst: Boolean(ctx.options.skipFirst),
            prefix: ctx.options.prefix || '',
          },
        }, { onProgress });
        setTask(task);
        const result = await task.promise;

        const name = outputName(file.name, 'numbered', 'pdf');
        return {
          title: 'ใส่เลขหน้าสำเร็จ',
          files: [{ name }],
          bytesOut: result.bytes.byteLength,
          warning: result.warning,
          stats: [
            { label: 'หน้าที่ใส่เลข', value: `${formatNumber(result.pagesAffected)} หน้า` },
            { label: 'ขนาดไฟล์', value: formatBytes(result.bytes.byteLength) },
          ],
          onDownload: () => downloadBytes(result.bytes, name),
        };
      });
    },
  },

  // ---------------------------------------------------------------- ลายน้ำ
  watermark: {
    actionLabel: 'ใส่ลายน้ำ',
    defaults: {
      kind: 'text', text: 'ลับ', fontSize: 52, color: '#ff3b6b', opacity: 25,
      rotation: 45, position: 'center', bold: true, scope: 'all', scale: 40,
    },
    async renderOptions(container, ctx) {
      const renderAll = () => {
        container.innerHTML = `
          ${field('ชนิดลายน้ำ', choiceGroup('kind', [
            { value: 'text', label: 'ข้อความ' },
            { value: 'image', label: 'รูปภาพ' },
          ], ctx.options.kind))}
          ${ctx.options.kind === 'text' ? `
            ${field('ข้อความลายน้ำ', `<input type="text" data-option="text" value="${escapeHtml(ctx.options.text)}" maxlength="60" placeholder="เช่น ลับ, สำเนา, CONFIDENTIAL">`)}
            ${field('ขนาดตัวอักษร <span data-range-output="fontSize" style="color:var(--brand);font-weight:700">' + ctx.options.fontSize + '</span> pt',
              `<input type="range" data-option="fontSize" min="12" max="140" value="${ctx.options.fontSize}">`)}
            ${field('สี', `<input type="color" data-option="color" value="${ctx.options.color}" style="width:64px;height:42px;padding:3px;border-radius:12px">`)}
            ${switchRow('wm-bold', 'ตัวหนา', ctx.options.bold)}
          ` : `
            ${field('เลือกรูปลายน้ำ', '<input type="file" id="wm-image" accept="image/png,image/jpeg">', 'แนะนำ PNG พื้นหลังโปร่งใส')}
            ${field('ขนาด <span data-range-output="scale" style="color:var(--brand);font-weight:700">' + ctx.options.scale + '%</span> ของความกว้างหน้า',
              `<input type="range" data-option="scale" data-suffix="%" min="10" max="100" step="5" value="${ctx.options.scale}">`)}
          `}
          ${field('ความโปร่งใส <span data-range-output="opacity" style="color:var(--brand);font-weight:700">' + ctx.options.opacity + '%</span>',
            `<input type="range" data-option="opacity" data-suffix="%" min="5" max="100" step="5" value="${ctx.options.opacity}">`)}
          ${field('การหมุน <span data-range-output="rotation" style="color:var(--brand);font-weight:700">' + ctx.options.rotation + '°</span>',
            `<input type="range" data-option="rotation" data-suffix="°" min="-90" max="90" step="5" value="${ctx.options.rotation}">`)}
          ${field('ตำแหน่ง', positionSelect(ctx.options.position))}
          ${field('ใส่ที่หน้าไหน', scopeSelect(ctx.options.scope))}`;

        const boldToggle = container.querySelector('#wm-bold');
        if (boldToggle) boldToggle.dataset.option = 'bold';

        container.querySelector('#wm-image')?.addEventListener('change', async (event) => {
          const imageFile = event.target.files?.[0];
          if (!imageFile) return;
          ctx.options.imageFile = imageFile;
          ctx.options.imageMime = imageFile.type;
        });

        bindOptions(container, ctx, (key) => { if (key === 'kind') renderAll(); });
      };
      renderAll();
    },
    async run(ctx, { onProgress, setTask }) {
      return withJobTracking(ctx.tool, ctx, async () => {
        const file = ctx.files[0];
        const bytes = await fileToBytes(file);
        let task;

        if (ctx.options.kind === 'image') {
          if (!ctx.options.imageFile) {
            throw Object.assign(new Error('กรุณาเลือกรูปที่จะใช้เป็นลายน้ำ'), { code: 'VALIDATION_ERROR' });
          }
          const imageBytes = new Uint8Array(await ctx.options.imageFile.arrayBuffer());
          task = runPdfTask('watermarkImage', {
            bytes,
            options: {
              imageBytes,
              imageMime: ctx.options.imageMime,
              opacity: Number(ctx.options.opacity) / 100,
              scale: Number(ctx.options.scale) / 100,
              position: ctx.options.position,
              rotation: Number(ctx.options.rotation),
              scope: ctx.options.scope,
            },
          }, { onProgress });
        } else {
          task = runPdfTask('watermarkText', {
            bytes,
            options: {
              text: ctx.options.text,
              fontSize: Number(ctx.options.fontSize),
              color: ctx.options.color,
              opacity: Number(ctx.options.opacity) / 100,
              rotation: Number(ctx.options.rotation),
              position: ctx.options.position,
              bold: Boolean(ctx.options.bold),
              scope: ctx.options.scope,
            },
          }, { onProgress });
        }

        setTask(task);
        const result = await task.promise;
        const name = outputName(file.name, 'watermarked', 'pdf');
        return {
          title: 'ใส่ลายน้ำสำเร็จ',
          files: [{ name }],
          bytesOut: result.bytes.byteLength,
          warning: result.warning,
          stats: [
            { label: 'หน้าที่ใส่ลายน้ำ', value: `${formatNumber(result.pagesAffected)} หน้า` },
            { label: 'ขนาดไฟล์', value: formatBytes(result.bytes.byteLength) },
          ],
          onDownload: () => downloadBytes(result.bytes, name),
        };
      });
    },
  },
};

// ======================================================================
// เครื่องมือที่ประมวลผลบนเซิร์ฟเวอร์
// ======================================================================

function serverRunner({ actionLabel, steps, defaults, renderOptions, buildParams, describe, secretFields = [] }) {
  return {
    actionLabel,
    steps: steps || ['เลือกไฟล์', 'ตั้งค่า', 'ส่งประมวลผล', 'ดาวน์โหลด'],
    defaults,
    renderOptions,
    async run(ctx, { onProgress, setTask }) {
      const params = buildParams ? buildParams(ctx) : { ...ctx.options };
      const controller = new AbortController();
      setTask({ cancel: () => controller.abort() });

      const submitted = await submitServerJob(ctx.tool.serverTool, ctx.files, params, { onProgress });
      onProgress(15, submitted.queue?.waiting > 1
        ? `อยู่ในคิวลำดับที่ ${submitted.queue.waiting}`
        : 'เข้าคิวประมวลผลแล้ว');

      // ลบความลับออกจากหน่วยความจำทันทีหลังส่ง
      secretFields.forEach((key) => { ctx.options[key] = ''; });

      const finished = await pollJob(submitted.jobId, {
        onProgress: (value, stage) => onProgress(15 + value * 0.8, stage),
        signal: controller.signal,
      });

      const outputFile = finished.files?.[0];
      if (!outputFile) throw new Error('ไม่พบไฟล์ผลลัพธ์');

      return {
        title: 'ประมวลผลสำเร็จ',
        files: finished.files.map((item) => ({ name: item.filename })),
        stats: [
          { label: 'ขนาดผลลัพธ์', value: formatBytes(outputFile.size) },
          { label: 'เวลาที่ใช้', value: formatDuration(finished.processingMs) },
          ...(describe ? describe(finished, ctx) : []),
        ],
        note: 'ไฟล์นี้จะถูกลบจากเซิร์ฟเวอร์อัตโนมัติภายใน 30 นาที กรุณาดาวน์โหลดก่อนหมดเวลา',
        onDownload: () => {
          const anchor = document.createElement('a');
          anchor.href = outputFile.downloadUrl;
          anchor.download = outputFile.filename;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          // ลบไฟล์บนเซิร์ฟเวอร์หลังดาวน์โหลดเสร็จ (spec ข้อ 72)
          setTimeout(() => purgeJobFiles(finished.jobId), 12000);
        },
        onShare: async () => {
          try {
            const link = await createShareLink(finished.jobId, outputFile.fileId);
            const { shareToLine } = await import('../line/liff.js');
            const shareResult = await shareToLine({ url: link.url, title: outputFile.filename });
            if (shareResult.method === 'clipboard') toastInfo('คัดลอกลิงก์แล้ว (ลิงก์มีอายุจำกัด)');
          } catch (err) {
            toastError(err.message || 'สร้างลิงก์แชร์ไม่สำเร็จ');
          }
        },
      };
    },
  };
}

RUNNERS.protect = serverRunner({
  actionLabel: 'ใส่รหัสผ่าน',
  defaults: { password: '', confirm: '', allowPrint: true, allowCopy: false, allowEdit: false, allowAnnotate: true },
  secretFields: ['password', 'confirm'],
  async renderOptions(container, ctx) {
    container.innerHTML = `
      ${field('รหัสผ่านสำหรับเปิดไฟล์', '<input type="password" data-option="password" autocomplete="new-password" placeholder="อย่างน้อย 4 ตัวอักษร">')}
      ${field('ยืนยันรหัสผ่าน', '<input type="password" data-option="confirm" autocomplete="new-password">')}
      <div class="section-title" style="margin-top:6px"><h2 style="font-size:14px">สิทธิ์การใช้งานไฟล์</h2></div>
      ${switchRow('perm-print', 'อนุญาตให้พิมพ์', ctx.options.allowPrint)}
      ${switchRow('perm-copy', 'อนุญาตให้คัดลอกข้อความ', ctx.options.allowCopy)}
      ${switchRow('perm-edit', 'อนุญาตให้แก้ไข', ctx.options.allowEdit)}
      ${switchRow('perm-annotate', 'อนุญาตให้เพิ่มคำอธิบาย', ctx.options.allowAnnotate)}
      <div class="notice notice--warn" style="margin-top:14px">
        <div><strong>กรุณาจดจำรหัสผ่านให้ดี</strong>
        <p style="margin:3px 0 0;font-size:13px">ระบบไม่เก็บรหัสผ่านของคุณ จึงไม่สามารถกู้คืนให้ได้หากลืม</p></div>
      </div>`;
    container.querySelector('#perm-print').dataset.option = 'allowPrint';
    container.querySelector('#perm-copy').dataset.option = 'allowCopy';
    container.querySelector('#perm-edit').dataset.option = 'allowEdit';
    container.querySelector('#perm-annotate').dataset.option = 'allowAnnotate';
    bindOptions(container, ctx);
  },
  buildParams(ctx) {
    const password = String(ctx.options.password || '');
    if (password.length < 4) {
      throw Object.assign(new Error('รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร'), { code: 'PASSWORD_TOO_SHORT' });
    }
    if (password !== ctx.options.confirm) {
      throw Object.assign(new Error('รหัสผ่านทั้งสองช่องไม่ตรงกัน'), { code: 'PASSWORD_MISMATCH' });
    }
    return {
      password,
      allowPrint: String(Boolean(ctx.options.allowPrint)),
      allowCopy: String(Boolean(ctx.options.allowCopy)),
      allowEdit: String(Boolean(ctx.options.allowEdit)),
      allowAnnotate: String(Boolean(ctx.options.allowAnnotate)),
    };
  },
});

RUNNERS.unlock = serverRunner({
  actionLabel: 'ปลดล็อกไฟล์',
  defaults: { password: '' },
  secretFields: ['password'],
  async renderOptions(container, ctx) {
    container.innerHTML = `
      ${field('รหัสผ่านของไฟล์', '<input type="password" data-option="password" autocomplete="off" placeholder="กรอกรหัสผ่านที่ใช้เปิดไฟล์">',
        'ถ้าไฟล์ล็อกเฉพาะสิทธิ์การใช้งาน (ไม่ต้องใส่รหัสตอนเปิด) ให้เว้นว่างไว้')}
      <div class="notice notice--warn">
        <div style="font-size:13px">ใช้เครื่องมือนี้กับไฟล์ที่คุณมีสิทธิ์ใช้งานเท่านั้น
        การปลดล็อกเอกสารของผู้อื่นโดยไม่ได้รับอนุญาตอาจผิดกฎหมาย</div>
      </div>`;
    bindOptions(container, ctx);
  },
  buildParams: (ctx) => ({ password: String(ctx.options.password || '') }),
});

RUNNERS['pdf-to-word'] = serverRunner({
  actionLabel: 'แปลงเป็นไฟล์ Word',
  defaults: { ocr: 'auto', langs: 'tha+eng' },
  async renderOptions(container, ctx) {
    container.innerHTML = `
      ${field('เอกสารสแกน', choiceGroup('ocr', [
        { value: 'auto', label: 'อ่านอัตโนมัติ' },
        { value: 'off', label: 'ไม่ต้องอ่าน' },
      ], ctx.options.ocr), 'ถ้าไฟล์เป็นภาพสแกน ระบบจะใช้ OCR อ่านข้อความให้อัตโนมัติ')}
      ${field('ภาษาในเอกสาร', `<select data-option="langs">
        <option value="tha+eng" ${ctx.options.langs === 'tha+eng' ? 'selected' : ''}>ไทย + อังกฤษ</option>
        <option value="tha" ${ctx.options.langs === 'tha' ? 'selected' : ''}>ไทยอย่างเดียว</option>
        <option value="eng" ${ctx.options.langs === 'eng' ? 'selected' : ''}>อังกฤษอย่างเดียว</option>
      </select>`)}
      <div class="field__hint">ไฟล์ Word ที่ได้จะคงข้อความและย่อหน้าไว้ แต่การจัดหน้าที่ซับซ้อน เช่น ตารางหรือคอลัมน์ อาจต้องปรับเพิ่มเล็กน้อย</div>`;
    bindOptions(container, ctx);
  },
  buildParams: (ctx) => ({ ocr: ctx.options.ocr, langs: ctx.options.langs }),
});

// ---------------------------------------------------------------- OCR บนเครื่อง
RUNNERS.ocr = {
  actionLabel: 'อ่านข้อความจากไฟล์',
  steps: ['เลือกไฟล์', 'เลือกภาษา', 'อ่านข้อความ', 'บันทึกผล'],
  defaults: { langs: 'tha+eng', dpi: 200 },
  async renderOptions(container, ctx) {
    container.innerHTML = `
      ${field('ภาษาที่ต้องการอ่าน', `<select data-option="langs">
        <option value="tha+eng" ${ctx.options.langs === 'tha+eng' ? 'selected' : ''}>ไทย + อังกฤษ</option>
        <option value="tha" ${ctx.options.langs === 'tha' ? 'selected' : ''}>ไทยอย่างเดียว</option>
        <option value="eng" ${ctx.options.langs === 'eng' ? 'selected' : ''}>อังกฤษอย่างเดียว</option>
      </select>`)}
      <div class="notice">
        <div style="font-size:13px">การอ่านข้อความทำบนเครื่องของคุณ เอกสารไม่ถูกส่งออกไปไหน
        แต่ครั้งแรกต้องต่ออินเทอร์เน็ตเพื่อดาวน์โหลดข้อมูลภาษา (ประมาณ 5–15 MB) หลังจากนั้นเบราว์เซอร์จะจำไว้ให้</div>
      </div>`;
    bindOptions(container, ctx);
  },
  async run(ctx, { onProgress, setTask }) {
    return withJobTracking(ctx.tool, ctx, async () => {
      const { runClientOcr } = await import('../pdf/ocr-client.js');
      const file = ctx.files[0];
      const controller = new AbortController();
      setTask({ cancel: () => controller.abort() });

      const result = await runClientOcr(file, {
        langs: ctx.options.langs,
        dpi: Number(ctx.options.dpi),
        onProgress,
        signal: controller.signal,
      });

      const name = outputName(file.name, 'ocr', 'txt');
      const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
      return {
        title: 'อ่านข้อความสำเร็จ',
        files: [{ name }],
        bytesOut: blob.size,
        stats: [
          { label: 'จำนวนหน้า', value: `${result.pages} หน้า` },
          { label: 'จำนวนอักขระ', value: formatNumber(result.text.length) },
          { label: 'ความมั่นใจเฉลี่ย', value: `${Math.round(result.confidence)}%` },
        ],
        note: result.confidence < 70
          ? 'ความมั่นใจในการอ่านค่อนข้างต่ำ หากผลลัพธ์ไม่ถูกต้อง ลองสแกนใหม่ให้คมชัดและตรงมากขึ้น'
          : '',
        onDownload: () => downloadBlob(blob, name),
        previewText: result.text,
      };
    });
  },
};

export function createRunner(tool) {
  const runner = RUNNERS[tool.id];
  if (!runner) {
    return {
      actionLabel: 'เริ่มประมวลผล',
      async renderOptions(container) {
        container.innerHTML = '<div class="field__hint">เครื่องมือนี้ยังไม่พร้อมใช้งาน</div>';
      },
      async run() { throw new Error('ยังไม่รองรับเครื่องมือนี้'); },
    };
  }
  return runner;
}
