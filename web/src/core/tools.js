/**
 * ทะเบียนเครื่องมือ — แหล่งความจริงเดียวของทั้งระบบ
 * ใช้สร้างหน้าแรก, ค้นหา, เมนู, routing และสถิติ
 *
 * runsOn:
 *   'local'  = ประมวลผลบนเครื่องผู้ใช้ทั้งหมด ไฟล์ไม่ออกจากเครื่อง (ใช้งานออฟไลน์ได้)
 *   'server' = ต้องอัปโหลดไปประมวลผลบนเซิร์ฟเวอร์ (ต้องต่ออินเทอร์เน็ต)
 * heavy: true = ใช้ CPU/หน่วยความจำสูง จะขึ้นจุดสีส้มเตือนบนการ์ด
 */
export const TOOLS = [
  {
    id: 'scan', route: '/scan', category: 'scan', icon: 'scan', runsOn: 'local',
    color: '#ec4899', bg: '#fce7f3', border: '#f9a8d4',
    name: { th: 'สแกนเอกสาร', en: 'Scan Document' },
    desc: { th: 'ถ่ายเอกสารด้วยกล้องแล้วแปลงเป็น PDF คมชัด', en: 'Capture documents with your camera' },
    keywords: ['สแกน', 'ถ่าย', 'กล้อง', 'scan', 'camera', 'เอกสาร'],
  },
  {
    id: 'merge', category: 'pdf', icon: 'merge', runsOn: 'local',
    color: '#3b82f6', bg: '#dbeafe', border: '#93c5fd',
    name: { th: 'รวมไฟล์ PDF', en: 'Merge PDF' },
    desc: { th: 'รวมหลายไฟล์ให้เป็น PDF เดียว จัดลำดับได้', en: 'Combine multiple files into one PDF' },
    keywords: ['รวม', 'ผสาน', 'ต่อไฟล์', 'merge', 'combine', 'join'],
    accept: ['pdf', 'image'], multiple: true,
  },
  {
    id: 'organize', category: 'pdf', icon: 'organize', runsOn: 'local',
    color: '#8b5cf6', bg: '#ede9fe', border: '#c4b5fd',
    name: { th: 'จัดหน้า PDF', en: 'Organize Pages' },
    desc: { th: 'เรียงลำดับ หมุน ลบ หรือทำสำเนาหน้า', en: 'Reorder, rotate, delete or duplicate pages' },
    keywords: ['จัดหน้า', 'เรียง', 'สลับหน้า', 'หมุน', 'ลบหน้า', 'organize', 'reorder', 'rotate', 'delete'],
    accept: ['pdf'],
  },
  {
    id: 'split', category: 'pdf', icon: 'split', runsOn: 'local',
    color: '#14b8a6', bg: '#ccfbf1', border: '#5eead4',
    name: { th: 'แยกไฟล์ PDF', en: 'Split PDF' },
    desc: { th: 'แยกตามหน้า ตามช่วง หรือทุก N หน้า', en: 'Split by page, range or every N pages' },
    keywords: ['แยก', 'ตัด', 'split', 'extract', 'ช่วงหน้า'],
    accept: ['pdf'],
  },
  {
    id: 'compress', category: 'pdf', icon: 'compress', runsOn: 'local', heavy: true,
    color: '#f59e0b', bg: '#fef3c7', border: '#fcd34d',
    name: { th: 'ลดขนาด PDF', en: 'Compress PDF' },
    desc: { th: 'ลดขนาดไฟล์ กำหนดขนาดเป้าหมายได้ เช่น ไม่เกิน 2 MB', en: 'Shrink PDFs, with an optional target size' },
    keywords: ['ลดขนาด', 'ลดขนาดเอกสาร', 'บีบอัด', 'compress', 'reduce', 'ย่อไฟล์', 'ไฟล์ใหญ่เกิน', 'อัปโหลดไม่ได้'],
    accept: ['pdf'],
  },
  {
    id: 'pdf-to-image', category: 'pdf', icon: 'image', runsOn: 'local', heavy: true,
    color: '#ef4444', bg: '#fee2e2', border: '#fca5a5',
    name: { th: 'แปลงเป็นรูป PDF→JPG', en: 'PDF to Image' },
    desc: { th: 'แปลงแต่ละหน้าเป็นไฟล์ JPG PNG หรือ WEBP', en: 'Convert each page to JPG, PNG or WEBP' },
    keywords: ['แปลงรูป', 'jpg', 'png', 'webp', 'image', 'รูปภาพ', 'แปลงเป็นรูป'],
    accept: ['pdf'],
  },
  {
    id: 'image-compress', category: 'image', icon: 'imageCompress', runsOn: 'local',
    color: '#f97316', bg: '#ffedd5', border: '#fdba74',
    name: { th: 'ลดขนาดไฟล์ภาพ', en: 'Compress Image' },
    desc: { th: 'ลดขนาดรูป JPG PNG WEBP โดยคุมคุณภาพเอง', en: 'Shrink JPG, PNG and WEBP images' },
    keywords: ['ลดขนาดภาพ', 'บีบอัดรูป', 'image', 'compress', 'ย่อรูป'],
    accept: ['image'], multiple: true,
  },
  {
    id: 'image-to-pdf', category: 'image', icon: 'imageToPdf', runsOn: 'local',
    color: '#0ea5e9', bg: '#e0f2fe', border: '#7dd3fc',
    name: { th: 'JPG → PDF', en: 'Image to PDF' },
    desc: { th: 'รวมรูปหลายใบเป็นไฟล์ PDF เดียว', en: 'Turn images into a single PDF' },
    keywords: ['รูปเป็น pdf', 'jpg to pdf', 'png to pdf', 'image', 'แปลงรูป'],
    accept: ['image'], multiple: true,
  },
  {
    id: 'page-number', category: 'document', icon: 'pageNumber', runsOn: 'local',
    color: '#6366f1', bg: '#e0e7ff', border: '#a5b4fc',
    name: { th: 'ใส่เลขหน้า PDF', en: 'Add Page Numbers' },
    desc: { th: 'ใส่เลขหน้าอัตโนมัติ เลือกตำแหน่งและรูปแบบได้', en: 'Insert page numbers automatically' },
    keywords: ['เลขหน้า', 'หมายเลขหน้า', 'page number', 'numbering'],
    accept: ['pdf'],
  },
  {
    id: 'watermark', category: 'document', icon: 'watermark', runsOn: 'local',
    color: '#d946ef', bg: '#fae8ff', border: '#f0abfc',
    name: { th: 'ใส่ลายน้ำ PDF', en: 'Add Watermark' },
    desc: { th: 'ใส่ข้อความหรือรูปลายน้ำทับทุกหน้า', en: 'Stamp text or image watermark' },
    keywords: ['ลายน้ำ', 'watermark', 'ตราประทับ', 'confidential', 'ลับ'],
    accept: ['pdf'],
  },
  {
    id: 'crop', category: 'document', icon: 'crop', runsOn: 'local',
    color: '#06b6d4', bg: '#cffafe', border: '#67e8f9',
    name: { th: 'ครอบตัดขอบ PDF', en: 'Crop PDF' },
    desc: { th: 'ตัดขอบขาวหรือเลือกพื้นที่ที่ต้องการเก็บไว้', en: 'Trim margins or crop to selection' },
    keywords: ['ครอบตัด', 'ตัดขอบ', 'crop', 'trim', 'margin'],
    accept: ['pdf'],
  },
  {
    id: 'protect', category: 'document', icon: 'lock', runsOn: 'server', serverTool: 'pdf-protect',
    color: '#ea580c', bg: '#ffedd5', border: '#fdba74',
    name: { th: 'ใส่รหัสผ่าน PDF', en: 'Protect PDF' },
    desc: { th: 'ล็อกไฟล์ด้วยรหัสผ่านและกำหนดสิทธิ์การใช้งาน', en: 'Encrypt with a password and permissions' },
    keywords: ['รหัสผ่าน', 'ล็อก', 'password', 'protect', 'encrypt', 'ความปลอดภัย'],
    accept: ['pdf'],
  },
  {
    id: 'sign', category: 'document', icon: 'sign', runsOn: 'local',
    color: '#10b981', bg: '#d1fae5', border: '#6ee7b7',
    name: { th: 'เซ็นเอกสาร PDF', en: 'Sign PDF' },
    desc: { th: 'วาด อัปโหลด หรือพิมพ์ลายเซ็นแล้ววางลงเอกสาร', en: 'Draw, upload or type your signature' },
    keywords: ['เซ็น', 'ลายเซ็น', 'sign', 'signature', 'e-signature'],
    accept: ['pdf'],
  },
  {
    id: 'edit', category: 'document', icon: 'edit', runsOn: 'local',
    color: '#84cc16', bg: '#ecfccb', border: '#bef264',
    name: { th: 'เพิ่มข้อมูลใน PDF', en: 'Edit PDF' },
    desc: { th: 'เพิ่มข้อความ รูป วันที่ และช่องติ๊กลงบนเอกสาร', en: 'Add text, images, dates and checkboxes' },
    keywords: ['แก้ไข', 'เพิ่มข้อความ', 'กรอกข้อมูล', 'edit', 'text', 'form', 'เติมข้อมูล'],
    accept: ['pdf'],
  },
  {
    id: 'unlock', category: 'document', icon: 'unlock', runsOn: 'server', serverTool: 'pdf-unlock',
    color: '#64748b', bg: '#e2e8f0', border: '#cbd5e1',
    name: { th: 'ปลดล็อก PDF', en: 'Unlock PDF' },
    desc: { th: 'ปลดรหัสผ่านไฟล์ที่คุณมีสิทธิ์ใช้งาน', en: 'Remove password from files you own' },
    keywords: ['ปลดล็อก', 'ปลดรหัส', 'unlock', 'decrypt', 'remove password'],
    accept: ['pdf'],
  },
  {
    id: 'pdf-to-word', category: 'document', icon: 'word', runsOn: 'server', serverTool: 'pdf-to-word', heavy: true,
    color: '#2563eb', bg: '#dbeafe', border: '#93c5fd',
    name: { th: 'PDF → Word', en: 'PDF to Word' },
    desc: { th: 'แปลงเป็นไฟล์ .docx ที่แก้ไขต่อได้', en: 'Convert to an editable .docx file' },
    keywords: ['word', 'docx', 'แปลงเป็นเวิร์ด', 'convert', 'แก้ไขเอกสาร'],
    accept: ['pdf'],
  },
  {
    id: 'ocr', category: 'document', icon: 'ocr', runsOn: 'local', heavy: true,
    color: '#7c3aed', bg: '#ede9fe', border: '#c4b5fd',
    name: { th: 'อ่านข้อความจากภาพ', en: 'OCR' },
    desc: { th: 'ดึงข้อความไทย–อังกฤษออกจากเอกสารสแกน', en: 'Extract Thai/English text from scans' },
    keywords: ['ocr', 'อ่านข้อความ', 'สแกนข้อความ', 'ดึงข้อความ', 'text recognition'],
    accept: ['pdf', 'image'],
  },
];

