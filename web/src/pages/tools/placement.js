/**
 * ผืนผ้าใบสำหรับวางองค์ประกอบลงบนหน้า PDF
 * ใช้ร่วมกันระหว่างเครื่องมือ "เซ็นเอกสาร" และ "เพิ่มข้อมูลใน PDF"
 *
 * พิกัดขององค์ประกอบเก็บเป็นสัดส่วน 0-1 ของหน้ากระดาษ
 * ทำให้ตำแหน่งคงที่ไม่ว่าจะแสดงผลบนจอขนาดใด และแปลงเป็นพิกัด PDF ได้ตรง
 */
import { renderPageToCanvas } from '../../pdf/render.js';
import icon from '../../ui/icons.js';
import { escapeHtml } from '../../utils/format.js';

export function createPlacementCanvas({ pdfDoc, container, onChange, onSelect }) {
  const state = {
    elements: [],
    selectedId: null,
    pageBoxes: [],
    undoStack: [],
    redoStack: [],
    currentPage: 0,
  };

  container.className = 'editor__stage';
  container.innerHTML = '';

  /** วาดทุกหน้าและสร้าง layer สำหรับวางองค์ประกอบ */
  async function renderPages({ maxWidth = 760 } = {}) {
    container.innerHTML = '';
    state.pageBoxes = [];
    const width = Math.min(maxWidth, container.clientWidth - 24 || maxWidth);

    for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
      const wrapper = document.createElement('div');
      wrapper.className = 'editor__page';
      wrapper.dataset.pageIndex = String(pageNumber - 1);

      const canvas = document.createElement('canvas');
      wrapper.appendChild(canvas);

      const layer = document.createElement('div');
      layer.className = 'editor__layer';
      wrapper.appendChild(layer);
      container.appendChild(wrapper);

      const { width: renderedWidth, height: renderedHeight } =
        await renderPageToCanvas(pdfDoc, pageNumber, { scale: 1, maxWidth: width, canvas });
      wrapper.style.width = `${renderedWidth}px`;
      wrapper.style.height = `${renderedHeight}px`;

      state.pageBoxes.push({ wrapper, layer, width: renderedWidth, height: renderedHeight, index: pageNumber - 1 });
      attachLayerHandlers(state.pageBoxes[pageNumber - 1]);
    }
    redraw();
  }

  function attachLayerHandlers(box) {
    box.layer.addEventListener('pointerdown', (event) => {
      if (event.target === box.layer) select(null);
      state.currentPage = box.index;
    });
  }

  function pushHistory() {
    state.undoStack.push(JSON.stringify(state.elements));
    if (state.undoStack.length > 40) state.undoStack.shift();
    state.redoStack.length = 0;
  }

  function addElement(element) {
    pushHistory();
    const id = `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    state.elements.push({ id, opacity: 1, rotation: 0, ...element });
    redraw();
    select(id);
    onChange?.(state.elements);
    return id;
  }

  function updateElement(id, patch, { history = true } = {}) {
    const element = state.elements.find((item) => item.id === id);
    if (!element) return;
    if (history) pushHistory();
    Object.assign(element, patch);
    redraw();
    onChange?.(state.elements);
  }

  function removeElement(id) {
    pushHistory();
    state.elements = state.elements.filter((item) => item.id !== id);
    if (state.selectedId === id) state.selectedId = null;
    redraw();
    onChange?.(state.elements);
  }

  function select(id) {
    state.selectedId = id;
    container.querySelectorAll('.editor__el').forEach((node) => {
      node.dataset.selected = String(node.dataset.id === id);
    });
    onSelect?.(state.elements.find((item) => item.id === id) || null);
  }

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(JSON.stringify(state.elements));
    state.elements = JSON.parse(state.undoStack.pop());
    state.selectedId = null;
    redraw();
    onChange?.(state.elements);
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(JSON.stringify(state.elements));
    state.elements = JSON.parse(state.redoStack.pop());
    redraw();
    onChange?.(state.elements);
  }

  function elementHtml(element, box) {
    if (element.type === 'image' || element.type === 'signature') {
      return `<img src="${element.src}" alt="" draggable="false">`;
    }
    if (element.type === 'checkbox') {
      const size = (element.fontSize || 16) * (box.height / (element.pageHeightPt || 842));
      return `<div style="width:100%;height:100%;border:1.6px solid #334155;border-radius:3px;
        display:grid;place-items:center;font-size:${Math.max(9, size * 0.7)}px;font-weight:700;color:#166534">
        ${element.checked ? '&#10003;' : ''}</div>`;
    }
    const fontPx = (element.fontSize || 14) * (box.height / (element.pageHeightPt || 842));
    return `<div class="editor__el-text" style="font-size:${Math.max(8, fontPx)}px;color:${element.color || '#111827'};
      font-weight:${element.bold ? 700 : 400}">${escapeHtml(element.text || '')}</div>`;
  }

  function redraw() {
    state.pageBoxes.forEach((box) => { box.layer.innerHTML = ''; });

    state.elements.forEach((element) => {
      const box = state.pageBoxes[element.pageIndex];
      if (!box) return;

      const node = document.createElement('div');
      node.className = 'editor__el';
      node.dataset.id = element.id;
      node.dataset.selected = String(state.selectedId === element.id);
      node.style.left = `${element.x * box.width}px`;
      node.style.top = `${element.y * box.height}px`;
      node.style.width = `${(element.width || 0.2) * box.width}px`;
      node.style.height = `${(element.height || 0.06) * box.height}px`;
      node.style.opacity = String(element.opacity ?? 1);
      if (element.rotation) node.style.transform = `rotate(${element.rotation}deg)`;
      node.innerHTML = `${elementHtml(element, box)}<span class="editor__handle" data-handle></span>`;

      makeDraggable(node, element, box);
      box.layer.appendChild(node);
    });
  }

  function makeDraggable(node, element, box) {
    let mode = null;
    let startX = 0;
    let startY = 0;
    let origin = null;

    const onPointerDown = (event) => {
      event.stopPropagation();
      select(element.id);
      mode = event.target.hasAttribute('data-handle') ? 'resize' : 'move';
      startX = event.clientX;
      startY = event.clientY;
      origin = { x: element.x, y: element.y, width: element.width, height: element.height };
      node.setPointerCapture(event.pointerId);
      pushHistory();
    };

    const onPointerMove = (event) => {
      if (!mode) return;
      event.preventDefault();
      const deltaX = (event.clientX - startX) / box.width;
      const deltaY = (event.clientY - startY) / box.height;

      if (mode === 'move') {
        element.x = Math.min(0.999, Math.max(-0.05, origin.x + deltaX));
        element.y = Math.min(0.999, Math.max(-0.05, origin.y + deltaY));
        node.style.left = `${element.x * box.width}px`;
        node.style.top = `${element.y * box.height}px`;
      } else {
        element.width = Math.max(0.02, origin.width + deltaX);
        element.height = Math.max(0.015, origin.height + deltaY);
        node.style.width = `${element.width * box.width}px`;
        node.style.height = `${element.height * box.height}px`;
      }
    };

    const onPointerUp = (event) => {
      if (!mode) return;
      mode = null;
      try { node.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
      onChange?.(state.elements);
      onSelect?.(element);
    };

    node.addEventListener('pointerdown', onPointerDown);
    node.addEventListener('pointermove', onPointerMove);
    node.addEventListener('pointerup', onPointerUp);
    node.addEventListener('pointercancel', onPointerUp);
  }

  // แป้นพิมพ์ลัด (spec ข้อ 104)
  function onKeydown(event) {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (typing) return;
    const ctrl = event.ctrlKey || event.metaKey;

    if (ctrl && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
    else if (ctrl && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) { event.preventDefault(); redo(); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedId) { event.preventDefault(); removeElement(state.selectedId); }
    else if (event.key.startsWith('Arrow') && state.selectedId) {
      event.preventDefault();
      const step = event.shiftKey ? 0.01 : 0.002;
      const element = state.elements.find((item) => item.id === state.selectedId);
      if (!element) return;
      if (event.key === 'ArrowUp') element.y -= step;
      if (event.key === 'ArrowDown') element.y += step;
      if (event.key === 'ArrowLeft') element.x -= step;
      if (event.key === 'ArrowRight') element.x += step;
      redraw();
      onChange?.(state.elements);
    }
  }
  document.addEventListener('keydown', onKeydown);

  return {
    state,
    renderPages,
    addElement,
    updateElement,
    removeElement,
    select,
    undo,
    redo,
    getElements: () => state.elements.map((element) => ({ ...element })),
    setElements(elements) { state.elements = elements.map((element) => ({ ...element })); redraw(); },
    get canUndo() { return state.undoStack.length > 0; },
    get canRedo() { return state.redoStack.length > 0; },
    destroy() {
      document.removeEventListener('keydown', onKeydown);
      container.innerHTML = '';
      state.elements = [];
    },
  };
}

/** แผงลายเซ็น: วาด / อัปโหลด / พิมพ์ (spec ข้อ 25) */
export function createSignaturePad({ onDone }) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="signature-tabs" role="tablist">
      <button type="button" role="tab" data-tab="draw" aria-selected="true">${icon('pen', { size: 15 })} วาด</button>
      <button type="button" role="tab" data-tab="upload" aria-selected="false">${icon('upload', { size: 15 })} อัปโหลด</button>
      <button type="button" role="tab" data-tab="type" aria-selected="false">${icon('text', { size: 15 })} พิมพ์</button>
    </div>
    <div data-panel="draw">
      <canvas class="signature-pad" width="750" height="300" aria-label="พื้นที่วาดลายเซ็น"></canvas>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
        <label style="font-size:13px">สี</label>
        <input type="color" id="sig-color" value="#111827" style="width:48px;height:34px;padding:2px;border-radius:9px">
        <label style="font-size:13px">ความหนา</label>
        <input type="range" id="sig-width" min="1" max="10" value="3" style="width:110px">
        <button type="button" class="btn btn--sm" id="sig-clear" style="margin-left:auto">ล้าง</button>
      </div>
    </div>
    <div data-panel="upload" hidden>
      <input type="file" id="sig-file" accept="image/png,image/jpeg" style="margin-bottom:10px">
      <div id="sig-preview" style="min-height:110px;display:grid;place-items:center;background:var(--surface-2);border-radius:14px">
        <span style="color:var(--text-faint);font-size:13px">ยังไม่ได้เลือกรูป</span>
      </div>
      <div class="field__hint">แนะนำไฟล์ PNG พื้นหลังโปร่งใส เพื่อให้ลายเซ็นดูเป็นธรรมชาติ</div>
    </div>
    <div data-panel="type" hidden>
      <input type="text" id="sig-text" placeholder="พิมพ์ชื่อของคุณ" maxlength="60" style="margin-bottom:10px">
      <select id="sig-font" style="margin-bottom:10px">
        <option value="cursive">ลายมือ</option>
        <option value="Sarabun, sans-serif">ตัวพิมพ์ปกติ</option>
        <option value="serif">ตัวพิมพ์มีเชิง</option>
      </select>
      <canvas id="sig-type-canvas" width="750" height="220" style="width:100%;background:#fff;border-radius:14px;border:1px solid var(--border)"></canvas>
    </div>`;

  const canvas = wrapper.querySelector('.signature-pad');
  const context = canvas.getContext('2d');
  context.lineCap = 'round';
  context.lineJoin = 'round';
  let drawing = false;
  let hasInk = false;

  const pointOf = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  canvas.addEventListener('pointerdown', (event) => {
    drawing = true;
    hasInk = true;
    canvas.setPointerCapture(event.pointerId);
    const point = pointOf(event);
    context.strokeStyle = wrapper.querySelector('#sig-color').value;
    context.lineWidth = Number(wrapper.querySelector('#sig-width').value) * 1.6;
    context.beginPath();
    context.moveTo(point.x, point.y);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    event.preventDefault();
    const point = pointOf(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => {
    canvas.addEventListener(type, () => { drawing = false; });
  });
  wrapper.querySelector('#sig-clear').addEventListener('click', () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    hasInk = false;
  });

  let uploadedDataUrl = null;
  wrapper.querySelector('#sig-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    uploadedDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    wrapper.querySelector('#sig-preview').innerHTML =
      `<img src="${uploadedDataUrl}" alt="ตัวอย่างลายเซ็น" style="max-height:150px">`;
  });

  const typeCanvas = wrapper.querySelector('#sig-type-canvas');
  const renderTyped = () => {
    const text = wrapper.querySelector('#sig-text').value;
    const font = wrapper.querySelector('#sig-font').value;
    const ctx2 = typeCanvas.getContext('2d');
    ctx2.clearRect(0, 0, typeCanvas.width, typeCanvas.height);
    if (!text) return;
    ctx2.fillStyle = '#111827';
    ctx2.font = `64px ${font}`;
    ctx2.textAlign = 'center';
    ctx2.textBaseline = 'middle';
    ctx2.fillText(text, typeCanvas.width / 2, typeCanvas.height / 2);
  };
  wrapper.querySelector('#sig-text').addEventListener('input', renderTyped);
  wrapper.querySelector('#sig-font').addEventListener('change', renderTyped);

  let activeTab = 'draw';
  wrapper.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activeTab = button.dataset.tab;
      wrapper.querySelectorAll('[data-tab]').forEach((tab) => tab.setAttribute('aria-selected', String(tab === button)));
      wrapper.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== activeTab; });
    });
  });

  /** ตัดพื้นที่ว่างรอบลายเซ็นออก แล้วคืนเป็น PNG โปร่งใส */
  function trimToDataUrl(sourceCanvas) {
    const { width, height } = sourceCanvas;
    const data = sourceCanvas.getContext('2d').getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let found = false;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] > 12) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return null;
    const pad = 8;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(width, maxX + pad); maxY = Math.min(height, maxY + pad);

    const output = document.createElement('canvas');
    output.width = maxX - minX;
    output.height = maxY - minY;
    output.getContext('2d').drawImage(sourceCanvas, minX, minY, output.width, output.height, 0, 0, output.width, output.height);
    return { dataUrl: output.toDataURL('image/png'), width: output.width, height: output.height };
  }

  wrapper.getSignature = () => {
    if (activeTab === 'draw') {
      if (!hasInk) return null;
      return trimToDataUrl(canvas);
    }
    if (activeTab === 'upload') {
      return uploadedDataUrl ? { dataUrl: uploadedDataUrl, width: 400, height: 160 } : null;
    }
    if (!wrapper.querySelector('#sig-text').value.trim()) return null;
    return trimToDataUrl(typeCanvas);
  };

  wrapper.querySelector('#sig-clear').addEventListener('click', () => onDone?.(null));
  return wrapper;
}
