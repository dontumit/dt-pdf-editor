/**
 * เรนเดอร์หน้า PDF ด้วย pdf.js
 * - ใช้ worker ของ pdf.js เอง งาน parse จึงไม่บล็อก UI
 * - เรนเดอร์เฉพาะหน้าที่มองเห็นด้วย IntersectionObserver (spec ข้อ 35)
 */
import { loadPdfjs } from './loader.js';

/** เปิดเอกสาร PDF สำหรับอ่าน/เรนเดอร์ */
export async function openDocument(data, { password } = {}) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    password,
    isEvalSupported: false,
    disableAutoFetch: true,
    useSystemFonts: true,
    cMapUrl: '/assets/vendor/cmaps/',
    cMapPacked: true,
  });
  try {
    return await task.promise;
  } catch (err) {
    if (err?.name === 'PasswordException') {
      const error = new Error('ไฟล์นี้มีรหัสผ่าน กรุณากรอกรหัสผ่านเพื่อเปิดไฟล์');
      error.code = 'PASSWORD_REQUIRED';
      throw error;
    }
    if (err?.name === 'InvalidPDFException') {
      const error = new Error('ไฟล์ PDF เสียหายหรือมีรูปแบบที่ไม่รองรับ');
      error.code = 'PDF_INVALID';
      throw error;
    }
    throw err;
  }
}

/** เรนเดอร์ 1 หน้าลง canvas */
export async function renderPageToCanvas(pdfDoc, pageNumber, { scale = 1, maxWidth = null, canvas = null, rotation = null } = {}) {
  const page = await pdfDoc.getPage(pageNumber);
  let viewport = page.getViewport({ scale, rotation: rotation ?? undefined });

  if (maxWidth && viewport.width > maxWidth) {
    viewport = page.getViewport({ scale: (scale * maxWidth) / viewport.width, rotation: rotation ?? undefined });
  }

  const target = canvas || document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  target.width = Math.floor(viewport.width * dpr);
  target.height = Math.floor(viewport.height * dpr);
  target.style.width = `${Math.floor(viewport.width)}px`;
  target.style.height = `${Math.floor(viewport.height)}px`;

  const context = target.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, target.width, target.height);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  await page.render({ canvasContext: context, viewport, intent: 'display' }).promise;
  page.cleanup();
  return { canvas: target, width: viewport.width, height: viewport.height };
}

/** เรนเดอร์เป็น Blob (ใช้กับ PDF → รูปภาพ) */
export async function renderPageToBlob(pdfDoc, pageNumber, { dpi = 150, format = 'image/jpeg', quality = 0.85 } = {}) {
  const scale = dpi / 72;
  const { canvas, width, height } = await renderPageToCanvas(pdfDoc, pageNumber, { scale });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, format, quality));
  // คืนหน่วยความจำของ canvas ทันที (spec ข้อ 70)
  canvas.width = 0;
  canvas.height = 0;
  return { blob, width, height };
}

/** สร้าง data URL ขนาดเล็กสำหรับ thumbnail */
export async function renderThumbnail(pdfDoc, pageNumber, { maxWidth = 220 } = {}) {
  const { canvas } = await renderPageToCanvas(pdfDoc, pageNumber, { scale: 1, maxWidth });
  const url = canvas.toDataURL('image/jpeg', 0.7);
  canvas.width = 0;
  canvas.height = 0;
  return url;
}

/**
 * เรนเดอร์ทีละหน้าเมื่อ element เข้ามาในจอ
 * คืน observer ไว้ให้เรียก disconnect เมื่อออกจากหน้า
 */
export function createLazyRenderer(pdfDoc, { maxWidth = 220 } = {}) {
  const rendered = new Set();
  const observer = new IntersectionObserver(async (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target;
      const pageNumber = Number(element.dataset.page);
      if (!pageNumber || rendered.has(pageNumber)) continue;
      rendered.add(pageNumber);
      observer.unobserve(element);
      try {
        const url = await renderThumbnail(pdfDoc, pageNumber, { maxWidth });
        const image = new Image();
        image.src = url;
        image.alt = `ตัวอย่างหน้า ${pageNumber}`;
        image.loading = 'lazy';
        element.querySelector('.page-thumb__skeleton')?.replaceWith(image);
      } catch (err) {
        rendered.delete(pageNumber);
        console.warn('render thumbnail failed', pageNumber, err);
      }
    }
  }, { rootMargin: '250px 0px' });

  return {
    observe: (element) => observer.observe(element),
    disconnect: () => observer.disconnect(),
  };
}

/** ดึงข้อมูลสรุปของเอกสาร */
export async function documentInfo(pdfDoc) {
  const metadata = await pdfDoc.getMetadata().catch(() => null);
  const firstPage = await pdfDoc.getPage(1);
  const viewport = firstPage.getViewport({ scale: 1 });
  firstPage.cleanup();
  return {
    pageCount: pdfDoc.numPages,
    width: viewport.width,
    height: viewport.height,
    title: metadata?.info?.Title || '',
    encrypted: Boolean(metadata?.info?.IsEncrypted),
  };
}

/** ตรวจว่าหน้ามีข้อความจริงหรือเป็นภาพสแกน */
export async function pageHasText(pdfDoc, pageNumber) {
  const page = await pdfDoc.getPage(pageNumber);
  const content = await page.getTextContent();
  page.cleanup();
  return content.items.some((item) => item.str && item.str.trim());
}
