/**
 * รูปภาพ -> PDF (ไม่ใช้ canvas จึงเรียกจาก Web Worker ได้)
 */
import { createPdf, savePdf, toFriendlyError } from './ops-core.js';

export const PAPER_SIZES = {
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
};

export async function imagesToPdf(images, {
  pageSize = 'A4', orientation = 'portrait', margin = 20, fit = 'contain',
  onProgress = () => {},
}) {
  try {
    const doc = await createPdf();

    for (let index = 0; index < images.length; index += 1) {
      const item = images[index];
      const embedded = item.mime === 'image/png'
        ? await doc.embedPng(item.bytes)
        : await doc.embedJpg(item.bytes);

      let pageWidth;
      let pageHeight;
      if (pageSize === 'original') {
        pageWidth = embedded.width;
        pageHeight = embedded.height;
      } else {
        const [w, h] = PAPER_SIZES[pageSize] || PAPER_SIZES.A4;
        const landscape = orientation === 'landscape'
          || (orientation === 'auto' && embedded.width > embedded.height);
        pageWidth = landscape ? h : w;
        pageHeight = landscape ? w : h;
      }

      const page = doc.addPage([pageWidth, pageHeight]);
      const availableWidth = pageSize === 'original' ? pageWidth : pageWidth - margin * 2;
      const availableHeight = pageSize === 'original' ? pageHeight : pageHeight - margin * 2;

      const scale = fit === 'cover'
        ? Math.max(availableWidth / embedded.width, availableHeight / embedded.height)
        : Math.min(availableWidth / embedded.width, availableHeight / embedded.height);
      const drawWidth = embedded.width * scale;
      const drawHeight = embedded.height * scale;

      page.drawImage(embedded, {
        x: (pageWidth - drawWidth) / 2,
        y: (pageHeight - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });

      onProgress(((index + 1) / images.length) * 93, `เพิ่มรูปที่ ${index + 1} จาก ${images.length}`);
    }

    onProgress(96, 'กำลังสร้างไฟล์ PDF');
    return savePdf(doc);
  } catch (err) {
    throw toFriendlyError(err);
  }
}
