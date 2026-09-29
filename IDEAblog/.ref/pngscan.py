"""PNG 采样工具（无第三方依赖）。

用途：在无头 Chrome 截图之后，直接解码 PNG 校验像素，
      而不是"看着像"就下结论 —— 之前几次误判（把布局溢出当成
      渲染问题、把没等到的状态当成已生效）都是只靠肉眼看图造成的。

支持 colortype 0(灰度) / 2(RGB) / 4(灰+A) / 6(RGBA)，8bit。

用法：
  python pngscan.py <png>                 # 概览
  python pngscan.py <png> --scan-y 350    # 横向扫一条线找 accent 红
"""
import zlib
import struct
import sys

PAPER = (239, 234, 224)
ACCENT = (200, 83, 47)  # --accent: #c8532f


def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', '不是 PNG'
    pos = 8
    idat = b''
    w = h = bd = ct = None
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos + 4])[0]
        typ = d[pos + 4:pos + 8]
        data = d[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct, cm, fm, il = struct.unpack('>IIBBBBB', data[:13])
            assert bd == 8, '只支持 8bit'
            assert il == 0, '不支持隔行扫描'
        elif typ == b'IDAT':
            idat += data
        elif typ == b'IEND':
            break
        pos += 12 + ln
    bpp = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(idat)
    return w, h, bpp, ct, raw


def unfilter(w, h, bpp, raw):
    stride = w * bpp
    rows = []
    prev = bytearray(stride)
    i = 0
    for _ in range(h):
        f = raw[i]
        i += 1
        line = bytearray(raw[i:i + stride])
        i += stride
        assert len(line) == stride, 'IDAT 数据不足'
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        elif f != 0:
            raise AssertionError('未知 filter %d' % f)
        rows.append(line)
        prev = line
    return rows


def close(c, t, tol):
    return all(abs(c[i] - t[i]) <= tol for i in range(3))


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else 'frames/m4e2e-02-hover.png'
    scan_y = 350
    if '--scan-y' in sys.argv:
        scan_y = int(sys.argv[sys.argv.index('--scan-y') + 1])

    w, h, bpp, ct, raw = read_png(path)
    rows = unfilter(w, h, bpp, raw)
    print('PNG %dx%d  colortype=%d bpp=%d' % (w, h, ct, bpp))

    def px(x, y):
        o = x * bpp
        return tuple(rows[y][o:o + 3])

    print('\n-- y=%d 横采样 --' % scan_y)
    for x in range(0, w, max(1, w // 20)):
        print('   x=%4d  %s' % (x, px(x, scan_y)))

    print('\n-- x=%d 纵采样 --' % (w // 2))
    for y in range(0, h, max(1, h // 16)):
        print('   y=%4d  %s' % (y, px(w // 2, y)))

    print('\n-- accent 红像素（y=%d）--' % scan_y)
    hits = [x for x in range(w) if close(px(x, scan_y), ACCENT, 45)]
    print('   count=%d' % len(hits), ('range %d..%d' % (hits[0], hits[-1])) if hits else '')

    # 右侧条带纸色占比：接近 100% 说明有纸色面板铺在那里
    pr = tr = 0
    for y in range(0, h, 5):
        for x in range(800, w, 3):
            tr += 1
            if close(px(x, y), PAPER, 16):
                pr += 1
    print('\n-- 右侧条带 (x>800) 纸色占比: %.1f%% --' % (100.0 * pr / tr))

    # 整图非纸色占比，用来判断"画面真的有内容"
    non = tot = 0
    for y in range(0, h, 7):
        for x in range(0, w, 7):
            tot += 1
            if not close(px(x, y), PAPER, 16):
                non += 1
    print('-- 整图非纸色占比: %.1f%% --' % (100.0 * non / tot))


if __name__ == '__main__':
    main()
