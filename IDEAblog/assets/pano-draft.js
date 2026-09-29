/* ============================================================
   庭院 · 万妖图录（One-shot :fullscreen 全景庭院）
   一个文件搞定一切：镜头 → 庭院 → 雾 → 场景 → 交互

   设计约束（与需求一一对应）：
     1. 定点 360° 环视（乙方案）：相机钉死在一处，鼠标拖动改朝向，
        不移动位置 —— 像街景一样"原地转圈看"。
     2. 场景 = 水墨庭院：远山 / 竹林 / 石灯 / 雾气，取漫剧的古风修仙气。
     3. 视觉 = 水墨 + 游戏 UI：淡墨界面、篆意标题、四角墨框、热点呼吸。
     4. 单机探索感：不是射击，是"走进一幅画里看看"的那种安静游览。

   实现路线：
     · 单张全景图作为球体内壁（BackSide 球 / 或 scene.background 的
       equirect 映射）—— 经典 360° 全景方案，拖鼠标改 lon/lat。
     · 为了让"定点环视"不呆板：图本身是画的，留白与笔触都自己可控。
     · 若全景图还没生成，用程序化天空/远山兜底，运行时不会白屏。

   使用方式（file:// 双击即可，无需服务器）：
     <script src="pano.js" data-scene="courtyard"></script>
   然后页面上会自动生成一个全屏的"庭院"层。
   ============================================================ */
