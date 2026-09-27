/* ============================================================
   一念未落 · 想法棋局（ideas.html 的 3D 棋盘，Three.js UMD 传统脚本）
   ------------------------------------------------------------
   创意：想法集 = 一盘没下完的棋。
     前排 = 你的想法（可点的棋子）：
       萌芽 = 原木（还没雕完）/ 生长 = 鎏金（正在发力）/ 已成 = 墨玉（黑亮沉淀）
     后排 = 未落的子（灰色剪影，纯氛围，不可点）

   棋子造型借鉴 Hartwig 抽象棋组：立方、球座、十字、L 块、
   拱门、塔、尖顶、宝珠 —— 全部用 Three 原始几何体拼，无外部模型。

   交互：拖动旋转 / 滚轮缩放 / 悬停棋子抬起+金光 / 点击进想法页。
   数据来自 ideas-data.js（window.IDEAS），加想法 = 加数据，棋子自动上盘。
   WebGL 不可用时：卡片列表留在原地当降级，什么都不缺。
   ============================================================ */
(function () {
  if (typeof THREE === "undefined") return;   /* 卡片列表兜底 */
  var canvas = document.getElementById("idea-board");
  if (!canvas) return;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  } catch (e) { return; }                     /* 卡片列表兜底 */

  /* 3D 就绪：隐藏卡片降级区 */
  document.body.classList.add("idea-board-3d");

  var reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;

  var scene = new THREE.Scene();
  /* 深夜蓝黑：远处化进夜色 */
  scene.background = new THREE.Color(0x070d1f);
  scene.fog = new THREE.Fog(0x070d1f, 46, 130);

  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

  /* ---------- 灯光：月光当唯一主光源，霓虹只做微弱补色 ----------
     davesocozy 那种桌面感靠「一段柔和的顶光 + 大面积暗」，
     所以这里的整体亮度压得很低，盘面主要靠自身的漫反射读出来。 */
  scene.add(new THREE.AmbientLight(0x2a3550, 0.38));

  var key = new THREE.DirectionalLight(0xdfe9ff, 0.62);   /* 月光：冷白，偏柔 */
  key.position.set(-16, 34, 18);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30; key.shadow.camera.right = 30;
  key.shadow.camera.top = 30; key.shadow.camera.bottom = -30;
  key.shadow.camera.far = 110;
  key.shadow.radius = 3.4;                 /* 阴影边缘糊一点，接近软光 */
  key.shadow.bias = -0.0006;
  scene.add(key);

  /* 极微弱的品红轮廓光：只在物件边缘勾一条线，不能把盘面打亮 */
  var rim = new THREE.DirectionalLight(0xff7ad9, 0.16);
  rim.position.set(18, 10, -20);
  scene.add(rim);

  /* 极微弱的青色侧光：让暗部不至于死黑 */
  var fill = new THREE.DirectionalLight(0x35c8ff, 0.12);
  fill.position.set(14, 8, 22);
  scene.add(fill);

  /* ============================================================
     棋盘：两张毛毡 —— 深绿毡 + 紫红毡，细格线缝在上面
     ------------------------------------------------------------
     参考 davesocozy 的桌面：有色的毡面、细格线、四周被光自然压暗、
     物件落在上面有软影。所以这里不用光板，用「低饱和毡色 + 粗糙度 0.95」，
     靠环境光与月光读出质感，格子对比压得很轻，只留缝线的暗示。
     ============================================================ */

  var SQ = 4;                       /* 格子边长 */
  var board = new THREE.Group();
  scene.add(board);

  /* 8×8 合并网格 + 顶点色：两种毡色交替，色差很小（缝线的暗示） */
  (function buildSquares() {
    var pos = [], col = [], idx = [];
    /* 毡的毛面不吃高光，所以颜色要直接给足，不要指望光照提亮 */
    var dk = [0.115, 0.190, 0.150];   /* 深墨绿毡 */
    var lt = [0.175, 0.270, 0.215];   /* 浅墨绿毡（微微亮一点点） */
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
  var grid = new THREE.GridHelper(SQ * 8, 8, 0x9fd8ff, 0x9fd8ff);
  grid.position.y = 0.028;
  grid.material.transparent = true;
  grid.material.opacity = 0.16;
  board.add(grid);

  /* 边框：紫红毡垫在下面露出一圈，像桌垫的边 */
  var frame = new THREE.Mesh(
    new THREE.BoxGeometry(SQ * 8 + 2.6, 1.1, SQ * 8 + 2.6),
    new THREE.MeshStandardMaterial({ color: 0x4a1f3a, roughness: 0.95, metalness: 0.0 })
  );
  frame.position.y = -0.56;
  frame.receiveShadow = true;
  board.add(frame);

  /* 边框上沿：一条极暗的缝线，勾出桌垫轮廓 */
  var edge = new THREE.Mesh(
    new THREE.BoxGeometry(SQ * 8 + 0.6, 0.08, SQ * 8 + 0.6),
    new THREE.MeshStandardMaterial({
      color: 0x6b2c52, roughness: 0.9, metalness: 0.0,
      emissive: 0x3a1029, emissiveIntensity: 0.35
    })
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

  /* ============================================================
     深夜氛围：星野 + 月亮 + 极淡极光 + 光尘 + 桌灯暖光
     ------------------------------------------------------------
     参考图的夜景是「深、静、少量暖光」：星光不用密，
     极光只要一层若有若无的色雾，暖光只有一盏桌灯。
     ============================================================ */

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

  /* 星野：数量与亮度都收着，像隔着窗看夜 */
  var starTex = radialTex("rgba(235,245,255,0.95)", "rgba(235,245,255,0)", 64);
  var starCount = 170;
  var starGeo = new THREE.BufferGeometry();
  var starPos = new Float32Array(starCount * 3);
  var rndS = mulberry(4242);
  for (var si = 0; si < starCount; si++) {
    starPos[si * 3]     = (rndS() - 0.5) * 260;
    starPos[si * 3 + 1] = 6 + rndS() * 90;
    starPos[si * 3 + 2] = (rndS() - 0.62) * 260;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  var starMat = new THREE.PointsMaterial({
    size: 1.4, map: starTex, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, color: 0xc8dcf6
  });
  var stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  /* 月亮 + 月晕（唯一的冷光源，柔） */
  var moon = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshBasicMaterial({ map: radialTex("rgba(248,246,232,0.90)", "rgba(248,246,232,0)", 128), transparent: true, depthWrite: false })
  );
  moon.position.set(42, 44, -98);
  scene.add(moon);
  var moonGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial({ map: radialTex("rgba(180,206,244,0.22)", "rgba(180,206,244,0)", 128), transparent: true, depthWrite: false })
  );
  moonGlow.position.set(42, 44, -99);
  scene.add(moonGlow);

  /* 极淡的极光：两层很宽很浅的色雾，只给夜空一点层次 */
  var auroraC = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 44),
    new THREE.MeshBasicMaterial({ map: radialTex("rgba(40,140,180,0.16)", "rgba(40,140,180,0)", 128), transparent: true, depthWrite: false })
  );
  auroraC.position.set(-50, 42, -108);
  auroraC.rotation.z = 0.24;
  scene.add(auroraC);
  var auroraM = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 48),
    new THREE.MeshBasicMaterial({ map: radialTex("rgba(150,70,140,0.12)", "rgba(150,70,140,0)", 128), transparent: true, depthWrite: false })
  );
  auroraM.position.set(34, 56, -118);
  auroraM.rotation.z = -0.2;
  scene.add(auroraM);

  /* 桌灯暖光：盘面左侧一小片暖黄，让毡面有被灯照到的一角 */
  var lamp = new THREE.PointLight(0xffc98a, 0.85, 46);
  lamp.position.set(-18, 13, 16);
  scene.add(lamp);
  var lampHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 46),
    new THREE.MeshBasicMaterial({ map: radialTex("rgba(255,196,128,0.13)", "rgba(255,196,128,0)", 128), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  lampHalo.position.set(-18, 4.6, 16);
  lampHalo.rotation.x = -Math.PI / 2;
  scene.add(lampHalo);

  /* 盘面上浮动的光尘：少而缓，像灯下的浮屑 */
  var dustGeo = new THREE.BufferGeometry();
  var dustCount = 60;
  var dustPos = new Float32Array(dustCount * 3);
  var rndD = mulberry(1313);
  for (var di = 0; di < dustCount; di++) {
    dustPos[di * 3]     = (rndD() - 0.5) * 44;
    dustPos[di * 3 + 1] = 1 + rndD() * 8;
    dustPos[di * 3 + 2] = (rndD() - 0.5) * 44;
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  var dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: 0.42, map: starTex, transparent: true, opacity: 0.3,
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

  var PIECES = [
    function cube(mat)   { var g = new THREE.Group(); g.add(box(2.4, 2.4, 2.4, 0, 1.2, 0, mat)); return g; },
    function ballBox(mat){ var g = new THREE.Group(); g.add(box(2.2, 1.2, 2.2, 0, 0.6, 0, mat));
                           var s = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 16), mat);
                           s.position.y = 2.15; s.castShadow = true; g.add(s); return g; },
    function cross(mat)  { var g = new THREE.Group(); g.add(box(0.8, 3.6, 0.8, 0, 1.8, 0, mat));
                           g.add(box(2.4, 0.8, 0.8, 0, 2.9, 0, mat)); return g; },
    function lblock(mat) { var g = new THREE.Group(); g.add(box(2.6, 1.2, 1.3, 0, 0.6, 0, mat));
                           g.add(box(1.3, 3.0, 1.3, -0.65, 1.5, 0, mat)); return g; },
    function arch(mat)   { var g = new THREE.Group(); g.add(box(0.9, 2.2, 1.4, -0.75, 1.1, 0, mat));
                           g.add(box(0.9, 2.2, 1.4, 0.75, 1.1, 0, mat));
                           g.add(box(2.4, 0.9, 1.4, 0, 2.65, 0, mat)); return g; },
    function tower(mat)  { var g = new THREE.Group(); g.add(box(2.4, 0.5, 2.4, 0, 0.25, 0, mat));
                           var t = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 3.4, 14), mat);
                           t.position.y = 2.2; t.castShadow = true; g.add(t); return g; },
    function spire(mat)  { var g = new THREE.Group(); g.add(box(2.0, 0.9, 2.0, 0, 0.45, 0, mat));
                           var c = new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.8, 14), mat);
                           c.position.y = 2.3; c.castShadow = true; g.add(c); return g; },
    function orb(mat)    { var g = new THREE.Group();
                           var t = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 2.4, 12), mat);
                           t.position.y = 1.2; t.castShadow = true; g.add(t);
                           var s = new THREE.Mesh(new THREE.SphereGeometry(0.95, 18, 14), mat);
                           s.position.y = 2.9; s.castShadow = true; g.add(s); return g; }
  ];

  /* 状态 → 材质（每个棋子独立材质，方便悬停高亮）
     毡面桌面版：棋子要「坐在」毡上，所以是厚实的哑光质感，
     不做塑料反光、不做自发光，只靠形状与色相区分状态。 */
  function statusMat(status) {
    if (status === "done")      /* 已成：墨玉，沉、暗、只留一点润 */
      return new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.55, metalness: 0.12 });
    if (status === "growing")   /* 生长：黄铜，暖、厚、微微发亮 */
      return new THREE.MeshStandardMaterial({ color: 0xb9862e, roughness: 0.48, metalness: 0.45 });
    /* 萌芽：灰紫陶土，素、哑、刚捏出来还没上釉 */
    return new THREE.MeshStandardMaterial({ color: 0x6c6a92, roughness: 0.88, metalness: 0.05 });
  }

  function ghostMat() {
    return new THREE.MeshStandardMaterial({
      color: 0x8fb4d8, roughness: 0.9, metalness: 0.0,
      transparent: true, opacity: 0.14, depthWrite: false
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

  ideas.forEach(function (idea, i) {
    var slot = IDEA_SLOTS[i % IDEA_SLOTS.length];
    var make = PIECES[(i * 3 + 1) % PIECES.length];
    var piece = make(statusMat(idea.status));
    piece.position.set((slot[0] - 3.5) * SQ, 0, (slot[1] - 3.5) * SQ);
    piece.userData = {
      idea: idea, baseY: 0, lift: 0,
      ph: Math.random() * Math.PI * 2
    };
    board.add(piece);
    ideaPieces.push(piece);
  });

  /* 未落的子：对面两排的暗色剪影（毡面版不用荧光线框，
     改成更暗更哑的"还没上桌的子"，靠轮廓读出形状） */
  var GHOST_SLOTS = [[0, 0], [2, 0], [4, 0], [6, 0], [7, 0], [1, 1], [3, 1], [5, 1]];
  GHOST_SLOTS.forEach(function (slot, i) {
    var make = PIECES[(i * 5 + 2) % PIECES.length];
    var piece = make(ghostMat());
    piece.position.set((slot[0] - 3.5) * SQ, 0, (slot[1] - 3.5) * SQ);
    piece.position.y = -0.35;          /* 微微沉进毡面：还没拿上来的子 */
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
     视角：手搓轨道（拖动旋转 / 滚轮缩放 / 空闲自转）
     ============================================================ */

  var target = new THREE.Vector3(0, 1.2, 0);
  var orbit = { theta: 0.0, phi: 0.62, radius: 38 };
  var dragging = false, lastX = 0, lastY = 0, idleFor = 99;

  function applyCamera() {
    var cp = Math.cos(orbit.phi), sp = Math.sin(orbit.phi);
    camera.position.set(
      target.x + orbit.radius * cp * Math.sin(orbit.theta),
      target.y + orbit.radius * sp,
      target.z + orbit.radius * cp * Math.cos(orbit.theta)
    );
    camera.lookAt(target);
  }

  canvas.addEventListener("pointerdown", function (e) {
    dragging = true; lastX = e.clientX; lastY = e.clientY; idleFor = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (dragging) {
      orbit.theta -= (e.clientX - lastX) * 0.0052;
      orbit.phi = Math.min(1.25, Math.max(0.30, orbit.phi - (e.clientY - lastY) * 0.004));
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
    e.preventDefault();
    orbit.radius = Math.min(62, Math.max(22, orbit.radius + e.deltaY * 0.03));
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
     主循环
     ============================================================ */

  function resize() {
    var w = canvas.clientWidth || canvas.parentElement.clientWidth;
    var h = canvas.clientHeight || canvas.parentElement.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  var clock = new THREE.Clock();
  var uTime = 0;

  function tick() {
    var dt = Math.min(clock.getDelta(), 0.05);
    var ts = reduce ? 0 : 1;
    uTime += dt * ts;

    /* 空闲自转（游戏感），交互后 4 秒恢复 */
    idleFor += dt;
    if (idleFor > 4 && !dragging) orbit.theta += dt * 0.05 * ts;
    applyCamera();

    /* 深夜氛围动画：星星很轻地眨眼、月与极光面向镜头、光尘缓旋 */
    starMat.opacity = 0.40 + 0.12 * Math.sin(uTime * 1.1) * ts;
    moon.lookAt(camera.position);
    moonGlow.lookAt(camera.position);
    auroraC.lookAt(camera.position);
    auroraM.lookAt(camera.position);
    dust.rotation.y += dt * 0.022 * ts;

    /* 悬停检测 */
    if (pointer.on && ideaPieces.length) {
      raycaster.setFromCamera({ x: pointer.x, y: pointer.y }, camera);
      var hits = raycaster.intersectObjects(ideaPieces, true);
      hovered = hits.length ? rootPiece(hits[0].object) : null;
    } else {
      hovered = null;
    }
    canvas.style.cursor = hovered ? "pointer" : (dragging ? "grabbing" : "grab");

    /* 棋子：悬停抬起 + 鎏金呼吸 */
    ideaPieces.forEach(function (p) {
      var ud = p.userData;
      var want = (hovered === p) ? 1 : 0;
      ud.lift += (want - ud.lift) * 0.16;
      var bob = (ud.idea.status === "growing")
        ? Math.sin(uTime * 0.9 + ud.ph) * 0.12 * ts : 0;
      p.position.y = ud.baseY + ud.lift * 1.1 + bob;
    });

    /* 金光圈跟随悬停棋子 */
    if (hovered) {
      hoverRing.position.x = hovered.position.x;
      hoverRing.position.z = hovered.position.z;
      hoverRing.material.opacity = 0.45 + 0.2 * Math.sin(uTime * 3) * ts;

      if (tip._for !== hovered) {
        tip._for = hovered;
        var idea = hovered.userData.idea;
        tip.textContent = idea.title + " · " + (STATUS_ZH[idea.status] || "萌芽");
        tip.classList.add("idea-tagtip--show");
      }
      tip.style.left = pointer.px + "px";
      tip.style.top = (pointer.py - 18) + "px";
    } else {
      hoverRing.material.opacity = 0;
      if (tip._for) { tip._for = null; tip.classList.remove("idea-tagtip--show"); }
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  tick();
})();
