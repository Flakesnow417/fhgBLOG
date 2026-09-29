/**
 * shot-paint5.mjs —— 抓「同一画框：素描 → 上色中 → 全彩」三连对照图（终版）
 *
 * ==================================================================
 * 这个脚本踩了四版坑，把根因写清楚，因为它对"3D 项目怎么做视觉验证"
 * 有普遍意义：
 *
 *   第 1 版 改 camera.position -> 被 useInfiniteCamera 的 useFrame
 *           每帧覆写，搬了白搬。（"状态只有一个写者"）
 *   第 2/3 版 用鼠标移到画框坐标 -> 鼠标位置本身就是转向输入，
 *           鼠标一偏，相机就转，画框从鼠标底下滑走，pointerout 立刻
 *           触发，hoverArtwork 一闪即灭，maxProgress 恒为 0。
 *           看起来像"上色功能坏了"，其实是鼠标在替相机做转向。
 *   第 4 版 只做 <10px 微调 -> 相机稳住了，但画框在 x=194，
 *           离屏幕中心 624 差了 430px，微调够不到。
 *
 * 终版解法：用项目自带的调试开关 window.__PORTFOLIO_FREEZE_CAMERA__。
 *   useInfiniteCamera 的 useFrame 第一行就检查这个标志，为真时直接
 *   return、不写相机 —— 于是相机成了自由变量，可以随便摆。
 *   而 pointermove 监听器**仍然照常工作**，所以 hover 射线依然准确。
 *   （这个开关本来就是为自动化验证预留的，见 hook 里的注释。）
 *
 * 有了它，整个流程变得非常干净：
 *   1. 冻结相机，自己把相机摆到某个画框正前方；
 *   2. 计算画框的屏幕坐标，移鼠标过去，用 hoverArtwork 确认命中；
 *   3. 保持鼠标不动，连拍整个上色过程；
 *   4. 从过程帧里取首帧（素描）、中间帧（上色中）、末帧（全彩）。
 * ==================================================================
 */
import fs from 'node:fs'
import path from 'node:path'

const CDP = 'file:///C:/Users/Administrator/.workbuddy/skills/webgl-browser-verify/scripts/cdp.mjs'
const { launch, sleep, decodePng, sat } = await import(CDP)

const outDir = process.argv[2] || 'E:/fhgBLOG/newtechnique/images'
const url = process.argv[3] || 'http://127.0.0.1:5173/'
fs.mkdirSync(outDir, { recursive: true })

const b = await launch({
  port: 9958, width: 1248, height: 697, headless: true, timeoutMs: 60000,
  readyExpression: "document.body.dataset.introPhase||''",
  readyValue: 'done', settleMs: 3000,
})

await b.goto(url)

// ---- 1. 冻结相机，把相机摆到第一幅画框正前方 3.4 米 ----------
const placed = await b.json(`(() => {
  const D = window.__PORTFOLIO_DEBUG__;
  const cam = D.camera;
  const V3 = cam.position.constructor;

  // 先冻住，否则下一帧就被 hook 覆写了
  window.__PORTFOLIO_FREEZE_CAMERA__ = true;

  // 找命中平面（PictureFrame 里唯一挂事件的那层）：2.13 x 1.596，
  // 材质 opacity 为 0。用世界矩阵取世界坐标。
  let best = null;
  D.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.geometry.type !== 'PlaneGeometry') return;
    const p = o.geometry.parameters;
    if (!p || Math.abs(p.width - 2.13) > 0.01 || Math.abs(p.height - 1.596) > 0.01) return;
    if (!o.material || o.material.opacity !== 0) return;
    const e = o.matrixWorld.elements;
    const w = new V3(e[12], e[13], e[14]);
    // 取最靠前的（z 最小 = 离起点最近）
    if (!best || w.z < best.w.z) best = { w, o };
  });
  if (!best) return { err: 'no hit plane' };

  const t = best.w.clone();
  const sideSign = t.x >= 0 ? 1 : -1;

  // 站到画框正前方：x 往走道中线收一点，z 在画框前方 3.4
  cam.position.set(t.x - sideSign * 2.55, t.y + 0.06, t.z + 3.4);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(0, 0, 0);
  cam.lookAt(t.x, t.y, t.z);
  cam.updateMatrixWorld(true);

  const ndc = t.clone().project(cam);
  return {
    frame: t.toArray().map(v => Math.round(v * 100) / 100),
    camPos: cam.position.toArray().map(v => Math.round(v * 100) / 100),
    screen: {
      x: Math.round((ndc.x * 0.5 + 0.5) * window.innerWidth),
      y: Math.round((-ndc.y * 0.5 + 0.5) * window.innerHeight),
    },
  };
})()`)
console.log('相机已就位:', JSON.stringify(placed))
if (placed.err) { await b.close(); process.exit(1) }

