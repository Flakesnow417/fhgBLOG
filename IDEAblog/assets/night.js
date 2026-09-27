/* ============================================================
   一念未落 · 夜场（content 页全屏深夜背景 · Canvas 2D，无依赖）
   ------------------------------------------------------------
   给「想法集 / 关于 / 详情页」这些文字页铺一层深夜天幕：
     背景：深蓝紫竖直渐变 + 地平线微光 + 月晕
     顶上：星野（含两三颗流星，很久才划一颗）
     下面：极光带（青 / 品红两道，正弦起伏的面片）
     近处：贴着地平线的千禧霓虹网格（透视网格，往远处收）
     细节：CRT 扫描线 + 颗粒噪点 + 四角暗角

   全部用 Canvas 手绘，不引第三方库：
     - 页面双击打开（file://）也正常
     - 尊重系统「减少动态」：只画一帧静态图，不进动画循环
     - 窗口尺寸变了 / 切到后台：自动暂停与重排

   想改颜色，认下面 CFG 里的几个色值就够了。
   页面里需要 <canvas id="idea-night"></canvas> 和 body.night-bg。
   ============================================================ */
(function () {
  var canvas = document.getElementById("idea-night");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");

  var reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* 画布就绪 → body 换成深夜配色（文字、描边、卡片全部跟着变） */
  document.body.classList.add("idea-night-on");

  /* ---------- 可调色 ---------- */
  var CFG = {
    skyTop:  "#04060f",
    skyMid:  "#0a1128",
    skyLow:  "#131a3d",
    glow:    [90, 70, 190],      /* 地平线微光（冷紫） */
    cyan:    [46, 230, 255],     /* 青霓虹 */
    magenta: [255, 122, 217],    /* 品红霓虹 */
    gold:    [244, 210, 116],    /* 金 */
    star:    [214, 232, 255],
    horizon: 0.74                /* 地平线在画面高度的比例 */
  };

  /* ---------- 状态 ---------- */
  var W = 0, H = 0, DPR = 1, horizonY = 0;
  var stars = [], auroras = [], meteors = [], dust = [];
  var t0 = performance.now(), rafId = 0;

  function rgba(c, a) {
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }

  function mulberry(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 建场：星星 / 极光 / 光尘 ---------- */
  function build() {
    var rnd = mulberry(20260927);
    var i;

    /* 星星：越靠上越密，地平线附近稀疏 */
    stars = [];
    var starCount = Math.round((W * H) / 5200);
    starCount = Math.max(90, Math.min(360, starCount));
    for (i = 0; i < starCount; i++) {
      var sy = Math.pow(rnd(), 1.5) * horizonY * 0.94;
      stars.push({
        x: rnd() * W,
        y: sy,
        r: 0.4 + rnd() * 1.25,
        a: 0.28 + rnd() * 0.6,
        ph: rnd() * Math.PI * 2,
        sp: 0.5 + rnd() * 1.7,
        gold: rnd() > 0.88          /* 少数偏金的星 */
      });
    }

    /* 极光带：两道，横向正弦，慢慢起伏 */
    auroras = [
      { c: CFG.cyan,    x: -0.16 * W, w: 0.78 * W, y: horizonY * 0.30, h: H * 0.20, a: 0.20, ph: 0.0, amp: H * 0.030, sp: 0.11, rot: -0.055 },
      { c: CFG.magenta, x:  0.38 * W, w: 0.86 * W, y: horizonY * 0.15, h: H * 0.24, a: 0.16, ph: 1.9, amp: H * 0.038, sp: 0.08, rot:  0.048 }
    ];

    /* 光尘：贴近地平线的浮尘 */
    dust = [];
    var dustCount = Math.round(W / 16);
    dustCount = Math.max(30, Math.min(120, dustCount));
    for (i = 0; i < dustCount; i++) {
      dust.push({
        x: rnd() * W,
        y: horizonY + rnd() * (H - horizonY) * 0.85,
        r: 0.5 + rnd() * 1.7,
        a: 0.06 + rnd() * 0.16,
        sp: 0.15 + rnd() * 0.5,
        dx: (rnd() - 0.5) * 0.12
      });
    }

    meteors = [];
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.75);
    W = window.innerWidth;
    H = window.innerHeight;
    horizonY = H * CFG.horizon;

    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    build();
  }

  /* ---------- 各图层 ---------- */

  function paintSky() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, CFG.skyTop);
    g.addColorStop(0.46, CFG.skyMid);
    g.addColorStop(CFG.horizon - 0.04, CFG.skyLow);
    g.addColorStop(1, CFG.skyTop);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* 地平线微光：远处城市/霓虹的一层光雾 */
    var halo = ctx.createRadialGradient(W * 0.5, horizonY, 0, W * 0.5, horizonY, Math.max(W, H) * 0.6);
    halo.addColorStop(0, rgba(CFG.glow, 0.26));
    halo.addColorStop(0.42, rgba(CFG.glow, 0.08));
    halo.addColorStop(1, rgba(CFG.glow, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
  }

  function paintMoon(t) {
    var mx = W * 0.80, my = horizonY * 0.24;
    var mr = Math.min(W, H) * 0.035;

    var glow = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 8);
    glow.addColorStop(0, rgba(CFG.star, 0.30));
    glow.addColorStop(0.34, rgba([190, 214, 255], 0.10));
    glow.addColorStop(1, rgba([190, 214, 255], 0));
    ctx.fillStyle = glow;
    ctx.fillRect(mx - mr * 8, my - mr * 8, mr * 16, mr * 16);

    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(252,250,236,0.92)";
    ctx.fill();

    /* 月晕极缓地呼吸一下 */
    ctx.beginPath();
    ctx.arc(mx, my, mr * 1.9, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(CFG.star, 0.06 + 0.03 * Math.sin(t * 0.6));
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function paintStars(t) {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var a = s.a * (0.68 + 0.32 * Math.sin(t * s.sp + s.ph));
      var col = s.gold ? CFG.gold : CFG.star;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(col, a);
      ctx.fill();

      /* 亮星带一点十字光芒 */
      if (s.r > 1.3) {
        ctx.strokeStyle = rgba(col, a * 0.35);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(s.x - s.r * 3.2, s.y); ctx.lineTo(s.x + s.r * 3.2, s.y);
        ctx.moveTo(s.x, s.y - s.r * 3.2); ctx.lineTo(s.x, s.y + s.r * 3.2);
        ctx.stroke();
      }
    }
  }

  function paintAurora(t) {
    for (var i = 0; i < auroras.length; i++) {
      var A = auroras[i];
      ctx.save();
      ctx.translate(A.x + A.w / 2, A.y + A.h / 2);
      ctx.rotate(A.rot);
      var g = ctx.createLinearGradient(0, -A.h * 0.5, 0, A.h * 0.5);
      g.addColorStop(0, rgba(A.c, 0));
      g.addColorStop(0.45, rgba(A.c, A.a));
      g.addColorStop(1, rgba(A.c, 0));
      ctx.fillStyle = g;

      /* 一条起伏的面片：上下两条正弦包出来 */
      var seg = 26;
      ctx.beginPath();
      for (var k = 0; k <= seg; k++) {
        var p = k / seg;
        var x = (p - 0.5) * A.w;
        var w1 = Math.sin(p * Math.PI) * 0.7 + 0.3;
        var yTop = Math.sin(p * 5.2 + t * A.sp + A.ph) * A.amp - A.h * 0.5 * w1;
        if (k === 0) ctx.moveTo(x, yTop); else ctx.lineTo(x, yTop);
      }
      for (k = seg; k >= 0; k--) {
        p = k / seg;
        x = (p - 0.5) * A.w;
        w1 = Math.sin(p * Math.PI) * 0.7 + 0.3;
        var yBot = Math.sin(p * 4.1 + t * A.sp * 1.3 + A.ph) * A.amp + A.h * 0.34 * w1;
        ctx.lineTo(x, yBot);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function paintGrid(t) {
    /* 贴着地平线的透视网格：千禧年电子味的「底盘」 */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizonY, W, H - horizonY);
    ctx.clip();

    var cx = W * 0.5, cy = horizonY;
    var glowC = 0.16 + 0.05 * Math.sin(t * 0.9);
    var rows = 13, cols = 30;

    /* 横线：往近处越来越稀（透视） */
    for (var r = 0; r < rows; r++) {
      var p = r / rows;
      var y = cy + Math.pow(p, 2.1) * (H - cy) * 1.18;
      if (y > H + 2) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.strokeStyle = rgba(CFG.cyan, (1 - p) * glowC * 0.7 + 0.012);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    /* 竖线：从灭点放射出去 */
    for (var c = 0; c <= cols; c++) {
      var q = c / cols;
      var xNear = (q - 0.5) * (W * 2.6);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + xNear, H + 8);
      ctx.strokeStyle = rgba(CFG.magenta, glowC * 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function paintDust(t) {
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i];
      d.x += d.dx;
      d.y -= d.sp * 0.35;
      if (d.y < horizonY - 12) { d.y = H * 0.98; d.x = Math.random() * W; }
      if (d.x < -6) d.x = W + 6;
      if (d.x > W + 6) d.x = -6;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(CFG.cyan, d.a * (0.7 + 0.3 * Math.sin(t * 1.4 + i)));
      ctx.fill();
    }
  }

  function spawnMeteor() {
    var fromLeft = Math.random() > 0.5;
    meteors.push({
      x: fromLeft ? -40 : W + 40,
      y: horizonY * (0.04 + Math.random() * 0.42),
      vx: (fromLeft ? 1 : -1) * (3.4 + Math.random() * 2.6),
      vy: 1.1 + Math.random() * 0.9,
      life: 0,
      max: 150 + Math.random() * 90,
      len: 70 + Math.random() * 90
    });
  }

  function paintMeteors(t) {
    /* 平均每 7~13 秒划一颗，久到不会让人分心 */
    if (!reduce && Math.random() < 1 / (60 * 9)) spawnMeteor();

    for (var i = meteors.length - 1; i >= 0; i--) {
      var m = meteors[i];
      m.x += m.vx; m.y += m.vy; m.life++;
      var k = 1 - m.life / m.max;
      if (k <= 0 || m.y > horizonY || m.x < -W * 0.4 || m.x > W * 1.4) {
        meteors.splice(i, 1);
        continue;
      }
      var nx = m.vx / Math.hypot(m.vx, m.vy), ny = m.vy / Math.hypot(m.vx, m.vy);
      var g = ctx.createLinearGradient(m.x, m.y, m.x - nx * m.len, m.y - ny * m.len);
      g.addColorStop(0, rgba([235, 246, 255], 0.72 * k));
      g.addColorStop(1, rgba([160, 200, 255], 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - nx * m.len, m.y - ny * m.len);
      ctx.stroke();
    }
  }

  function paintVignette() {
    var g = ctx.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.34,
                                     W * 0.5, H * 0.5, Math.max(W, H) * 0.86);
    g.addColorStop(0, "rgba(2,4,10,0)");
    g.addColorStop(1, "rgba(2,4,10,0.72)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------- 主循环 ---------- */

  function frame(now) {
    var t = (now - t0) / 1000;

    paintSky();
    paintMoon(t);
    paintStars(t);
    paintAurora(t);
    paintMeteors(t);
    paintGrid(t);
    paintDust(t);
    paintVignette();

    rafId = requestAnimationFrame(frame);
  }

  function stop() { cancelAnimationFrame(rafId); rafId = 0; }
  function start() {
    if (rafId) return;
    if (reduce) { frame(t0); stop(); return; }   /* 静态一帧 */
    rafId = requestAnimationFrame(frame);
  }

  /* 切到后台就停，省电 */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  var rt = 0;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(resize, 160);
  });

  resize();
  start();
})();
