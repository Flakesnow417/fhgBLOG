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
  scene.fog = new THREE.Fog(0xf1ede1, 46, 130);   /* 远处化进宣纸色 */

  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

  /* ---------- 灯光：暖主光（带阴影）+ 天光 + 冷轮廓光 ---------- */
  scene.add(new THREE.AmbientLight(0xfff6e8, 0.55));

  var key = new THREE.DirectionalLight(0xffedd5, 0.95);
  key.position.set(-18, 30, 14);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -26; key.shadow.camera.right = 26;
  key.shadow.camera.top = 26; key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 90;
  key.shadow.bias = -0.0008;
  scene.add(key);

  var rim = new THREE.DirectionalLight(0xbdd4e2, 0.35);
  rim.position.set(16, 12, -18);
  scene.add(rim);

  /* ============================================================
     棋盘：墨黑格 × 宣纸木格 + 深木边框
     ============================================================ */

  var SQ = 4;                       /* 格子边长 */
  var board = new THREE.Group();
  scene.add(board);

  var sqLight = new THREE.MeshStandardMaterial({ color: 0xcfc2a2, roughness: 0.8, metalness: 0.02 });
  var sqDark  = new THREE.MeshStandardMaterial({ color: 0x1b232b, roughness: 0.55, metalness: 0.08 });

  for (var f = 0; f < 8; f++) {
    for (var r = 0; r < 8; r++) {
      var sq = new THREE.Mesh(
        new THREE.PlaneGeometry(SQ, SQ),
        (f + r) % 2 ? sqDark : sqLight
      );
      sq.rotation.x = -Math.PI / 2;
      sq.position.set((f - 3.5) * SQ, 0.01, (r - 3.5) * SQ);
      sq.receiveShadow = true;
      board.add(sq);
    }
  }

  /* 边框与底盘 */
  var frame = new THREE.Mesh(
    new THREE.BoxGeometry(SQ * 8 + 2.4, 1.0, SQ * 8 + 2.4),
    new THREE.MeshStandardMaterial({ color: 0x4a3b26, roughness: 0.6, metalness: 0.1 })
  );
  frame.position.y = -0.52;
  frame.receiveShadow = true;
  board.add(frame);

  /* 棋盘点金装边 */
  var edge = new THREE.Mesh(
    new THREE.BoxGeometry(SQ * 8 + 0.5, 0.18, SQ * 8 + 0.5),
    new THREE.MeshStandardMaterial({ color: 0xa8852f, roughness: 0.35, metalness: 0.7 })
  );
  edge.position.y = 0.02;
  board.add(edge);

  /* 棋盘落影：接住整盘棋在宣纸上的软影 */
  var shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.ShadowMaterial({ opacity: 0.17 })
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = -1.04;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

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

  /* 状态 → 材质（每个棋子独立材质，方便悬停高亮） */
  function statusMat(status) {
    if (status === "done")    /* 已成：墨玉，黑亮 */
      return new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.22, metalness: 0.35 });
    if (status === "growing") /* 生长：鎏金 */
      return new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.75, emissive: 0x2a1f05 });
    /* 萌芽：原木，还没雕完 */
    return new THREE.MeshStandardMaterial({ color: 0xb9a888, roughness: 0.75, metalness: 0.02 });
  }

  function ghostMat() {
    return new THREE.MeshStandardMaterial({ color: 0x8d877b, roughness: 0.85, metalness: 0.02 });
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

  /* 未落的子：对面两排的灰色剪影，不可点 */
  var GHOST_SLOTS = [[0, 0], [2, 0], [4, 0], [6, 0], [7, 0], [1, 1], [3, 1], [5, 1]];
  GHOST_SLOTS.forEach(function (slot, i) {
    var make = PIECES[(i * 5 + 2) % PIECES.length];
    var piece = make(ghostMat());
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
