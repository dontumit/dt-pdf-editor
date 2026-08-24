/**
 * ประมวลผลภาพสำหรับสแกนเอกสาร (spec ข้อ 13)
 * ทั้งหมดทำด้วย Canvas API บนเครื่องผู้ใช้
 */

/** คำนวณเมทริกซ์ homography สำหรับดัดภาพ 4 มุมให้เป็นสี่เหลี่ยมตรง */
function computeHomography(src, dst) {
  // แก้ระบบสมการเชิงเส้น 8 ตัวแปรด้วยวิธี Gaussian elimination
  const a = [];
  const b = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const n = 8;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    if (Math.abs(a[col][col]) < 1e-10) continue;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k < n; k += 1) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }

  const h = new Array(9);
  for (let i = 0; i < n; i += 1) h[i] = Math.abs(a[i][i]) < 1e-10 ? 0 : b[i] / a[i][i];
  h[8] = 1;
  return h;
}

function invert3x3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    (e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
    (f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
    (d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
}

/**
 * ดัดมุมภาพให้ตรง (perspective correction)
 * @param {HTMLCanvasElement} source
 * @param {Array<{x:number,y:number}>} corners 4 มุมตามเข็มนาฬิกาเริ่มจากซ้ายบน (พิกัดจริงบน canvas)
 */
export function warpPerspective(source, corners, { outputWidth, outputHeight } = {}) {
  const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const width = outputWidth || Math.round(Math.max(distance(corners[0], corners[1]), distance(corners[3], corners[2])));
  const height = outputHeight || Math.round(Math.max(distance(corners[0], corners[3]), distance(corners[1], corners[2])));

  const dst = [
    { x: 0, y: 0 }, { x: width, y: 0 },
    { x: width, y: height }, { x: 0, y: height },
  ];
  const forward = computeHomography(corners, dst);
  const inverse = invert3x3(forward);
  if (!inverse) return source;

  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  const sourceData = sourceContext.getImageData(0, 0, source.width, source.height);
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const outputContext = output.getContext('2d');
  const outputData = outputContext.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const denominator = inverse[6] * x + inverse[7] * y + inverse[8];
      const sx = Math.round((inverse[0] * x + inverse[1] * y + inverse[2]) / denominator);
      const sy = Math.round((inverse[3] * x + inverse[4] * y + inverse[5]) / denominator);
      const target = (y * width + x) * 4;

      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) {
        outputData.data[target + 3] = 255;
        outputData.data[target] = 255;
        outputData.data[target + 1] = 255;
        outputData.data[target + 2] = 255;
        continue;
      }
      const origin = (sy * source.width + sx) * 4;
      outputData.data[target] = sourceData.data[origin];
      outputData.data[target + 1] = sourceData.data[origin + 1];
      outputData.data[target + 2] = sourceData.data[origin + 2];
      outputData.data[target + 3] = 255;
    }
  }

  outputContext.putImageData(outputData, 0, 0);
  return output;
}

export const SCAN_MODES = {
  auto: { th: 'อัตโนมัติ', contrast: 1.25, brightness: 1.06, grayscale: false, sharpen: true, threshold: false },
  document: { th: 'เอกสาร', contrast: 1.55, brightness: 1.14, grayscale: true, sharpen: true, threshold: true },
  idcard: { th: 'บัตรประชาชน', contrast: 1.28, brightness: 1.08, grayscale: false, sharpen: true, threshold: false },
  receipt: { th: 'ใบเสร็จ', contrast: 1.7, brightness: 1.18, grayscale: true, sharpen: true, threshold: true },
  photo: { th: 'รูปถ่าย', contrast: 1, brightness: 1, grayscale: false, sharpen: false, threshold: false },
};

/** ปรับความคมชัด/ความสว่าง/ขาวดำ ตามโหมดที่เลือก */
export function enhance(canvas, mode = 'auto') {
  const preset = SCAN_MODES[mode] || SCAN_MODES.auto;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (preset.grayscale) {
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      r = gray; g = gray; b = gray;
    }
    r = (r - 128) * preset.contrast + 128;
    g = (g - 128) * preset.contrast + 128;
    b = (b - 128) * preset.contrast + 128;
    r *= preset.brightness;
    g *= preset.brightness;
    b *= preset.brightness;

    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }
  context.putImageData(image, 0, 0);

  if (preset.sharpen) sharpen(canvas, 0.6);
  return canvas;
}

/** ทำให้ภาพคมขึ้นด้วย convolution kernel */
function sharpen(canvas, amount = 0.6) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const source = context.getImageData(0, 0, width, height);
  const output = context.createImageData(width, height);
  const kernel = [0, -amount, 0, -amount, 1 + 4 * amount, -amount, 0, -amount, 0];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        let k = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            sum += source.data[((y + ky) * width + (x + kx)) * 4 + channel] * kernel[k];
            k += 1;
          }
        }
        output.data[(y * width + x) * 4 + channel] = Math.max(0, Math.min(255, sum));
      }
      output.data[(y * width + x) * 4 + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
}

/**
 * เดาตำแหน่ง 4 มุมของเอกสารอย่างง่าย
 * ใช้ความแตกต่างของความสว่างจากขอบภาพเข้ามาหาบริเวณเอกสาร
 */
export function guessCorners(canvas, { threshold = 42 } = {}) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;

  const luminanceAt = (x, y) => {
    const offset = (y * width + x) * 4;
    return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  };

  // ค่าความสว่างเฉลี่ยของกรอบนอก ใช้เป็นตัวแทน "พื้นหลัง"
  let background = 0;
  let samples = 0;
  for (let x = 0; x < width; x += 4) {
    background += luminanceAt(x, 2) + luminanceAt(x, height - 3);
    samples += 2;
  }
  for (let y = 0; y < height; y += 4) {
    background += luminanceAt(2, y) + luminanceAt(width - 3, y);
    samples += 2;
  }
  background /= samples;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      if (Math.abs(luminanceAt(x, y) - background) > threshold) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!found || maxX - minX < width * 0.2 || maxY - minY < height * 0.2) {
    const inset = 0.06;
    return [
      { x: width * inset, y: height * inset },
      { x: width * (1 - inset), y: height * inset },
      { x: width * (1 - inset), y: height * (1 - inset) },
      { x: width * inset, y: height * (1 - inset) },
    ];
  }

  return [
    { x: minX, y: minY }, { x: maxX, y: minY },
    { x: maxX, y: maxY }, { x: minX, y: maxY },
  ];
}
