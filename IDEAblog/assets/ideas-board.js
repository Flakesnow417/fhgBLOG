/* ============================================================
   一念未落 · 想法棋局（ideas.html 的 3D 棋盘，Three.js UMD 传统脚本）
   ------------------------------------------------------------
   创意：想法集 = 一盘没下完的棋。
     前排 = 你的想法（可点的棋子）：
       萌芽 = 陶土（还没上釉）/ 生长 = 黄铜（正在发力）/ 已成 = 墨玉（沉下来）
     后排 = 未落的子（暗色，纯氛围，不可点）

   棋子造型 = 立体的国际象棋棋子（王冠 / 主教 / 骑士 / 城堡 /
   兵 / 后冠 / 车），全部旋转体（Lathe）+ 原始几何体拼出，
   做工讲究「有实体感」：底座圆盘、束腰、细颈、顶部有可辨认的形。
   无外部模型。

   交互：拖动旋转 / 滚轮缩放 / 悬停棋子抬起+光圈 / 点击进想法页。
   数据来自 ideas-data.js（window.IDEAS），加想法 = 加数据，棋子自动上盘。
   WebGL 不可用时：卡片列表留在原地当降级，什么都不缺。
   ============================================================ */
(function () {
  if (typeof THREE === "undefined") return;   /* 卡片列表兜底 */
  var canvas = document.getElementById("idea-board");
  if (!canvas) return;

  var renderer;
  try {
    /* alpha: true —— 画布本身透明，棋盘才真正"浮"在页面夜色上 */
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  } catch (e) { return; }                     /* 卡片列表兜底 */

  /* 3D 就绪：隐藏卡片降级区、把棋盘舞台布局切换过来 */
  document.body.classList.add("idea-board-3d");
  if (window.__ideaStageLayout) window.__ideaStageLayout();

  var reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setClearColor(0x000000, 0);        /* 透明底：不要任何背板 */
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;

  var scene = new THREE.Scene();
  /* 不设 scene.background —— 页面自己的天幕透上来 */
  /* 雾只作用在棋盘本身，用很浅的量让远端的格子化开 */
  scene.fog = new THREE.Fog(0x0a1420, 52, 145);

  var camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);

  /* ---------- 灯光：月光当主光源，霓虹只做极弱补色 ----------
     上一版整盘发粉紫的教训：紫红边框面积大 + 环境光偏高，
     冷环境光会把暖紫毡整体抬成粉。所以这里
     ① 环境光再降 ② 环境光改中性偏暖（不要蓝紫） ③ 边框与盘面同色系。 */
  scene.add(new THREE.AmbientLight(0x50565e, 0.34));

  var key = new THREE.DirectionalLight(0xdfe9ff, 0.70);   /* 月光：冷白，偏柔 */
  key.position.set(-16, 34, 18);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30; key.shadow.camera.right = 30;
  key.shadow.camera.top = 30; key.shadow.camera.bottom = -30;
  key.shadow.camera.far = 110;
  key.shadow.radius = 3.4;                 /* 阴影边缘糊一点，接近软光 */
  key.shadow.bias = -0.0006;
  scene.add(key);

  /* 品红轮廓光：只勾物件边缘，够不到盘面 */
  var rim = new THREE.DirectionalLight(0xff7ad9, 0.14);
  rim.position.set(18, 10, -20);
  scene.add(rim);

  /* 青色侧光：防止暗部死黑，量很小 */
  var fill = new THREE.DirectionalLight(0x8fd8ff, 0.10);
  fill.position.set(14, 8, 22);
  scene.add(fill);

  /* ============================================================
     棋盘：整块深墨绿毡 —— 盘面、格、边框同色系
     ------------------------------------------------------------
     上一版用「墨绿毡 + 紫红边」，两边都亮，撞色撞出一片粉紫。
     现在整块统一成深墨绿，只靠明度差分出格与边：
       深格 < 浅格 < 边框亮边，全是同一个绿的深浅。
     ============================================================ */

  var SQ = 4;                       /* 格子边长 */
  var board = new THREE.Group();
  scene.add(board);

  /* 8×8 合并网格 + 顶点色：同色系的深浅两档，色差很小 */
  (function buildSquares() {
    var pos = [], col = [], idx = [];
    /* 毡的毛面不吃高光，颜色要直接给足，不要指望光照提亮 */
    var dk = [0.070, 0.135, 0.105];   /* 深墨绿毡 */
    var lt = [0.105, 0.190, 0.150];   /* 浅墨绿毡（微微亮一点点） */
    for (var f = 0; f < 8; f++) {
      for (var r = 0; r < 8; r++) {
        var x0 = (f - 4) * SQ, x1 = x0 + SQ;
        var z0 = (r - 4) * SQ, z1 = z0 + SQ;
        var c = ((f + r) % 2) ? dk : lt;
        var base = pos.length / 3;
        pos.push(x0, 0.01, z0,  x1, 0.01, z0,  x1, 0.01, z1,  x0, 0.01, z1);
        for (var k = 0; k < 4; k++) col.push(c[0], c[1], c[2]);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    var mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0.0
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    board.add(mesh);
  })();

  /* 格线：细、暗、几乎贴着毡面（缝线，不是发光网格） */
  var grid = new THREE.GridHelper(SQ * 8, 8, 0xbfe6d4, 0xbfe6d4);
  grid.position.y = 0.028;
  grid.material.transparent = true;
  grid.material.opacity = 0.13;
  board.add(grid);

  /* 边框：同色系的深墨绿木缘，只在最外侧压一圈 */
  var frame = new THREE.Mesh(
    new THREE.BoxGeometry(SQ * 8 + 2.6, 1.1, SQ * 8 + 2.6),
    new THREE.MeshStandardMaterial({ color: 0x1c3428, roughness: 0.92, metalness: 0.0 })
  );
  frame.position.y = -0.56;
  frame.receiveShadow = true;
  board.add(frame);

  /* 边框上沿：一条同为墨绿的窄亮边，勾出棋盘轮廓 */
  var edge = new THREE.Mesh(
    new THREE.BoxGeometry(SQ * 8 + 0.6, 0.08, SQ * 8 + 0.6),
    new THREE.MeshStandardMaterial({ color: 0x2e5340, roughness: 0.85, metalness: 0.05 })
  );
  edge.position.y = 0.02;
  board.add(edge);

  /* 桌面落影：整盘压在夜色里的软影 */
  var shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.ShadowMaterial({ opacity: 0.55 })
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = -1.12;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  /* 深夜氛围：只留月亮（要遮在棋盘后面，所以浮得很高但离得很远）
     星野/极光交给页面的 night.js —— 棋盘画布现在是透明的，
     页面的天幕会从棋盘周围直接透上来，两者自然连成一体。 */

  function radialTex(inner, outer, size) {
    var s = size || 128, c = document.createElement("canvas");
    c.width = c.height = s;
    var g = c.getContext("2d");
    var grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
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

  /* 月亮 + 月晕：唯一的冷光源，柔 */
  var moon = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshBasicMaterial({ map: radialTex("rgba(248,246,232,0.90)", "rgba(248,246,232,0)", 128), transparent: true, depthWrite: false })
  );
  moon.position.set(44, 46, -96);
  scene.add(moon);
  var moonGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial({ map: radialTex("rgba(180,206,244,0.20)", "rgba(180,206,244,0)", 128), transparent: true, depthWrite: false })
  );
  moonGlow.position.set(44, 46, -97);
  scene.add(moonGlow);

  /* 桌灯暖光：盘面左侧一小片暖黄，让毡面有被灯照到的一角 */
  var lamp = new THREE.PointLight(0xffc98a, 0.80, 46);
  lamp.position.set(-18, 13, 16);
  scene.add(lamp);
  var lampHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 46),
    new THREE.MeshBasicMaterial({ map: radialTex("rgba(255,196,128,0.11)", "rgba(255,196,128,0)", 128), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  lampHalo.position.set(-18, 4.6, 16);
  lampHalo.rotation.x = -Math.PI / 2;
  scene.add(lampHalo);

  /* 盘面上空极少的浮尘：不用 sprite，用很小的方块，省事也够看 */
  var dustGeo = new THREE.BufferGeometry();
  var dustCount = 46;
  var dustPos = new Float32Array(dustCount * 3);
  var rndD = mulberry(1313);
  for (var di = 0; di < dustCount; di++) {
    dustPos[di * 3]     = (rndD() - 0.5) * 44;
    dustPos[di * 3 + 1] = 1 + rndD() * 8;
    dustPos[di * 3 + 2] = (rndD() - 0.5) * 44;
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  var dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: 0.30, transparent: true, opacity: 0.34,
    blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffd9a8
  }));
  scene.add(dust);

  /* ============================================================
     棋子工厂：8 种 Hartwig 式抽象造型
     ============================================================ */

  function box(w, h, d, x, y, z, mat) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }

  /* ============================================================
     棋子工厂：立体的国际象棋棋子
     ------------------------------------------------------------
     每个子都用「底座圆盘 → 束腰 → 细颈 → 顶部特征形」这几段拼，
     这是真实棋子的比例。旋转体用 LatheGeometry 按轮廓线车出来，
     顶部的王冠 / 主教尖 / 骑士马头 / 城堡齿用原始几何体补。

     比例基准：最高的王约 3.4，兵约 2.2（真实棋组也是这个高低差）。
     ============================================================ */

  /* 轮廓线 → 旋转体（车床）：pts = [[半径, 高度], ...] */
  function lathe(pts, mat, seg) {
    var v = [];
    for (var i = 0; i < pts.length; i++) v.push(new THREE.Vector2(pts[i][0], pts[i][1]));
    var m = new THREE.Mesh(new THREE.LatheGeometry(v, seg || 30), mat);
    m.castShadow = true;
    return m;
  }

  /* 棋子通用的底座轮廓：厚圆盘 + 一圈束腰 + 圆润的柱身 */
  function pedestal(mat, r) {
    r = r || 1.0;
    return lathe([
      [0.001, 0.00],
      [r * 0.98, 0.00],
      [r, 0.13],
      [r, 0.30],
      [r * 0.95, 0.40],
      [r * 0.62, 0.52],       /* 束腰（收进去） */
      [r * 0.58, 0.70],
      [r * 0.70, 0.86],
      [r * 0.68, 1.05],
      [r * 0.52, 1.20],
      [r * 0.44, 1.35],       /* 细颈 */
      [r * 0.58, 1.52]
    ], mat, 32);
  }

  function cyl(rt, rb, h, seg, mat, y) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    if (y !== undefined) m.position.y = y;
    m.castShadow = true;
    return m;
  }

  function ring(r, tube, mat, y, seg) {
    var m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, seg || 26), mat);
    m.rotation.x = Math.PI / 2;
    if (y !== undefined) m.position.y = y;
    m.castShadow = true;
    return m;
  }

  /* 1 · 兵：最小的子，球头 + 底下两道环 */
  function pawn(mat) {
    var g = new THREE.Group();
    g.add(lathe([
      [0.001, 0.00], [0.80, 0.00], [0.82, 0.12], [0.80, 0.28],
      [0.56, 0.42], [0.50, 0.58], [0.62, 0.72], [0.60, 0.88],
      [0.46, 1.00], [0.40, 1.14]
    ], mat, 30));
    g.add(ring(0.44, 0.10, mat, 1.24, 24));
    var s = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 18), mat);
    s.position.y = 1.62; s.castShadow = true; g.add(s);
    return g;
  }

  /* 2 · 城堡（车）：方形塔身 + 城齿 */
  function rook(mat) {
    var g = new THREE.Group();
    g.add(pedestal(mat, 1.0));
    var body = cyl(0.76, 0.82, 1.13, 8, mat, 2.05);
    body.rotation.y = Math.PI / 8;              /* 八棱柱转正一个面朝前 */
    g.add(body);
    var crown = cyl(1.00, 0.94, 0.22, 8, mat, 2.72);
    crown.rotation.y = Math.PI / 8;
    g.add(crown);
    /* 城齿：八棱柱顶上削出四个缺口 */
    for (var i = 0; i < 4; i++) {
      var a = i * Math.PI / 2 + Math.PI / 8;
      var t = box(0.42, 0.40, 0.42, Math.cos(a) * 0.72, 2.98, Math.sin(a) * 0.72, mat);
      g.add(t);
    }
    return g;
  }

  /* 3 · 骑士：马头（侧面轮廓 + 鼻梁 + 鬃背） */
  function knight(mat) {
    var g = new THREE.Group();
    g.add(pedestal(mat, 1.0));
    /* 脖子：从柱身往前上方倾 */
    var neck = cyl(0.46, 0.70, 1.05, 20, mat, 2.02);
    neck.rotation.x = -0.30;
    neck.position.z = 0.16;
    g.add(neck);
    /* 头：斜着的长立方体 */
    var head = box(0.78, 0.56, 1.32, 0, 2.62, 0.44, mat);
    head.rotation.x = -0.36;
    g.add(head);
    /* 口鼻：向前伸出一小段 */
    var nose = box(0.62, 0.44, 0.52, 0, 2.44, 1.06, mat);
    nose.rotation.x = -0.22;
    g.add(nose);
    /* 鬃背：从头顶往颈后一溜 */
    var mane = box(0.34, 0.40, 1.30, 0, 2.90, 0.06, mat);
    mane.rotation.x = -0.34;
    g.add(mane);
    /* 耳尖 */
    var ear = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.36, 10), mat);
    ear.position.set(0, 3.06, 0.86);
    ear.rotation.x = -0.2;
    ear.castShadow = true;
    g.add(ear);
    return g;
  }

  /* 4 · 主教：细高塔 + 主教帽的斜切口 + 顶珠 */
  function bishop(mat) {
    var g = new THREE.Group();
    g.add(pedestal(mat, 1.0));
    g.add(cyl(0.50, 0.66, 1.10, 24, mat, 2.05));
    g.add(ring(0.56, 0.09, mat, 2.58, 26));
    /* 主教帽：上细下粗的旋转体 */
    g.add(lathe([
      [0.001, 2.60], [0.30, 2.62], [0.52, 2.78],
      [0.54, 3.00], [0.40, 3.26], [0.20, 3.50], [0.001, 3.58]
    ], mat, 26));
    /* 帽上的斜切口：一小块斜放的薄板当"缝" */
    var slit = box(0.10, 0.42, 0.30, 0, 3.05, 0.44, mat);
    slit.rotation.x = -0.5;
    g.add(slit);
    var top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mat);
    top.position.y = 3.70; top.castShadow = true; g.add(top);
    return g;
  }

  /* 5 · 后：高冠，顶上一圈小珠 */
  function queen(mat) {
    var g = new THREE.Group();
    g.add(pedestal(mat, 1.06));
    g.add(cyl(0.54, 0.72, 1.22, 26, mat, 2.08));
    g.add(ring(0.60, 0.10, mat, 2.66, 28));
    /* 冠：向下收口，顶上带一圈小球 */
    g.add(lathe([
      [0.001, 2.70], [0.42, 2.72], [0.62, 2.92],
      [0.66, 3.16], [0.76, 3.36], [0.72, 3.52], [0.001, 3.58]
    ], mat, 28));
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      var b = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), mat);
      b.position.set(Math.cos(a) * 0.62, 3.60, Math.sin(a) * 0.62);
      b.castShadow = true;
      g.add(b);
    }
    var orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), mat);
    orb.position.y = 3.82; orb.castShadow = true; g.add(orb);
    return g;
  }

  /* 6 · 王：最高的子，头顶一个十字 */
  function king(mat) {
    var g = new THREE.Group();
    g.add(pedestal(mat, 1.08));
    g.add(cyl(0.56, 0.76, 1.30, 26, mat, 2.12));
    g.add(ring(0.62, 0.10, mat, 2.74, 28));
    g.add(lathe([
      [0.001, 2.78], [0.46, 2.80], [0.66, 3.00],
      [0.68, 3.24], [0.62, 3.44], [0.001, 3.52]
    ], mat, 28));
    /* 十字：竖杆 + 横杆 */
    g.add(box(0.20, 0.76, 0.20, 0, 3.86, 0, mat));
    g.add(box(0.56, 0.20, 0.20, 0, 3.98, 0, mat));
    return g;
  }

  /* 7 · 高塔：细长的塔身 + 尖顶，比兵高一截 */
  function tower(mat) {
    var g = new THREE.Group();
    g.add(pedestal(mat, 0.95));
    g.add(cyl(0.42, 0.56, 1.60, 22, mat, 2.30));
    g.add(ring(0.48, 0.08, mat, 3.10, 24));
    var c = new THREE.Mesh(new THREE.ConeGeometry(0.50, 0.94, 22), mat);
    c.position.y = 3.62; c.castShadow = true; g.add(c);
    return g;
  }

  /* 8 · 圆顶子：低调的收尾造型（圆球顶 + 细颈） */
  function dome(mat) {
    var g = new THREE.Group();
    g.add(pedestal(mat, 0.92));
    g.add(cyl(0.34, 0.46, 0.70, 20, mat, 1.85));
    var s = new THREE.Mesh(new THREE.SphereGeometry(0.52, 22, 16), mat);
    s.position.y = 2.52; s.castShadow = true; g.add(s);
    return g;
  }

  var PIECES = [king, queen, rook, bishop, knight, pawn, tower, dome];

  /* 状态 → 材质（每个棋子独立材质，方便悬停高亮）
     实体棋子：底座暗、上身亮，靠金属度与粗糙度读出"料"，
     三种状态是三种材料，不是三种颜色贴纸。 */
  function statusMat(status) {
    if (status === "done")      /* 已成：墨玉。深，但有油润的高光 */
      return new THREE.MeshStandardMaterial({
        color: 0x1b1f27, roughness: 0.34, metalness: 0.30
      });
    if (status === "growing")   /* 生长：黄铜。暖、亮、有金属高光 */
      return new THREE.MeshStandardMaterial({
        color: 0xc08a33, roughness: 0.32, metalness: 0.72
      });
    /* 萌芽：米白陶土。素、哑，刚捏出来还没上釉 */
    return new THREE.MeshStandardMaterial({
      color: 0xa8a294, roughness: 0.82, metalness: 0.04
    });
  }

  function ghostMat() {
    return new THREE.MeshStandardMaterial({
      color: 0x4a5568, roughness: 0.75, metalness: 0.05,
      transparent: true, opacity: 0.42
    });
  }

  /* ============================================================
     摆子：前排你的想法（可点），后排未落的子（剪影）
     ============================================================ */

  var STATUS_ZH = { seed: "萌芽", growing: "生长", done: "已成" };
  var ideas = (window.IDEAS || []).slice();
  var ideaPieces = [];

  /* 想法棋子摆位：中路前排，最显眼的位置 */
  var IDEA_SLOTS = [[3, 6], [4, 6], [2, 5], [5, 5], [1, 6], [6, 6], [3, 5], [4, 5]];

  /* 棋子造型按状态分配：已成最重器（王/后），生长用轻快形（骑士/主教），
     萌芽用小子（兵/圆顶）。挑的时候保证一眼能读出"这份想法多重"。 */
  var FORM_BY_STATUS = {
    done:    [0, 1],        /* 王 / 后 */
    growing: [4, 3],        /* 骑士 / 主教 */
    seed:    [5, 6, 7]      /* 兵 / 高塔 / 圆顶 */
  };
  var formUsed = { done: 0, growing: 0, seed: 0 };

  ideas.forEach(function (idea, i) {
    var slot = IDEA_SLOTS[i % IDEA_SLOTS.length];
    var pool = FORM_BY_STATUS[idea.status] || FORM_BY_STATUS.seed;
    var pick = pool[formUsed[idea.status === "done" ? "done"
                 : idea.status === "growing" ? "growing" : "seed"] % pool.length];
    formUsed[idea.status === "done" ? "done"
             : idea.status === "growing" ? "growing" : "seed"]++;
    var piece = PIECES[pick](statusMat(idea.status));
    piece.position.set((slot[0] - 3.5) * SQ, 0, (slot[1] - 3.5) * SQ);
    piece.rotation.y = (i % 2 ? 1 : -1) * (0.5 + (i % 3) * 0.35);  /* 各自微转，不呆板 */
    piece.userData = {
      idea: idea, baseY: 0, lift: 0,
      ph: Math.random() * Math.PI * 2
    };
    board.add(piece);
    ideaPieces.push(piece);
  });

  /* 未落的子：对面两排的暗色棋子（形状都有，只是还没上桌） */
  var GHOST_SLOTS = [[0, 0], [2, 0], [4, 0], [6, 0], [7, 0], [1, 1], [3, 1], [5, 1]];
  GHOST_SLOTS.forEach(function (slot, i) {
    var piece = PIECES[(i * 5 + 2) % PIECES.length](ghostMat());
    piece.position.set((slot[0] - 3.5) * SQ, 0, (slot[1] - 3.5) * SQ);
    piece.position.y = -0.06;          /* 微微沉进毡面：还没拿上来的子 */
    piece.scale.setScalar(0.92);
    piece.rotation.y = (i % 2 ? 1 : -1) * (0.6 + (i % 3) * 0.4);
    board.add(piece);
  });

  /* 悬停光圈：暗金细环，铺在棋子脚下（毡上没有光环，只有缝线） */
  var hoverRing = new THREE.Mesh(
    new THREE.RingGeometry(1.75, 2.05, 44),
    new THREE.MeshBasicMaterial({ color: 0xc79a45, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  hoverRing.rotation.x = -Math.PI / 2;
  hoverRing.position.y = 0.06;
  board.add(hoverRing);

  /* ============================================================
     视角：棋盘「悬浮」的关键 —— 一个承载倾斜的舞台组
     ------------------------------------------------------------
     相机固定不动，棋盘整组绕自身中心做「轻微俯视 + 轻微侧转」，
     所以画面上盘面有明显的透视收缩与倾角，像悬在页面前方。
     拖动只改这组的 yaw/pitch（顺手反馈强），滚轮改相机距离。
     ============================================================ */

  var rig = new THREE.Group();
  var BOARD_CENTER = new THREE.Vector3(0, 0.6, 0);
  rig.position.copy(BOARD_CENTER);
  scene.add(rig);
  rig.add(board);
  board.position.set(-BOARD_CENTER.x, -BOARD_CENTER.y, -BOARD_CENTER.z);

  var shadowSync = function () {
    rig.updateMatrixWorld(true);
  };

  /* 初始倾角：大概 30° 俯视 + 一点点侧转，透视感就出来了 */
  var tilt = { yaw: -0.30, pitch: 0.50 };
  var dragging = false, lastX = 0, lastY = 0, idleFor = 99;

  /* 相机：正对着舞台，微微俯视 */
  var camDist = 26;
  camera.position.set(0, 3.4, camDist);
  camera.lookAt(0, 0.6, 0);

  function applyTilt() {
    rig.rotation.set(tilt.pitch, tilt.yaw, 0);
    shadowSync();
  }

  canvas.addEventListener("pointerdown", function (e) {
    if (inPlay) return;                       /* 入局后禁用上帝视角轨道 */
    dragging = true; lastX = e.clientX; lastY = e.clientY; idleFor = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (dragging && !inPlay) {
      tilt.yaw += (e.clientX - lastX) * 0.0062;
      tilt.pitch = Math.min(1.05, Math.max(0.06, tilt.pitch + (e.clientY - lastY) * 0.0042));
      lastX = e.clientX; lastY = e.clientY; idleFor = 0;
    }
    pointer.x = (e.clientX / canvas.clientWidth) * 2 - 1;
    pointer.y = -((e.clientY / canvas.clientHeight) * 2 - 1);
    pointer.px = e.clientX; pointer.py = e.clientY;
    pointer.on = true;
  });
  window.addEventListener("pointerup", function () { dragging = false; });
  canvas.addEventListener("pointerleave", function () { pointer.on = false; });
  canvas.addEventListener("wheel", function (e) {
    if (inPlay) { e.preventDefault(); return; }   /* 入局后不给缩放 */
    e.preventDefault();
    camDist = Math.min(40, Math.max(16, camDist + e.deltaY * 0.02));
    camera.position.z = camDist;
    idleFor = 0;
  }, { passive: false });

  var pointer = { x: -2, y: -2, px: 0, py: 0, on: false };

  /* ============================================================
     拾取：悬停抬起 + 提示牌；点击跳想法页
     ============================================================ */

  var raycaster = new THREE.Raycaster();
  var tip = document.createElement("div");
  tip.className = "idea-tagtip idea-tagtip--light";
  document.body.appendChild(tip);
  var hovered = null;

  function rootPiece(obj) {
    while (obj && obj.parent && obj.parent !== board) obj = obj.parent;
    return obj && obj.parent === board ? obj : null;
  }

  canvas.addEventListener("click", function () {
    if (!hovered) return;
    var idea = hovered.userData.idea;
    if (idea && idea.href) window.location.href = idea.href;
  });

  /* ============================================================
     游戏层：入局 / 出局 · 方向键走子 · 靠近目标弹出入口浮层
     ------------------------------------------------------------
     入局 = 相机平滑推到「贴在盘面旁边」的高度，同时禁用上帝视角轨道。
     出局 = 一切恢复原样（相机、倾角、轨道都能回来）。
     棋子用方向键一格一格走，靠 lerp 走出平滑感；
     走到目标棋子附近（阈值内）在它头顶弹一个链接浮层 —— 必须手点。
     ============================================================ */

  /* 玩家棋子：铜色小圆盘 + 宝珠，风格与棋组一致（车床轮廓） */
  var player = (function () {
    var g = new THREE.Group();
    /* 影子跟着浮动会闪，所以分两层：
       shadowLayer 一直贴着盘面（负责投影），saucer 负责起伏（视觉） */
    var shadowLayer = new THREE.Group();
    var saucer = new THREE.Group();
    g.add(shadowLayer);
    g.add(saucer);

    var mat = new THREE.MeshStandardMaterial({
      color: 0xd9b06a, roughness: 0.26, metalness: 0.85,
      emissive: 0x4a3208, emissiveIntensity: 0.35
    });
    saucer.add(lathe([
      [0.001, 0.00], [0.92, 0.00], [0.94, 0.10], [0.90, 0.26],
      [0.66, 0.40], [0.62, 0.58], [0.72, 0.72], [0.60, 0.86], [0.001, 0.92]
    ], mat, 30));
    var orb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), mat);
    orb.position.y = 1.10; orb.castShadow = true; saucer.add(orb);
    /* 贴地的小圆盘：专门吃阴影，位置固定不动 */
    var plate = new THREE.Mesh(
      new THREE.CircleGeometry(0.94, 32),
      new THREE.ShadowMaterial({ opacity: 0.42 })
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = 0.03;
    plate.receiveShadow = true;
    shadowLayer.add(plate);

    /* 脚下光环：让玩家一眼找到自己 */
    var halo = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.30, 40),
      new THREE.MeshBasicMaterial({
        color: 0xf2d382, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.05;
    shadowLayer.add(halo);
    g.userData.halo = halo;
    g.userData.saucer = saucer;
    g.visible = false;
    board.add(g);
    return g;
  })();

  /* 玩家所在格：从某个角上起步 */
  var pGrid = { x: 2, z: 7 };
  var pWant = { x: 2, z: 7 };                 /* 键盘写入的目标格 */
  var PLAY_MIN = 0, PLAY_MAX = 7;
  var STEP = 0.16;                            /* 平滑速度（越大越快） */
  var NEAR = SQ * 2.05;                       /* 靠近阈值：两个格子内触发 */

  function gridToWorld(c) { return (c - 3.5) * SQ; }

  player.position.set(gridToWorld(pGrid.x), 0, gridToWorld(pGrid.z));

  /* 是否有一个目标格正在等待落地（防止一格没走完就吃掉下一键） */
  function atTarget() {
    return pGrid.x === pWant.x && pGrid.z === pWant.z;
  }

  var KEYS = {
    ArrowUp:    [0, -1], ArrowDown: [0, 1],
    ArrowLeft:  [-1, 0], ArrowRight: [1, 0],
    KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0]
  };

  window.addEventListener("keydown", function (e) {
    if (!inPlay || !KEYS[e.code]) return;
    e.preventDefault();                        /* 别让方向键把页面滚走 */
    if (!atTarget()) return;                   /* 走完一格再走下一格 */
    var d = KEYS[e.code];
    pWant.x = Math.min(PLAY_MAX, Math.max(PLAY_MIN, pWant.x + d[0]));
    pWant.z = Math.min(PLAY_MAX, Math.max(PLAY_MIN, pWant.z + d[1]));
    lastMove = Date.now();
  });

  /* 靠近检测 → 弹浮层。浮层只有一个，跟着最近的那个目标走。 */
  var nearPiece = null;
  var nearPanel = document.getElementById("idea-near");

  function updateNear() {
    var best = null, bestD = NEAR;
    for (var i = 0; i < ideaPieces.length; i++) {
      var p = ideaPieces[i];
      var idea = p.userData.idea;
      if (!idea || !idea.href) continue;       /* 没链接的想法不弹浮层 */
      var dx = p.position.x - player.position.x;
      var dz = p.position.z - player.position.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best !== nearPiece) {
      nearPiece = best;
      if (nearPanel) {
        if (best) {
          var idea = best.userData.idea;
          nearPanel.innerHTML =
            '<span class="idea-near-kind">' + (STATUS_ZH[idea.status] || "萌芽") + "</span>" +
            "<b>" + escHtml(idea.title) + "</b>" +
            "<span>" + escHtml(idea.summary || "") + "</span>" +
            '<span class="idea-near-go">点此入册 →</span>';
          nearPanel.href = idea.href;
          nearPanel.setAttribute("aria-label", "进入想法：" + idea.title);
          nearPanel.classList.add("is-on");
        } else {
          nearPanel.classList.remove("is-on");
        }
      }
    }
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------- 入局 / 出局：相机与状态的平滑过渡 ---------- */

  var inPlay = false;
  var camFrom = new THREE.Vector3(), camTo = new THREE.Vector3();
  var lookFrom = new THREE.Vector3(), lookTo = new THREE.Vector3();
  var tween = { on: false, t: 0, dur: 0.9 };
  var lastMove = 0;

  function camSnapshot() {
    camFrom.copy(camera.position);
    lookFrom.copy(camLook);
  }

  function cameraTargets() {
    if (!inPlay) {
      /* 上帝视角：回到初始机位与倾角 */
      camTo.set(0, 3.4, camDist);
      lookTo.set(0, 0.6, 0);
    } else {
      /* 入局：贴到玩家棋子斜后方，压到接近盘面的高度 */
      var px = player.position.x, pz = player.position.z;
      camTo.set(px - 3.4, 3.6, pz + 8.2);
      lookTo.set(px * 0.4, 0.75, pz - 3.2);
    }
    tween.on = true; tween.t = 0;
  }

  var camLook = new THREE.Vector3(0, 0.6, 0);

  function enterGame() {
    if (inPlay) return;
    inPlay = true;
    player.visible = true;
    pWant.x = pGrid.x; pWant.z = pGrid.z;
    camSnapshot();
    cameraTargets();
    document.body.classList.add("idea-in-play");
    var b = document.getElementById("idea-join-btn");
    if (b) b.setAttribute("aria-pressed", "true");
    canvas.style.cursor = "default";
    lastMove = Date.now();
  }

  function exitGame() {
    if (!inPlay) return;
    inPlay = false;
    camSnapshot();
    cameraTargets();
    document.body.classList.remove("idea-in-play");
    var b = document.getElementById("idea-join-btn");
    if (b) b.setAttribute("aria-pressed", "false");
    canvas.style.cursor = "grab";
    /* 浮层收掉，玩家棋子隐去 */
    if (nearPanel) nearPanel.classList.remove("is-on");
    nearPiece = null;
    player.visible = false;
    /* 上帝视角的倾角回到初始，避免歪着出去 */
    tilt.yaw = -0.30;
    tilt.pitch = 0.50;
  }

  (function bindGameUI() {
    var joinBtn = document.getElementById("idea-join-btn");
    if (joinBtn) {
      joinBtn.addEventListener("click", function () {
        if (inPlay) exitGame(); else enterGame();
      });
    }
    var exitBtn = document.getElementById("idea-exit-btn");
    if (exitBtn) exitBtn.addEventListener("click", exitGame);
    /* Esc 也能出局，符合直觉 */
    window.addEventListener("keydown", function (e) {
      if (inPlay && e.code === "Escape") exitGame();
    });
  })();

  /* ============================================================
     主循环
     ============================================================ */

  var B = SQ * 4;                   /* 棋盘半宽（含边框约 ×1.16） */

  /* 自适应取景：按画布宽高算出「让整盘刚好装进来」的距离 ——
     倾斜后棋盘在屏幕上的投影会变宽变高，所以留了余量，
     并给移动端单独放宽。这样任何尺寸都不会被裁掉边角。 */
  function fitToCanvas(w, h) {
    var aspect = w / h;
    var halfW = B * 1.55;                      /* 倾斜后横向占宽的上界 */
    var halfH = B * 1.30;                      /* 纵向占高（含棋子高度） */
    var fovY = camera.fov * Math.PI / 180;
    var fitH = halfH / Math.tan(fovY / 2);
    var fitW = halfW / (Math.tan(fovY / 2) * aspect);
    var need = Math.max(fitH, fitW) * 1.10;    /* 10% 呼吸余量 */
    camDist = Math.max(need, 17);
    camera.position.z = camDist;
    camera.lookAt(0, 0.6, 0);
  }

  function resize() {
    var stage = canvas.parentElement;
    var w = (stage && stage.clientWidth) || window.innerWidth;
    var h = (stage && stage.clientHeight) || Math.round(window.innerHeight * 0.72);
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitToCanvas(w, h);
    applyTilt();
  }
  window.addEventListener("resize", resize);
  resize();
  /* 舞台高度由页面脚本按视口算，算完可能晚一拍：补一次 */
  setTimeout(resize, 120);
  setTimeout(resize, 600);

  var clock = new THREE.Clock();
  var uTime = 0;

  function tick() {
    var dt = Math.min(clock.getDelta(), 0.05);
    var ts = reduce ? 0 : 1;
    uTime += dt * ts;

    /* 上帝视角：空闲时棋盘自己很慢地转（悬着的呼吸感）
       入局后不再自转（否则走动时画面会飘） */
    idleFor += dt;
    if (!inPlay && idleFor > 4 && !dragging) {
      tilt.yaw += dt * 0.055 * ts;
      applyTilt();
    }

    /* 相机过渡（入局 / 出局 / 跟随玩家走位） */
    if (tween.on) {
      tween.t += dt / tween.dur;
      var k = tween.t >= 1 ? 1 : tween.t;
      var e = k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k;   /* easeInOut */
      camera.position.lerpVectors(camFrom, camTo, e);
      camLook.lerpVectors(lookFrom, lookTo, e);
      camera.lookAt(camLook);
      if (k >= 1) tween.on = false;
    } else if (inPlay) {
      /* 入局中：相机始终跟着玩家棋子（缓动跟随，别硬贴） */
      var px = player.position.x, pz = player.position.z;
      var wantX = px - 3.4, wantY = 3.6, wantZ = pz + 8.2;
      camera.position.x += (wantX - camera.position.x) * Math.min(1, dt * 3.2);
      camera.position.y += (wantY - camera.position.y) * Math.min(1, dt * 3.2);
      camera.position.z += (wantZ - camera.position.z) * Math.min(1, dt * 3.2);
      camLook.x += (px * 0.4 - camLook.x) * Math.min(1, dt * 3.6);
      camLook.y += (0.75 - camLook.y) * Math.min(1, dt * 3.6);
      camLook.z += (pz - 3.2 - camLook.z) * Math.min(1, dt * 3.6);
      camera.lookAt(camLook);
    }

    /* 玩家棋子的平滑走位：朝目标格挪，走到就吸附 */
    if (inPlay) {
      var tx = gridToWorld(pWant.x), tz = gridToWorld(pWant.z);
      player.position.x += (tx - player.position.x) * Math.min(1, dt / STEP * 0.28);
      player.position.z += (tz - player.position.z) * Math.min(1, dt / STEP * 0.28);
      if (Math.abs(tx - player.position.x) < 0.02) { player.position.x = tx; pGrid.x = pWant.x; }
      if (Math.abs(tz - player.position.z) < 0.02) { player.position.z = tz; pGrid.z = pWant.z; }
      /* 走动时轻微上下浮动 + 光环呼吸，看得出是个活物
         （影子跟着浮动会闪，所以只让棋子本身上下） */
      if (player.userData.saucer) {
        player.userData.saucer.position.y = Math.abs(Math.sin(uTime * 6)) * 0.06 * ts;
      }
      var halo = player.userData.halo;
      halo.material.opacity = 0.38 + 0.18 * Math.sin(uTime * 2.4) * ts;

      updateNear();
    }

    /* 月与光晕面向镜头、浮尘缓旋 */
    moon.lookAt(camera.position);
    moonGlow.lookAt(camera.position);
    dust.rotation.y += dt * 0.022 * ts;

    /* 悬停检测：入局后只看玩家附近那一个（避免误触别的子） */
    if (!inPlay && pointer.on && ideaPieces.length) {
      raycaster.setFromCamera({ x: pointer.x, y: pointer.y }, camera);
      var hits = raycaster.intersectObjects(ideaPieces, true);
      hovered = hits.length ? rootPiece(hits[0].object) : null;
    } else {
      hovered = null;
    }
    if (!inPlay) {
      canvas.style.cursor = hovered ? "pointer" : (dragging ? "grabbing" : "grab");
    }

    /* 棋子：悬停抬起 + 鎏金呼吸；入局后把浮层指向的那个目标也抬一抬 */
    ideaPieces.forEach(function (p) {
      var ud = p.userData;
      var want = (hovered === p || (inPlay && nearPiece === p)) ? 1 : 0;
      ud.lift += (want - ud.lift) * 0.16;
      var bob = (ud.idea.status === "growing")
        ? Math.sin(uTime * 0.9 + ud.ph) * 0.12 * ts : 0;
      p.position.y = ud.baseY + ud.lift * 1.1 + bob;
    });

    /* 金光圈：入局后吸附在"最近的那个目标"上，代替鼠标悬停 */
    var ringOn = inPlay ? nearPiece : hovered;
    if (ringOn) {
      hoverRing.position.x = ringOn.position.x;
      hoverRing.position.z = ringOn.position.z;
      hoverRing.material.opacity = 0.45 + 0.2 * Math.sin(uTime * 3) * ts;

      if (!inPlay && tip._for !== hovered) {
        tip._for = hovered;
        var idea = hovered.userData.idea;
        tip.textContent = idea.title + " · " + (STATUS_ZH[idea.status] || "萌芽");
        tip.classList.add("idea-tagtip--show");
      }
      if (!inPlay) {
        tip.style.left = pointer.px + "px";
        tip.style.top = (pointer.py - 18) + "px";
      }
    } else {
      hoverRing.material.opacity = 0;
      if (tip._for) { tip._for = null; tip.classList.remove("idea-tagtip--show"); }
    }

    /* 靠近浮层贴着目标棋子走（世界坐标 → 屏幕坐标） */
    if (inPlay && nearPiece && nearPanel && nearPanel.classList.contains("is-on")) {
      var world = new THREE.Vector3();
      nearPiece.getWorldPosition(world);
      world.y += 3.6;                          /* 浮在棋子头顶上方 */
      world.project(camera);
      var w = canvas.clientWidth, h = canvas.clientHeight;
      nearPanel.style.left = ((world.x * 0.5 + 0.5) * w) + "px";
      nearPanel.style.top = ((-world.y * 0.5 + 0.5) * h) + "px";
      nearPanel.style.visibility = (world.z > 1) ? "hidden" : "visible";
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  tick();
})();
