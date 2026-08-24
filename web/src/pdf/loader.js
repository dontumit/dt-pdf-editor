/**
 * โหลด library ขนาดใหญ่แบบ lazy (spec ข้อ 91)
 * pdf-lib / pdfjs / fontkit / jszip จะถูกโหลดเฉพาะตอนที่ใช้จริง
 * ไฟล์ทั้งหมด self-host อยู่ใน /assets/vendor จึงทำงานได้แม้ CDN ล่มหรือออฟไลน์
 */
export const VENDOR = '/assets/vendor';

let pdfLibPromise = null;
let pdfjsPromise = null;
let fontkitPromise = null;
let jszipPromise = null;

export function loadPdfLib() {
  if (!pdfLibPromise) pdfLibPromise = import(`${VENDOR}/pdf-lib.esm.min.js`);
  return pdfLibPromise;
}

export function loadFontkit() {
  if (!fontkitPromise) {
    fontkitPromise = import(`${VENDOR}/fontkit.esm.js`).then((mod) => mod.default || mod);
  }
  return fontkitPromise;
}

export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(`${VENDOR}/pdf.min.mjs`).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}/pdf.worker.min.mjs`;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export function loadJsZip() {
  if (!jszipPromise) {
    jszipPromise = import(`${VENDOR}/jszip.min.js`).then(() => window.JSZip);
  }
  return jszipPromise;
}

/**
 * OCR ใช้ Tesseract.js จาก CDN เพราะไฟล์ข้อมูลภาษาไทยมีขนาดใหญ่หลาย MB
 * จึงไม่เหมาะกับการบันเดิลไว้ในแอป — ครั้งแรกต้องต่ออินเทอร์เน็ต
 */
let tesseractPromise = null;
export function loadTesseract() {
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      if (window.Tesseract) { resolve(window.Tesseract); return; }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => {
        tesseractPromise = null;
        reject(new Error('โหลดโมดูล OCR ไม่สำเร็จ — เครื่องมือนี้ต้องต่ออินเทอร์เน็ต'));
      };
      document.head.appendChild(script);
    });
  }
  return tesseractPromise;
}
