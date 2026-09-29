/* ============================================================
   庭院 · 定点 360° 环视（水墨 + 游戏 UI）
   ------------------------------------------------------------
   用途
     把 ideas.html 的首屏换成一间"水墨庭院"：站在院子中央，
     按住拖动可环视四周（远山 / 竹林 / 石灯 / 雾气），
     不动时极慢自转，像院子里有口气在动。

   原理（全景查看器的标准做法）
     1. 一个半径 50 的球，法线翻转（scale(-1,1,1) = 站在球里面看）。
     2. 球内壁贴一张 equirectangular 全景图（assets/pano/*.png 生成）。
        UV 与球面一一对应，不会像 BackSide 那样左右镜像。
     3. 相机永远在球心，拖动只改"看哪"：
          lon（经度，左右）× lat（纬度，上下）→ lookAt 球面一点。
        ★ 人不动，只转头 —— 这就是"定点环视"。
     4. 松手有惯性滑行；静置 4 秒后极慢自转（可关）。

   全景图怎么来的（不依赖任何外部素材、不联网）
     assets/pano/make-faces.js  用 Canvas 2D 画六面水墨庭院
       face00 东 · face01 南 · face02 西 · face03 北 · face04 天 · face05 地
     assets/pano/make-equirect.js  把六面拼成 4096×2048 全景
       npm 里没有依赖：PNG 编解码、采样、球面映射全部手写
       四面远山用"整圈连续函数"采样 → 接缝处山脊天然对齐
     想改庭院长相：改 make-faces.js 里 sideFace() 的近景分支，
     然后 node make-faces.js && node make-equirect.js。

   降级
     · THREE 没加载 / WebGL 不可用 → 页面回落到原本的夜色背景，
       不会白屏、不会留一块死黑板。
     · 全景图加载失败 → 球保持纸色，场景仍是可环视的"空庭院"。

   对外钩子
     window.Courtyard.lookAt(yaw, pitch)   转到某个方向（度）
     window.Courtyard.on / off             暂停 / 继续渲染
     window.Courtyard.yaw / .pitch         当前朝向
     window.Courtyard.ready                全景图是否已就绪
   ============================================================ */
