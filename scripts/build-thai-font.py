#!/usr/bin/env python3
"""
ประกอบฟอนต์ Sarabun (TTF) สำหรับฝังลงไฟล์ PDF

@fontsource แจกฟอนต์เป็นไฟล์ woff2 แยกตาม subset (thai / latin / latin-ext)
แต่ pdf-lib + fontkit ต้องใช้ TTF ที่ครอบคลุมทั้งไทยและอังกฤษในไฟล์เดียว
สคริปต์นี้จึงแปลง woff2 -> ttf แล้วรวม subset เข้าด้วยกัน

วิธีใช้
    npm install --no-save @fontsource/sarabun
    pip install "fonttools[woff]" brotli
    python3 scripts/build-thai-font.py
"""
import os
import shutil
import sys

try:
    from fontTools.ttLib import TTFont
    from fontTools.merge import Merger
except ImportError:
    sys.exit('ต้องติดตั้งก่อน: pip install "fonttools[woff]" brotli')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'web', 'assets', 'fonts')
TMP_DIR = os.path.join(ROOT, '.font-build')

SEARCH_PATHS = [
    os.path.join(ROOT, 'node_modules', '@fontsource', 'sarabun', 'files'),
    os.path.join(ROOT, 'server', 'node_modules', '@fontsource', 'sarabun', 'files'),
]

def find_source_dir():
    for path in SEARCH_PATHS:
        if os.path.isdir(path):
            return path
    sys.exit('ไม่พบ @fontsource/sarabun — รัน: npm install --no-save @fontsource/sarabun')

def build(source_dir, weight, out_name):
    os.makedirs(TMP_DIR, exist_ok=True)
    parts = []
    for subset in ('thai', 'latin', 'latin-ext'):
        src = os.path.join(source_dir, f'sarabun-{subset}-{weight}-normal.woff2')
        if not os.path.exists(src):
            print(f'  ข้าม subset ที่ไม่พบ: {subset}')
            continue
        font = TTFont(src)
        font.flavor = None                     # ถอดการบีบอัด woff2 ออก เหลือ TTF ปกติ
        tmp = os.path.join(TMP_DIR, f'{subset}-{weight}.ttf')
        font.save(tmp)
        parts.append(tmp)

    if not parts:
        sys.exit(f'ไม่พบไฟล์ต้นทางสำหรับน้ำหนัก {weight}')

    target = os.path.join(OUT_DIR, out_name)
    if len(parts) == 1:
        shutil.copy(parts[0], target)
    else:
        Merger().merge(parts).save(target)
    size_kb = os.path.getsize(target) / 1024
    print(f'  สร้าง {out_name} — {size_kb:.0f} KB')

def main():
    source_dir = find_source_dir()
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f'ต้นทาง: {source_dir}')
    build(source_dir, '400', 'Sarabun-Regular.ttf')
    build(source_dir, '700', 'Sarabun-Bold.ttf')
    shutil.rmtree(TMP_DIR, ignore_errors=True)
    print('เสร็จสิ้น — ฟอนต์อยู่ที่ web/assets/fonts')

if __name__ == '__main__':
    main()
