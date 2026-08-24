/**
 * Worker สำหรับตรวจสุขภาพระบบฟอนต์ไทย (ใช้ในการทดสอบและหน้า diagnostics)
 * ตรวจว่า pdf-lib + fontkit + ฟอนต์ Sarabun ทำงานได้จริงใน Web Worker
 */
self.addEventListener('message', async () => {
  const report = {};
  try {
    const { PDFDocument } = await import('../../assets/vendor/pdf-lib.esm.min.js');
    report.pdfLib = 'ok';
    const mod = await import('../../assets/vendor/fontkit.esm.js');
    const fontkit = mod.default || mod;
    report.fontkit = typeof fontkit === 'object' || typeof fontkit === 'function' ? 'ok' : 'invalid';
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const res = await fetch('/assets/fonts/Sarabun-Regular.ttf');
    report.fontFetch = res.status;
    const bytes = await res.arrayBuffer();
    report.fontBytes = bytes.byteLength;
    const font = await doc.embedFont(bytes, { subset: true });
    const page = doc.addPage([420, 200]);
    page.drawText('ทดสอบภาษาไทย ๑๒๓', { x: 24, y: 110, size: 22, font });
    const saved = await doc.save();
    report.pdfBytes = saved.byteLength;
    report.ok = true;
  } catch (err) {
    report.ok = false;
    report.error = err.message;
  }
  self.postMessage(report);
});
