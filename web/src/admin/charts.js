/**
 * กราฟ SVG แบบเขียนเอง — ไม่พึ่งไลบรารีภายนอก
 * ทำให้แผงผู้ดูแลโหลดเร็วและใช้งานออฟไลน์ได้
 * ข้อมูลทั้งหมดมาจาก API จริง ไม่มีข้อมูลตัวอย่าง
 */
import { formatNumber, escapeHtml } from '../utils/format.js';

const PALETTE = ['#7c6bf5', '#4fd1b5', '#ff8ec7', '#ffc857', '#60a5fa', '#f97316'];

/** กราฟเส้นหลายชุดข้อมูล พร้อมพื้นที่ไล่เฉดใต้เส้น */
export function lineChart({ data, series, height = 190, formatX = (d) => d }) {
  if (!data.length) return '<div class="empty-state" style="padding:26px">ยังไม่มีข้อมูล</div>';

  const width = 720;
  const padding = { top: 14, right: 12, bottom: 26, left: 42 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const maxValue = Math.max(1, ...series.flatMap((s) => data.map((row) => Number(row[s.key]) || 0)));
  const stepX = data.length > 1 ? innerWidth / (data.length - 1) : 0;
  const pointAt = (index, value) => ({
    x: padding.left + index * stepX,
    y: padding.top + innerHeight - (value / maxValue) * innerHeight,
  });

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = padding.top + innerHeight * (1 - ratio);
    return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"
      stroke="currentColor" stroke-opacity=".12" stroke-width="1"/>
      <text x="${padding.left - 7}" y="${y + 4}" text-anchor="end" font-size="10.5"
        fill="currentColor" fill-opacity=".5">${formatNumber(Math.round(maxValue * ratio))}</text>`;
  }).join('');

  const labelEvery = Math.max(1, Math.ceil(data.length / 7));
  const xLabels = data.map((row, index) => {
    if (index % labelEvery !== 0 && index !== data.length - 1) return '';
    const { x } = pointAt(index, 0);
    return `<text x="${x}" y="${height - 7}" text-anchor="middle" font-size="10.5"
      fill="currentColor" fill-opacity=".5">${escapeHtml(formatX(row))}</text>`;
  }).join('');

  const paths = series.map((item, seriesIndex) => {
    const color = item.color || PALETTE[seriesIndex % PALETTE.length];
    const points = data.map((row, index) => pointAt(index, Number(row[item.key]) || 0));
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = `${line} L${points[points.length - 1].x.toFixed(1)},${padding.top + innerHeight} L${points[0].x.toFixed(1)},${padding.top + innerHeight} Z`;
    return `
      <defs><linearGradient id="grad-${item.key}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".28"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#grad-${item.key})"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2.4"
        stroke-linejoin="round" stroke-linecap="round"/>
      ${points.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.6" fill="${color}"/>`).join('')}`;
  }).join('');

  const legend = series.map((item, index) => `
    <span><i style="background:${item.color || PALETTE[index % PALETTE.length]}"></i>${escapeHtml(item.label)}</span>`).join('');

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img"
      aria-label="กราฟ ${series.map((s) => s.label).join(' และ ')}">
      ${gridLines}${paths}${xLabels}
    </svg>
    <div class="chart-legend">${legend}</div>`;
}

/** กราฟแท่งแนวนอน เหมาะกับอันดับเครื่องมือยอดนิยม */
export function barList({ items, valueKey = 'value', labelKey = 'label', suffix = '' }) {
  if (!items.length) return '<div class="empty-state" style="padding:26px">ยังไม่มีข้อมูล</div>';
  const max = Math.max(1, ...items.map((item) => Number(item[valueKey]) || 0));
  return items.map((item, index) => {
    const value = Number(item[valueKey]) || 0;
    const color = PALETTE[index % PALETTE.length];
    return `
      <div class="bar-row">
        <span class="bar-row__label" title="${escapeHtml(item[labelKey])}">${escapeHtml(item[labelKey])}</span>
        <span class="bar-row__track">
          <span class="bar-row__fill" style="width:${(value / max) * 100}%;
            background:linear-gradient(90deg,${color},${color}bb);
            box-shadow:0 0 10px -1px ${color}99"></span>
        </span>
        <span class="bar-row__value">${formatNumber(value)}${suffix}</span>
      </div>`;
  }).join('');
}

/** แถบแสดงสัดส่วน เช่น พื้นที่ที่ใช้ หรืออัตราความสำเร็จ */
export function gauge({ ratio, color = '#7c6bf5', label = '' }) {
  const percent = Math.max(0, Math.min(1, Number(ratio) || 0)) * 100;
  return `
    <div class="gauge">
      <span class="gauge__track">
        <span class="gauge__fill" style="width:${percent}%;background:linear-gradient(90deg,${color},${color}aa);
          box-shadow:0 0 10px -1px ${color}"></span>
      </span>
      <strong style="font-size:13.5px;font-variant-numeric:tabular-nums">${percent.toFixed(1)}%</strong>
    </div>
    ${label ? `<div style="font-size:12px;color:var(--text-faint);margin-top:5px">${escapeHtml(label)}</div>` : ''}`;
}

export function metricCard({ label, value, sub = '', color = 'var(--brand)' }) {
  return `
    <div class="metric" style="--metric-color:${color}">
      <div class="metric__label">${escapeHtml(label)}</div>
      <div class="metric__value">${escapeHtml(String(value))}</div>
      ${sub ? `<div class="metric__sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;
}

export { PALETTE };
