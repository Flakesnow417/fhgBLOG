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
  /* 千禧深夜：天鹅绒蓝黑夜空，远处化进夜色 */
  scene.background = new THREE.Color(0x070d1f);
  scene.fog = new THREE.Fog(0x070d1f, 46, 130);

  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

  /* ---------- 灯光：月光主光 + 青/品红霓虹补光（Y2K 深夜） ---------- */
  scene.add(new THREE.AmbientLight(0x36466e, 0.65));

  var key = new THREE.DirectionalLight(0xe8f1ff, 0.85);
  key.position.set(-18, 30, 14);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -26; key.shadow.camera.right = 26;
  key.shadow.camera.top = 26; key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 90;
  key.shadow.bias = -0.0008;
  scene.add(key);

  /* 品红轮廓光：Y2K 霓虹的边缘光 */
  var rim = new THREE.DirectionalLight(0xff7ad9, 0.35);
  rim.position.set(16, 12, -18);
  scene.add(rim);

  /* 棋盘下方的青色底光：盘面浮在霓虹上 */
  var under = new THREE.PointLight(0x35c8ff, 0.9, 70);
  under.position.set(0, -7, 6);
  scene.add(under);

  /* ============================================================
     棋盘：墨黑格 × 宣纸木格 + 深木边框
     ============================================================ */

  var SQ = 4;                       /* 格子边长 */
  var board = new THREE.Group();
  scene.add(board);

  /* 8×8 合并网格 + 顶点色：黑曜石格 × 磨砂玻璃格，对比干脆 */
  (function buildSquares() {
    var pos = [], col = [], idx = [];
    var dk = [0.030, 0.048, 0.095], lt = [0.72, 0.80, 0.92];
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
      vertexColors: true, roughness: 0.32, metalness: 0.25
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    board.add(mesh);
  })();

  /* 盘面霓虹网格线：Y2K 的全息投影感 */
  var grid = new THREE.GridHelper(SQ * 8, 8, 0x59e6ff, 0x1c5a80);
  grid.position.y = 0.035;
  grid.material.transparent = true;
  grid.material.opacity = 0.38;
  board.add(grid);

  /* 边框：Y2K 铬合金 + 底部霓虹亮边 */
  var frame = new THREE.Mesh(
    new THREE.BoxGeometry(SQ * 8 + 2.4, 1.0, SQ * 8 + 2.4),
    new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.28, metalness: 0.88 })
  );
  frame.position.y = -0.52;
  frame.receiveShadow = true;
  board.add(frame);

  var edge = new THREE.Mesh(
    new THREE.BoxGeometry(SQ * 8 + 0.5, 0.18, SQ * 8 + 0.5),
    new THREE.MeshStandardMaterial({
      color: 0x2ee6ff, roughness: 0.25, metalness: 0.4,
      emissive: 0x1fb8d8, emissiveIntensity: 0.9
    })
  );
  edge.position.y = 0.02;
  board.add(edge);

  /* 深夜的影子：比平时更深一点 */
  var shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.ShadowMaterial({ opacity: 0.4 })
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = -1.04;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  /* ============================================================
     深夜氛围：星空 + 月亮 + 青品双极光 + 盘面光尘
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

  /* 星空（会慢慢眨眼睛） */
  var starTex = radialTex("rgba(235,245,255,0.95)", "rgba(235,245,255,0)", 64);
  var starCount = 260;
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
    size: 1.7, map: starTex, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false, color: 0xcfe2ff
  });
  var stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  /* 月亮 + 月晕 */
  var moon = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshBasicMaterial({ map: radialTex("rgba(252,248,228,0.95)", "rgba(252,248,228,0)", 128), transparent: true, depthWrite: false })
  );
  moon.position.set(38, 42, -95);
  scene.add(moon);
  var moonGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(42, 42),
    new THREE.MeshBasicMaterial({ map: radialTex("rgba(190,214,255,0.30)", "rgba(190,214,255,0)", 128), transparent: true, depthWrite: false })
  );
  moonGlow.position.set(38, 42, -96);
  scene.add(moonGlow);

  /* Y2K 双极光：左青右品红，斜挂夜空 */
  var auroraC = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 34),
    new THREE.MeshBasicMaterial({ map: radialTex("rgba(46,230,255,0.30)", "rgba(46,230,255,0)", 128), transparent: true, depthWrite: false })
  );
  auroraC.position.set(-46, 44, -105);
  auroraC.rotation.z = 0.28;
  scene.add(auroraC);
  var auroraM = new THREE.Mesh(
    new THREE.PlaneGeometry(130, 38),
    new THREE.MeshBasicMaterial({ map: radialTex("rgba(255,122,217,0.24)", "rgba(255,122,217,0)", 128), transparent: true, depthWrite: false })
  );
  auroraM.position.set(30, 56, -115);
  auroraM.rotation.z = -0.22;
  scene.add(auroraM);

  /* 盘面上浮动的光尘 */
  var dustGeo = new THREE.BufferGeometry();
  var dustCount = 90;
  var dustPos = new Float32Array(dustCount * 3);
  var rndD = mulberry(1313);
  for (var di = 0; di < dustCount; di++) {
    dustPos[di * 3]     = (rndD() - 0.5) * 44;
    dustPos[di * 3 + 1] = 1 + rndD() * 9;
    dustPos[di * 3 + 2] = (rndD() - 0.5) * 44;
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  var dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: 0.55, map: starTex, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, color: 0x7fe8ff
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
     千禧深夜版：萌芽 = 全息青→品红渐变，生长 = 霓虹鎏金，已成 = 黑曜石 */
  function statusMat(status) {
    if (status === "done")
      return new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 0.18, metalness: 0.6 });
    if (status === "growing")
      return new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.26, metalness: 0.8, emissive: 0x6b4a08, emissiveIntensity: 0.6 });
    /* 全息材质：夜色里泛着青紫偏光 */
    return new THREE.MeshStandardMaterial({ color: 0x9fb8ff, roughness: 0.22, metalness: 0.72, emissive: 0x1b2450, emissiveIntensity: 0.5 });
  }

  function ghostMat() {
    return new THREE.MeshStandardMaterial({
      color: 0x67e8ff, roughness: 0.3, metalness: 0.1,
      transparent: true, opacity: 0.20, depthWrite: false
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

  /* 未落的子：对面两排的全息剪影（半透明 + 线框，不可点） */
  var GHOST_SLOTS = [[0, 0], [2, 0], [4, 0], [6, 0], [7, 0], [1, 1], [3, 1], [5, 1]];
  GHOST_SLOTS.forEach(function (slot, i) {
    var make = PIECES[(i * 5 + 2) % PIECES.length];
    var gm = ghostMat();
    var piece = make(gm);
    /* 给全息影子加一层线框，全息感拉满 */
    piece.children.slice().forEach(function (m) {
      if (!m.geometry) return;
      var wire = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({
        color: 0x9df3ff, wireframe: true, transparent: true, opacity: 0.22
      }));
      wire.position.copy(m.position);
      piece.add(wire);
    });
    piece.position.set((slot[0] - 3.5) * SQ, 0, (slot[1] - 3.5) * SQ);
    board.add(piece);
  });

  /* 悬停金光圈：铺在棋子脚下 */
  var hoverRing = new THREE.Mesh(
    new THREE.RingGeometry(1.7, 2.15, 40),
    new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  hoverRing.rotation.x = -Math.PI / 2;
  hoverRing.position.y = 0.05;
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

    /* 深夜氛围动画：星星眨眼、月与极光面向镜头、光尘缓旋 */
    starMat.opacity = 0.62 + 0.24 * Math.sin(uTime * 1.7) * ts;
    moon.lookAt(camera.position);
    moonGlow.lookAt(camera.position);
    auroraC.lookAt(camera.position);
    auroraM.lookAt(camera.position);
    dust.rotation.y += dt * 0.03 * ts;

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