(function () {
  "use strict";

  if (window.__courtyardReady) return;
  if (typeof THREE === "undefined") return;

  var canvas = document.getElementById("idea-courtyard");
  if (!canvas) return;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
  } catch (e) {
    return;                       /* 交给 CSS 的兜底背景 */
  }

  var reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var mobile = window.innerWidth < 760;

  /* ---------------- 可调参数（想微调手感就改这里） ---------------- */

  var FOV = 74;                 /* 视场角。越大越"广"，越小越像望远镜 */
  var DRAG = 0.125;             /* 拖动灵敏度：角度 / 像素 */
  var INERTIA = 0.93;           /* 松手后的滑行衰减，越大滑得越久 */
  var PITCH_MIN = -34;          /* 抬头 / 低头上限：别让人看到天顶和脚底 */
  var PITCH_MAX = 34;
  var EASE = 0.88;              /* 转向缓动，越小越"黏" */
  var AUTO_SPIN = 1.6;          /* 静置自转速度：度 / 秒（0 = 不自转） */
  var AUTO_DELAY = 4200;        /* 静置多久开始自转（毫秒） */
  var DPR_MAX = mobile ? 1.5 : 1.8;

  var YAW0 = 0;                 /* 初始朝向：0 = 正对东面（竹林夹道 + 石灯） */
  var PITCH0 = -3;

  var WHEEL_MIN = 50, WHEEL_MAX = 96;   /* 滚轮微调视场的范围 */

  /* ---------------- 场景 ---------------- */

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_MAX));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputEncoding = THREE.sRGBEncoding;

  var scene = new THREE.Scene();
  var R = 50;
  var camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, R * 4);

  var geo = new THREE.SphereGeometry(R, 96, 56);
  geo.scale(-1, 1, 1);          /* 翻转法线：我们站在球心往里看 */
  var mat = new THREE.MeshBasicMaterial({ color: 0xf2ede0 });
  var sphere = new THREE.Mesh(geo, mat);
  scene.add(sphere);

  function ready() {
    document.body.classList.add("courtyard-ready");
    window.Courtyard.ready = true;
  }

  /* file:// 直开时 TextureLoader 会因同源限制静默失败，
     所以走 fetch → blob → Image → Texture 这条路，双击也能用。 */
  function loadPano(url) {
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.blob();
      })
      .then(function (b) {
        return new Promise(function (res, rej) {
          var u = URL.createObjectURL(b);
          var img = new Image();
          img.onload = function () { URL.revokeObjectURL(u); res(img); };
          img.onerror = function (e) { URL.revokeObjectURL(u); rej(e); };
          img.src = u;
        });
      })
      .then(function (img) {
        var tex = new THREE.Texture(img);
        tex.encoding = THREE.sRGBEncoding;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.wrapS = THREE.RepeatWrapping;   /* 经度绕一圈要接上 */
        tex.needsUpdate = true;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
        ready();
      })
      .catch(function () {
        /* 图挂了也照样环视：球的纸色就是"空庭院" */
        document.body.classList.add("courtyard-nopano");
        ready();
      });
  }

  var PanoURL = (window.COURTYARD_PANO ||
    (canvas.getAttribute && canvas.getAttribute("data-pano")) ||
    "assets/pano/pano.png");

  loadPano(PanoURL);

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener("resize", resize);
  resize();

  /* ---------------- 环视控制 ---------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var lon = YAW0, lat = PITCH0;
  var lonT = lon, latT = lat;
  var vLon = 0, vLat = 0;
  var dragging = false, lastX = 0, lastY = 0, moved = 0;
  var idleAt = performance.now();
  var autoSpin = !reduce && AUTO_SPIN > 0;

  canvas.addEventListener("pointerdown", function (e) {
    dragging = true; moved = 0;
    lastX = e.clientX; lastY = e.clientY;
    vLon = vLat = 0;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    document.body.classList.add("courtyard-drag");
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    /* 鼠标往右拖 = 想往左看，所以经度减小 */
    lonT -= dx * DRAG;
    latT = clamp(latT + dy * DRAG, PITCH_MIN, PITCH_MAX);
    vLon = -dx * DRAG * 0.55;
    vLat = dy * DRAG * 0.55;
    idleAt = performance.now();
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("courtyard-drag");
    idleAt = performance.now();
    if (moved < 6) { vLon = vLat = 0; }   /* 位移很小 = 点击，不滑行 */
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", endDrag);

  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    camera.fov = clamp(camera.fov + (e.deltaY > 0 ? 2.5 : -2.5), WHEEL_MIN, WHEEL_MAX);
    camera.updateProjectionMatrix();
  }, { passive: false });

  /* ---------------- 主循环 ---------------- */

  var raf = 0, last = 0, paused = false;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (paused) { last = now; return; }
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;

    if (!dragging) {
      /* 惯性滑行 */
      if (Math.abs(vLon) > 0.01 || Math.abs(vLat) > 0.01) {
        lonT += vLon;
        latT = clamp(latT + vLat, PITCH_MIN, PITCH_MAX);
        vLon *= INERTIA; vLat *= INERTIA;
      } else if (autoSpin && now - idleAt > AUTO_DELAY) {
        lonT += AUTO_SPIN * dt;          /* 静置 → 极慢自转 */
      }
    }

    /* 指数逼近，帧率无关 */
    var k = 1 - Math.pow(EASE, dt * 60);
    lon += (lonT - lon) * k;
    lat += (latT - lat) * k;

    var phi = (90 - lat) * Math.PI / 180;
    var th = lon * Math.PI / 180;
    camera.lookAt(
      R * Math.sin(phi) * Math.cos(th),
      R * Math.cos(phi),
      R * Math.sin(phi) * Math.sin(th)
    );

    renderer.render(scene, camera);
    window.Courtyard.yaw = lonT;
    window.Courtyard.pitch = latT;
    if (window.Courtyard.onFrame) window.Courtyard.onFrame(lonT, latT);
  }

  document.addEventListener("visibilitychange", function () {
    paused = document.hidden;
    if (!paused) last = 0;
  });

  /* ---------------- 对外接口 ---------------- */

  window.Courtyard = {
    ready: false,
    lookAt: function (yaw, pitch) {
      lonT = yaw;
      latT = clamp(pitch === undefined ? latT : pitch, PITCH_MIN, PITCH_MAX);
      idleAt = performance.now();
    },
    on: function () { paused = false; last = 0; },
    off: function () { paused = true; },
    yaw: lonT,
    pitch: latT,
    /* 每帧回调：以后要挂"热点随视线高亮"就接这里 */
    onFrame: null,
    /* 想动态换全景图（比如切季节）就调它 */
    setPano: function (url) { loadPano(url); }
  };

  raf = requestAnimationFrame(frame);
  window.__courtyardReady = true;
})();