export const CATEGORIES = [
  { id: 'scan', name: { th: 'สแกน', en: 'Scanner' } },
  { id: 'pdf', name: { th: 'เครื่องมือ PDF', en: 'PDF Tools' } },
  { id: 'image', name: { th: 'เครื่องมือรูปภาพ', en: 'Image Tools' } },
  { id: 'document', name: { th: 'เครื่องมือเอกสาร', en: 'Document Tools' } },
];

const BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

export const getTool = (id) => BY_ID.get(id) || null;
export const toolRoute = (tool) => tool.route || `/tool/${tool.id}`;

/** ค้นหาเครื่องมือจากชื่อและคำค้นทั้งไทยและอังกฤษ (spec ข้อ 43) */
export function searchTools(query, lang = 'th') {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return TOOLS;
  return TOOLS
    .map((tool) => {
      const haystack = [
        tool.name.th, tool.name.en, tool.desc.th, tool.desc.en, tool.id, ...(tool.keywords || []),
      ].join(' ').toLowerCase();
      const nameMatch = (tool.name[lang] || tool.name.th).toLowerCase().includes(text);
      if (nameMatch) return { tool, score: 3 };
      if (haystack.includes(text)) return { tool, score: 1 };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.tool);
}

/** ชนิดไฟล์ที่รับได้ของเครื่องมือ ใช้กับ input[accept] */
export function acceptAttr(tool) {
  const parts = [];
  if (tool.accept?.includes('pdf')) parts.push('application/pdf', '.pdf');
  if (tool.accept?.includes('image')) parts.push('image/jpeg', 'image/png', 'image/webp', '.jpg', '.jpeg', '.png', '.webp');
  return parts.join(',');
}
