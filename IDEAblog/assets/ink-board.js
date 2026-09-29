/* ============================================================
   一局墨棋 · 水墨宣纸棋盘（Canvas 2D，零依赖）
   ------------------------------------------------------------
   为什么是 Canvas 2D 而不是 Three.js：
     毛笔线条的枯笔飞白、墨渍的自然扩散、宣纸的纤维吸墨感，
     本质都是"二维笔触 + 像素级混合"。用 3D 几何体做不出墨晕，
     所以这一版把棋盘整个搬回 2D 纸面。

   全部程序生成，不依赖任何外部图片 —— 双击 file:// 也不会丢图。

   结构：
     ① 宣纸底      paperTexture()   泛黄纤维 + 深浅斑
     ② 墨云虚化    inkCloud()       边缘水墨晕染（吃掉硬直角）
     ③ 网格        drawGrid()       枯笔细淡墨线，带飞白断笔
     ④ 棋子        drawStone()      浓墨团 / 淡墨留白圆 + 边缘墨晕
     ⑤ 涟漪        ripples[]        落子瞬间向外扩散的淡墨圈
     ⑥ 选中        drawSelect()     极浅墨色高亮 + 呼吸
     ⑦ 四角装饰    drawOrnaments()  淡墨山石云纹（不抢主体）

   对外只用三个钩子：
     window.InkBoard.init(canvas, ideas)   初始化并喂数据
     window.InkBoard.select(index)         高亮某枚棋子
     window.InkBoard.onPick = fn           点击棋子的回调
   ============================================================ */