await sleep(900)

// ---- 2. 鼠标移到画框上，确认 hover 命中 ----------
const sx = placed.screen.x, sy = placed.screen.y
let hit = ''
for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [8, 0], [-8, 0]]) {
  await b.mouse('move', sx + dx, sy + dy, 'none')
  await sleep(220)
  hit = await b.evaluate("document.body.dataset.hoverArtwork||''")
  if (hit) { console.log(`✅ hover 命中: ${hit} @ (${sx + dx},${sy + dy})`); break }
}
if (!hit) { console.error('❌ hover 未命中'); await b.close(); process.exit(1) }

// ---- 3. 保持鼠标不动，连拍整个上色过程 ----------
const frames = []
for (let i = 0; i < 30; i++) {
  const f = path.join(outDir, `_t${String(i).padStart(2, '0')}.png`)
  try { await b.screenshot(f); frames.push(f) } catch {}
  await sleep(120)
}

/*
 * ⚠️ 判据要按「画框区域」算，不能按全屏算。
 *
 * 画框在 1248×697 的屏幕上只占约 150×110 px（≈1.9% 面积）。
 * 早先版本用「全屏彩色像素占比」当判据，结果上色明明成功了
 * （肉眼看立方体已是琥珀色、maxProgress = 1），
 * 全屏占比却始终只有 0.1%，被误判成"上色没发生"。
 *
 * 所以这里先按画框的屏幕包围盒裁一块区域出来，
 * 只在区域内统计彩色占比 —— 这样 0% 到 100% 的动态范围才明显。
 */
const BW = 170, BH = 130
const bx0 = Math.max(0, sx - BW / 2), by0 = Math.max(0, sy - BH / 2)
const bx1 = Math.min(1248, sx + BW / 2), by1 = Math.min(697, sy + BH / 2)

const scored = []
for (const f of frames) {
  try {
    const img = decodePng(fs.readFileSync(f))
    let colored = 0, total = 0
    for (let y = Math.round(by0); y < Math.round(by1); y += 2)
      for (let x = Math.round(bx0); x < Math.round(bx1); x += 2) { total++; if (sat(img, x, y) > 45) colored++ }
    scored.push({ f, pct: Math.round((colored / total) * 1000) / 10 })
  } catch { }
}
console.log('画框区域彩色占比:', scored.map((s) => s.pct).join(' '))

const maxPct = Math.max(...scored.map((s) => s.pct))
const maxProg = await b.evaluate('window.__PORTFOLIO_DEBUG__.paints().maxProgress')
console.log('maxProgress =', maxProg, ' 区域彩色峰值 =', maxPct + '%')

if (maxPct < 8) {
  console.error('❌ 上色未发生（画框区域彩色峰值 ' + maxPct + '%），保留帧供排查')
  await b.close(); process.exit(1)
}

fs.copyFileSync(scored[0].f, path.join(outDir, '04-frame-sketch.png'))
const hi = scored.reduce((a, z) => (z.pct > a.pct ? z : a), scored[0])
const mids = scored.filter((s) => s.pct >= hi.pct * 0.3 && s.pct <= hi.pct * 0.7)
if (mids.length) {
  const m = mids[Math.floor(mids.length / 2)]
  fs.copyFileSync(m.f, path.join(outDir, '05-frame-hover-painting.png'))
  console.log('上色中 ->', m.pct + '%')
}
fs.copyFileSync(hi.f, path.join(outDir, '06-frame-painted.png'))
console.log('全彩 ->', hi.pct + '%')

// ---- 4. 顺便拍一张详情弹窗（相机仍冻结，位置可控） ----------
await b.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1, buttons: 1 })
await sleep(60)
await b.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 1, buttons: 0 })
await sleep(1500)
await b.screenshot(path.join(outDir, '07-detail-modal.png'))
console.log('弹窗 ->', path.join(outDir, '07-detail-modal.png'))

for (const f of frames) { try { fs.unlinkSync(f) } catch {} }
await b.close()
process.exit(0)
