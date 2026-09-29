/* 水墨庭院 · 单面生成器
   ------------------------------------------------------------
   生成 face00(东) face01(南) face02(西) face03(北) face04(天) face05(地)
   每张 1024×1024，用 Canvas 2D 画水墨：
     宣纸底 + 远山三层 + 竹林 + 石灯 + 院墙 + 雾气 + 飞鸟
   面与面之间需要"接得上"：相邻面的边缘共享同一条地平线高度和雾浓度，
   所以所有面共用同一套 horizon / mist 常量。

   用法：node make-faces.js
   产物：./faceNN.png
   ============================================================ */
(function () {
  "use strict";
  var fs = require("fs");
  var DIR = __dirname;

  /* ---------- 极简 PNG 编码（零依赖） ---------- */
  var zlib = require("zlib");
  var crcTable = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();
  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function encodePNG(w, h, rgba) {
    var stride = w * 4;
    var raw = Buffer.alloc((stride + 1) * h);
    for (var y = 0; y < h; y++) {
      raw[y * (stride + 1)] = 0;
      rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    var idat = zlib.deflateSync(raw, { level: 6 });
    function chunk(type, data) {
      var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
      var td = Buffer.concat([Buffer.from(type, "ascii"), data]);
      var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0, 0);
      return Buffer.concat([len, td, crc]);
    }
    var ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))
    ]);
  }

  /* ---------- 光栅化：把 RGBA 数组当画布，含基础图元 ---------- */
  function Raster(w, h) {
    this.w = w; this.h = h;
    this.d = new Float32Array(w * h * 4);   /* 用 float 累加，最后再 clamp */
    for (var i = 0; i < w * h; i++) {
      this.d[i * 4] = 240; this.d[i * 4 + 1] = 236; this.d[i * 4 + 2] = 223;
      this.d[i * 4 + 3] = 255;
    }
  }
  Raster.prototype.blend = function (x, y, r, g, b, a) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    var o = (y * this.w + x) * 4, d = this.d;
    d[o]     = d[o]     * (1 - a) + r * a;
    d[o + 1] = d[o + 1] * (1 - a) + g * a;
    d[o + 2] = d[o + 2] * (1 - a) + b * a;
  };
  /* 加色（用于雾的提亮） */
  Raster.prototype.add = function (x, y, r, g, b, a) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    var o = (y * this.w + x) * 4, d = this.d;
    d[o]     += r * a; d[o + 1] += g * a; d[o + 2] += b * a;
  };
  Raster.prototype.soft = function (x, y, rad, r, g, b, a) {
    /* 软圆：中心到边缘线性衰减 */
    var r0 = Math.ceil(rad);
    for (var dy = -r0; dy <= r0; dy++) {
      for (var dx = -r0; dx <= r0; dx++) {
        var dd = Math.sqrt(dx * dx + dy * dy) / rad;
        if (dd >= 1) continue;
        this.blend(x + dx, y + dy, r, g, b, a * (1 - dd));
      }
    }
  };
  Raster.prototype.toPNG = function () {
    var out = Buffer.alloc(this.w * this.h * 4);
    for (var i = 0; i < this.w * this.h; i++) {
      var o = i * 4;
      out[o]     = Math.max(0, Math.min(255, this.d[o])) | 0;
      out[o + 1] = Math.max(0, Math.min(255, this.d[o + 1])) | 0;
      out[o + 2] = Math.max(0, Math.min(255, this.d[o + 2])) | 0;
      out[o + 3] = 255;
    }
    return encodePNG(this.w, this.h, out);
  };

  /* ---------- 固定种子随机 ---------- */
  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var S = 1024;               /* 面尺寸 */
  var HORIZON = 0.60;         /* 地平线：所有侧面共用，接缝才对得上 */

  var INK = [30, 28, 25], INK_MID = [78, 74, 68], INK_PALE = [140, 134, 122];
  var PAPER = [240, 236, 223], MIST = [214, 220, 218];
  var QING = [104, 128, 142], ZHE = [168, 128, 88];

  /* 一条毛笔线：分段 + 抖动 + 随机断笔（飞白） */
  function brush(rs, x0, y0, x1, y1, rnd, opt) {
    opt = opt || {};
    var w = opt.w || 2, a = opt.a || 0.3, col = opt.col || INK_MID;
    var segs = opt.segs || 40, wob = opt.wob === undefined ? 1.6 : opt.wob;
    var gap = opt.gap === undefined ? 0.05 : opt.gap;
    var run = false, lx = 0, ly = 0;
    for (var i = 0; i <= segs; i++) {
      var t = i / segs;
      var edgeK = 0.35 + 0.65 * Math.abs(t - 0.5) * 2;
      var x = x0 + (x1 - x0) * t + (rnd() - 0.5) * wob * edgeK;
      var y = y0 + (y1 - y0) * t + (rnd() - 0.5) * wob * edgeK;
      var thick = w * (0.55 + 0.45 * Math.sin(Math.PI * t));
      if (rnd() < gap) { run = false; continue; }
      if (run) {
        /* 在两点之间补点，形成稍有粗细的笔道 */
        var steps = Math.max(1, Math.ceil(Math.hypot(x - lx, y - ly)));
        for (var s = 0; s <= steps; s++) {
          var px = lx + (x - lx) * s / steps, py = ly + (y - ly) * s / steps;
          var rr = Math.max(0.5, thick);
          for (var dy = -rr; dy <= rr; dy++) {
            for (var dx = -rr; dx <= rr; dx++) {
              if (dx * dx + dy * dy > rr * rr) continue;
              rs.blend(px + dx, py + dy, col[0], col[1], col[2], a);
            }
          }
        }
      }
      lx = x; ly = y; run = true;
    }
  }

  /* 宣纸底：纤维 + 斑 */
  function paper(rs, rnd) {
    for (var i = 0; i < 9000; i++) {
      var x = rnd() * S, y = rnd() * S;
      var a = 0.02 + rnd() * 0.05;
      var warm = rnd() > 0.5;
      rs.blend(x, y, warm ? ZHE[0] : INK_PALE[0], warm ? ZHE[1] : INK_PALE[1],
               warm ? ZHE[2] : INK_PALE[2], a);
    }
    for (i = 0; i < 70; i++) {
      var cx = rnd() * S, cy = rnd() * S, r = 40 + rnd() * 200;
      var k = 0.010 + rnd() * 0.020;
      rs.soft(cx, cy, r, 200, 196, 184, k);
    }
  }

  /* 远山：一条起伏的山脊，向下渐隐进雾里 */
  function hill(rs, rnd, opt) {
    var baseY = opt.baseY, amp = opt.amp, alpha = opt.alpha;
    var col = opt.col || INK_PALE;
    var ph1 = opt.ph1 === undefined ? rnd() * 6.283 : opt.ph1;
    var ph2 = opt.ph2 === undefined ? rnd() * 6.283 : opt.ph2;
    var ph3 = opt.ph3 === undefined ? rnd() * 6.283 : opt.ph3;
    var n = 90, pts = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var y = baseY - amp * (
        0.52 + 0.30 * Math.sin(t * 6.283 * 1.6 + ph1)
             + 0.14 * Math.sin(t * 6.283 * 3.7 + ph2)
             + 0.07 * Math.sin(t * 6.283 * 8.1 + ph3));
      pts.push([t * S, y]);
    }
    /* 山体填充：上缘实、下缘化开 */
    var depth = opt.depth || 190;
    for (var x = 0; x < S; x++) {
      var idx = x / S * n;
      var i0 = Math.floor(idx), fx = idx - i0;
      var y0 = pts[Math.min(n, i0)][1], y1 = pts[Math.min(n, i0 + 1)][1];
      var top = y0 + (y1 - y0) * fx;
      for (var y = Math.round(top); y < top + depth; y++) {
        var u = (y - top) / depth;
        var a = alpha * (1 - u) * (1 - u) * 0.92;
        if (a <= 0.002) continue;
        rs.blend(x, y, col[0], col[1], col[2], a);
      }
    }
    /* 山脊线：贴着轮廓重一点，山才"立"得起来 */
    for (var k = 0; k < n; k++) {
      var ax = pts[k][0], ay = pts[k][1], bx2 = pts[k + 1][0], by2 = pts[k + 1][1];
      var steps = Math.max(1, Math.ceil(bx2 - ax));
      for (var s = 0; s <= steps; s++) {
        var px = ax + (bx2 - ax) * s / steps, py = ay + (by2 - ay) * s / steps;
        for (var dy = -1.2; dy <= 1.2; dy += 0.6) {
          for (var dx = -1.2; dx <= 1.2; dx += 0.6) {
            rs.blend(px + dx, py + dy, col[0], col[1], col[2], alpha * 0.30);
          }
        }
      }
    }
  }

  /* 竹林：多根竹竿 + 叶。竹是画面的骨架，必须成丛、有前后层次 */
  function bamboo(rs, rnd, opt) {
    var y0 = opt.y0, y1 = opt.y1, x0 = opt.x0, x1 = opt.x1, n = opt.n, alpha = opt.alpha;
    var gy = opt.ground === undefined ? S * HORIZON : opt.ground;
    for (var i = 0; i < n; i++) {
      var baseX = x0 + (x1 - x0) * (i + rnd() * 0.85) / n;
      var top = y0 + (y1 - y0) * rnd();
      var bw = 0.9 + rnd() * 2.2;
      var a = alpha * (0.45 + rnd() * 0.55);
      /* 竹竿：3 段手绘弧线，避免尺子味 */
      var ctrl = (rnd() - 0.5) * 26;
      var segs = 22, lastX = baseX, lastY = gy;
      for (var s = 1; s <= segs; s++) {
        var t = s / segs;
        var x = baseX + Math.sin(t * Math.PI) * ctrl + Math.sin(t * 5 + i) * 2.2;
        var y = gy + (top - gy) * t;
        brush(rs, lastX, lastY, x, y, rnd, { w: bw, a: a, col: INK, wob: 0.5, gap: 0.01, segs: 3 });
        if (s % 4 === 0) rs.soft(x, y, bw * 1.7, INK[0], INK[1], INK[2], a * 0.5);
        lastX = x; lastY = y;
      }
      /* 叶：从竿上斜撇，上部密、下部疏，方向交替 */
      var leafN = 7 + Math.floor(rnd() * 8);
      for (var L = 0; L < leafN; L++) {
        var lt = 0.30 + rnd() * 0.70;
        var ly = gy + (top - gy) * lt;
        var lx = baseX + Math.sin(lt * Math.PI) * ctrl;
        var dir = rnd() > 0.5 ? 1 : -1;
        var len = 20 + rnd() * 40;
        brush(rs, lx, ly, lx + dir * len, ly - len * (0.30 + rnd() * 0.45), rnd,
              { w: 0.9 + rnd() * 1.8, a: a * 0.85, col: INK_MID, wob: 1.2, segs: 7, gap: 0.02 });
      }
    }
  }

  /* 石灯：基座 + 柱 + 灯窗 + 顶盖，一笔一笔堆出来 */
  function lantern(rs, rnd, cx, gy, scale, alpha) {
    var u = scale;
    function bar(x0, y0, x1, y1, w, a) {
      brush(rs, cx + x0 * u, gy + y0 * u, cx + x1 * u, gy + y1 * u, rnd,
            { w: w * u, a: a, col: INK, wob: 0.6, segs: 6, gap: 0.02 });
    }
    /* 底座两层 */
    bar(-13, 0, 13, 0, 3.2, alpha);
    bar(-9, -7, 9, -7, 3.6, alpha);
    /* 柱 */
    bar(-2.4, -7, -2.4, -34, 2.6, alpha);
    bar(2.4, -7, 2.4, -34, 2.6, alpha);
    /* 灯室：四面墙 + 窗 */
    bar(-8, -34, -8, -50, 2.4, alpha);
    bar(8, -34, 8, -50, 2.4, alpha);
    bar(-10, -34, 10, -34, 2.0, alpha * 0.8);
    bar(-10, -50, 10, -50, 2.0, alpha * 0.8);
    /* 窗：留白（纸色），中间一点暖光 */
    rs.blend(cx, gy - 42 * u, 244, 240, 226, alpha * 0.72);
    rs.soft(cx, gy - 42 * u, 9 * u, 236, 214, 168, alpha * 0.34);
    /* 顶盖：两坡 */
    bar(-16, -50, -3, -60, 3.0, alpha);
    bar(3, -60, 16, -50, 3.0, alpha);
    bar(-17, -50, 17, -50, 2.2, alpha * 0.85);
    /* 塔尖 */
    rs.soft(cx, gy - 63 * u, 3.4 * u, INK[0], INK[1], INK[2], alpha * 0.9);
  }

  /* 院墙：一道矮墙 + 瓦沿 */
  function wall(rs, rnd, x0, x1, baseY, h, alpha) {
    var y = baseY;
    for (var x = x0; x < x1; x++) {
      for (var yy = y - h; yy < y; yy++) {
        var u = (yy - (y - h)) / h;
        rs.blend(x, yy, INK_PALE[0], INK_PALE[1], INK_PALE[2], alpha * (0.20 + u * 0.26));
      }
    }
    brush(rs, x0, y - h, x1, y - h, rnd, { w: 2.6, a: alpha * 0.62, col: INK_MID, wob: 1.4, segs: 60 });
    brush(rs, x0, y, x1, y, rnd, { w: 1.6, a: alpha * 0.4, col: INK_MID, wob: 1.2, segs: 60 });
  }

  /* 雾：横向极淡的带子，把远景推远 */
  function mist(rs, rnd, y, thick, alpha) {
    for (var i = 0; i < 46; i++) {
      var x = rnd() * S;
      var yy = y + (rnd() - 0.5) * thick;
      var r = 90 + rnd() * 260;
      rs.soft(x, yy, r, MIST[0], MIST[1], MIST[2], alpha * (0.5 + rnd() * 0.6));
    }
  }

  /* 飞鸟：两三笔的"人"字 */
  function bird(rs, rnd, x, y, s, alpha) {
    brush(rs, x - s, y, x, y - s * 0.5, rnd, { w: 1.4, a: alpha, col: INK_MID, segs: 5, gap: 0.0 });
    brush(rs, x, y - s * 0.5, x + s, y - s * 0.05, rnd, { w: 1.4, a: alpha, col: INK_MID, segs: 5, gap: 0.0 });
  }

  /* 月亮（只在一面，让环视时有"发现"的惊喜） */
  function moon(rs, cx, cy, r) {
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        var d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d > 1) continue;
        var a = d < 0.86 ? 0.94 : (1 - (d - 0.86) / 0.14) * 0.94;
        rs.blend(cx + dx, cy + dy, 250, 246, 232, a * 0.9);
      }
    }
    for (var k = 0; k < 3; k++) {
      rs.soft(cx, cy, r * (2.0 + k * 1.3), 236, 240, 238, 0.05 - k * 0.013);
    }
  }

  /* ---------- 四个侧面 ---------- */
  /* 每面都要"接得上邻居"：地平线、雾带高度、山的浓度梯度统一。
     关键：相邻两面的远山相位必须相同 —— 否则接缝处山脊会"断头"。
     所以四面共用一套 mountainPhase，只有近景主角不同。 */

  /* 全景图横向 360°：0°=东、90°=南、180°=西、270°=北。
     山脊用"整圈连续函数"采样，天然保证首尾与左右都能接上。 */
  var MTN = [
    { w: 1.00, ph: 0.00, amp: 1.00, base: 0,    col: QING,     a: 0.15, d: 150 },
    { w: 1.35, ph: 1.90, amp: 1.25, base: -52,  col: INK_PALE, a: 0.23, d: 165 },
    { w: 1.70, ph: 3.30, amp: 1.50, base: -14,  col: INK_MID,  a: 0.34, d: 175 }
  ];

  /* 整圈山脊：t 是全景横向 0..1（= 0..360°），返回该方向的脊线高度 */
  function ridgeAll(t, m, HZ) {
    var a = t * 6.283;
    return (HZ + m.base) - m.amp * (30 + 16 * Math.sin(a * 3 + m.ph)
                                       + 9 * Math.sin(a * 7 + m.ph * 2)
                                       + 5 * Math.sin(a * 13 + m.ph * 3));
  }

  /* 在某一面上画"整圈山"的 idx 那一段（起止 u 对应该面的左右边界） */
  function hillSlice(rs, m, u0, u1, HZ) {
    var N = 240, pts = [];
    for (var i = 0; i <= N; i++) {
      var t = u0 + (u1 - u0) * (i / N);
      pts.push([ (i / N) * S, ridgeAll(t, m, HZ) ]);
    }
    for (var x = 0; x < S; x++) {
      var idx = x / S * N;
      var i0 = Math.floor(idx), fx = idx - i0;
      var y0 = pts[Math.min(N, i0)][1], y1 = pts[Math.min(N, i0 + 1)][1];
      var top = y0 + (y1 - y0) * fx;
      for (var y = Math.round(top); y < top + m.d; y++) {
        var u = (y - top) / m.d;
        var a = m.a * (1 - u) * (1 - u) * 0.92;
        if (a <= 0.002) continue;
        rs.blend(x, y, m.col[0], m.col[1], m.col[2], a);
      }
    }
    /* 山脊线 */
    for (var k = 0; k < N; k++) {
      var ax = pts[k][0], ay = pts[k][1], bx2 = pts[k + 1][0], by2 = pts[k + 1][1];
      var steps = Math.max(1, Math.ceil(bx2 - ax));
      for (var s = 0; s <= steps; s++) {
        var px = ax + (bx2 - ax) * s / steps, py = ay + (by2 - ay) * s / steps;
        for (var dy = -1.1; dy <= 1.1; dy += 0.55) {
          for (var dx = -1.1; dx <= 1.1; dx += 0.55) {
            rs.blend(px + dx, py + dy, m.col[0], m.col[1], m.col[2], m.a * 0.26);
          }
        }
      }
    }
  }

  function sideFace(idx) {
    var rs = new Raster(S, S);
    var rnd = mulberry(1000 + idx * 977);
    paper(rs, rnd);

    var HZ = S * HORIZON;
    /* 该面覆盖的整圈角度区间：东0-90 / 南90-180 / 西180-270 / 北270-360 */
    var u0 = idx / 4, u1 = (idx + 1) / 4;

    /* 天：越靠上越亮（留白），越靠地平线越沉一点 */
    for (var y = 0; y < HZ; y++) {
      var uy = y / HZ;
      for (var x = 0; x < S; x += 1) {
        rs.blend(x, y, 246, 243, 233, 0.30 * (1 - uy) * (1 - uy) * (1 - uy));
      }
    }

    /* 三层山：用整圈函数切片，四面严丝合缝 */
    for (var mi = 0; mi < MTN.length; mi++) hillSlice(rs, MTN[mi], u0, u1, HZ);

    /* 雾：山脚与山腰各一条 */
    mist(rs, mulberry(500 + idx), HZ - 56, 66, 0.22);
    mist(rs, mulberry(560 + idx), HZ - 14, 44, 0.28);

    /* 地面：越近（画面越下）越沉，形成"站在院子里"的纵深 */
    for (y = Math.round(HZ); y < S; y++) {
      var v = (y - HZ) / (S - HZ);
      for (var x2 = 0; x2 < S; x2 += 1) {
        rs.blend(x2, y, 228, 222, 205, 0.12 + v * 0.30);
      }
    }
    /* 地面枯笔：石板缝 / 草痕 */
    for (var i = 0; i < 16; i++) {
      var gx = rnd() * S, gy = HZ + 50 + rnd() * (S - HZ - 70);
      brush(rs, gx, gy, gx + 34 + rnd() * 90, gy + (rnd() - 0.5) * 16, rnd,
            { w: 1.1, a: 0.11, col: INK_PALE, wob: 2.4, segs: 10, gap: 0.16 });
    }

    /* 各面近景主角不同 —— 这是"环视时每一转都有新东西"的关键 */
    var G = HZ + 92;      /* 近景地面基线 */
    if (idx === 0) {
      /* 东：竹林夹道 + 石灯（正对，进门第一眼）。
         正前方要留出天空的余白好放标题，所以两丛竹都往两侧让，
         中间只留石灯 —— 视线有落点，字也有地方写。 */
      bamboo(rs, mulberry(700), { x0: -40, x1: 250, y0: HZ - 400, y1: HZ - 240, n: 14, alpha: 0.78, ground: G });
      bamboo(rs, mulberry(710), { x0: 780, x1: 1064, y0: HZ - 380, y1: HZ - 210, n: 13, alpha: 0.72, ground: G });
      bamboo(rs, mulberry(715), { x0: 300, x1: 420, y0: HZ - 170, y1: HZ - 100, n: 4, alpha: 0.26, ground: G });
      bamboo(rs, mulberry(716), { x0: 620, x1: 740, y0: HZ - 160, y1: HZ - 96, n: 4, alpha: 0.24, ground: G });
      lantern(rs, mulberry(720), S * 0.50, G + 10, 1.85, 0.82);
    } else if (idx === 1) {
      /* 南：院墙横贯 + 墙头竹 + 偏右石灯 */
      wall(rs, mulberry(800), -10, S + 10, HZ + 86, 84, 0.40);
      bamboo(rs, mulberry(810), { x0: 40, x1: 420, y0: HZ - 390, y1: HZ - 240, n: 15, alpha: 0.72, ground: G });
      lantern(rs, mulberry(820), S * 0.76, G + 6, 1.55, 0.76);
      bamboo(rs, mulberry(830), { x0: 600, x1: 1000, y0: HZ - 170, y1: HZ - 90, n: 8, alpha: 0.32, ground: G });
    } else if (idx === 2) {
      /* 西：月亮压场 + 密竹 + 飞鸟（最有"修仙"感的一面） */
      moon(rs, S * 0.30, HZ - 330, 62);
      bamboo(rs, mulberry(900), { x0: 470, x1: 1030, y0: HZ - 430, y1: HZ - 200, n: 18, alpha: 0.74, ground: G });
      bamboo(rs, mulberry(905), { x0: -30, x1: 300, y0: HZ - 200, y1: HZ - 120, n: 9, alpha: 0.34, ground: G });
      lantern(rs, mulberry(910), S * 0.20, G + 4, 1.50, 0.74);
      bird(rs, mulberry(920), S * 0.62, HZ - 268, 11, 0.42);
      bird(rs, mulberry(921), S * 0.71, HZ - 238, 8.5, 0.34);
      bird(rs, mulberry(922), S * 0.55, HZ - 224, 7, 0.26);
    } else {
      /* 北：松枝斜出（回头才看得见的那一面）+ 矮墙 + 石灯
         ★ 松枝必须收在面内左侧，不能顶到右边界 ——
           因为 equirect 平面图的右端会绕回东面的左端，
           松枝伸到边界上就会"飘"到正前方的院子里挡视线。 */
      var sx = S * 0.06, sy = -30;
      var ex = S * 0.62, ey = HZ * 0.30;
      brush(rs, sx, sy, ex, ey, mulberry(950),
            { w: 9, a: 0.70, col: INK, wob: 2.4, segs: 30, gap: 0.02 });
      brush(rs, S * 0.26, HZ * 0.11, S * 0.72, HZ * 0.24, mulberry(951),
            { w: 5.2, a: 0.56, col: INK, wob: 2.0, segs: 20, gap: 0.02 });
      for (i = 0; i < 22; i++) {
        var t2 = rnd();
        var bx = sx + (ex - sx) * t2, by = sy + (ey - sy) * t2;
        var ang = -0.4 - rnd() * 1.4;
        var len = 30 + rnd() * 62;
        brush(rs, bx, by, bx + Math.cos(ang) * len, by + Math.sin(ang) * len, mulberry(960 + i),
              { w: 1.0 + rnd() * 1.6, a: 0.44, col: INK_MID, wob: 1.6, segs: 9, gap: 0.04 });
      }
      wall(rs, mulberry(970), -10, S + 10, HZ + 72, 62, 0.30);
      lantern(rs, mulberry(980), S * 0.58, G + 2, 1.35, 0.66);
      bamboo(rs, mulberry(985), { x0: 700, x1: 1010, y0: HZ - 260, y1: HZ - 150, n: 9, alpha: 0.46, ground: G });
    }

    /* 地平线：四面同高同淡，接缝处才连成一条 */
    brush(rs, 0, HZ, S, HZ, mulberry(990), { w: 1.0, a: 0.09, col: INK_PALE, wob: 0.8, segs: 70, gap: 0.08 });

    return rs;
  }

  /* ---------- 天顶：一片将亮未亮的纸白 + 流云 ---------- */
  function topFace() {
    var rs = new Raster(S, S);
    var rnd = mulberry(4242);
    paper(rs, rnd);
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x += 1) {
        var cx = (x / S - 0.5) * 2, cy = (y / S - 0.5) * 2;
        var r = Math.sqrt(cx * cx + cy * cy);
        rs.blend(x, y, 246, 243, 234, Math.max(0, 1 - r) * 0.34);
      }
    }
    /* 流云：横向拉长的淡团 */
    for (var i = 0; i < 30; i++) {
      var x0 = rnd() * S, y0 = rnd() * S;
      var ang = (rnd() - 0.5) * 0.5;
      for (var k = 0; k < 54; k++) {
        var t = k / 54;
        var x = x0 + Math.cos(ang) * (t - 0.5) * 380;
        var y = y0 + Math.sin(ang) * (t - 0.5) * 380;
        rs.soft(x, y, 26 + rnd() * 60, 252, 250, 243, 0.045 + rnd() * 0.045);
      }
    }
    return rs;
  }

  /* ---------- 地面：宣纸 + 中心一圈淡淡的院子 ---------- */
  function bottomFace() {
    var rs = new Raster(S, S);
    var rnd = mulberry(8181);
    paper(rs, rnd);
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x += 1) {
        var cx = (x / S - 0.5) * 2, cy = (y / S - 0.5) * 2;
        var r = Math.sqrt(cx * cx + cy * cy);
        /* 越靠中心越像被人踩过的院子：略深、带碎石 */
        rs.blend(x, y, 226, 220, 204, Math.max(0, 1 - r * 0.8) * 0.45);
      }
    }
    /* 院心石板：放射状的短笔 */
    for (var i = 0; i < 90; i++) {
      var a = rnd() * 6.283, rr = 20 + rnd() * 300;
      var x0 = S / 2 + Math.cos(a) * rr, y0 = S / 2 + Math.sin(a) * rr;
      var l = 10 + rnd() * 34;
      brush(rs, x0, y0, x0 + Math.cos(a) * l, y0 + Math.sin(a) * l, mulberry(7000 + i),
            { w: 1.0 + rnd(), a: 0.10 + rnd() * 0.10, col: INK_PALE, wob: 1.4, segs: 6, gap: 0.12 });
    }
    /* 三角枫叶几片 */
    for (i = 0; i < 26; i++) {
      var x = rnd() * S, y = rnd() * S;
      rs.soft(x, y, 2 + rnd() * 3.4, INK_MID[0], INK_MID[1], INK_MID[2], 0.24 + rnd() * 0.2);
    }
    return rs;
  }

  /* ---------- 输出 ---------- */
  ["00", "01", "02", "03"].forEach(function (k, i) {
    var rs = sideFace(i);
    var png = rs.toPNG();
    fs.writeFileSync(DIR + "/face" + k + ".png", png);
    console.log("face" + k + ".png " + (png.length / 1024).toFixed(0) + "KB");
  });
  var t = topFace().toPNG();
  fs.writeFileSync(DIR + "/face04.png", t);
  console.log("face04.png(天) " + (t.length / 1024).toFixed(0) + "KB");
  var b = bottomFace().toPNG();
  fs.writeFileSync(DIR + "/face05.png", b);
  console.log("face05.png(地) " + (b.length / 1024).toFixed(0) + "KB");
})();