(function () {
  "use strict";

  var TAU = Math.PI * 2;

  /* 随机数：固定种子，保证每次刷新纸纹一致（不会闪） */
  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

  /* ------------------------------------------------------ 配置 */

  var CFG = {
    paper:   [242, 237, 224],   /* 宣纸米白（和页面 --xuan 同源） */
    paperB:  [231, 224, 206],   /* 纸的暗部 */
    ink:     [28, 26, 23],      /* 焦墨：黑子、主线条 */
    inkMid:  [74, 70, 64],      /* 重墨：次级 */
    inkPale: [138, 132, 120],   /* 淡墨：网格、晕染 */
    zhe:     [166, 124, 82],    /* 浅赭：暖点缀 */
    qing:    [96, 122, 138],    /* 石青：冷点缀 */
    zhu:     [168, 50, 45]      /* 朱砂：只用在印章/当下落点 */
  };

  /* 8×8 棋盘的 16 个落子位（4 行 × 4 列，居中留白）。
     水墨画最忌铺满，所以只占中间一小块。 */
  var GRID = 8;
  var SLOTS = [
    [1, 1], [3, 1], [5, 1], [6, 1],
    [2, 2], [4, 2], [5, 2], [6, 2],
    [1, 3], [2, 3], [4, 3], [6, 3],
    [2, 4], [3, 4], [4, 4], [5, 4]
  ];

  /* ------------------------------------------------- ① 宣纸底 */

  var paperCanvas = null;

  function paperTexture(w, h, seed) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var g = c.getContext("2d");
    var rnd = mulberry(seed || 20260927);

    /* 底色：中间亮、四周略沉，模拟纸的吸光不均 */
    g.fillStyle = "rgb(" + CFG.paper.join(",") + ")";
    g.fillRect(0, 0, w, h);
    var vg = g.createRadialGradient(w * 0.5, h * 0.42, Math.min(w, h) * 0.1,
                                    w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    vg.addColorStop(0, "rgba(" + CFG.paperB.join(",") + ",0)");
    vg.addColorStop(1, "rgba(" + CFG.paperB.join(",") + ",0.55)");
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);

    /* 纸浆斑块：大小不一的极淡色团，像手工纸的厚薄不均 */
    var i, x, y, r;
    for (i = 0; i < 90; i++) {
      x = rnd() * w; y = rnd() * h; r = 20 + rnd() * 130;
      var pg = g.createRadialGradient(x, y, 0, x, y, r);
      var warm = rnd() > 0.45;
      var col = warm ? CFG.zhe : CFG.paperB;
      pg.addColorStop(0, "rgba(" + col.join(",") + "," + (0.012 + rnd() * 0.026) + ")");
      pg.addColorStop(1, "rgba(" + col.join(",") + ",0)");
      g.fillStyle = pg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    /* 纸纤维：短促的细线，方向随机，给"手工纸"的触感 */
    g.lineWidth = 0.6;
    for (i = 0; i < 1600; i++) {
      x = rnd() * w; y = rnd() * h;
      var a = rnd() * TAU, len = 2 + rnd() * 9;
      g.strokeStyle = "rgba(" + CFG.inkPale.join(",") + "," + (0.03 + rnd() * 0.05) + ")";
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }

    /* 深色麻点：手工纸里偶尔的杂质 */
    for (i = 0; i < 220; i++) {
      x = rnd() * w; y = rnd() * h;
      g.fillStyle = "rgba(" + CFG.inkMid.join(",") + "," + (0.05 + rnd() * 0.10) + ")";
      g.beginPath();
      g.arc(x, y, 0.5 + rnd() * 1.4, 0, TAU);
      g.fill();
    }

    /* 四角压暗：让纸有"摊在桌面上"的边角感 */
    var corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
    var cg = g.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.32,
                                    w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    cg.addColorStop(0, "rgba(" + CFG.paperB.join(",") + ",0)");
    cg.addColorStop(1, "rgba(" + CFG.inkMid.join(",") + ",0.10)");
    g.fillStyle = cg;
    g.fillRect(0, 0, w, h);
    void corners;

    return c;
  }

  /* --------------------------------------- ② 墨云：边缘晕染虚化 */

  /* 在棋盘四边叠一层不规则淡墨，把方正的边角"吃"掉。
     这是水墨画的关键手法：不起稿画框，让墨自然化开。
     角上刻意加重——"不生硬直角"靠的就是这里。 */
  function inkCloud(g, w, h, rnd) {
    function wash(cx, cy, rx, ry, alpha) {
      var rg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
      rg.addColorStop(0, "rgba(" + CFG.inkPale.join(",") + "," + alpha + ")");
      rg.addColorStop(0.42, "rgba(" + CFG.inkPale.join(",") + "," + (alpha * 0.55) + ")");
      rg.addColorStop(0.75, "rgba(" + CFG.inkPale.join(",") + "," + (alpha * 0.20) + ")");
      rg.addColorStop(1, "rgba(" + CFG.inkPale.join(",") + ",0)");
      g.save();
      g.translate(cx, cy);
      g.scale(1, ry / Math.max(rx, ry));
      g.translate(-cx, -cy);
      g.fillStyle = rg;
      g.fillRect(cx - rx * 1.2, cy - rx * 1.2, rx * 2.4, rx * 2.4);
      g.restore();
    }

    var edge = Math.min(w, h);
    var i, t, cx, cy, rr;

    /* 四边：沿边走一串大小不等的墨团（数量与浓度都加大） */
    for (i = 0; i < 22; i++) {
      t = i / 21;
      wash(t * w, (rnd() - 0.5) * edge * 0.03,
           edge * (0.13 + rnd() * 0.18), edge * (0.07 + rnd() * 0.10),
           0.040 + rnd() * 0.048);
      wash(t * w, h + (rnd() - 0.5) * edge * 0.03,
           edge * (0.13 + rnd() * 0.19), edge * (0.07 + rnd() * 0.11),
           0.044 + rnd() * 0.052);
    }
    for (i = 0; i < 18; i++) {
      t = i / 17;
      wash((rnd() - 0.5) * edge * 0.03, t * h,
           edge * (0.09 + rnd() * 0.14), edge * (0.13 + rnd() * 0.18),
           0.038 + rnd() * 0.044);
      wash(w + (rnd() - 0.5) * edge * 0.03, t * h,
           edge * (0.09 + rnd() * 0.15), edge * (0.13 + rnd() * 0.19),
           0.038 + rnd() * 0.046);
    }

    /* 四角：内外两层加重，角上的虚化最明显 —— 直角就化在这里 */
    var corners = [[0, 0, 1, 1], [w, 0, 1, 1], [0, h, 1, 1], [w, h, 1, 1]];
    for (i = 0; i < corners.length; i++) {
      cx = corners[i][0]; cy = corners[i][1];
      rr = edge * (0.22 + rnd() * 0.12);
      wash(cx, cy, rr, rr * (0.85 + rnd() * 0.5), 0.070 + rnd() * 0.038);
      rr = edge * (0.10 + rnd() * 0.06);
      wash(cx, cy, rr, rr * (0.9 + rnd() * 0.4), 0.055 + rnd() * 0.030);
    }

    /* 墨雾：几团横贯纸面的极淡墨，制造"烟云"的流动感 */
    for (i = 0; i < 5; i++) {
      var my = h * (0.18 + rnd() * 0.66);
      var mx = w * (0.15 + rnd() * 0.7);
      var mw = edge * (0.42 + rnd() * 0.40);
      wash(mx, my, mw, mw * (0.20 + rnd() * 0.16), 0.016 + rnd() * 0.016);
    }
  }

  /* --------------------------------------------- ③ 网格：枯笔线 */

  /* 一条"毛笔线"：主笔 + 若干偏移的淡笔，中间随机断（飞白）。
     平滑直线是矢量感，断笔与抖动才是手绘感。 */
  function brushLine(g, x0, y0, x1, y1, rnd, opt) {
    opt = opt || {};
    var base = opt.width || 1.1;
    var alpha = opt.alpha || 0.20;
    var col = opt.color || CFG.inkPale;
    var segs = 26;
    var wob = opt.wobble || 1.1;
    var strokes = opt.strokes || 2;

    for (var s = 0; s < strokes; s++) {
      var off = (rnd() - 0.5) * wob * 2;
      var a = alpha * (s === 0 ? 1 : 0.5);
      var lw = base * (s === 0 ? 1 : 0.7);
      var run = false;
      g.beginPath();
      for (var i = 0; i <= segs; i++) {
        var t = i / segs;
        var nx = lerp(x0, x1, t), ny = lerp(y0, y1, t);
        /* 垂直于线方向抖动，越靠两端越抖（起收笔的颤） */
        var edgeK = 0.4 + 0.6 * Math.abs(t - 0.5) * 2;
        var dx = nx + wob * (rnd() - 0.5) * 0.5 * edgeK + (y1 - y0 === 0 ? 0 : off * 0.2);
        var dy = ny + wob * (rnd() - 0.5) * 0.5 * edgeK + (x1 - x0 === 0 ? 0 : off * 0.2);
        /* 飞白：随机断笔，断处不留墨 */
        if (rnd() < 0.055) { run = false; continue; }
        if (!run) { g.moveTo(dx, dy); run = true; }
        else g.lineTo(dx, dy);
      }
      g.strokeStyle = "rgba(" + col.join(",") + "," + a + ")";
      g.lineWidth = lw;
      g.lineCap = "round";
      g.stroke();
    }
  }

  /* 网格：细淡墨线，四边不封口（留白，也是水墨的做法）。
     手绘感来自两处：① 整体坐标系的轻微歪斜（人画不出正矩形）
     ② 每条线自身的抖动与飞白断笔。

     关键：歪斜必须"算一次、存下来"，让棋子和网格共用同一张网，
     否则棋会落在线外面。所以这里只用 box._at（layout 时已建好）。 */
  function drawGrid(g, box, rnd) {
    var i, t;
    var inset = box.w * 0.05;      /* 线的起收都收进来一点，不顶到头 */
    var at = box._at;
    if (!at) return;

    for (i = 0; i <= GRID; i++) {
      t = i / GRID;
      /* 竖线：从 (t,0) 到 (t,1)，起收各留空隙 */
      var a = at(t, inset / box.h), b = at(t, 1 - inset / box.h);
      brushLine(g, a.x, a.y, b.x, b.y, rnd,
                { width: 1.0, alpha: 0.17, wobble: 1.5 });
      /* 横线：从 (0,t) 到 (1,t) */
      var c = at(inset / box.w, t), d = at(1 - inset / box.w, t);
      brushLine(g, c.x, c.y, d.x, d.y, rnd,
                { width: 1.0, alpha: 0.17, wobble: 1.5 });
    }
  }

  /* 建立"歪斜坐标系"：四角各自漂移，双线性插值出整张网。
     返回 (u,v) → 实际像素坐标的函数。网格与棋子都用它。 */
  function makeWarp(box, seed) {
    var rnd = mulberry(seed);
    var sk = box.w * 0.016;        /* 漂移幅度：看得出歪，但不像画错 */
    var c0 = { x: box.x + (rnd() - 0.5) * sk, y: box.y + (rnd() - 0.5) * sk };
    var c1 = { x: box.x + box.w + (rnd() - 0.5) * sk, y: box.y + (rnd() - 0.5) * sk };
    var c2 = { x: box.x + (rnd() - 0.5) * sk, y: box.y + box.h + (rnd() - 0.5) * sk };
    var c3 = { x: box.x + box.w + (rnd() - 0.5) * sk, y: box.y + box.h + (rnd() - 0.5) * sk };
    return function (u, v) {
      var tx = lerp(c0.x, c1.x, u), ty = lerp(c0.y, c1.y, u);
      var bx = lerp(c2.x, c3.x, u), by = lerp(c2.y, c3.y, u);
      return { x: lerp(tx, bx, v), y: lerp(ty, by, v) };
    };
  }

  /* ----------------------------------------- ④ 棋子：墨团与留白 */

  /* 黑子 = 浓墨团：中心实、边缘化开，带几处不规则外溢（墨渍）。
     刻意做得"脏"一点：墨点不该是完美的圆，运笔的轻重、纸的吸墨
     都会让边缘不匀。 */
  function drawBlackStone(g, x, y, r, alpha, rnd) {
    alpha = alpha === undefined ? 1 : alpha;
    g.save();
    g.globalAlpha = alpha;

    /* 外晕：三层由深到浅，营造"墨在纸上洇开" */
    for (var k = 0; k < 3; k++) {
      var rr = r * (k === 0 ? 1.26 : (k === 1 ? 1.54 : 1.92));
      var rg = g.createRadialGradient(x, y, r * 0.45, x, y, rr);
      var a0 = k === 0 ? 0.40 : (k === 1 ? 0.20 : 0.09);
      rg.addColorStop(0, "rgba(" + CFG.ink.join(",") + "," + a0 + ")");
      rg.addColorStop(0.58, "rgba(" + CFG.ink.join(",") + "," + (a0 * 0.34) + ")");
      rg.addColorStop(1, "rgba(" + CFG.ink.join(",") + ",0)");
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x, y, rr, 0, TAU);
      g.fill();
    }

    /* 墨渍外溢：写意的关键是"低频大轮廓"，不是高频锯齿。
       只用两根低频正弦（整体不圆 + 一处偏心鼓起），
       保留圆润感；高频抖动一律去掉，否则边缘会变海胆。 */
    var lobes = 3 + Math.floor(rnd() * 3);
    var ph1 = rnd() * TAU, ph2 = rnd() * TAU;
    var bulge = rnd() * TAU;                  /* 鼓起来的那一边 */

    function outline(scale) {
      var pts = [];
      for (var i = 0; i <= 96; i++) {
        var a = (i / 96) * TAU;
        /* 低频起伏 + 单向偏心（像笔尖按重了往一边推） */
        var w = 1 + Math.sin(a * lobes + ph1) * 0.075
                  + Math.sin(a * 2 + ph2) * 0.030
                  + Math.cos(a - bulge) * 0.045;
        pts.push([x + Math.cos(a) * r * scale * w,
                  y + Math.sin(a) * r * scale * w]);
      }
      return pts;
    }

    /* 把点列描成闭合路径（避免在各处重复写循环、也避免变量泄漏） */
    function trace(pts) {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (var k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
      g.closePath();
    }

    /* 外层：略大、略淡，是墨被挤出去的边 */
    g.fillStyle = "rgba(" + CFG.ink.join(",") + ",0.86)";
    trace(outline(1.04));
    g.fill();

    /* 内层浓墨：偏一点，让墨团有"落笔那一下"的重心 */
    var coreX = x - r * 0.10, coreY = y - r * 0.12;
    var cg = g.createRadialGradient(coreX, coreY, 0, x, y, r * 1.0);
    cg.addColorStop(0, "rgba(" + CFG.ink.join(",") + ",1)");
    cg.addColorStop(0.66, "rgba(" + CFG.ink.join(",") + ",0.98)");
    cg.addColorStop(1, "rgba(" + CFG.ink.join(",") + ",0.84)");
    g.fillStyle = cg;
    trace(outline(0.94));
    g.fill();

    /* 飞白：墨团里留一两道没吃透墨的干笔痕 */
    if (rnd() > 0.35) {
      g.strokeStyle = "rgba(" + CFG.paper.join(",") + ",0.15)";
      g.lineWidth = r * 0.10;
      g.lineCap = "round";
      var fa = rnd() * TAU, fl = r * (0.5 + rnd() * 0.5);
      g.beginPath();
      g.moveTo(coreX - Math.cos(fa) * fl * 0.45, coreY - Math.sin(fa) * fl * 0.45);
      g.lineTo(coreX + Math.cos(fa) * fl * 0.55, coreY + Math.sin(fa) * fl * 0.55);
      g.stroke();
    }

    /* 一点极淡的高光：不是塑料反光，是纸面没吃透墨的透气感 */
    var hg = g.createRadialGradient(coreX - r * 0.05, coreY - r * 0.07, 0,
                                    coreX - r * 0.05, coreY - r * 0.07, r * 0.40);
    hg.addColorStop(0, "rgba(255,253,246,0.14)");
    hg.addColorStop(1, "rgba(255,253,246,0)");
    g.fillStyle = hg;
    g.beginPath();
    g.arc(x, y, r * 0.40, 0, TAU);
    g.fill();

    g.restore();
  }

  /* 白子 = 淡墨留白圆：只有一圈很淡的墨边，中间是纸色（留白）。
     边线不闭合、粗细有变，像随笔圈了一下。 */
  function drawWhiteStone(g, x, y, r, alpha, rnd) {
    alpha = alpha === undefined ? 1 : alpha;
    g.save();
    g.globalAlpha = alpha;

    /* 外晕：比黑子更淡，像轻轻按了一下 */
    var rg = g.createRadialGradient(x, y, r * 0.55, x, y, r * 1.72);
    rg.addColorStop(0, "rgba(" + CFG.inkPale.join(",") + ",0.24)");
    rg.addColorStop(0.55, "rgba(" + CFG.inkPale.join(",") + ",0.09)");
    rg.addColorStop(1, "rgba(" + CFG.inkPale.join(",") + ",0)");
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, r * 1.72, 0, TAU);
    g.fill();

    /* 留白：填纸色，压掉底下的网格线（"白"是留出来的，不是画出来的） */
    g.fillStyle = "rgba(250,247,238,0.90)";
    g.beginPath();
    g.arc(x, y, r * 0.97, 0, TAU);
    g.fill();

    /* 内晕：留白不该是空的。中心一层极淡的墨色慢慢化开，
       这是"淡墨留白圆"和"镂空圆环"的区别所在。 */
    var ig = g.createRadialGradient(x - r * 0.08, y - r * 0.06, 0, x, y, r * 1.0);
    ig.addColorStop(0, "rgba(" + CFG.inkPale.join(",") + ",0.115)");
    ig.addColorStop(0.50, "rgba(" + CFG.inkPale.join(",") + ",0.072)");
    ig.addColorStop(0.82, "rgba(" + CFG.inkPale.join(",") + ",0.030)");
    ig.addColorStop(1, "rgba(" + CFG.inkPale.join(",") + ",0.010)");
    g.fillStyle = ig;
    g.beginPath();
    g.arc(x, y, r * 0.97, 0, TAU);
    g.fill();

    /* 墨边：一笔不闭合的弧线，两端渐隐（收笔的自然形状）。
       做法：整段弧一次画完，用 globalAlpha 控制浓淡。
       早先试过"分段描边做粗细渐变"，但极细线宽 + 分段 arc
       在抗锯齿下会串色（白边发蓝），所以改成单次描边。
       粗细变化交给两笔错落的弧线来体现。 */
    var start = rnd() * TAU;
    var span = TAU * (0.54 + rnd() * 0.28);

    g.lineCap = "round";

    /* 主笔：浓一点、粗一点，近看要能看出是"画了一圈" */
    g.lineWidth = r * 0.185;
    g.strokeStyle = "rgba(" + CFG.inkMid.join(",") + ",0.82)";
    g.beginPath();
    g.arc(x, y, r * 0.90, start, start + span);
    g.stroke();

    /* 收笔：一小段更淡更细的，像是笔锋拖出来的尾 */
    g.lineWidth = r * 0.095;
    g.strokeStyle = "rgba(" + CFG.inkPale.join(",") + ",0.62)";
    g.beginPath();
    g.arc(x, y, r * 0.90, start + span + 0.08, start + span + 0.58);
    g.stroke();

    /* 起笔：缺口另一侧一点淡痕，闭合视觉上的圆 */
    g.lineWidth = r * 0.085;
    g.strokeStyle = "rgba(" + CFG.inkPale.join(",") + ",0.46)";
    g.beginPath();
    g.arc(x, y, r * 0.90, start - 0.42, start - 0.04);
    g.stroke();

    /* 淡墨心：一点点灰，避免留白太空 */
    var cg = g.createRadialGradient(x - r * 0.14, y - r * 0.14, 0, x, y, r * 0.85);
    cg.addColorStop(0, "rgba(" + CFG.inkPale.join(",") + ",0.070)");
    cg.addColorStop(1, "rgba(" + CFG.inkPale.join(",") + ",0.018)");
    g.fillStyle = cg;
    g.beginPath();
    g.arc(x, y, r * 0.85, 0, TAU);
    g.fill();

    g.restore();
  }

  /* ------------------------------------------- ⑤ 涟漪：墨的扩散 */

  /* 落子瞬间：一圈淡墨从棋子位置向外化开，逐渐变淡变粗。
     用两圈错开的相位，像墨在水里散开的层次。 */
  function drawRipple(g, x, y, r0, p) {
    for (var k = 0; k < 2; k++) {
      var pp = p - k * 0.18;
      if (pp <= 0 || pp >= 1) continue;
      var e = ease(pp);
      var r = r0 * lerp(1.0, 3.4, e);
      var a = (1 - e) * (1 - e) * (k === 0 ? 0.26 : 0.15);
      g.strokeStyle = "rgba(" + CFG.inkPale.join(",") + "," + a + ")";
      g.lineWidth = lerp(2.2, 0.6, e);
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.stroke();
    }
  }

  /* --------------------------------------- ⑥ 选中：极浅墨色高亮 */

  function drawSelect(g, x, y, r, phase) {
    /* 呼吸的极淡墨圈 + 四个角的小记号（像画谱上的批注） */
    var pulse = 0.5 + 0.5 * Math.sin(phase);
    var rr = r * (1.52 + pulse * 0.10);
    g.strokeStyle = "rgba(" + CFG.inkPale.join(",") + "," + (0.20 + pulse * 0.14) + ")";
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(x, y, rr, 0, TAU);
    g.stroke();

    var rg = g.createRadialGradient(x, y, r * 0.8, x, y, rr * 1.5);
    rg.addColorStop(0, "rgba(" + CFG.zhe.join(",") + "," + (0.05 + pulse * 0.05) + ")");
    rg.addColorStop(1, "rgba(" + CFG.zhe.join(",") + ",0)");
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, rr * 1.5, 0, TAU);
    g.fill();
  }

  /* ------------------------------------- ⑦ 四角：淡墨山石与云纹 */

  /* 远山：两笔起伏的墨影，下缘晕开（山从雾里长出来） */
  function drawHill(g, cx, baseY, w, h, rnd, alpha) {
    g.save();
    g.globalAlpha = alpha;
    var pts = [], i, n = 22;
    for (i = 0; i <= n; i++) {
      var t = i / n;
      var y = baseY - h * (
        Math.sin(t * Math.PI * 1.15) * 0.72 +
        Math.sin(t * Math.PI * 2.6 + 0.7) * 0.22 +
        rnd() * 0.06
      );
      pts.push([cx - w / 2 + w * t, y]);
    }
    /* 山体：上缘是曲线，下缘直接化进纸里 */
    var grad = g.createLinearGradient(0, baseY - h, 0, baseY + h * 0.5);
    grad.addColorStop(0, "rgba(" + CFG.inkPale.join(",") + ",0.30)");
    grad.addColorStop(0.55, "rgba(" + CFG.inkPale.join(",") + ",0.14)");
    grad.addColorStop(1, "rgba(" + CFG.inkPale.join(",") + ",0)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.lineTo(cx + w / 2, baseY + h * 0.9);
    g.lineTo(cx - w / 2, baseY + h * 0.9);
    g.closePath();
    g.fill();

    /* 山脊：一笔略重的线，带飞白 */
    brushLine(g, pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1],
              rnd, { width: 0.9, alpha: 0.20 * alpha, wobble: 1.6, color: CFG.inkMid });
    g.restore();
  }

  /* 云纹：三道平行的短弧，传统云纹的极简写法 */
  function drawCloud(g, cx, cy, w, rnd, alpha) {
    g.save();
    g.globalAlpha = alpha;
    for (var k = 0; k < 3; k++) {
      var yy = cy + k * w * 0.14;
      var ww = w * (1 - k * 0.16);
      g.strokeStyle = "rgba(" + CFG.inkPale.join(",") + "," + (0.22 - k * 0.05) + ")";
      g.lineWidth = 0.9;
      g.lineCap = "round";
      g.beginPath();
      for (var i = 0; i <= 20; i++) {
        var t = i / 20;
        var x = cx - ww / 2 + ww * t;
        var y = yy - Math.sin(t * Math.PI) * w * 0.10 + (rnd() - 0.5) * 0.7;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.restore();
  }

  /* ---------------------------------------------------- 棋盘主体 */

  function InkBoard() {
    this.canvas = null;
    this.g = null;
    this.ideas = [];
    this.slots = [];          /* [{x,y,r,idea,slot}] */
    this.ripples = [];        /* [{x,y,r,p}] */
    this.hover = -1;
    this.selected = -1;
    this.dpr = 1;
    this.W = 0; this.H = 0;
    this.box = null;          /* 棋盘格区域 */
    this.paper = null;        /* 纸纹离屏画布 */
    this.lastW = 0; this.lastH = 0;
    this.phase = 0;
    this.raf = 0;
    this.t0 = performance.now();
    this.onPick = null;
    this.contentAlpha = 1;    /* 整体淡入用 */
  }

  /* 计算布局：棋盘格取画布中间一块，四周留给留白与装饰。
     留白是水墨的命：格子只占中间约 54%，四边全空出来给墨云和远山。 */
  InkBoard.prototype.layout = function () {
    var W = this.W, H = this.H;
    var side = Math.min(W, H) * 0.545;
    var bx = (W - side) / 2;
    var by = (H - side) / 2 + H * 0.01;
    this.box = { x: bx, y: by, w: side, h: side };
    this.cell = side / GRID;

    /* 先建歪斜坐标系，网格与棋子共用 —— 这样棋一定落在交叉点上 */
    this.box._at = makeWarp(this.box, 20260927);

    /* 落子位：把 SLOTS 的格号映射到"歪斜后"的格子中心 */
    this.slots = [];
    var at = this.box._at;
    for (var i = 0; i < this.ideas.length && i < SLOTS.length; i++) {
      var s = SLOTS[i];
      var p = at((s[0] + 0.5) / GRID, (s[1] + 0.5) / GRID);
      this.slots.push({
        slot: s,
        x: p.x,
        y: p.y,
        /* 棋子占格子的 46%：比标准围棋大，墨点要压得住纸 */
        r: this.cell * 0.46,
        idea: this.ideas[i],
        index: i
      });
    }
  };

  /* 纸纹重绘：只在尺寸变化时做一次（这是最贵的一步） */
  InkBoard.prototype.ensurePaper = function () {
    if (this.paper && this.lastW === this.W && this.lastH === this.H) return;
    this.paper = paperTexture(this.W, this.H, 20260927);
    this.lastW = this.W; this.lastH = this.H;
  };

  /* 一帧绘制 */
  InkBoard.prototype.draw = function (now) {
    var g = this.g, W = this.W, H = this.H;
    if (!g) return;
    var t = (now - this.t0) / 1000;
    this.phase = t;

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    /* ① 宣纸底 */
    this.ensurePaper();
    g.drawImage(this.paper, 0, 0, W, H);

    /* 整体淡入：首次绘制逐步显影，像墨刚落纸 */
    if (this.contentAlpha < 1) this.contentAlpha = Math.min(1, this.contentAlpha + 0.02);
    g.globalAlpha = this.contentAlpha;

    var rnd = mulberry(4242);      /* 每帧同一种子：笔触抖动稳定不闪 */

    /* ② 边缘墨云（吃掉硬直角）—— 每帧用同一颗种子重画，笔触稳定不闪 */
    if (!this._cloudSeed) this._cloudSeed = mulberry(909);
    inkCloud(g, W, H, this._cloudSeed);

    /* ③ 网格 */
    drawGrid(g, this.box, rnd);

    /* ⑤ 涟漪（在棋子下层扩散，更自然） */
    var alive = [];
    for (var i = 0; i < this.ripples.length; i++) {
      var rp = this.ripples[i];
      rp.p += 0.018;
      if (rp.p < 1) alive.push(rp);
      drawRipple(g, rp.x, rp.y, rp.r, rp.p);
    }
    this.ripples = alive;

    /* ④ 棋子 */
    for (i = 0; i < this.slots.length; i++) {
      var s = this.slots[i];
      var st = s.idea.status;
      var isBlack = (st === "done");          /* 已成 = 黑子（墨重） */
      var dim = (this.selected >= 0 && this.selected !== i) ? 0.62 : 1;
      if (isBlack) drawBlackStone(g, s.x, s.y, s.r, dim, mulberry(100 + i));
      else drawWhiteStone(g, s.x, s.y, s.r, dim, mulberry(200 + i));

      /* 选中 / 悬停高亮 */
      if (this.selected === i) drawSelect(g, s.x, s.y, s.r, t * 2.0);
      else if (this.hover === i) {
        g.strokeStyle = "rgba(" + CFG.inkPale.join(",") + ",0.26)";
        g.lineWidth = 1;
        g.beginPath();
        g.arc(s.x, s.y, s.r * 1.46, 0, TAU);
        g.stroke();
      }
    }

    /* ⑦ 四角装饰：远山 + 云纹 */
    var eg = Math.min(W, H);
    drawHill(g, W * 0.14, H * 0.16, eg * 0.34, eg * 0.15, mulberry(77), 0.90);
    drawHill(g, W * 0.86, H * 0.14, eg * 0.26, eg * 0.11, mulberry(78), 0.60);
    drawCloud(g, W * 0.87, H * 0.87, eg * 0.22, mulberry(88), 0.92);
    drawCloud(g, W * 0.13, H * 0.89, eg * 0.18, mulberry(99), 0.60);

    /* 石青远霭：山后一抹冷色，把"雾"里透出的青灰补上。
       水墨不只是黑灰，石青与浅赭是画面的呼吸。 */
    drawHaze(g, W * 0.18, H * 0.20, eg * 0.42, CFG.qing, 0.055);
    drawHaze(g, W * 0.82, H * 0.84, eg * 0.34, CFG.qing, 0.045);

    /* 浅赭暖晕：纸的暖调，压在左上与右下，
       平衡冷色、避免整张画发青。 */
    drawHaze(g, W * 0.86, H * 0.30, eg * 0.38, CFG.zhe, 0.048);
    drawHaze(g, W * 0.12, H * 0.74, eg * 0.32, CFG.zhe, 0.040);

    /* 纸边毛刺：沿画面四缘点一圈不规则的淡墨小点，
       让纸的边界看起来是"撕出来的"而不是裁出来的 */
    drawDeckle(g, W, H, deckleSeed());

    /* 落款：右下角一小方朱砂印（唯一的暖色，点睛） */
    drawSeal(g, W * 0.930, H * 0.948, eg * 0.026, t);

    g.globalAlpha = 1;
  };

  /* 色雾：一团极淡的有色墨，用来加冷暖层次（石青 / 浅赭） */
  function drawHaze(g, cx, cy, r, col, alpha) {
    var rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, "rgba(" + col.join(",") + "," + alpha + ")");
    rg.addColorStop(0.55, "rgba(" + col.join(",") + "," + (alpha * 0.42) + ")");
    rg.addColorStop(1, "rgba(" + col.join(",") + ",0)");
    g.fillStyle = rg;
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.fill();
  }

  /* 纸边毛刺：四缘的不规则小点 */
  function drawDeckle(g, w, h, rnd) {
    var i, x, y, n = Math.round((w + h) / 6);
    g.fillStyle = "rgba(" + CFG.inkMid.join(",") + ",0.055)";
    for (i = 0; i < n; i++) {
      var side = Math.floor(rnd() * 4);
      if (side === 0) { x = rnd() * w; y = rnd() * 3.2; }
      else if (side === 1) { x = rnd() * w; y = h - rnd() * 3.2; }
      else if (side === 2) { x = rnd() * 3.2; y = rnd() * h; }
      else { x = w - rnd() * 3.2; y = rnd() * h; }
      g.beginPath();
      g.arc(x, y, 0.4 + rnd() * 1.5, 0, TAU);
      g.fill();
    }
  }

  /* 每帧复用的种子函数（避免每帧新建闭包，笔触也稳定不闪） */
  var _deckleRnd = null;
  function deckleSeed() {
    if (!_deckleRnd) _deckleRnd = mulberry(555);
    return _deckleRnd;
  }

  /* 朱砂小印：方框 + "念"字，微微呼吸 */
  function drawSeal(g, x, y, s, t) {
    var pulse = 0.86 + 0.14 * Math.sin(t * 1.4);
    g.save();
    g.globalAlpha = 0.80 * pulse;
    g.strokeStyle = "rgba(" + CFG.zhu.join(",") + ",0.88)";
    g.lineWidth = Math.max(1, s * 0.13);
    g.strokeRect(x - s, y - s, s * 2, s * 2);
    g.fillStyle = "rgba(" + CFG.zhu.join(",") + ",0.72)";
    g.font = "600 " + Math.round(s * 1.5) + "px " + '"Ma Shan Zheng", "STKaiti", serif';
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("念", x, y + s * 0.06);
    g.restore();
  }

  /* ---------------------------------------------------- 事件与循环 */

  InkBoard.prototype.pickAt = function (px, py) {
    for (var i = 0; i < this.slots.length; i++) {
      var s = this.slots[i];
      var dx = px - s.x, dy = py - s.y;
      if (dx * dx + dy * dy <= (s.r * 1.5) * (s.r * 1.5)) return i;
    }
    return -1;
  };

  InkBoard.prototype.bind = function () {
    var self = this;
    var c = this.canvas;

    function pos(e) {
      var r = c.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (self.W / r.width),
        y: (e.clientY - r.top) * (self.H / r.height)
      };
    }

    c.addEventListener("pointermove", function (e) {
      var p = pos(e);
      var i = self.pickAt(p.x, p.y);
      if (i !== self.hover) {
        self.hover = i;
        c.style.cursor = i >= 0 ? "pointer" : "default";
      }
    });
    c.addEventListener("pointerleave", function () {
      self.hover = -1; c.style.cursor = "default";
    });
    c.addEventListener("click", function (e) {
      var p = pos(e);
      var i = self.pickAt(p.x, p.y);
      if (i < 0) return;
      self.selected = i;
      var s = self.slots[i];
      /* 落子涟漪：从棋子位置向外化开 */
      self.ripples.push({ x: s.x, y: s.y, r: s.r, p: 0 });
      if (typeof self.onPick === "function") self.onPick(s.idea, i);
    });

    /* 尺寸：ResizeObserver 比 window.resize 更准（容器变了也响应） */
    function fit() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var r = c.getBoundingClientRect();
      var w = Math.max(320, Math.round(r.width));
      var h = Math.max(320, Math.round(r.height));
      if (w === self.cssW && h === self.cssH && dpr === self.dpr && self.W) return;
      self.cssW = w; self.cssH = h; self.dpr = dpr;
      self.W = w; self.H = h;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      self.layout();
      self.ensurePaper();
    }
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(fit).observe(c.parentElement || c);
    }
    window.addEventListener("resize", fit);
    fit();

    /* 页面隐藏时停画，省电 */
    function loop(now) {
      self.draw(now);
      self.raf = requestAnimationFrame(loop);
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (self.raf) { cancelAnimationFrame(self.raf); self.raf = 0; }
      } else if (!self.raf) {
        self.raf = requestAnimationFrame(loop);
      }
    });
    this.raf = requestAnimationFrame(loop);
  };

  InkBoard.prototype.triggerRipple = function (i) {
    var s = this.slots[i];
    if (s) this.ripples.push({ x: s.x, y: s.y, r: s.r, p: 0 });
  };

  var inst = null;
  window.InkBoard = {
    init: function (canvas, ideas) {
      inst = new InkBoard();
      inst.canvas = canvas;
      inst.g = canvas.getContext("2d");
      inst.ideas = ideas || [];
      inst.bind();
      return inst;
    },
    select: function (i) {
      if (!inst) return;
      inst.selected = i;
      inst.triggerRipple(i);
    },
    get instance() { return inst; }
  };
})();
