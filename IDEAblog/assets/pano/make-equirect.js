/* ============================================================
   水墨庭院 · 全景生成器（把 6 面全景图拼成一张 equirect）
   ------------------------------------------------------------
   输入：北/东/南/西 四张 1024×1024 庭院视图
   输出：一张 4096×2048 equirectangular 全景图
         直接贴在球体内壁 = 定点 360° 环视（Google 街景同款）

   核心几何：equirect (u,v) → 方向向量 → 该方向落在哪一面 → 面上像素
     lon = (u - 0.5) * 2π        lon=0 正对 +z（东面）
     lat = (0.5 - v) * π         lat=+90 天顶
     x = cos(lat)·cos(lon)，y = sin(lat)，z = -cos(lat)·sin(lon)
     东 face00 +z / 南 face01 +x / 西 face02 -z / 北 face03 -x
     天 face04 +y / 地 face05 -y
   ============================================================ */
(function () {
  "use strict";
  var fs = require("fs");

  var DIR = __dirname;
  var W = 4096, H = 2048;

  /* ---------- 载入六面 ---------- */
  var faces = {};
  ["00", "01", "02", "03", "04", "05"].forEach(function (k) {
    var p = DIR + "/face" + k + ".png";
    if (fs.existsSync(p)) faces[k] = fs.readFileSync(p);
    else console.log("缺 face" + k);
  });
  var have = Object.keys(faces);
  console.log("载入面：", have.join(","));

  if (have.length < 4) { console.log("至少要有 4 个侧面"); process.exit(1); }

  /* 用 sharp 统一解码/编码（如果装了）；没装就走纯 JS 兜底 */
  var sharp = null;
  try { sharp = require("sharp"); } catch (e) {}

  /* 纯 JS PNG 解码/编码（兜底，零依赖） */
  var zlib = require("zlib");

  function decodePNG(buf) {
    /* 极简 PNG 解码：仅支持 8bit RGBA / RGB，非隔行 —— 我们的图自产自销 */
    var pos = 8, w = 0, h = 0, ct = 0, bd = 0, idat = [];
    while (pos < buf.length) {
      var len = buf.readUInt32BE(pos);
      var type = buf.toString("ascii", pos + 4, pos + 8);
      var data = buf.slice(pos + 8, pos + 8 + len);
      if (type === "IHDR") {
        w = data.readUInt32BE(0); h = data.readUInt32BE(4);
        bd = data[8]; ct = data[9];
        if (data[12] !== 0) throw new Error("不支持隔行 PNG");
        if (bd !== 8) throw new Error("只支持 8bit PNG");
      } else if (type === "IDAT") {
        idat.push(data);
      } else if (type === "IEND") break;
      pos += 12 + len;
    }
    var raw = zlib.inflateSync(Buffer.concat(idat));
    var ch = ct === 6 ? 4 : (ct === 2 ? 3 : (ct === 0 ? 1 : 4));
    var stride = w * ch;
    var out = Buffer.alloc(w * h * 4);
    var prev = Buffer.alloc(stride);
    var off = 0;
    for (var y = 0; y < h; y++) {
      var ft = raw[off++];
      var line = raw.slice(off, off + stride); off += stride;
      var cur = Buffer.alloc(stride);
      for (var x = 0; x < stride; x++) {
        var a = x >= ch ? cur[x - ch] : 0;
        var b = prev[x];
        var c = x >= ch ? prev[x - ch] : 0;
        var v = line[x];
        if (ft === 1) v += a;
        else if (ft === 2) v += b;
        else if (ft === 3) v += (a + b) >> 1;
        else if (ft === 4) {
          var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        }
        cur[x] = v & 255;
      }
      prev = cur;
      for (x = 0; x < w; x++) {
        var o = (y * w + x) * 4;
        if (ch === 4) { out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3]; }
        else if (ch === 3) { out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255; }
        else { var g = cur[x]; out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255; }
      }
    }
    return { w: w, h: h, data: out };
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
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))
    ]);
  }

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

  /* ---------- 解码 ---------- */
  var img = {};
  have.forEach(function (k) {
    img[k] = decodePNG(faces[k]);
    console.log("face" + k, img[k].w + "×" + img[k].h);
  });
  var FS = img[have[0]].w;       /* 面尺寸 1024 */

  /* 从一张面图按 (u,v) 双线性采样 */
  function sampleFace(im, u, v) {
    u = u - Math.floor(u); v = v - Math.floor(v);
    var x = u * im.w - 0.5, y = v * im.h - 0.5;
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    function px(px_, py_) {
      px_ = (px_ + im.w) % im.w; py_ = Math.max(0, Math.min(im.h - 1, py_));
      var o = (py_ * im.w + px_) * 4;
      return [im.data[o], im.data[o + 1], im.data[o + 2], im.data[o + 3]];
    }
    var a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), d = px(x0 + 1, y0 + 1);
    var out = [0, 0, 0, 0];
    for (var i = 0; i < 4; i++) {
      out[i] = (a[i] * (1 - fx) + b[i] * fx) * (1 - fy) +
               (c[i] * (1 - fx) + d[i] * fx) * fy;
    }
    return out;
  }

  /* ---------- 方向 → 面 & 面内 uv ----------
     坐标约定（与 Three.js equirect 一致）：
       lon = (u-0.5)·2π     u=0.5 → lon=0 → 正对东面
       lat = (0.5-v)·π      v=0   → 天顶
       x = cos(lat)cos(lon)
       y = sin(lat)
       z = -cos(lat)sin(lon)
     面与朝向：
       +z → 东(face00)   +x → 南(face01)
       -z → 西(face02)   -x → 北(face03)
     ★ 关键：图片本身有"左右"方向，必须满足"站在球心往那边看，
        图的左边对应空间的左边"。否则南北两面会镜像。
        推导后：朝 +z 看时左手是 -x → u 随 x 递增；
                朝 +x 看时左手是 +z → u 随 z 递减。 */
  function dirToFace(x, y, z) {
    var ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);

    if (ay >= ax && ay >= az) {
      /* 天 / 地：极坐标映射，u 由 atan2 给出，绕一圈连续 */
      var uu = 0.5 + Math.atan2(-z, x) / (Math.PI * 2);
      if (uu < 0) uu += 1;
      if (uu >= 1) uu -= 1;
      if (y > 0) return { f: "04", u: uu, v: 0.5 - Math.hypot(x, z) / (ay || 1e-6) * 0.5 };
      return { f: "05", u: uu, v: 0.5 - Math.hypot(x, z) / (ay || 1e-6) * 0.5 };
    }
    if (az >= ax) {
      /* 东 / 西 */
      return z > 0 ? { f: "00", u: 0.5 + x / az * 0.5, v: 0.5 - y / az * 0.5 }
                   : { f: "02", u: 0.5 + x / az * 0.5, v: 0.5 - y / az * 0.5 };
    }
    /* 南 / 北 */
    return x > 0 ? { f: "01", u: 0.5 - z / ax * 0.5, v: 0.5 - y / ax * 0.5 }
                 : { f: "03", u: 0.5 - z / ax * 0.5, v: 0.5 - y / ax * 0.5 };
  }

  /* ---------- 生成 equirect ---------- */
  var out = Buffer.alloc(W * H * 4);
  var r2d = Math.PI / 180;

  for (var py = 0; py < H; py++) {
    var v = (py + 0.5) / H;
    var lat = (0.5 - v) * Math.PI;
    var cosLat = Math.cos(lat), sinLat = Math.sin(lat);
    for (var px_ = 0; px_ < W; px_++) {
      var u = (px_ + 0.5) / W;
      var lon = (u - 0.5) * Math.PI * 2;
      var x = cosLat * Math.cos(lon);
      var y = sinLat;
      var z = -cosLat * Math.sin(lon);
      var hit = dirToFace(x, y, z);
      var s = sampleFace(img[hit.f], hit.u, hit.v);
      var o = (py * W + px_) * 4;
      out[o] = s[0]; out[o + 1] = s[1]; out[o + 2] = s[2]; out[o + 3] = 255;
    }
    if (py % 256 === 0) console.log("  row " + py + "/" + H);
  }

  var png = encodePNG(W, H, out);
  var outPath = DIR + "/pano-actual.png";
  fs.writeFileSync(outPath, png);
  console.log("写入 pano-actual.png " + (png.length / 1048576).toFixed(2) + "MB");

  /* ---------- 缩略图：给浏览器截图用（4096 太大，1:1 采样取 1/4） ---------- */
  var SW = 1024, SH = 512;
  var small = Buffer.alloc(SW * SH * 4);
  for (var sy = 0; sy < SH; sy++) {
    for (var sx = 0; sx < SW; sx++) {
      var so = (sy * SW + sx) * 4;
      var to = ((sy * 4) * W + (sx * 4)) * 4;
      small[so] = out[to]; small[so + 1] = out[to + 1];
      small[so + 2] = out[to + 2]; small[so + 3] = 255;
    }
  }
  fs.writeFileSync(DIR + "/pano-small.png", encodePNG(SW, SH, small));
  console.log("写入 pano-small.png " + (encodePNG(SW, SH, small).length / 1024).toFixed(0) + "KB");
})();
