/* ============================================================================
 * ideas-perf.js —— 性能测量小工具（默认关闭，不影响任何视觉与交互）
 *
 * 打开方式（任选其一）：
 *   1. 地址栏加参数：ideas.html?perf=1
 *   2. 控制台手动开：__ideaPerf.on()
 *
 * 关闭方式：
 *   - 控制台 __ideaPerf.off()   /  __ideaPerf.toggle()
 *   - 面板右上角「×」按钮
 *   - 再次带 ?perf=0 打开
 *
 * 面板分三段：
 *   ① 帧率：均帧 / 平均FPS / 1% Low / 最差帧 / 丢帧数
 *   ② 首帧：从脚本执行到第一帧绘制完成的耗时拆解
 *   ③ 交互：按键→画面位移 的响应延迟，入局过渡耗时
 *
 * 采样口径说明见页面下方「复制报告」输出的文本，
 * 便于直接贴到 issue / 笔记里做优化前后对比。
 * ========================================================================== */
(function () {
  "use strict";

  var qs = location.search || "";
  var want = /[?&]perf=1\b/.test(qs);
  if (/[?&]perf=0\b/.test(qs)) {
    try { localStorage.removeItem("idea_perf"); } catch (e) {}
    return;
  }
  try {
    if (localStorage.getItem("idea_perf") === "1") want = true;
  } catch (e) {}

  /* ------------------------------------------------------------------ 数据 */

  /* 帧率样本：只统计"有渲染"的帧，避免把空闲期算进去 */
  var frames = [];            /* 每帧间隔 ms */
  var MAX_FRAMES = 1800;      /* 约 30 秒 @60fps，滚动窗口 */
  var windowStart = 0;
  var dropped = 0;            /* 超过 2 倍目标帧长的帧 */
  var targetMs = 1000 / 60;

  var fpsEma = 0;             /* 指数平滑 FPS，用于面板主数字 */
  var lastNow = 0;

  /* 时间口径 —— 只用 performance.now() 这一个时钟，不混用 timeOrigin。
     原因：某些浏览器里 performance.now() 与 performance.timeOrigin
     并不共享同一个零点（实测 HeadlessChrome 下相减直接是负数）。
     混用两个时钟会算出荒谬的值，所以这里统一成"相对本脚本加载时刻"。

     T0 在脚本一载入就取，位置紧跟 ideas-board.js 之后，
     因此"场景就绪 / 首帧画出"都是"相对棋盘脚本刚刚跑完"的小数值，
     精确到毫秒级，且永远非负。 */
  var T0 = performance.now();

  /* 相对 T0 的毫秒数（本页所有埋点统一用这个口径） */
  function since() { return performance.now() - T0; }

  var marks = {
    scriptStart: 0,           /* 页面脚本链起点（近似 0） */
    boardReady: 0,            /* ideas-board.js 建完场景（3D 首帧就绪） */
    firstFrame: 0,            /* 第一帧真的呈现出来 */
    nightReady: 0             /* night.js 天幕就绪 */
  };

  /* T0 对应的"页面已加载"耗时，作为报告里的绝对值参考 */
  var loadedAt = T0;

  /* 收编棋盘脚本在探针加载前留下的事件戳（场景就绪那一刻）。
     它比 T0 早，所以在这里补记成"相对 T0 的负偏移"没有意义 ——
     直接换算成"从页面起到场景就绪"。 */
  var boardStamp = window.__ideaBoardReadyAt;

  /* 场景就绪耗时 = 探针加载时刻 − 场景就绪时刻。
     棋盘脚本先于探针执行，所以这个差值是"整条脚本链跑到 3D 建完"的耗时 */
  var boardCost = boardStamp ? (loadedAt - boardStamp) : 0;

  /* 交互延迟 */
  var inputSamples = [];      /* 按键 → 画面出现位移的 ms */
  var enterSamples = [];      /* 点入局 → 过渡动画跑完的 ms */
  var pendingInput = 0;

  /* ------------------------------------------------------------ 帧率采样 */

  function pushFrame(ms) {
    if (ms <= 0 || ms > 1000) return;      /* 切后台回来的巨大间隔丢掉 */
    frames.push(ms);
    if (frames.length > MAX_FRAMES) frames.shift();

    var inst = 1000 / ms;
    fpsEma = fpsEma ? fpsEma * 0.9 + inst * 0.1 : inst;

    var budget = targetMs * 2;             /* 一般认为 >2 帧预算算掉帧 */
    /* 目标帧长按当前刷新率估：60Hz=16.7ms，120Hz=8.3ms */
    if (ms > budget) dropped++;

    /* 帧率稳定下来了，顺便修正目标帧长（适配 120Hz 屏） */
    if (frames.length > 120) {
      var sorted = frames.slice().sort(function (a, b) { return a - b; });
      var p50 = sorted[Math.floor(sorted.length * 0.5)];
      if (p50 > 0) targetMs = Math.max(4, Math.min(34, p50));
    }
  }

  /* 用一个独立的 rAF 链条采样，不干扰主循环 */
  var frameSeenOnce = false;

  function sampler() {
    var now = performance.now();
    if (lastNow) pushFrame(now - lastNow);
    lastNow = now;
    /* 第二帧才有帧间隔，用第二帧的时刻记"首帧已呈现"更贴近真实 */
    if (!marks.firstFrame && frameSeenOnce) marks.firstFrame = since();
    frameSeenOnce = true;
    requestAnimationFrame(sampler);
  }
  requestAnimationFrame(sampler);

  /* 页面隐藏时停止采样，避免把隐藏期算成"极慢帧" */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      lastNow = 0;
    } else {
      lastNow = 0;                          /* 回来第一帧重新起算 */
    }
  });

  /* ------------------------------------------------------- 交互延迟埋点 */

  /* 记录一次"按键 → 画面位移"的往返。棋盘脚本在移动真正生效时
     会调用 __ideaPerf.markMove()，这里算出耗时。 */
  window.addEventListener("keydown", function (e) {
    if (!pendingInput && /^Arrow|^Key[WASD]$/.test(e.code)) {
      pendingInput = performance.now();
    }
  }, true);

  function markMove() {
    if (!pendingInput) return;
    var dt = performance.now() - pendingInput;
    pendingInput = 0;
    if (dt < 600) {
      inputSamples.push(dt);
      if (inputSamples.length > 200) inputSamples.shift();
    }
  }

  function markEnter(ms) {
    enterSamples.push(ms);
    if (enterSamples.length > 50) enterSamples.shift();
  }

  /* ----------------------------------------------------------- 统计工具 */

  function pct(arr, p) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)));
    return s[i];
  }
  function avg(arr) {
    if (!arr.length) return 0;
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += arr[i];
    return t / arr.length;
  }
  function n1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function n2(v) { return (Math.round(v * 100) / 100).toFixed(2); }

  /* ------------------------------------------------------------- 面板 UI */

  var panel = null, rowsEl = null, rafPanel = 0;

  function buildPanel() {
    if (!want || panel) return;
    panel = document.createElement("div");
    panel.className = "idea-perf";
    panel.innerHTML =
      '<div class="idea-perf-head">' +
        '<span class="idea-perf-title">性能采样</span>' +
        '<button class="idea-perf-btn" data-act="copy" type="button">复制报告</button>' +
        '<button class="idea-perf-btn" data-act="reset" type="button">清零</button>' +
        '<button class="idea-perf-btn idea-perf-x" data-act="close" type="button">×</button>' +
      "</div>" +
      '<div class="idea-perf-body"></div>';
    document.body.appendChild(panel);

    rowsEl = panel.querySelector(".idea-perf-body");

    panel.addEventListener("click", function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
      if (act === "close") off();
      else if (act === "reset") reset();
      else if (act === "copy") copyReport(e.target);
    });

    /* 面板本身用低频更新（4Hz），别让工具自己变成开销 */
    (function loop() {
      render();
      rafPanel = setTimeout(loop, 250);
    })();
  }

  function row(label, value, hint) {
    return '<div class="idea-perf-row">' +
      '<span class="idea-perf-k">' + label + "</span>" +
      '<span class="idea-perf-v">' + value + (hint ? '<em>' + hint + "</em>" : "") + "</span>" +
      "</div>";
  }

  function render() {
    if (!rowsEl) return;
    var meanMs = avg(frames);
    var meanFps = meanMs > 0 ? 1000 / meanMs : 0;
    var oneLow = 1000 / (pct(frames, 0.99) || 1);
    var worst = pct(frames, 1);

    var first = marks.firstFrame ? n1(marks.firstFrame) + " ms" : "—";

    var inAvg = inputSamples.length ? n1(avg(inputSamples)) + " ms" : "—";
    var inMax = inputSamples.length ? n1(pct(inputSamples, 1)) + " ms" : "—";
    var inCount = inputSamples.length ? inputSamples.length + " 次" : "";

    var enAvg = enterSamples.length ? n1(avg(enterSamples)) + " ms" : "—";
    var enMax = enterSamples.length ? n1(pct(enterSamples, 1)) + " ms" : "—";

    rowsEl.innerHTML =
      '<div class="idea-perf-sec">帧率（滚动 ' + frames.length + " 帧）</div>" +
      row("平均 FPS", frames.length ? n1(meanFps) : "—", frames.length ? "均帧 " + n1(meanMs) + "ms" : "") +
      row("1% Low", frames.length ? n1(oneLow) : "—", "卡顿尾部") +
      row("最差帧", frames.length ? n1(worst) + "ms" : "—") +
      row("掉帧数", String(dropped), ">2 帧预算") +

      '<div class="idea-perf-sec">首帧</div>' +
      row("3D 场景就绪", boardCost ? n1(boardCost) + " ms" : "—",
          boardCost ? "建场景总耗时" : "") +
      row("首帧画出", first, marks.firstFrame ? "探针就绪后" : "") +

      '<div class="idea-perf-sec">交互</div>' +
      row("按键 → 位移", inAvg, inCount) +
      row("  最差", inMax) +
      row("入局过渡", enAvg, enterSamples.length ? "最差 " + enMax : "");
  }

  function reportText() {
    var lines = [];
    lines.push("# IDEAblog 性能采样报告");
    lines.push("# 时间 " + new Date().toLocaleString());
    lines.push("# UA " + navigator.userAgent);
    lines.push("# 视口 " + window.innerWidth + "x" + window.innerHeight +
      "  DPR " + (window.devicePixelRatio || 1));
    lines.push("");
    lines.push("[帧率]  样本 " + frames.length + " 帧");
    lines.push("  平均 FPS     " + n1(frames.length ? 1000 / avg(frames) : 0));
    lines.push("  1% Low FPS   " + n1(1000 / (pct(frames, 0.99) || 1)));
    lines.push("  最差帧       " + n1(pct(frames, 1)) + " ms");
    lines.push("  掉帧数       " + dropped);
    lines.push("");
    lines.push("[首帧]");
    lines.push("  3D 场景就绪   " + n1(boardCost) + " ms  (页面起到 3D 建完场景)");
    lines.push("  首帧画出      " + n1(marks.firstFrame) + " ms  (探针就绪后到首帧)");
    lines.push("  (探针载入时页面已耗时 " + n1(loadedAt) + " ms)");
    lines.push("");
    lines.push("[交互]");
    lines.push("  按键→位移  均 " + n1(avg(inputSamples)) + " ms / 最差 " +
      n1(pct(inputSamples, 1)) + " ms  (" + inputSamples.length + " 次)");
    lines.push("  入局过渡   均 " + n1(avg(enterSamples)) + " ms / 最差 " +
      n1(pct(enterSamples, 1)) + " ms  (" + enterSamples.length + " 次)");
    return lines.join("\n");
  }

  function copyReport(btn) {
    var txt = reportText();
    function done() {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = "已复制";
      setTimeout(function () { btn.textContent = old; }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallback(); });
    } else {
      fallback();
    }
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = txt;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      } catch (e) {
        console.log(txt);
      }
    }
    console.log(txt);
    return txt;
  }

  function reset() {
    frames.length = 0;
    inputSamples.length = 0;
    enterSamples.length = 0;
    dropped = 0;
    fpsEma = 0;
    lastNow = 0;
    render();
  }

  /* -------------------------------------------------------- 开关与对外 API */

  var api = {
    on: function () {
      want = true;
      try { localStorage.setItem("idea_perf", "1"); } catch (e) {}
      buildPanel();
      return "性能面板已开启";
    },
    off: function () {
      want = false;
      try { localStorage.removeItem("idea_perf"); } catch (e) {}
      if (rafPanel) { clearTimeout(rafPanel); rafPanel = 0; }
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      panel = null; rowsEl = null;
      return "性能面板已关闭";
    },
    toggle: function () { return want ? api.off() : api.on(); },
    /* 棋盘脚本调用：场景建完 / 第一帧渲染完成 / 走子生效 / 入局过渡结束。
       t 省略时按"相对本探针加载时刻"取当前值（全站统一，不会为负）。 */
    mark: function (name, t) {
      if (name in marks) marks[name] = (t === undefined ? since() : t);
    },
    /* 供其他脚本对齐时间口径 */
    now: since,
    markMove: markMove,
    markEnter: markEnter,
    frames: frames,
    samples: { input: inputSamples, enter: enterSamples },
    report: reportText
  };
  window.__ideaPerf = api;

  function off() { api.off(); }

  if (want) {
    if (document.body) buildPanel();
    else document.addEventListener("DOMContentLoaded", buildPanel);
  }
})();
