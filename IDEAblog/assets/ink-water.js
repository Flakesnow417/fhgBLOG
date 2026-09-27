/* ============================================================
   一念未落 · 墨流水境（Canvas 逐帧绘制，无依赖）
   ------------------------------------------------------------
   画面构成（从底到顶）：
     1) 暗青黑底 + 顶部冷光
     2) 三层滚动墨河：预渲染的水面条带，不同速度横移 + 微起伏
     3) 水面涟漪：太极纹（同心环 + S 线 + 两眼）+ 随机扩散的涟漪圈
     4) 漂浮书法字：黑字半透明（氛围层）+ 鎏金字（导航层，可点击）
   景深（伪 3D）：每个字有深度 z —— 越大越近：尺寸大、透明度
   高、漂浮幅度大、视差移动多，并带立体挤出描边与发光。
   点击：鎏金字带 href 的点击跳转，空 href 为预留位（点击只弹跳）。
   尊重系统「减少动态」：渲染一帧静态终态。
   ============================================================ */
(function () {
  var canvas = document.querySelector(".idea-inkcanvas");
  if (!canvas) return;

  var reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var ctx = canvas.getContext("2d");
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  var W = 0, H = 0, world = 1;
  var CX = 0, CY = 0;               /* 太极涟漪中心 */

  function resize() {
    var hero = canvas.parentElement;
    W = hero.clientWidth;
    H = hero.clientHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    world = Math.max(0.55, Math.min(W, H) / 780);
    CX = W * 0.42;
    CY = H * 0.60;
  }
  window.addEventListener("resize", resize);
  resize();

  /* ============================================================
     一、墨河水面条带（预渲染，滚动制造流动感）
     ============================================================ */

  function makeStrip(seed) {
    var w = 1500, h = 260;
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var g = c.getContext("2d");
    var rnd = mulberry(seed);

    /* 底层暗涌：大团深墨 */
    for (var i = 0; i < 6; i++) {
      var bx = rnd() * w, by = h * (0.25 + rnd() * 0.6);
      var br = 130 + rnd() * 210;
      var grad = g.createRadialGradient(bx, by, 0, bx, by, br);
      grad.addColorStop(0, "rgba(3,7,11," + (0.35 + rnd() * 0.3) + ")");
      grad.addColorStop(1, "rgba(3,7,11,0)");
      g.fillStyle = grad;
      g.fillRect(bx - br, by - br, br * 2, br * 2);
    }

    /* 回旋涡纹：几段粗弧线 */
    for (var e = 0; e < 4; e++) {
      var ex = rnd() * w, ey = h * (0.3 + rnd() * 0.5), er = 40 + rnd() * 90;
      var a0 = rnd() * Math.PI * 2, a1 = a0 + 1.6 + rnd() * 2.2;
      g.strokeStyle = "rgba(6,12,18," + (0.3 + rnd() * 0.3) + ")";
      g.lineWidth = 10 + rnd() * 16;
      g.beginPath(); g.arc(ex, ey, er, a0, a1); g.stroke();
      /* 涡边一道冷光 */
      g.strokeStyle = "rgba(150,190,208," + (0.10 + rnd() * 0.12) + ")";
      g.lineWidth = 1.4;
      g.beginPath(); g.arc(ex, ey, er + 9, a0 + 0.2, a1 - 0.1); g.stroke();
    }

    /* 高光碎波：断续的亮线，像月光碎在水上 */
    for (var l = 0; l < 9; l++) {
      var yBase = h * (0.12 + rnd() * 0.76);
      var amp = 5 + rnd() * 13;
      var fq = 0.004 + rnd() * 0.005;
      var ph = rnd() * Math.PI * 2;
      var segs = 46, step = w / segs;
      var bright = 0.08 + rnd() * 0.16;
      for (var s = 0; s < segs; s++) {
        if (rnd() < 0.42) continue;                 /* 断开来，才有"碎光" */
        var x0 = s * step;
        var y0 = yBase + Math.sin(x0 * fq + ph) * amp;
        var x1 = x0 + step * (0.6 + rnd() * 0.5);
        var y1 = yBase + Math.sin(x1 * fq + ph) * amp;
        g.strokeStyle = "rgba(186,216,230," + (bright * (0.5 + rnd() * 0.8)) + ")";
        g.lineWidth = 0.8 + rnd() * 1.8;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    }
    return c;
  }

  /* 简单可复现的随机数（让每次刷新画面一致风格） */
  function mulberry(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  var strips = [
    { spr: makeStrip(11), scale: 1.25, y: 0.50, speed: 20, alpha: 0.85, ph: 0.0 },
    { spr: makeStrip(47), scale: 1.05, y: 0.65, speed: 36, alpha: 0.92, ph: 2.1 },
    { spr: makeStrip(83), scale: 0.85, y: 0.80, speed: 58, alpha: 1.00, ph: 4.2 }
  ];
  strips.forEach(function (s) { s.off = 0; });

  /* ============================================================
     二、太极涟漪（预渲染，呼吸 + 慢转）
     ============================================================ */

  function makeTaijiRipple() {
    var s = 460, c = document.createElement("canvas");
    c.width = c.height = s;
    var g = c.getContext("2d");
    var m = s / 2;
    function ring(r, a, lw) {
      g.strokeStyle = "rgba(158,198,214," + a + ")";
      g.lineWidth = lw;
      g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.stroke();
    }
    ring(170, 0.50, 2);
    ring(128, 0.32, 1.4);
    ring(84, 0.22, 1.2);
    ring(212, 0.16, 1);
    /* S 线：上弧过右、下弧过左 */
    g.strokeStyle = "rgba(158,198,214,0.34)";
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(m, m - 85, 85, Math.PI / 2, Math.PI * 1.5, true);
    g.arc(m, m + 85, 85, Math.PI / 2, Math.PI * 1.5, false);
    g.stroke();
    /* 两眼：一点微光 */
    [m - 85, m + 85].forEach(function (ey) {
      var grad = g.createRadialGradient(m, ey, 0, m, ey, 14);
      grad.addColorStop(0, "rgba(190,225,238,0.5)");
      grad.addColorStop(1, "rgba(190,225,238,0)");
      g.fillStyle = grad;
      g.fillRect(m - 14, ey - 14, 28, 28);
    });
    return c;
  }

  var taiji = makeTaijiRipple();

  /* 随机扩散的涟漪圈 */
  var ripples = [];
  var rippleTimer = 0;
  function spawnRipple(now) {
    var at = Math.random() < 0.55;
    ripples.push({
      x: at ? CX + (Math.random() * 120 - 60) : W * (0.08 + Math.random() * 0.84),
      y: at ? CY + (Math.random() * 50 - 25) : H * (0.55 + Math.random() * 0.35),
      r: 6,
      life: 0,
      maxLife: 3 + Math.random() * 1.6,
      speed: 42 + Math.random() * 26
    });
  }

  /* ============================================================
     三、漂浮书法字（字体加载完成后生成 sprite）
     ============================================================ */

  var goldSprites = {};   /* 字 → sprite */
  var airSprites = {};

  function makeGoldChar(ch) {
    var s = 230, c = document.createElement("canvas");
    c.width = c.height = s;
    var g = c.getContext("2d");
    var font = "165px \"Ma Shan Zheng\",\"STKaiti\",\"KaiTi\",serif";
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    /* 立体挤出：往右下叠几层深色 */
    g.fillStyle = "#5d4718";
    for (var k = 5; k >= 1; k--) {
      g.globalAlpha = 0.35 + k * 0.12;
      g.fillText(ch, s / 2 + k * 1.6, s / 2 + k * 2.0);
    }
    /* 鎏金面 + 发光 */
    g.globalAlpha = 1;
    g.shadowColor = "rgba(238,200,100,0.9)";
    g.shadowBlur = 30;
    var grd = g.createLinearGradient(0, s * 0.14, 0, s * 0.86);
    grd.addColorStop(0, "#faecae");
    grd.addColorStop(0.45, "#e6c46a");
    grd.addColorStop(1, "#9c7427");
    g.fillStyle = grd;
    g.fillText(ch, s / 2, s / 2);
    g.shadowBlur = 0;
    return c;
  }

  function makeAirChar(ch) {
    var s = 200, c = document.createElement("canvas");
    c.width = c.height = s;
    var g = c.getContext("2d");
    g.font = "150px \"Ma Shan Zheng\",\"STKaiti\",\"KaiTi\",serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    /* 半透明墨体 + 冷光勾边 */
    g.shadowColor = "rgba(0,0,0,0.55)";
    g.shadowBlur = 7;
    g.fillStyle = "rgba(10,15,20,0.88)";
    g.fillText(ch, s / 2, s / 2);
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(158,196,212,0.30)";
    g.lineWidth = 1.3;
    g.strokeText(ch, s / 2, s / 2);
    return c;
  }

  /* 鎏金导航字：带链接（空字符串 = 预留位） */
  var GOLD = [
    { ch: "册", href: "ideas.html",        x: 0.30, y: 0.26, z: 1.00 },
    { ch: "词", href: "ideas/dao-notes.html", x: 0.19, y: 0.48, z: 0.92 },
    { ch: "梦", href: "",                  x: 0.33, y: 0.68, z: 0.86 },
    { ch: "游", href: "",                  x: 0.11, y: 0.36, z: 0.78 }
  ];

  /* 氛围黑字：从字池里随机取，散布中远景 */
  var AIR_POOL = "水墨云山空无心剑仙";
  var AIR_POS = [
    [0.06, 0.10, 0.30], [0.16, 0.20, 0.42], [0.27, 0.09, 0.36],
    [0.40, 0.16, 0.55], [0.52, 0.08, 0.33], [0.62, 0.20, 0.48],
    [0.08, 0.60, 0.38], [0.55, 0.44, 0.35], [0.46, 0.72, 0.50],
    [0.64, 0.62, 0.40], [0.24, 0.80, 0.45], [0.05, 0.38, 0.28]
  ];
  var rndAir = mulberry(2026);
  var AIR = AIR_POS.map(function (p, i) {
    return {
      ch: AIR_POOL[(i * 3 + ((rndAir() * 7) | 0)) % AIR_POOL.length],
      x: p[0], y: p[1], z: p[2],
      ph: rndAir() * Math.PI * 2,
      sp: 0.5 + rndAir() * 0.7
    };
  });

  GOLD.forEach(function (c) { c.ph = Math.random() * Math.PI * 2; c.pulse = 0; });
  AIR.forEach(function (c) { if (!airSprites[c.ch]) airSprites[c.ch] = makeAirChar(c.ch); });

  var fontsReady = false;
  function buildGoldSprites() {
    GOLD.forEach(function (c) { goldSprites[c.ch] = makeGoldChar(c.ch); });
    fontsReady = true;
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      if (!fontsReady) buildGoldSprites();
    });
  }
  setTimeout(function () { if (!fontsReady) buildGoldSprites(); }, 2400);

  /* ============================================================
     四、主循环
     ============================================================ */

  var mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  var pointer = { x: -9999, y: -9999 };
  var heroEl = canvas.parentElement;

  heroEl.addEventListener("pointermove", function (e) {
    var rc = canvas.getBoundingClientRect();
    var px = e.clientX - rc.left, py = e.clientY - rc.top;
    mouse.tx = px - CX;
    mouse.ty = py - CY;
    pointer.x = px; pointer.y = py;
  }, { passive: true });

  heroEl.addEventListener("pointerleave", function () {
    pointer.x = -9999; pointer.y = -9999;
    mouse.tx = 0; mouse.ty = 0;
  });

  /* 点击鎏金字：有链接就跳，预留位只弹跳一下 */
  heroEl.addEventListener("pointerdown", function (e) {
    var rc = canvas.getBoundingClientRect();
    var px = e.clientX - rc.left, py = e.clientY - rc.top;
    GOLD.forEach(function (c) {
      var pos = charPos(c, lastNow);
      var dx = px - pos.x, dy = py - pos.y;
      if (dx * dx + dy * dy < pos.hit * pos.hit) {
        if (c.href) window.location.href = c.href;
        else c.pulse = 1;
      }
    });
  });

  function charPos(c, now) {
    var size = (104 + 84 * c.z) * world;
    if (c.pulse > 0) size *= 1 + 0.10 * c.pulse;
    var bob = Math.sin(now * 0.00045 * (0.7 + c.z) + c.ph) * (7 + 11 * c.z) * world;
    var drift = Math.sin(now * 0.00028 + c.ph * 2.3) * (5 + 9 * c.z) * world;
    var parX = -mouse.x * (0.018 + 0.045 * c.z);
    var parY = -mouse.y * (0.010 + 0.028 * c.z);
    return {
      x: c.x * W + drift + parX,
      y: c.y * H + bob + parY,
      size: size,
      hit: size * 0.46
    };
  }

  var lastNow = 0;
  var t0 = 0;

  function frame(now) {
    if (!t0) t0 = now;
    lastNow = now;
    var dt = Math.min((now - (frame.last || now)) / 1000, 0.05);
    frame.last = now;

    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;

    /* ---- 1) 底：暗青黑渐变 + 顶部冷光 ---- */
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#060a0f");
    bg.addColorStop(0.45, "#0a1219");
    bg.addColorStop(0.72, "#0e1720");
    bg.addColorStop(1, "#05080c");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var glow = ctx.createRadialGradient(W * 0.34, H * 0.30, 0, W * 0.34, H * 0.30, Math.max(W, H) * 0.55);
    glow.addColorStop(0, "rgba(96,140,165,0.14)");
    glow.addColorStop(1, "rgba(96,140,165,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    /* ---- 2) 三层墨河 ---- */
    strips.forEach(function (s, i) {
      var w = 1500 * world * s.scale;
      var h = 260 * world * s.scale;
      s.off = (s.off + s.speed * world * dt) % w;
      var y = H * s.y + Math.sin(now * 0.00035 + s.ph) * 5 * world - h / 2;
      ctx.globalAlpha = s.alpha;
      ctx.drawImage(s.spr, -s.off, y, w, h);
      ctx.drawImage(s.spr, -s.off + w, y, w, h);
    });
    ctx.globalAlpha = 1;

    /* ---- 3) 太极涟漪 + 扩散涟漪圈 ---- */
    var tRot = now * 0.00003;
    var tSize = 470 * world;
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(tRot);
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(now * 0.0004);
    ctx.drawImage(taiji, -tSize / 2, -tSize / 2, tSize, tSize);
    ctx.restore();

    rippleTimer -= dt;
    if (rippleTimer <= 0 && !reduce) { spawnRipple(now); rippleTimer = 1.4 + Math.random() * 1.2; }
    for (var i = ripples.length - 1; i >= 0; i--) {
      var rp = ripples[i];
      rp.life += dt;
      if (rp.life > rp.maxLife) { ripples.splice(i, 1); continue; }
      rp.r += rp.speed * world * dt;
      var a = 0.20 * (1 - rp.life / rp.maxLife);
      ctx.strokeStyle = "rgba(170,208,224," + a + ")";
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2); ctx.stroke();
    }

    /* ---- 4) 氛围黑字（远，先画） ---- */
    AIR.forEach(function (c) {
      var spr = airSprites[c.ch];
      if (!spr) return;
      var size = (52 + 58 * c.z) * world;
      var bob = Math.sin(now * 0.0004 * c.sp + c.ph) * (5 + 7 * c.z) * world;
      var drift = Math.sin(now * 0.00022 + c.ph * 1.7) * (4 + 6 * c.z) * world;
      var parX = -mouse.x * (0.008 + 0.02 * c.z);
      var parY = -mouse.y * (0.005 + 0.012 * c.z);
      ctx.save();
      ctx.translate(c.x * W + drift + parX, c.y * H + bob + parY);
      ctx.rotate(Math.sin(now * 0.00018 + c.ph) * 0.05);
      ctx.globalAlpha = 0.55 + 0.45 * c.z;
      ctx.drawImage(spr, -size / 2, -size / 2, size, size);
      ctx.restore();
    });

    /* ---- 5) 鎏金导航字（近，后画） ---- */
    GOLD.forEach(function (c) {
      var spr = goldSprites[c.ch];
      if (!spr) return;
      if (c.pulse > 0) c.pulse = Math.max(0, c.pulse - dt * 2.2);
      var pos = charPos(c, now);
      var hover = pointer.x > -999 &&
        Math.abs(pointer.x - pos.x) < pos.hit &&
        Math.abs(pointer.y - pos.y) < pos.hit;
      var breathe = 1 + 0.018 * Math.sin(now * 0.0008 + c.ph);
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(Math.sin(now * 0.0002 + c.ph) * 0.035);
      if (hover || c.pulse > 0) {
        var boost = (hover ? 1.10 : 1) + c.pulse * 0.10;
        ctx.scale(boost, boost);
        /* 悬停时额外晕光 */
        ctx.shadowColor = "rgba(240,205,110,0.85)";
        ctx.shadowBlur = 34;
      }
      ctx.drawImage(spr, -pos.size * breathe / 2, -pos.size * breathe / 2,
        pos.size * breathe, pos.size * breathe);
      ctx.restore();
    });
    canvas.style.cursor = GOLD.some(function (c) {
      if (!c.href || !goldSprites[c.ch]) return false;
      var pos = charPos(c, now);
      return Math.abs(pointer.x - pos.x) < pos.hit &&
             Math.abs(pointer.y - pos.y) < pos.hit;
    }) ? "pointer" : "default";

    /* ---- 6) 四周暗角（电影感） ---- */
    var vg = ctx.createRadialGradient(W * 0.5, H * 0.52, Math.min(W, H) * 0.34,
                                      W * 0.5, H * 0.52, Math.max(W, H) * 0.78);
    vg.addColorStop(0, "rgba(2,4,7,0)");
    vg.addColorStop(1, "rgba(2,4,7,0.62)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    if (!reduce) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
