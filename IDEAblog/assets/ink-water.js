/* ============================================================
   一念未落 · 墨流水境 v2 —— 三轴分层（Canvas 逐帧绘制，无依赖）
   ------------------------------------------------------------
   空间结构（用户定义的三轴）：
     xy 平面 = 景：水墨河流（三层滚动墨河）+ 山水（远/中/近三层山峦）
     z  轴   = 你的标签：14+ 枚书法字悬在纵深空间，
               近的鎏金立体、远的墨影虚焦，每一枚近/中层都可点击。

   z 纵深感的四个手段：
     1) 透视投影：远的字向灭点(0.5, 0.55)收拢，近的字向外扩
     2) 景深虚焦：z<0.5 的字用预渲染的模糊 sprite
     3) 水汽雾化：越远越淡、越偏向背景冷色
     4) 分层视差：近字跟鼠标位移多（×1.0），远字几乎不动（×0.15）

   你以后只需要改 TAGS 表：加一行 = 多一枚可点的标签字。
   href: "" 的是占位，点击只弹跳不跳转，以后补上页面路径即可。
   ============================================================ */
(function () {
  var canvas = document.querySelector(".idea-inkcanvas");
  if (!canvas) return;
  var heroEl = canvas.parentElement;

  var reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var ctx = canvas.getContext("2d");
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  var W = 0, H = 0, world = 1;
  var CX = 0, CY = 0;

  function resize() {
    W = heroEl.clientWidth;
    H = heroEl.clientHeight;
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

  /* 简单可复现随机数（固定种子 → 画面每次风格一致） */
  function mulberry(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ============================================================
     一、xy 平面 · 山水：远 / 中 / 近三层山峦
     手法：分层噪声画出山脊折线，山体由上往下渐淡，
           山脚化进雾里，避免「山浮在水上」的硬边。
     ============================================================ */

  function makeMountain(seed, w, h, amp, sharp, tone, tint) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var g = c.getContext("2d");
    var rnd = mulberry(seed);
    var p1 = rnd() * 6.283, p2 = rnd() * 6.283, p3 = rnd() * 6.283;

    /* 山脊高度 = 三个不同频率正弦叠加；sharp 控制高频占比（山有多峭） */
    function ridgeY(x) {
      var t = x / w;
      return h * 0.52
        - Math.sin(t * 6.283 * 1.7 + p1) * amp
        - Math.sin(t * 6.283 * (3.4 + sharp) + p2) * amp * 0.5 * sharp
        - Math.sin(t * 6.283 * (7.1 + sharp * 2) + p3) * amp * 0.22 * sharp;
    }

    /* 山体：从山脊往下渐淡，脚化进雾 */
    g.beginPath();
    g.moveTo(0, h);
    for (var x = 0; x <= w; x += 4) g.lineTo(x, ridgeY(x));
    g.lineTo(w, h);
    g.closePath();
    var grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0,    tint + tone + ")");
    grad.addColorStop(0.55, tint + tone * 0.55 + ")");
    grad.addColorStop(1,    tint + "0)");
    g.fillStyle = grad;
    g.fill();

    /* 山脊线：浓墨一道，带毛边 */
    g.strokeStyle = tint + Math.min(tone * 1.7, 0.6) + ")";
    g.lineWidth = 1.6;
    g.beginPath();
    for (var x2 = 0; x2 <= w; x2 += 5) {
      var y = ridgeY(x2) + (mulberry(seed + x2)() - 0.5) * 1.6;
      if (x2) g.lineTo(x2, y); else g.moveTo(x2, y);
    }
    g.stroke();
    return c;
  }

  /* 近礁上的松树剪影 */
  function makePine() {
    var s = 90, c = document.createElement("canvas");
    c.width = c.height = s;
    var g = c.getContext("2d");
    g.strokeStyle = "rgba(8,13,18,0.85)";
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.95);
    g.quadraticCurveTo(s * 0.46, s * 0.6, s * 0.52, s * 0.28);
    g.stroke();
    [[0.62, 0.30], [0.48, 0.46], [0.56, 0.60]].forEach(function (b, i) {
      g.lineWidth = 1.6 - i * 0.2;
      for (var k = 0; k < 4; k++) {
        var ang = Math.PI * (0.15 + k * 0.18);
        g.beginPath();
        g.moveTo(s * b[0], s * b[1]);
        g.lineTo(s * b[0] + Math.cos(ang) * 22, s * b[1] - Math.sin(ang) * 12);
        g.stroke();
      }
    });
    return c;
  }

  var mtns = [
    { spr: makeMountain(101, 2000, 300, 86, 0.5, 0.16, "rgba(92,122,140,"),
      y: 0.30, h: 0.24, speed: 2.2, par: 0.006 },
    { spr: makeMountain(233, 1700, 320, 96, 1.1, 0.24, "rgba(58,82,98,"),
      y: 0.40, h: 0.27, speed: 4.5, par: 0.012 },
    { spr: makeMountain(377, 1100, 240, 60, 1.8, 0.42, "rgba(15,23,30,"),
      y: 0.52, h: 0.20, speed: 8.5, par: 0.022 }
  ];
  mtns.forEach(function (m) { m.off = 0; });
  var pine = makePine();

  /* ============================================================
     二、xy 平面 · 墨河：三层滚动水面（沿用 v1 技法，整体下压给山腾位）
     ============================================================ */

  function makeStrip(seed) {
    var w = 1500, h = 260;
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var g = c.getContext("2d");
    var rnd = mulberry(seed);

    for (var i = 0; i < 6; i++) {
      var bx = rnd() * w, by = h * (0.25 + rnd() * 0.6);
      var br = 130 + rnd() * 210;
      var grad = g.createRadialGradient(bx, by, 0, bx, by, br);
      grad.addColorStop(0, "rgba(3,7,11," + (0.35 + rnd() * 0.3) + ")");
      grad.addColorStop(1, "rgba(3,7,11,0)");
      g.fillStyle = grad;
      g.fillRect(bx - br, by - br, br * 2, br * 2);
    }

    for (var e = 0; e < 4; e++) {
      var ex = rnd() * w, ey = h * (0.3 + rnd() * 0.5), er = 40 + rnd() * 90;
      var a0 = rnd() * Math.PI * 2, a1 = a0 + 1.6 + rnd() * 2.2;
      g.strokeStyle = "rgba(6,12,18," + (0.3 + rnd() * 0.3) + ")";
      g.lineWidth = 10 + rnd() * 16;
      g.beginPath(); g.arc(ex, ey, er, a0, a1); g.stroke();
      g.strokeStyle = "rgba(150,190,208," + (0.10 + rnd() * 0.12) + ")";
      g.lineWidth = 1.4;
      g.beginPath(); g.arc(ex, ey, er + 9, a0 + 0.2, a1 - 0.1); g.stroke();
    }

    for (var l = 0; l < 9; l++) {
      var yBase = h * (0.12 + rnd() * 0.76);
      var amp = 5 + rnd() * 13;
      var fq = 0.004 + rnd() * 0.005;
      var ph = rnd() * Math.PI * 2;
      var segs = 46, step = w / segs;
      var bright = 0.08 + rnd() * 0.16;
      for (var s = 0; s < segs; s++) {
        if (rnd() < 0.42) continue;
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

  var strips = [
    { spr: makeStrip(11), scale: 1.25, y: 0.56, speed: 20, alpha: 0.85, ph: 0.0 },
    { spr: makeStrip(47), scale: 1.05, y: 0.70, speed: 36, alpha: 0.92, ph: 2.1 },
    { spr: makeStrip(83), scale: 0.85, y: 0.84, speed: 58, alpha: 1.00, ph: 4.2 }
  ];
  strips.forEach(function (s) { s.off = 0; });

  /* ============================================================
     三、太极涟漪 + 随机涟漪圈（沿用 v1，位置略沉到水面上）
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
    g.strokeStyle = "rgba(158,198,214,0.34)";
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(m, m - 85, 85, Math.PI / 2, Math.PI * 1.5, true);
    g.arc(m, m + 85, 85, Math.PI / 2, Math.PI * 1.5, false);
    g.stroke();
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

  var ripples = [];
  var rippleTimer = 0;
  function spawnRipple() {
    var at = Math.random() < 0.55;
    ripples.push({
      x: at ? CX + (Math.random() * 120 - 60) : W * (0.08 + Math.random() * 0.84),
      y: at ? CY + (Math.random() * 50 - 25) : H * (0.62 + Math.random() * 0.28),
      r: 6, life: 0, maxLife: 3 + Math.random() * 1.6,
      speed: 42 + Math.random() * 26
    });
  }

  /* ============================================================
     四、z 轴 · 标签字
     ★★★ 你以后只改这里 ★★★
     加一行 = 多一枚可点的标签字。href:"" 为占位（点击只弹跳）。
     z 决定纵深：0.85+ 近（鎏金大），0.55~0.85 中，0.4~0.55 远，<0.4 纯氛围不可点。
     ============================================================ */

  var TAGS = [
    { ch: "册", label: "想法集",   href: "ideas.html",           x: 0.30, y: 0.22, z: 0.95, gold: true },
    { ch: "词", label: "道家词库", href: "ideas/dao-notes.html", x: 0.15, y: 0.42, z: 0.88, gold: true },
    { ch: "画", label: "封面自述", href: "ideas/ink-cover.html", x: 0.36, y: 0.58, z: 0.82, gold: true },
    { ch: "我", label: "关于我",   href: "about.html",           x: 0.08, y: 0.30, z: 0.74, gold: true },
    { ch: "梦", label: "预留",     href: "",                     x: 0.24, y: 0.78, z: 0.66, gold: false },
    { ch: "影", label: "预留",     href: "",                     x: 0.47, y: 0.26, z: 0.58, gold: false },
    { ch: "书", label: "预留",     href: "",                     x: 0.52, y: 0.50, z: 0.52, gold: false },
    { ch: "游", label: "预留",     href: "",                     x: 0.60, y: 0.72, z: 0.46, gold: false }
  ];

  /* 远层氛围字（z < 0.4，纯墨影，不可点） */
  var AIR_POOL = "水墨云山空无心剑仙";
  var AIR_POS = [
    [0.06, 0.10, 0.32], [0.18, 0.18, 0.40], [0.28, 0.08, 0.26],
    [0.42, 0.12, 0.38], [0.54, 0.08, 0.30], [0.64, 0.22, 0.36],
    [0.07, 0.56, 0.34], [0.55, 0.40, 0.28], [0.48, 0.66, 0.38],
    [0.66, 0.58, 0.24], [0.22, 0.60, 0.30], [0.04, 0.36, 0.22]
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

  TAGS.forEach(function (c) { c.ph = Math.random() * Math.PI * 2; c.pulse = 0; });

  /* ---------- 书法字 sprite 预渲染（三种气质） ---------- */

  var FONT_BRUSH = "\"Ma Shan Zheng\",\"STKaiti\",\"KaiTi\",serif";
  var sprites = {};   /* key = ch + 类型 */

  /* 鎏金：立体挤出 + 发光（近层主标签） */
  function makeGoldChar(ch) {
    var s = 230, c = document.createElement("canvas");
    c.width = c.height = s;
    var g = c.getContext("2d");
    g.font = "165px " + FONT_BRUSH;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "#5d4718";
    for (var k = 5; k >= 1; k--) {
      g.globalAlpha = 0.35 + k * 0.12;
      g.fillText(ch, s / 2 + k * 1.6, s / 2 + k * 2.0);
    }
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

  /* 哑金：低光、偏灰（占位标签 —— 未落笔所以还没点亮） */
  function makeDimChar(ch) {
    var s = 220, c = document.createElement("canvas");
    c.width = c.height = s;
    var g = c.getContext("2d");
    g.font = "160px " + FONT_BRUSH;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.shadowColor = "rgba(190,170,120,0.35)";
    g.shadowBlur = 12;
    var grd = g.createLinearGradient(0, s * 0.15, 0, s * 0.85);
    grd.addColorStop(0, "#c9bfa0");
    grd.addColorStop(0.5, "#a59872");
    grd.addColorStop(1, "#6d6349");
    g.fillStyle = grd;
    g.fillText(ch, s / 2, s / 2);
    g.shadowBlur = 0;
    return c;
  }

  /* 墨影：半透明墨体 + 冷光勾边；blur=true 出虚焦版（远层） */
  function makeAirChar(ch, blur) {
    var s = 200, c = document.createElement("canvas");
    c.width = c.height = s;
    var g = c.getContext("2d");
    g.font = "150px " + FONT_BRUSH;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "rgba(14,20,26,0.9)";
    if (blur) {
      /* 用多次偏移叠印近似高斯模糊（预渲染，零逐帧成本） */
      for (var i = 0; i < 10; i++) {
        var a = (i / 10) * Math.PI * 2;
        g.globalAlpha = 0.10;
        g.fillText(ch, s / 2 + Math.cos(a) * 1.6, s / 2 + Math.sin(a) * 1.6);
      }
      g.globalAlpha = 1;
    }
    g.fillText(ch, s / 2, s / 2);
    g.strokeStyle = "rgba(158,196,212," + (blur ? 0.18 : 0.30) + ")";
    g.lineWidth = blur ? 1 : 1.3;
    g.strokeText(ch, s / 2, s / 2);
    return c;
  }

  var fontsReady = false;
  function buildCharSprites() {
    TAGS.forEach(function (c) {
      sprites[c.ch + (c.gold ? "G" : "D")] = c.gold ? makeGoldChar(c.ch) : makeDimChar(c.ch);
    });
    AIR.forEach(function (c) {
      sprites[c.ch + "A"]  = makeAirChar(c.ch, false);
      sprites[c.ch + "AB"] = makeAirChar(c.ch, true);
    });
    fontsReady = true;
    if (reduce) paint(8000);   /* 静态模式：字体到位后补画一帧 */
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { if (!fontsReady) buildCharSprites(); });
  }
  setTimeout(function () { if (!fontsReady) buildCharSprites(); }, 2400);

  /* ---------- 悬停提示牌（HTML 层，跟着标签走） ---------- */

  var tip = document.createElement("div");
  tip.className = "idea-tagtip";
  heroEl.appendChild(tip);
  var tipTag = null;

  /* ---------- 交互 ---------- */

  var mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  var pointer = { x: -9999, y: -9999 };
  var lastNow = 0;

  heroEl.addEventListener("pointermove", function (e) {
    var rc = canvas.getBoundingClientRect();
    var px = e.clientX - rc.left, py = e.clientY - rc.top;
    mouse.tx = px - CX; mouse.ty = py - CY;
    pointer.x = px; pointer.y = py;
  }, { passive: true });

  heroEl.addEventListener("pointerleave", function () {
    pointer.x = -9999; pointer.y = -9999;
    mouse.tx = 0; mouse.ty = 0;
  });

  heroEl.addEventListener("pointerdown", function (e) {
    var rc = canvas.getBoundingClientRect();
    var px = e.clientX - rc.left, py = e.clientY - rc.top;
    TAGS.forEach(function (c) {
      if (c.z < 0.4) return;
      var pos = tagPos(c, lastNow);
      var dx = px - pos.x, dy = py - pos.y;
      if (dx * dx + dy * dy < pos.hit * pos.hit) {
        if (c.href) window.location.href = c.href;
        else c.pulse = 1;
      }
    });
  });

  /* ---------- z 纵深投影：位置 / 大小 / 视差 都由 z 驱动 ---------- */

  function tagPos(c, now) {
    var p = 0.15 + 0.85 * c.z;                       /* 视差权重：近 1.0，远 0.15 */
    var xProj = 0.5 + (c.x - 0.5) * (0.70 + 0.42 * c.z);   /* 透视：远往灭点收 */
    var yProj = 0.55 + (c.y - 0.55) * (0.80 + 0.28 * c.z);
    var size = (40 + 94 * c.z) * world;
    if (c.pulse > 0) size *= 1 + 0.10 * c.pulse;
    var bob = Math.sin(now * 0.00045 * (0.6 + c.z) + c.ph) * (4 + 11 * c.z) * world;
    var drift = Math.sin(now * 0.00026 + c.ph * 2.1) * (3 + 8 * c.z) * world;
    var parX = -mouse.x * 0.10 * p;
    var parY = -mouse.y * 0.05 * p;
    return {
      x: xProj * W + drift + parX,
      y: yProj * H + bob + parY,
      size: size,
      hit: size * 0.46
    };
  }

  /* ============================================================
     五、绘制一帧（静态模式也走这里）
     ============================================================ */

  var rippleSeed = 0;

  function paint(now) {
    var dt = Math.min((now - (paint.last || now)) / 1000, 0.05);
    paint.last = now;
    lastNow = now;   /* 点击检测要用同一时刻的字位 */

    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;

    /* 1) 暗青黑底 + 顶部冷光 */
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#060a0f");
    bg.addColorStop(0.45, "#0a1219");
    bg.addColorStop(0.72, "#0e1720");
    bg.addColorStop(1, "#05080c");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var glow = ctx.createRadialGradient(W * 0.34, H * 0.26, 0, W * 0.34, H * 0.26, Math.max(W, H) * 0.55);
    glow.addColorStop(0, "rgba(96,140,165,0.13)");
    glow.addColorStop(1, "rgba(96,140,165,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    /* 2) 山水：远 → 中 → 近，横向极慢漂移 + 轻微视差 */
    mtns.forEach(function (m) {
      var w = m.spr.width * (H * m.h / m.spr.height);
      m.off = (m.off + m.speed * world * dt) % w;
      var y = H * m.y - mouse.y * m.par;
      var x0 = -m.off - mouse.x * m.par;
      ctx.drawImage(m.spr, x0, y, w, H * m.h);
      ctx.drawImage(m.spr, x0 + w, y, w, H * m.h);
    });

    /* 山脚水汽：在山与河之间铺一道雾，把两者接起来 */
    var mist = ctx.createLinearGradient(0, H * 0.40, 0, H * 0.60);
    mist.addColorStop(0, "rgba(150,180,198,0)");
    mist.addColorStop(0.5, "rgba(150,180,198,0.07)");
    mist.addColorStop(1, "rgba(150,180,198,0)");
    ctx.fillStyle = mist;
    ctx.fillRect(0, H * 0.40, W, H * 0.20);

    /* 近礁上的松 */
    var ps = 90 * world;
    ctx.drawImage(pine, W * 0.62 - ps / 2, H * 0.55 - ps, ps, ps);

    /* 3) 三层墨河 */
    strips.forEach(function (s) {
      var w = 1500 * world * s.scale;
      var h = 260 * world * s.scale;
      s.off = (s.off + s.speed * world * dt) % w;
      var y = H * s.y + Math.sin(now * 0.00035 + s.ph) * 5 * world - h / 2;
      ctx.globalAlpha = s.alpha;
      ctx.drawImage(s.spr, -s.off, y, w, h);
      ctx.drawImage(s.spr, -s.off + w, y, w, h);
    });
    ctx.globalAlpha = 1;

    /* 4) 太极涟漪 + 扩散涟漪 */
    var tSize = 470 * world;
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(now * 0.00003);
    ctx.globalAlpha = 0.70 + 0.25 * Math.sin(now * 0.0004);
    ctx.drawImage(taiji, -tSize / 2, -tSize / 2, tSize, tSize);
    ctx.restore();

    rippleTimer -= dt;
    if (rippleTimer <= 0 && !reduce) { spawnRipple(); rippleTimer = 1.4 + Math.random() * 1.2; }
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

    /* 5) 远层氛围墨字（z<0.4，虚焦，不可点） */
    if (fontsReady) {
      AIR.forEach(function (c) {
        var blurred = c.z < 0.30;
        var spr = sprites[c.ch + (blurred ? "AB" : "A")];
        if (!spr) return;
        var p = 0.15 + 0.85 * c.z;
        var xProj = 0.5 + (c.x - 0.5) * (0.70 + 0.42 * c.z);
        var yProj = 0.55 + (c.y - 0.55) * (0.80 + 0.28 * c.z);
        var size = (40 + 94 * c.z) * world;
        var bob = Math.sin(now * 0.0004 * c.sp + c.ph) * (4 + 7 * c.z) * world;
        var drift = Math.sin(now * 0.00022 + c.ph * 1.7) * (3 + 6 * c.z) * world;
        ctx.save();
        ctx.translate(xProj * W + drift - mouse.x * 0.10 * p,
                      yProj * H + bob - mouse.y * 0.05 * p);
        ctx.rotate(Math.sin(now * 0.00018 + c.ph) * 0.05);
        ctx.globalAlpha = 0.22 + 0.42 * c.z;
        ctx.drawImage(spr, -size / 2, -size / 2, size, size);
        ctx.restore();
      });
    }

    /* 6) 标签字（近/中层，可点击） */
    var hovered = null;
    if (fontsReady) {
      TAGS.forEach(function (c) {
        var spr = sprites[c.ch + (c.gold ? "G" : "D")];
        if (!spr) return;
        if (c.pulse > 0) c.pulse = Math.max(0, c.pulse - dt * 2.2);
        var pos = tagPos(c, now);
        var isHover = c.z >= 0.4 && pointer.x > -999 &&
          Math.abs(pointer.x - pos.x) < pos.hit &&
          Math.abs(pointer.y - pos.y) < pos.hit;
        if (isHover && (!hovered || c.z > hovered.z)) hovered = c;

        var breathe = 1 + 0.018 * Math.sin(now * 0.0008 + c.ph);
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(Math.sin(now * 0.0002 + c.ph) * 0.035);
        if (isHover || c.pulse > 0) {
          var boost = (isHover ? 1.10 : 1) + c.pulse * 0.10;
          ctx.scale(boost, boost);
          ctx.shadowColor = c.href ? "rgba(240,205,110,0.85)" : "rgba(190,170,120,0.55)";
          ctx.shadowBlur = 32;
        }
        ctx.globalAlpha = 0.34 + 0.66 * c.z;
        ctx.drawImage(spr, -pos.size * breathe / 2, -pos.size * breathe / 2,
          pos.size * breathe, pos.size * breathe);
        ctx.restore();
      });
    }

    /* 悬停：光标 + 提示牌 */
    canvas.style.cursor = (hovered && hovered.href) ? "pointer" : "default";
    if (hovered && hovered !== tipTag) {
      tipTag = hovered;
      tip.textContent = hovered.label + (hovered.href ? "" : " · 未落笔");
      tip.classList.add("idea-tagtip--show");
    } else if (!hovered && tipTag) {
      tipTag = null;
      tip.classList.remove("idea-tagtip--show");
    }
    if (tipTag) {
      var tp = tagPos(tipTag, now);
      tip.style.left = tp.x + "px";
      tip.style.top = (tp.y - tp.size * 0.62) + "px";
    }

    /* 7) 四周电影暗角 */
    var vg = ctx.createRadialGradient(W * 0.5, H * 0.52, Math.min(W, H) * 0.34,
                                      W * 0.5, H * 0.52, Math.max(W, H) * 0.78);
    vg.addColorStop(0, "rgba(2,4,7,0)");
    vg.addColorStop(1, "rgba(2,4,7,0.62)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  /* 静态模式：画一帧安定的终态；动态模式：进入主循环 */
  function frame(now) {
    paint(now);
    if (!reduce) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
