/* ============================================================
   一念未落 · 一念入海（Three.js 真 3D，滚动下潜 + 第一人称视角）
   ------------------------------------------------------------
   场景五幕：云端俯瞰 → 鼠标转视角 → 滚动下潜掠过山巅
             → 字阵从身边掠过（可点击）→ 停驻水面太极之上。

   空间结构（沿用用户的三轴定义）：
     xy 平面 = 景：低多边形水墨群山（雾中越远越淡）
               + 着色器波动的墨河水面 + 漂浮雾团 + 光尘
     z  轴   = 标签字：鎏金/哑金书法字悬浮在下潜路径两侧，
               billboard 永远朝向你的视线，射线拾取点击跳页。

   ★ 你以后只改 TAGS：加一条 = 多一枚空间里的可点标签字。
   注：使用 UMD 传统脚本版 three.min.js（全局 THREE），
       双击 file:// 打开也能跑，不挑协议。
   ============================================================ */

(function () {
  /* three.min.js 没加载成功（比如文件丢失）→ 直接降级 */
  if (typeof THREE === "undefined") {
    document.body.classList.add("idea-no-webgl");
    return;
  }

  var canvas = document.getElementById("idea-gl");
  if (!canvas) return;

  /* ---------- 渲染器（失败则降级为静态封面） ---------- */
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  } catch (e) {
    document.body.classList.add("idea-no-webgl");
    return;
  }
  window.IDEA_GL_READY = true;

  var reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var mobile = window.innerWidth < 720;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.4 : 1.6));
  renderer.outputEncoding = THREE.sRGBEncoding;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1822);
  scene.fog = new THREE.FogExp2(0x13222e, 0.011);

  var camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1200);

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

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
     一、墨河水面：着色器顶点波动 + 波峰冷光 + 手工雾
     ============================================================ */

  var waterUniforms = {
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0x13222e) },
    uFogDensity: { value: 0.011 }
  };

  var waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: [
      "uniform float uTime;",
      "varying float vElev;",
      "varying float vViewZ;",
      "varying float vWX;",
      "varying float vWY;",
      "float wave(vec2 p, float t){",
      "  return sin(p.x*0.055 + t*0.9)*1.1",
      "       + sin(p.y*0.042 + t*0.65)*1.5",
      "       + sin((p.x+p.y)*0.028 + t*0.45)*1.9",
      "       + sin(length(p)*0.05 - t*0.7)*0.8;",
      "}",
      "void main(){",
      "  vec3 pos = position;",
      "  float e = wave(pos.xy, uTime);",
      "  pos.z += e;",
      "  vElev = e;",
      "  vWX = pos.x;",
      "  vWY = pos.y;",
      "  vec4 mv = modelViewMatrix * vec4(pos, 1.0);",
      "  vViewZ = -mv.z;",
      "  gl_Position = projectionMatrix * mv;",
      "}"
    ].join("\n"),
    fragmentShader: [
      "uniform vec3 uFogColor;",
      "uniform float uFogDensity;",
      "uniform float uTime;",
      "varying float vElev;",
      "varying float vViewZ;",
      "varying float vWX;",
      "varying float vWY;",
      "void main(){",
      "  vec3 deep = vec3(0.030, 0.055, 0.075);",
      "  vec3 mid  = vec3(0.100, 0.150, 0.185);",
      "  vec3 col = mix(deep, mid, smoothstep(-2.6, 2.6, vElev));",
      "  float crest = smoothstep(1.8, 2.8, vElev);",
      "  col += vec3(0.38, 0.52, 0.60) * crest * 0.65;",
      /* 月光湖道：月亮在水面拖出的反光光路（水墨湖泊的灵魂） */
      "  float band = exp(-pow((vWX - 24.0) / 26.0, 2.0));",
      "  float shimmer = 0.55 + 0.45 * sin(vWY * 0.55 + uTime * 1.6) * sin(vWX * 0.35 - uTime * 0.9);",
      "  col += vec3(0.52, 0.62, 0.66) * band * shimmer * 0.30;",
      "  float f = 1.0 - exp(-uFogDensity*uFogDensity*vViewZ*vViewZ);",
      "  col = mix(col, uFogColor, clamp(f, 0.0, 1.0));",
      "  gl_FragColor = vec4(col, 1.0);",
      "}"
    ].join("\n")
  });

  var water = new THREE.Mesh(new THREE.PlaneGeometry(700, 700, 110, 110), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, -60);
  scene.add(water);

  /* ============================================================
     二、水墨群山：山脊帷幕几何体（顶点色：脊浓脚淡，雾负责推远）
     ============================================================ */

  function makeRange(seed, width, topH, toneK) {
    var segs = 130;
    var pos = [], col = [], idx = [];
    var rnd = mulberry(seed);
    var p1 = rnd() * 6.283, p2 = rnd() * 6.283, p3 = rnd() * 6.283;
    for (var i = 0; i <= segs; i++) {
      var t = i / segs;
      var x = -width / 2 + width * t;
      var y = topH * (0.55
        + 0.30 * Math.sin(t * 6.283 * 2.1 + p1)
        + 0.18 * Math.sin(t * 6.283 * 4.7 + p2)
        + 0.10 * Math.sin(t * 6.283 * 9.3 + p3));
      pos.push(x, -14, 0, x, y, 0);
      /* 山脚青灰，山脊按 toneK 提亮（远山更淡更冷） */
      col.push(0.030, 0.046, 0.062,
               0.105 * toneK, 0.140 * toneK, 0.168 * toneK);
      if (i < segs) {
        var a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    var mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    return new THREE.Mesh(geo, mat);
  }

  [
    { seed: 11, w: 280, h: 42,  z: -38,  x: -20, k: 1.00 },
    { seed: 47, w: 360, h: 54,  z: -80,  x: 30,  k: 1.15 },
    { seed: 83, w: 460, h: 68,  z: -135, x: -40, k: 1.32 },
    { seed: 129, w: 580, h: 88, z: -210, x: 20,  k: 1.55 }
  ].forEach(function (m) {
    var range = makeRange(m.seed, m.w, m.h, m.k);
    range.position.set(m.x, 0, m.z);
    scene.add(range);
  });

  /* ============================================================
     三、雾团 + 光尘（游戏感的空气）
     ============================================================ */

  function radialTex(inner, outer) {
    var s = 128, c = document.createElement("canvas");
    c.width = c.height = s;
    var g = c.getContext("2d");
    var grad = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  /* 高空雾团 + 贴水面的湖雾（水墨湖泊的平远雾气） */
  var mistTex = radialTex("rgba(158,190,205,0.55)", "rgba(158,190,205,0)");
  var mists = [];
  [[-30, 12, -55, 150, 40], [40, 18, -95, 190, 50], [-50, 22, -150, 240, 60],
   [15, 5, -40, 130, 22], [-25, 6, -75, 160, 26]].forEach(function (m) {
    var mat = new THREE.MeshBasicMaterial({
      map: mistTex, transparent: true, opacity: 0.22, depthWrite: false
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(m[3], m[4]), mat);
    mesh.position.set(m[0], m[1], m[2]);
    scene.add(mesh);
    mists.push(mesh);
  });

  var dotTex = radialTex("rgba(190,215,228,0.9)", "rgba(190,215,228,0)");
  var pCount = mobile ? 120 : 240;
  var pGeo = new THREE.BufferGeometry();
  var pPos = new Float32Array(pCount * 3);
  var rndP = mulberry(777);
  for (var i = 0; i < pCount; i++) {
    pPos[i * 3]     = (rndP() - 0.5) * 160;
    pPos[i * 3 + 1] = 2 + rndP() * 70;
    pPos[i * 3 + 2] = 120 - rndP() * 280;
  }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  var particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 1.5, map: dotTex, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, color: 0x9ec6d6
  }));
  scene.add(particles);

  /* ---------- 湖上月：月轮 + 月晕（月光湖道的源头） ---------- */

  var moonTex = radialTex("rgba(252,248,228,0.95)", "rgba(252,248,228,0)");
  var moonGlowTex = radialTex("rgba(214,228,236,0.34)", "rgba(214,228,236,0)");
  var moon = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 13),
    new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, depthWrite: false })
  );
  moon.position.set(24, 62, -180);
  scene.add(moon);
  var moonGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshBasicMaterial({ map: moonGlowTex, transparent: true, depthWrite: false, opacity: 0.85 })
  );
  moonGlow.position.set(24, 62, -181);
  scene.add(moonGlow);

  /* ============================================================
     四、水面太极 + 涟漪圈
     ============================================================ */

  function taijiTexture() {
    var s = 512, c = document.createElement("canvas");
    c.width = c.height = s;
    var g = c.getContext("2d");
    var m = s / 2;
    function ring(r, a, lw) {
      g.strokeStyle = "rgba(158,198,214," + a + ")";
      g.lineWidth = lw;
      g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.stroke();
    }
    ring(190, 0.55, 3);
    ring(142, 0.34, 2);
    ring(96, 0.22, 1.6);
    g.strokeStyle = "rgba(158,198,214,0.36)";
    g.lineWidth = 2.2;
    g.beginPath();
    g.arc(m, m - 95, 95, Math.PI / 2, Math.PI * 1.5, true);
    g.arc(m, m + 95, 95, Math.PI / 2, Math.PI * 1.5, false);
    g.stroke();
    [m - 95, m + 95].forEach(function (ey) {
      var grad = g.createRadialGradient(m, ey, 0, m, ey, 16);
      grad.addColorStop(0, "rgba(190,225,238,0.55)");
      grad.addColorStop(1, "rgba(190,225,238,0)");
      g.fillStyle = grad;
      g.fillRect(m - 16, ey - 16, 32, 32);
    });
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  var taiji = new THREE.Mesh(
    new THREE.PlaneGeometry(52, 52),
    new THREE.MeshBasicMaterial({ map: taijiTexture(), transparent: true, opacity: 0.85, depthWrite: false })
  );
  taiji.rotation.x = -Math.PI / 2;
  taiji.position.set(0, 0.4, -78);
  scene.add(taiji);

  var ripples = [];
  for (var r = 0; r < 5; r++) {
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48),
      new THREE.MeshBasicMaterial({
        color: 0xaad0e0, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set((mulberry(r * 31 + 5)() - 0.5) * 90, 0.35, -30 - mulberry(r * 17 + 9)() * 90);
    ring.userData.life = r * 0.8;
    scene.add(ring);
    ripples.push(ring);
  }

  /* ============================================================
     五、z 轴 · 标签字（billboard + 射线拾取）
     ★★★ 你以后只改这张表 ★★★
     ============================================================ */

  var TAGS = [
    { ch: "册", label: "想法集",   href: "ideas.html",           pos: [8, 15, 42],   z: 0.95, gold: true },
    { ch: "词", label: "道家词库", href: "ideas/dao-notes.html", pos: [-11, 11, 12], z: 0.88, gold: true },
    { ch: "画", label: "封面自述", href: "ideas/ink-cover.html", pos: [12, 8, -14],  z: 0.82, gold: true },
    { ch: "我", label: "关于我",   href: "about.html",           pos: [-9, 13, 66],  z: 0.74, gold: true },
    { ch: "梦", label: "预留",     href: "",                     pos: [13, 6, -38],  z: 0.66, gold: false },
    { ch: "影", label: "预留",     href: "",                     pos: [-14, 9, -8],  z: 0.58, gold: false },
    { ch: "书", label: "预留",     href: "",                     pos: [10, 14, 24],  z: 0.52, gold: false },
    { ch: "游", label: "预留",     href: "",                     pos: [-12, 7, -30], z: 0.46, gold: false }
  ];

  var AIR_POOL = "水墨云山空无心剑仙";
  var rndAir = mulberry(2026);
  var AIR = [];
  for (var a = 0; a < 10; a++) {
    AIR.push({
      ch: AIR_POOL[(a * 3 + ((rndAir() * 7) | 0)) % AIR_POOL.length],
      pos: [(rndAir() - 0.5) * 55, 4 + rndAir() * 22, 80 - rndAir() * 150],
      ph: rndAir() * Math.PI * 2
    });
  }

  var FONT_BRUSH = "\"Ma Shan Zheng\",\"STKaiti\",\"KaiTi\",serif";

  function charTexture(ch, style) {
    var s = 256, c = document.createElement("canvas");
    c.width = c.height = s;
    var g = c.getContext("2d");
    g.font = "172px " + FONT_BRUSH;
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (style === "gold") {
      g.fillStyle = "#5d4718";
      for (var k = 5; k >= 1; k--) {
        g.globalAlpha = 0.35 + k * 0.12;
        g.fillText(ch, s / 2 + k * 1.6, s / 2 + k * 2.0);
      }
      g.globalAlpha = 1;
      g.shadowColor = "rgba(238,200,100,0.95)";
      g.shadowBlur = 40;
      var grd = g.createLinearGradient(0, s * 0.14, 0, s * 0.86);
      grd.addColorStop(0, "#faecae");
      grd.addColorStop(0.45, "#e6c46a");
      grd.addColorStop(1, "#9c7427");
      g.fillStyle = grd;
      g.fillText(ch, s / 2, s / 2);
      g.shadowBlur = 0;
    } else if (style === "dim") {
      g.shadowColor = "rgba(190,170,120,0.35)";
      g.shadowBlur = 12;
      var gd = g.createLinearGradient(0, s * 0.15, 0, s * 0.85);
      gd.addColorStop(0, "#c9bfa0");
      gd.addColorStop(0.5, "#a59872");
      gd.addColorStop(1, "#6d6349");
      g.fillStyle = gd;
      g.fillText(ch, s / 2, s / 2);
      g.shadowBlur = 0;
    } else {
      g.fillStyle = "rgba(14,20,26,0.92)";
      g.fillText(ch, s / 2, s / 2);
      g.strokeStyle = "rgba(158,196,212,0.32)";
      g.lineWidth = 1.4;
      g.strokeText(ch, s / 2, s / 2);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
  }

  /* 可点标签的金色光晕纹理（只有能点进去的鎏金字才有） */
  var haloTex = radialTex("rgba(244,210,116,0.60)", "rgba(244,210,116,0)");

  var tagMeshes = [];
  var airMeshes = [];

  function buildTags() {
    TAGS.forEach(function (c) {
      var size = 3.4 + 3.4 * c.z;
      var mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({
          map: charTexture(c.ch, c.gold ? "gold" : "dim"),
          transparent: true, depthWrite: false, side: THREE.DoubleSide
        })
      );
      mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
      mesh.userData = {
        href: c.href, label: c.label, z: c.z,
        baseY: c.pos[1], ph: Math.random() * Math.PI * 2,
        pulse: 0, scaleT: 1, size: size
      };
      if (c.gold) {
        var halo = new THREE.Mesh(
          new THREE.PlaneGeometry(size * 2.1, size * 2.1),
          new THREE.MeshBasicMaterial({
            map: haloTex, transparent: true, opacity: 0.32,
            blending: THREE.AdditiveBlending, depthWrite: false
          })
        );
        halo.position.z = -0.05;
        halo.renderOrder = -1;
        mesh.add(halo);
        mesh.userData.halo = halo;
      }
      scene.add(mesh);
      tagMeshes.push(mesh);
    });
    AIR.forEach(function (c) {
      var size = 3.2 + rndAir() * 2.2;
      var mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({
          map: charTexture(c.ch, "air"),
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
          opacity: 0.6
        })
      );
      mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
      mesh.userData = { baseY: c.pos[1], ph: c.ph };
      scene.add(mesh);
      airMeshes.push(mesh);
    });
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { if (!tagMeshes.length) buildTags(); });
  }
  setTimeout(function () { if (!tagMeshes.length) buildTags(); }, 2400);

  /* ---------- 悬停提示牌（fixed，投影定位） ---------- */

  var tip = document.createElement("div");
  tip.className = "idea-tagtip";
  document.body.appendChild(tip);
  var tipMesh = null;

  /* ============================================================
     六、相机路径 + 滚动驱动 + 鼠标视角
     ============================================================ */

  var PATH = [
    { t: 0.00, pos: [0, 92, 150],   look: [0, 8, 0] },
    { t: 0.32, pos: [12, 50, 70],   look: [-6, 8, -30] },
    { t: 0.66, pos: [-10, 20, 10],  look: [0, 6, -50] },
    { t: 1.00, pos: [0, 6.5, -32],  look: [0, 4, -90] }
  ];

  function smoothstep(u) { return u * u * (3 - 2 * u); }

  function pathAt(t) {
    var i = 0;
    while (i < PATH.length - 2 && t > PATH[i + 1].t) i++;
    var a = PATH[i], b = PATH[i + 1];
    var u = smoothstep(Math.min(Math.max((t - a.t) / (b.t - a.t), 0), 1));
    return {
      pos: [0, 1, 2].map(function (k) { return a.pos[k] + (b.pos[k] - a.pos[k]) * u; }),
      look: [0, 1, 2].map(function (k) { return a.look[k] + (b.look[k] - a.look[k]) * u; })
    };
  }

  var scrollT = 0, scrollCur = 0;
  function readScroll() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    scrollT = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
  }
  window.addEventListener("scroll", readScroll, { passive: true });
  readScroll();

  var lookX = 0, lookY = 0, lookTX = 0, lookTY = 0;
  var ndc = new THREE.Vector2(-2, -2);

  window.addEventListener("pointermove", function (e) {
    lookTX = (e.clientX / window.innerWidth) * 2 - 1;
    lookTY = (e.clientY / window.innerHeight) * 2 - 1;
    ndc.x = lookTX;
    ndc.y = -lookTY;
  }, { passive: true });

  /* ---------- 点击：射线拾取标签字 ---------- */

  var raycaster = new THREE.Raycaster();

  window.addEventListener("pointerdown", function (e) {
    if (!tagMeshes.length) return;
    var v = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -((e.clientY / window.innerHeight) * 2 - 1)
    );
    raycaster.setFromCamera(v, camera);
    var hits = raycaster.intersectObjects(tagMeshes);
    if (hits.length) {
      var ud = hits[0].object.userData;
      if (ud.href) window.location.href = ud.href;
      else ud.pulse = 1;
    }
  });

  /* ---------- DOM 覆盖层 ---------- */

  var titleEl = document.querySelector(".idea-titleblock");
  var hintEl = document.querySelector(".idea-hintline");
  var endEl = document.getElementById("idea-dive-end");

  /* ============================================================
     七、主循环
     ============================================================ */

  var clock = new THREE.Clock();
  var uTime = 0;
  var hoverCheck = 0;
  var hovered = null;
  var v3 = new THREE.Vector3();

  function tick() {
    var dt = Math.min(clock.getDelta(), 0.05);
    var ts = reduce ? 0 : 1;                 /* 减少动态：冻结波动/漂浮，滚动视角照常 */
    uTime += dt * ts;

    /* 滚动（平滑）→ 相机路径 */
    scrollCur += (scrollT - scrollCur) * 0.07;
    var p = pathAt(scrollCur);

    /* 鼠标视角（平滑） */
    lookX += (lookTX - lookX) * 0.06;
    lookY += (lookTY - lookY) * 0.06;

    camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
    camera.lookAt(p.look[0], p.look[1], p.look[2]);
    camera.rotateY(-lookX * 0.42);
    camera.rotateX(-lookY * 0.26);

    /* 水面时间 */
    waterUniforms.uTime.value = uTime;

    /* 太极慢转 + 涟漪循环 */
    taiji.rotation.z += dt * 0.05 * ts;
    ripples.forEach(function (ring) {
      ring.userData.life += dt * ts;
      var life = ring.userData.life % 3.2;
      var k = life / 3.2;
      ring.scale.setScalar(1 + k * 15);
      ring.material.opacity = 0.4 * (1 - k);
    });

    /* 雾团漂浮 + 面向相机 */
    mists.forEach(function (m, i) {
      m.position.x += Math.sin(uTime * 0.08 + i * 2.1) * 0.008 * ts;
      m.lookAt(camera.position);
    });

    /* 光尘缓旋 */
    particles.rotation.y += dt * 0.006 * ts;

    /* 标签字：面向相机 + 漂浮 + 脉冲/悬停缩放 */
    tagMeshes.forEach(function (m) {
      var ud = m.userData;
      m.lookAt(camera.position);
      m.position.y = ud.baseY + Math.sin(uTime * 0.5 + ud.ph) * (0.4 + ud.z * 0.5) * ts;
      if (ud.halo) {
        /* 金光呼吸；悬停时更亮 */
        ud.halo.material.opacity =
          (hovered === m ? 0.52 : 0.30) + 0.10 * Math.sin(uTime * 0.8 + ud.ph) * ts;
      }
      if (ud.pulse > 0) ud.pulse = Math.max(0, ud.pulse - dt * 2.2);
      var target = (hovered === m ? 1.14 : 1) + ud.pulse * 0.12;
      ud.scaleT += (target - ud.scaleT) * 0.15;
      m.scale.setScalar(ud.scaleT);
    });
    airMeshes.forEach(function (m) {
      m.lookAt(camera.position);
      m.position.y = m.userData.baseY + Math.sin(uTime * 0.35 + m.userData.ph) * 0.5 * ts;
    });

    /* 悬停检测（节流） */
    hoverCheck -= dt;
    if (hoverCheck <= 0 && tagMeshes.length) {
      hoverCheck = 0.09;
      if (ndc.x > -1.5) {
        raycaster.setFromCamera(ndc, camera);
        var hits = raycaster.intersectObjects(tagMeshes);
        hovered = hits.length ? hits[0].object : null;
      } else {
        hovered = null;
      }
      canvas.style.cursor = (hovered && hovered.userData.href) ? "pointer" : "default";
    }

    /* 提示牌跟随（世界坐标 → 屏幕） */
    if (hovered) {
      if (tipMesh !== hovered) {
        tipMesh = hovered;
        tip.textContent = hovered.userData.label + (hovered.userData.href ? "" : " · 未落笔");
        tip.classList.add("idea-tagtip--show");
      }
      v3.copy(hovered.position).project(camera);
      tip.style.left = ((v3.x * 0.5 + 0.5) * window.innerWidth) + "px";
      tip.style.top = ((-v3.y * 0.5 + 0.5) * window.innerHeight - hovered.userData.size * 14) + "px";
    } else if (tipMesh) {
      tipMesh = null;
      tip.classList.remove("idea-tagtip--show");
    }

    /* 覆盖层淡出/淡入 */
    if (titleEl) titleEl.style.opacity = Math.max(0, 1 - scrollCur * 3.2);
    if (hintEl) hintEl.style.opacity = scrollCur < 0.06 ? 1 : Math.max(0, 1 - (scrollCur - 0.06) * 10);
    if (endEl) endEl.classList.toggle("show", scrollCur > 0.93);

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  tick();
})();
