/* ============================================================
   一念未落 · 活墨星云（Canvas 逐帧绘制，无依赖）
   ------------------------------------------------------------
   思路：水墨的本质是「一堆边缘不规则的半透明墨斑叠在宣纸上」。
   每个墨斑先预渲染到小画布（sprite），主循环只做 drawImage，
   所以每秒 60 帧、近 50 个墨团也不卡。

   动感来自五处：
     0) 开场：一滴浓墨落进水里，晕开
     1) 星云差速旋转：内圈快外圈慢，像水在被搅
     2) 墨斑呼吸：每个墨斑的大小浓淡各自缓慢起伏
     3) 墨丝：沿螺旋被拉出的细线，长度来回伸缩
     4) 鼠标视差：整团墨轻轻偏向指针
   色彩：焦墨为主，少量墨绿与赭石低浓度点缀。
   尊重系统「减少动态」：画一帧静态墨，不流动。
   ============================================================ */
(function () {
  var canvas = document.querySelector(".idea-inkcanvas");
  if (!canvas) return;

  var reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var ctx = canvas.getContext("2d");
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  var W = 0, H = 0, CX = 0, CY = 0, world = 1;
  function resize() {
    var hero = canvas.parentElement;
    W = hero.clientWidth;
    H = hero.clientHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    /* 漩涡中心对齐 SVG 太极的位置（36% / 50%） */
    CX = W * 0.36;
    CY = H * 0.5;
    world = Math.max(0.55, Math.min(W, H) / 800);
  }
  window.addEventListener("resize", resize);
  resize();

  /* ---------- 墨斑 sprite：角向噪声的轮廓 + 中心浓四周淡 ---------- */

  function makeSprite(size, seed, tint) {
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var g = c.getContext("2d");
    var R = size / 2 - 2;

    /* 半径随角度起伏：几个不同频率的 sin 叠出「不规则的圆」 */
    function radius(a) {
      return R * (0.66
        + 0.15 * Math.sin(a * 3.1 + seed)
        + 0.10 * Math.sin(a * 5.7 + seed * 2.3)
        + 0.07 * Math.sin(a * 9.3 + seed * 4.7));
    }

    /* 三层叠：主形 + 两个更淡、更偏的形 = 浓淡层次 */
    for (var layer = 0; layer < 3; layer++) {
      var off = layer * 0.55;
      var base = layer === 0 ? 0.55 : 0.20;
      g.beginPath();
      for (var i = 0; i <= 72; i++) {
        var a = (i / 72) * Math.PI * 2;
        var r = radius(a + off);
        var x = R + Math.cos(a) * r;
        var y = R + Math.sin(a) * r;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      var grad = g.createRadialGradient(R, R, 0, R, R, R);
      grad.addColorStop(0,    tint(base));
      grad.addColorStop(0.55, tint(base * 0.6));
      grad.addColorStop(1,    tint(0));
      g.fillStyle = grad;
      g.fill();
    }
    return c;
  }

  function inkTint(a)   { return "rgba(30,27,23," + a + ")"; }
  function greenTint(a) { return "rgba(61,79,69," + a + ")"; }
  function ochreTint(a) { return "rgba(138,90,48," + a + ")"; }

  var sprites = [
    makeSprite(240, 1.7,  inkTint),
    makeSprite(240, 4.2,  inkTint),
    makeSprite(240, 7.9,  inkTint),
    makeSprite(240, 10.1, inkTint),
    makeSprite(240, 12.4, inkTint),
    makeSprite(240, 15.2, inkTint),
    makeSprite(220, 20.5, greenTint),  /* 少量墨绿 */
    makeSprite(200, 24.7, ochreTint)   /* 极少赭石 */
  ];

  /* ---------- 墨团布阵：雾层(不搅) → 主体 → 近景 → 飞墨 ---------- */

  var density = W < 640 ? 0.6 : 1;
  var blobs = [];

  function addBlobs(count, rMin, rMax, sMin, sMax, aMin, aMax, speed, layer) {
    for (var i = 0; i < Math.round(count * density); i++) {
      blobs.push({
        t: Math.random() * Math.PI * 2,
        r: rMin + Math.random() * (rMax - rMin),
        s: sMin + Math.random() * (sMax - sMin),
        a: aMin + Math.random() * (aMax - aMin),
        ph: Math.random() * Math.PI * 2,
        sp: speed * (0.6 + Math.random() * 0.8),
        spr: sprites[(Math.random() * sprites.length) | 0],
        layer: layer
      });
    }
  }

  /* 雾层：大而淡，几乎不转，铺出「纸上有雾」的底 */
  addBlobs(10, 260, 560, 330, 540, 0.05, 0.09, 0.5, 0);
  /* 主体：星云的中坚，差速旋转 */
  addBlobs(22, 120, 330, 150, 310, 0.08, 0.16, 1.0, 1);
  /* 近景：小而浓，转得最快 */
  addBlobs(16, 55, 150, 85, 175, 0.11, 0.20, 1.6, 2);

  /* 飞墨：小实心点，像被甩出去的墨滴 */
  var dots = [];
  for (var d = 0; d < Math.round(14 * density); d++) {
    dots.push({
      t: Math.random() * Math.PI * 2,
      r: 180 + Math.random() * 260,
      s: 1.2 + Math.random() * 2.4,
      a: 0.18 + Math.random() * 0.22,
      sp: 1.6 + Math.random() * 1.2
    });
  }

  /* 墨丝：沿螺旋被拉出的细线 */
  var strands = [];
  for (var s = 0; s < 8; s++) {
    strands.push({
      t0: Math.random() * Math.PI * 2,
      k: 0.7 + Math.random() * 0.6,
      r0: 80 + Math.random() * 130,
      drift: 140 + Math.random() * 160,
      len: 0.5 + Math.random() * 0.8,
      w: 0.8 + Math.random() * 1.3,
      a: 0.04 + Math.random() * 0.07,
      ph: Math.random() * Math.PI * 2
    });
  }

  /* ---------- 交互状态 ---------- */

  var mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  canvas.parentElement.addEventListener("pointermove", function (e) {
    var rc = canvas.getBoundingClientRect();
    mouse.tx = e.clientX - rc.left - CX;
    mouse.ty = e.clientY - rc.top - CY;
  }, { passive: true });

  /* ---------- 主循环 ---------- */

  var t0 = 0;
  var last = 0;
  var INTRO = 1600;

  function frame(now) {
    if (!t0) { t0 = now; last = now; }
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    var el = now - t0;
    /* 减少动态模式：直接渲染一帧「已安定」的静态墨，不流动 */
    var intro = reduce ? 1 : Math.min(el / INTRO, 1);
    var ease = 1 - Math.pow(1 - intro, 3);

    /* 鼠标视差平滑跟随，幅度很轻 */
    mouse.x += (mouse.tx - mouse.x) * 0.04;
    mouse.y += (mouse.ty - mouse.y) * 0.04;
    var px = Math.max(-16, Math.min(16, mouse.x * 0.06));
    var py = Math.max(-16, Math.min(16, mouse.y * 0.06));

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(CX + px, CY + py);

    /* 开场：一滴浓墨落进水里，晕开淡去 */
    if (intro < 1) {
      var drip = 1 - Math.pow(1 - Math.min(el / 1200, 1), 3);
      var dSize = (50 + drip * 340) * world;
      ctx.globalAlpha = 0.55 * (1 - drip);
      ctx.drawImage(sprites[2], -dSize / 2, -dSize / 2, dSize, dSize);
      ctx.globalAlpha = 1;
    }

    /* 墨团：差速旋转（内快外慢）+ 呼吸 */
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      /* 每个墨斑自己的角速度：越靠外越慢 → 螺旋被缠绕出水流感 */
      b.t += dt * b.sp * 34 / (44 + b.r);
      var breath = 1 + 0.15 * Math.sin(now * 0.00045 + b.ph);
      var fadeK = 0.72 + 0.28 * Math.sin(now * 0.0006 + b.ph * 1.7);
      var x = Math.cos(b.t) * b.r * world;
      var y = Math.sin(b.t) * b.r * world * 0.94;   /* 略压扁，星云更扁长 */
      var size = b.s * world * breath;
      ctx.globalAlpha = b.a * fadeK * ease;
      ctx.drawImage(b.spr, x - size / 2, y - size / 2, size, size);
    }

    /* 墨丝：螺旋细线，长度来回伸缩，像墨在水里被拉出来 */
    for (var j = 0; j < strands.length; j++) {
      var st = strands[j];
      var a = st.a * ease * (0.55 + 0.45 * Math.sin(now * 0.00035 + st.ph));
      if (a <= 0.01) continue;
      ctx.strokeStyle = "rgba(30,27,23," + a + ")";
      ctx.lineWidth = st.w;
      ctx.beginPath();
      var steps = 26;
      var reach = st.len * (0.65 + 0.35 * Math.sin(now * 0.0005 + st.ph));
      for (var k = 0; k <= steps; k++) {
        var th = st.t0 + el * 0.00004 * st.k + (k / steps) * reach;
        var rr = (st.r0 + (k / steps) * st.drift) * world;
        var sx = Math.cos(th) * rr;
        var sy = Math.sin(th) * rr * 0.94;
        if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      }
      ctx.stroke();
    }

    /* 飞墨：小墨点，转得最快，像从笔上甩出去的 */
    ctx.fillStyle = "rgba(30,27,23,1)";
    for (var m = 0; m < dots.length; m++) {
      var p = dots[m];
      p.t += dt * p.sp * 34 / (44 + p.r);
      var dx = Math.cos(p.t) * p.r * world;
      var dy = Math.sin(p.t) * p.r * world * 0.94;
      ctx.globalAlpha = p.a * ease;
      ctx.beginPath();
      ctx.arc(dx, dy, p.s * world, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
    ctx.globalAlpha = 1;

    if (!reduce) requestAnimationFrame(frame);
  }

  /* 页面切到后台时 rAF 自动暂停，回来时 dt 会被钳制，安全 */
  requestAnimationFrame(frame);
})();
