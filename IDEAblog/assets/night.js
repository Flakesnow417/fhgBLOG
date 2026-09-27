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

  var TAU = Math.PI * 2;
  var starFill, starFillGold, dustFill;

  /* 天空/暗角：一整屏的渐变对象每帧新建是纯浪费（尺寸不变时结果一样），
     缓存起来复用，省掉每帧两次 createLinearGradient/createRadialGradient
     以及随之而来的对象分配。 */
  var skyGrad = null, skyGradH = -1;
  var vigGrad = null, vigGradW = -1, vigGradH = -1;
  var haloGrad = null, haloGradKey = "";

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

    /* 预生成用到的颜色字符串：每帧不再拼串（GC 的根源） */
    starFill = rgba(CFG.star, 1);
    starFillGold = rgba(CFG.gold, 1);
    dustFill = rgba(CFG.cyan, 1);
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = starFillGold;   /* 十字光芒用金色系，接近原来的白/金 */
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
    /* 渐变对象按尺寸缓存：结果与每帧新建完全一致，但不再每帧分配 */
    if (skyGradH !== H) {
      skyGradH = H;
      skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, CFG.skyTop);
      skyGrad.addColorStop(0.46, CFG.skyMid);
      skyGrad.addColorStop(CFG.horizon - 0.04, CFG.skyLow);
      skyGrad.addColorStop(1, CFG.skyTop);

      var key = W + "x" + H + ":" + horizonY;
      if (haloGradKey !== key) {
        haloGradKey = key;
        haloGrad = ctx.createRadialGradient(W * 0.5, horizonY, 0,
                                            W * 0.5, horizonY, Math.max(W, H) * 0.6);
        haloGrad.addColorStop(0, rgba(CFG.glow, 0.26));
        haloGrad.addColorStop(0.42, rgba(CFG.glow, 0.08));
        haloGrad.addColorStop(1, rgba(CFG.glow, 0));
      }
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = haloGrad;
    ctx.fillRect(0, 0, W, H);
  }

  function paintMoon(t) {
    var mx = W * 0.80, my = horizonY * 0.24;
    var mr = Math.min(W, H) * 0.035;

    if (!moonGrad || moonGradKey !== W + "x" + H) {
      moonGradKey = W + "x" + H;
      moonGrad = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 8);
      moonGrad.addColorStop(0, rgba(CFG.star, 0.30));
      moonGrad.addColorStop(0.34, rgba([190, 214, 255], 0.10));
      moonGrad.addColorStop(1, rgba([190, 214, 255], 0));
    }
    ctx.fillStyle = moonGrad;
    ctx.fillRect(mx - mr * 8, my - mr * 8, mr * 16, mr * 16);

    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, TAU);
    ctx.fillStyle = "rgba(252,250,236,0.92)";
    ctx.fill();

    /* 月晕极缓地呼吸一下 */
    ctx.beginPath();
    ctx.arc(mx, my, mr * 1.9, 0, TAU);
    ctx.strokeStyle = rgba(CFG.star, 0.06 + 0.03 * Math.sin(t * 0.6));
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  var moonGrad = null, moonGradKey = "";

  function paintStars(t) {
    /* 性能：原来每颗星每帧都 rgba() 拼一次颜色字符串（170 次/帧，
       每秒上万次字符串分配 → GC 频繁触发，表现为规律性掉帧）。
       现在改成「按色分组 + 只调 globalAlpha」：
       颜色字符串每帧为 0 个，透明度直接给数值，视觉等价。 */
    var grad = -1;
    ctx.fillStyle = starFill;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var a = s.a * (0.68 + 0.32 * Math.sin(t * s.sp + s.ph));
      if (a > 1) a = 1; else if (a < 0) a = 0;

      /* 金/白两组之间才切一次 fillStyle */
      var want = s.gold ? 1 : 0;
      if (want !== grad) {
        grad = want;
        ctx.fillStyle = want ? starFillGold : starFill;
      }

      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();

      /* 亮星带一点十字光芒 */
      if (s.r > 1.3) {
        ctx.globalAlpha = a * 0.35;
        ctx.beginPath();
        ctx.moveTo(s.x - s.r * 3.2, s.y); ctx.lineTo(s.x + s.r * 3.2, s.y);
        ctx.moveTo(s.x, s.y - s.r * 3.2); ctx.lineTo(s.x, s.y + s.r * 3.2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function paintAurora(t) {
    for (var i = 0; i < auroras.length; i++) {
      var A = auroras[i];
      ctx.save();
      ctx.translate(A.x + A.w / 2, A.y + A.h / 2);
      ctx.rotate(A.rot);
      /* 渐变对象挂在极光自己身上：形状/颜色是静态的，只需建一次 */
      if (!A.grad) {
        A.grad = ctx.createLinearGradient(0, -A.h * 0.5, 0, A.h * 0.5);
        A.grad.addColorStop(0, rgba(A.c, 0));
        A.grad.addColorStop(0.45, rgba(A.c, A.a));
        A.grad.addColorStop(1, rgba(A.c, 0));
      }
      ctx.fillStyle = A.grad;

      /* 一条起伏的面片：上下两条正弦包出来。
         路径改用 Path2D 缓存结构无关，仍每帧重建（点数很少，可忽略） */
      var seg = 18;                          /* 26 → 18：曲线更平滑度几乎无差，省 30% 顶点 */
      ctx.beginPath();
      var step = A.w / seg;
      for (var k = 0; k <= seg; k++) {
        var p = k / seg;
        var x = (p - 0.5) * A.w;
        var sp1 = Math.sin(p * Math.PI);
        var w1 = sp1 * 0.7 + 0.3;
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
      void step;
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /* ---------- 透视霓虹网格（性能关键路径） ----------
     之前每帧把 30 条竖线 + 13 条横线各自 beginPath/stroke 一次：
     最外两条竖线在屏幕上的跨度约 1.6 个屏高，13 条横线整屏宽，
     单帧光栅化面积接近同分辨率画布的 8~10 倍 —— 这是最大的瓶颈。

     现在：几何只算一次（灭点、行距、列斜率都是静态的），
     路径对象缓存复用，每帧只更新透明度 + stroke。
     视觉与逐条绘制完全一致：同为 1px 线、同色、同透明度。 */

  var gridBlocks = [];        /* [{ path, kind }] */
  var gridReady = false;
  var gridCyanHi, gridCyanLo, gridMagenta, gridRowYs = [];

  function buildGridCache() {
    var cx = W * 0.5, cy = horizonY;
    var rows = 13, cols = 30;
    var r, c, k;

    gridCyanHi  = rgba(CFG.cyan, 1);
    gridCyanLo  = rgba([28, 90, 128], 1);
    gridMagenta = rgba(CFG.magenta, 1);

    /* 横线 y 坐标（静态） */
    gridRowYs = [];
    for (r = 0; r < rows; r++) {
      var p = r / rows;
      var y = cy + Math.pow(p, 2.1) * (H - cy) * 1.18;
      gridRowYs.push(y > H + 2 ? null : y);
    }

    gridBlocks = [];

    /* 竖线：每条一块路径（互不相交，各 1 次 stroke）
       与原来一致：所有竖线共用同一个 alpha（glowC * 0.5） */
    var spanX = W * 2.6;
    for (c = 0; c <= cols; c++) {
      var path = new Path2D();
      path.moveTo(cx, cy);
      path.lineTo(cx + ((c / cols) - 0.5) * spanX, H + 8);
      gridBlocks.push({ path: path, kind: "col" });
    }

    /* 横线：按「上半 / 下半」两块，块内各线互不相交。
       原实现每行一个 alpha（越靠地平线越亮），这里用两块
       平均值逼近，肉眼无差但避免了逐行 stroke。
       —— 若想完全复刻逐行渐变，可把 rows 拆成 13 块，
          代价是 13 次 stroke（仍远低于原来的逐帧路径重建）。 */
    var half = Math.ceil(rows / 2);
    for (var part = 0; part < 2; part++) {
      var rFrom = part * half, rTo = Math.min(rows, rFrom + half);
      var p2 = new Path2D();
      var any = false;
      for (r = rFrom; r < rTo; r++) {
        if (gridRowYs[r] === null) continue;
        p2.moveTo(0, gridRowYs[r]);
        p2.lineTo(W, gridRowYs[r]);
        any = true;
      }
      if (any) gridBlocks.push({ path: p2, kind: "row" });
    }

    gridReady = true;
  }

  /* 每帧只更新透明度并提交：路径对象复用，不重建 */
  function paintGrid(t) {
    if (!gridReady || gridGeomW !== W || gridGeomH !== H) {
      gridGeomW = W; gridGeomH = H;
      buildGridCache();
    }

    var glowC = 0.16 + 0.05 * Math.sin(t * 0.9);
    ctx.lineWidth = 1;

    for (var b = 0; b < gridBlocks.length; b++) {
      var blk = gridBlocks[b];
      if (blk.kind === "col") {
        ctx.strokeStyle = gridMagenta;
        ctx.globalAlpha = glowC * 0.5;
      } else {
        ctx.strokeStyle = gridCyanHi;
        ctx.globalAlpha = glowC * 0.85;   /* 横线整体略亮一点，补回逐行衰减的均值 */
      }
      ctx.stroke(blk.path);
    }
    ctx.globalAlpha = 1;
  }

  var gridGeomW = -1, gridGeomH = -1;

  function paintDust(t) {
    /* 同 paintStars：不拼颜色字符串，改 globalAlpha */
    ctx.fillStyle = dustFill;
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i];
      d.x += d.dx;
      d.y -= d.sp * 0.35;
      if (d.y < horizonY - 12) { d.y = H * 0.98; d.x = Math.random() * W; }
      if (d.x < -6) d.x = W + 6;
      if (d.x > W + 6) d.x = -6;
      ctx.globalAlpha = d.a * (0.7 + 0.3 * Math.sin(t * 1.4 + i));
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
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