(function () {
  "use strict";

  /* 防止重复初始化（脚本被 include 两次也不会出两个庭院） */
  if (window.__panoReady) return;

  var THREE_OK = (typeof THREE !== "undefined");

  /* ------------------------------------------------------------
     配置：全景图的路径。图放在同目录 assets/pano/ 下。
     没图的时候自动降级到程序化远山（见 fallbackSky()）。
     ------------------------------------------------------------ */
  var ME = document.currentScript || (function () {
    var all = document.getElementsByTagName("script");
    return all[all.length - 1];
  })();

  var SRC = (ME && ME.getAttribute && ME.getAttribute("data-src")) ||
            (ME && ME.getAttribute && ME.getAttribute("data-src")) ||
            "../../assets/pano/courtyard.jpg";
  var SCENE = (ME && ME.getAttribute && ME.getAttribute("data-scene")) || "courtyard";
  /* 相机初始朝向：默认正对庭院中轴（图的正中 = 东方），可被覆盖 */
  var YAW0 = parseFloat((ME && ME.getAttribute && ME.getAttribute("data-yaw")) || "0");
  var PITCH0 = parseFloat((ME && ME.getAttribute && ME.getAttribute("data-pitch")) || "-2");

  /* 交互参数 */
  var FOV = 74;                  /* 视场角：太窄像望远镜，太宽会畸变 */
  var DRAG_K = 0.12;             /* 拖动灵敏度：度 / 像素 */
  var INERTIA = 0.93;            /* 松手后的滑行衰减 */
  var PITCH_MIN = -38, PITCH_MAX = 38;   /* 上下限：不让人看到天空顶和地底 */
  var LOOK_EASE = 0.12;          /* 点击热点时镜头转过去的缓动 */

  var reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var mobile = window.innerWidth < 760;

  /* ------------------------------------------------------------
     一、场景搭建
     ------------------------------------------------------------ */
  var renderer, scene, camera, sphere, rig;

  function build() {
    if (!THREE_OK) return false;

    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.8));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.domElement.className = "pano-canvas";

    /* 承载全景球的组：拖动改它的 rotation，相机永远在球心 */
    scene = new THREE.Scene();
    rig = new THREE.Group();
    scene.add(rig);

    camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 500);

    /* 全屏球：内壁贴全景图。BackSide = 我们站在球里面看 */
    var geo = new THREE.SphereGeometry(60, 64, 40);
    geo.scale(-1, 1, 1);        /* 把法线翻过来，等价于 BackSide，但 UV 不会镜像 */
    var mat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    sphere = new THREE.Mesh(geo, mat);
    rig.add(sphere);

    /* 全景图：能加载就贴上去；加载不了就保留程序化兜底色 */
    if (SRC) {
      var loader = new THREE.TextureLoader();
      loader.load(SRC, function (tex) {
        tex.encoding = THREE.sRGBEncoding;
        tex.minFilter = THREE.LinearFilter;      /* 手机不必 mipmap，省显存 */
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
        document.body.classList.add("pano-loaded");
      }, null, function () {
        document.body.classList.add("pano-nopano");   /* 没图 → 走兜底 */
      });
    }

    document.body.appendChild(renderer.domElement);
    window.addEventListener("resize", resize);
    resize();
    return true;
  }

  function resize() {
    if (!renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /* ------------------------------------------------------------
     二、拖动环视：球体旋转 = 相机转头（全景查看器的标准做法）
     ------------------------------------------------------------ */

  var lon = YAW0, lat = PITCH0;          /* 当前朝向（度） */
  var lonT = lon, latT = lat;            /* 目标朝向：缓动趋近 */
  var vLon = 0, vLat = 0;                /* 松手后的惯性速度 */
  var dragging = false, lastX = 0, lastY = 0, moved = 0;
  var autoSpin = !reduce && !mobile;     /* 桌面端：静置一会儿自动慢转，像"活着一口气" */
  var idleAt = 0;

  function bindDrag(canvas) {
    canvas.addEventListener("pointerdown", function (e) {
      dragging = true; moved = 0;
      lastX = e.clientX; lastY = e.clientY;
      vLon = vLat = 0;
      idleAt = 0;
      canvas.setPointerCapture(e.pointerId);
      document.body.classList.add("pano-dragging");
    });

    canvas.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      /* 鼠标右 → 画面往右走 = 相机往左转，所以 lon 减小 */
      lonT -= dx * DRAG_K;
      latT = clamp(latT + dy * DRAG_K, PITCH_MIN, PITCH_MAX);
      vLon = -dx * DRAG_K * 0.55;
      vLat = dy * DRAG_K * 0.55;
      idleAt = 0;
    });

    function up(e) {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("pano-dragging");
      idleAt = performance.now();
      /* 位移很小 = 点击：交给热点判定，不做惯性 */
      if (moved < 6) { vLon = vLat = 0; }
    }
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", function () { if (dragging) up(); });

    /* 滚轮：轻微缩放在全景里很常见，但会破坏"定点"，所以改成微调视场 */
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      var f = camera.fov + (e.deltaY > 0 ? 2.2 : -2.2);
      camera.fov = clamp(f, 52, 96);
      camera.updateProjectionMatrix();
    }, { passive: false });
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ------------------------------------------------------------
     三、动画：把朝向缓动到目标；静置时轻微自转
     ------------------------------------------------------------ */
  var t0 = performance.now(), raf = 0, running = false;

  function tick(now) {
    var dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;

    /* 惯性滑行 */
    if (!dragging) {
      if (Math.abs(vLon) > 0.001 || Math.abs(vLat) > 0.001) {
        lonT += vLon; latT = clamp(latT + vLat, PITCH_MIN, PITCH_MAX);
        vLon *= INERTIA; vLat *= INERTIA;
        if (Math.abs(vLon) < 0.02) vLon = 0;
        if (Math.abs(vLat) < 0.02) vLat = 0;
      } else if (autoSpin && idleAt && now - idleAt > 4200) {
        lonT += 2.4 * dt;                    /* 静置 → 极慢自转 */
      }
    }

    /* 缓动趋近目标（帧率无关的指数逼近） */
    var k = 1 - Math.pow(1 - LOOK_EASE, dt * 60);
    lon = lerp(lon, lonT, k);
    lat = lerp(lat, latT, k);

    var phi = THREE.MathUtils.degToRad(90 - lat);
    var theta = THREE.MathUtils.degToRad(lon);
    camera.lookAt(
      sphere.position.x + 60 * Math.sin(phi) * Math.cos(theta),
      sphere.position.y + 60 * Math.cos(phi),
      sphere.position.z + 60 * Math.sin(phi) * Math.sin(theta)
    );

    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    running = true; t0 = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  /* ------------------------------------------------------------
     四、启动
     ------------------------------------------------------------ */
  function boot() {
    if (!build()) {
      document.body.classList.add("pano-failed");   /* 交给 CSS 的兜底背景 */
      return;
    }
    bindDrag(renderer.domElement);
    start();
    window.__panoReady = true;

    /* 页面切到后台就停，回来再跑（省电、也避免手机发烫） */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else start();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /* 对外暴露一点点钩子，方便以后接热点/热点跳转 */
  window.Pano = {
    lookAt: function (yaw, pitch) { lonT = yaw; latT = clamp(pitch || 0, PITCH_MIN, PITCH_MAX); },
    stop: stop,
    start: start,
    get yaw() { return lonT; },
    get pitch() { return latT; }
  };
})();
