/* ============================================================
   一念未落 · 墨迹交互（原生 JS，无任何依赖）
   ------------------------------------------------------------
   1) 鼠标划过 → 淡墨小点，洇开即散
   2) 点击 / 触屏点按 → 一团墨晕
   尊重系统「减少动态效果」设置：开了就完全不生效。
   同屏墨点超过 22 个就不再生成，防止长按拖动时卡顿。
   ============================================================ */
(function () {
  if (window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  var layer = document.createElement("div");
  layer.className = "idea-ink-layer";
  document.body.appendChild(layer);

  var living = 0;

  function spawn(x, y, big) {
    if (living > 22) return;
    living++;

    var dot = document.createElement("span");
    dot.className = "idea-ink" + (big ? " idea-ink--big" : "");

    var size = big ? 46 + Math.random() * 34 : 12 + Math.random() * 12;
    dot.style.width = size + "px";
    dot.style.height = size + "px";
    dot.style.left = x + "px";
    dot.style.top = y + "px";
    /* 每滴墨随机偏移一点方向，像真的洇墨 */
    dot.style.setProperty("--dx", (Math.random() * 12 - 6) + "px");

    layer.appendChild(dot);

    dot.addEventListener("animationend", function () {
      dot.remove();
      living--;
    });
  }

  /* 划过：限频（每 110ms 最多一滴），只跟鼠标不跟手指 */
  var last = 0;
  document.addEventListener("pointermove", function (e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    var now = Date.now();
    if (now - last < 110) return;
    last = now;
    spawn(e.clientX, e.clientY, false);
  }, { passive: true });

  /* 点按：一团墨晕 */
  document.addEventListener("pointerdown", function (e) {
    spawn(e.clientX, e.clientY, true);
  }, { passive: true });
})();
