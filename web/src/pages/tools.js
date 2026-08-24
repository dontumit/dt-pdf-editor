/** หน้ารวมเครื่องมือทั้งหมด แยกตามหมวด พร้อมค้นหา */
import { TOOLS, CATEGORIES, searchTools } from '../core/tools.js';
import appState from '../core/state.js';
import icon from '../ui/icons.js';
import { toolCardHtml } from './home.js';
import { escapeHtml } from '../utils/format.js';

export default async function ToolsPage({ root, params }) {
  const lang = appState.get().language || 'th';
  const activeCategory = params.category || 'all';

  root.innerHTML = `
    <div class="section-title" style="margin-top:6px"><h2 style="font-size:19px">เครื่องมือทั้งหมด</h2></div>
    <div class="search-box">
      <span class="search-box__icon">${icon('search', { size: 18 })}</span>
      <input type="search" id="tool-search" placeholder="ค้นหาเครื่องมือ" aria-label="ค้นหาเครื่องมือ" enterkeyhint="search">
    </div>
    <div class="choice-group" style="margin-bottom:16px" id="cat-filter">
      <label class="choice"><input type="radio" name="cat" value="all" ${activeCategory === 'all' ? 'checked' : ''}><span>ทั้งหมด</span></label>
      ${CATEGORIES.map((category) => `
        <label class="choice"><input type="radio" name="cat" value="${category.id}" ${activeCategory === category.id ? 'checked' : ''}>
        <span>${escapeHtml(category.name[lang] || category.name.th)}</span></label>`).join('')}
    </div>
    <div id="tool-list"></div>`;

  const listEl = root.querySelector('#tool-list');
  const searchInput = root.querySelector('#tool-search');
  let category = activeCategory;

  function render() {
    const query = searchInput.value.trim();
    let tools = query ? searchTools(query, lang) : TOOLS;
    if (category !== 'all') tools = tools.filter((tool) => tool.category === category);

    if (!tools.length) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state__icon">${icon('search', { size: 42, stroke: 1.5 })}</div>
        <h3>ไม่พบเครื่องมือ</h3><p>ลองเปลี่ยนคำค้นหรือเลือกหมวดอื่น</p></div>`;
      return;
    }

    listEl.innerHTML = `
      <div class="tool-grid">${tools.map((tool) => toolCardHtml(tool, lang)).join('')}</div>
      <div class="card" style="margin-top:20px">
        <div class="card__title">สัญลักษณ์บนการ์ด</div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;color:var(--text-muted)">
          <div style="display:flex;align-items:center;gap:9px">
            <span style="width:9px;height:9px;border-radius:50%;background:var(--accent-sun);box-shadow:0 0 10px 2px color-mix(in srgb,var(--accent-sun) 70%,transparent)"></span>
            ใช้ทรัพยากรเครื่องสูง หรือต้องเชื่อมต่ออินเทอร์เน็ต
          </div>
          <div>เครื่องมือที่ไม่มีจุด ทำงานบนเครื่องคุณทั้งหมด และใช้งานได้แม้ออฟไลน์</div>
        </div>
      </div>`;
  }

  let timer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  });
  root.querySelector('#cat-filter').addEventListener('change', (event) => {
    category = event.target.value;
    render();
  });

  render();
  return () => clearTimeout(timer);
}
