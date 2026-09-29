/**
 * smoke-test.mjs —— 自检：证明 cdp.mjs 真的能连上浏览器、拿像素、派发事件。
 *
 * 跑法（需要被测项目已在 http://127.0.0.1:5173 跑着）：
 *     node smoke-test.mjs
 *
 * 这个脚本本身也是**用法示例**：把 URL / debugGlobal / 谓词换成你自己项目的即可。
 */
import { launch, checker, sat, sleep } from './cdp.mjs'

const URL_ = process.env.TARGET_URL || 'http://127.0.0.1:5173/'

const b = await launch({
  port: 9470,
  debugGlobal: '__PORTFOLIO_DEBUG__', // ← 换项目时改这里
  readyValue: 'done',
})
await b.goto(URL_)

const c = checker()

// --- 1. 页面活着 ---
const phase = await b.evaluate("document.body.dataset.introPhase||''")
c.check(phase === 'done', `进场动画完成（introPhase=${phase}）`)

// --- 2. canvas 撑满视口（R3F 布局最常见的坑）---
const size = await b.json(
  `(() => {
    const cv = document.querySelector('canvas');
    if (!cv) return { err: 'no canvas' };
    const r = cv.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight };
  })()`,
)
c.check(
  size && size.w === size.vw && size.h === size.vh,
  `canvas 撑满视口（${size?.w}x${size?.h} vs ${size?.vw}x${size?.vh}）`,
)

// --- 3. 调试桥挂载 ---
const hasBridge = await b.evaluate(`!!window[${JSON.stringify(b.debugGlobal)}]`)
c.check(hasBridge, '调试桥挂载')

// --- 4. 截图 + 解码（零依赖 PNG）---
const img = await b.shot('E:/fhgBLOG/IDEAblog/.ref/frames/skill-smoke.png')
c.check(img.w === 1248 && img.h === 697, `截图尺寸 ${img.w}x${img.h}`)
c.check(
  img.bpp === 3,
  `colortype=${img.colorType} → bpp=${img.bpp}（Chrome 给的是 RGB，不是 RGBA）`,
)

// --- 5. 像素统计：整体应是低饱和素描质感 ---
let s = 0
let n = 0
for (let y = 100; y < 600; y += 7) {
  for (let x = 100; x < 1100; x += 7) {
    s += sat(img, x, y)
    n++
  }
}
const avg = s / n
c.check(avg < 40, `长廊整体低饱和素描质感（平均饱和 ${avg.toFixed(1)}）`)

// --- 6. 定位一个可上色的画框（谓词式选择）---
// 先把相机固定并朝向某个画框，避免漫游中的相机把目标扫出视野
await b.json(`(() => {
  const d = window.${b.debugGlobal};
  window.__PORTFOLIO_FREEZE_CAMERA__ = true;
  const cam = d.camera;
  cam.position.set(2.0, 2.15, 24);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(0, Math.PI / 2, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return { ok: true };
})()`)
await sleep(300)

const box = await b.projectBox(`(o) => o.material && o.material.userData && o.material.userData.paint`)
c.check(!box.err, `定位到可上色的画框（box=${JSON.stringify(box.box)}）`)

if (!box.err) {
  const [x0, y0, x1, y1] = box.box
  const cx = Math.round((x0 + x1) / 2)
  const cy = Math.round((y0 + y1) / 2)

  const before = await b.shot()
  const beforeSat = sat(before, cx, cy)

  // --- 7. hover：派发真实鼠标事件（不是 JS 模拟事件）---
  await b.hover(cx, cy, 900)
  const cursor = await b.evaluate(
    'document.body.style.cursor || getComputedStyle(document.body).cursor',
  )
  c.check(cursor === 'pointer', `hover 后光标变手型（${cursor}）`)

  const after = await b.shot('E:/fhgBLOG/IDEAblog/.ref/frames/skill-smoke-hover.png')
  const afterSat = sat(after, cx, cy)
  c.check(
    afterSat > beforeSat + 20,
    `hover 后由素描变彩（饱和 ${beforeSat.toFixed(0)} → ${afterSat.toFixed(0)}）`,
  )

  // --- 8. 点击弹窗 ---
  await b.click(cx, cy, 700)
  const dlg = await b.json(
    `(() => {
      const d = document.querySelector('[role=dialog]');
      if (!d) return { open: false };
      const h = d.querySelector('h1,h2,h3');
      return { open: true, title: h ? h.textContent.trim() : null,
               ariaModal: d.getAttribute('aria-modal') };
    })()`,
  )
  c.check(dlg.open, `点击弹窗打开（标题「${dlg?.title}」，aria-modal=${dlg?.ariaModal}）`)

  // --- 9. Esc 关闭 ---
  await b.key('Escape', 'Escape', 27)
  await sleep(500)
  const gone = await b.evaluate("!document.querySelector('[role=dialog]')")
  c.check(gone, 'Esc 关闭弹窗')
}

const failed = c.done('cdp.mjs 冒烟测试')
b.finish('异常统计')

if (failed) process.exit(2)
