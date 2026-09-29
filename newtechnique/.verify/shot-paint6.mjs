/**
 * shot-paint6.mjs —— 用 freeze 钉住进度，拍「素描 / 上色中 / 全彩」三连图
 *
 * ==================================================================
 * 为什么不能用「hover 后连拍」抓中间态：
 *   usePaintReveal 的 revealRate = 9.0，progress 是指数逼近，
 *   从 0 到 0.95 只要约 0.11 秒。而 CDP 一次 screenshot 往返
 *   就要 100ms 上下 —— 等第一张图落盘，上色早就完成了。
 *   实测：连拍 30 张，区域彩色占比恒为 22%，一张中间态都没有。
 *
 * 正确做法：用项目自带的 reveal.freeze(key, value) 把 progress
 *   钉死在指定值上（这正是当初做这个调试接口的目的，见
 *   src/utils/revealRegistry.js 的注释）。
 *   钉住之后画面是静止的，想拍多久拍多久。
 *
 * 暴露给脚本的接口（DebugBridge）：
 *   window.__PORTFOLIO_DEBUG__.reveal.ids()        -> ['rev-1', ...]
 *   window.__PORTFOLIO_DEBUG__.reveal.freeze(k, v) -> 把第 k 个钉在 v
 *   window.__PORTFOLIO_DEBUG__.reveal.freezeAll(v) -> 全部钉在 v
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
  port: 9959, width: 1248, height: 697, headless: true, timeoutMs: 60000,
  readyExpression: "document.body.dataset.introPhase||''",
  readyValue: 'done', settleMs: 3000,
})

await b.goto(url)

// ---- 1. 冻结相机并摆到第一幅画框正前方 3.4 米 ----
const placed = await b.json(`(() => {
  const D = window.__PORTFOLIO_DEBUG__;
  const cam = D.camera;
  const V3 = cam.position.constructor;
  window.__PORTFOLIO_FREEZE_CAMERA__ = true;

  let best = null;
  D.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.geometry.type !== 'PlaneGeometry') return;
    const p = o.geometry.parameters;
    if (!p || Math.abs(p.width - 2.13) > 0.01 || Math.abs(p.height - 1.596) > 0.01) return;
    if (!o.material || o.material.opacity !== 0) return;
    const e = o.matrixWorld.elements;
    const w = new V3(e[12], e[13], e[14]);
    if (!best || w.z < best.w.z) best = { w };
  });
  if (!best) return { err: 'no hit plane' };

  const t = best.w.clone();
  const sign = t.x >= 0 ? 1 : -1;
  cam.position.set(t.x - sign * 2.55, t.y + 0.06, t.z + 3.4);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(0, 0, 0);
  cam.lookAt(t.x, t.y, t.z);
  cam.updateMatrixWorld(true);

  const ndc = t.clone().project(cam);
  return {
    screen: {
      x: Math.round((ndc.x * 0.5 + 0.5) * window.innerWidth),
      y: Math.round((-ndc.y * 0.5 + 0.5) * window.innerHeight),
    },
    ids: D.reveal.ids(),
  };
})()`)
console.log('相机已就位:', JSON.stringify(placed))
if (placed.err) { await b.close(); process.exit(1) }

const sx = placed.screen.x, sy = placed.screen.y

// ---- 2. 找出哪一幅画被 hover 命中（它的 freeze key 我们要单独处理） ----
// 先把鼠标放上去拿到 artworkId，然后立刻 freezeAll(null) 解除 hover 干扰，
// 改为纯手工控制进度。
await b.mouse('move', sx, sy, 'none')
await sleep(240)
const hoverId = await b.evaluate("document.body.dataset.hoverArtwork||''")
console.log('hover 命中:', hoverId || '(无)')

// 鼠标移开、解除 hover，再用 freeze 手工摆状态
await b.mouse('move', 60, 640, 'none')
await sleep(500)
await b.evaluate('window.__PORTFOLIO_DEBUG__.reveal.freezeAll(null)')
await sleep(400)

// ---- 3. 逐个快照：progress = 0 / 0.35 / 0.55 / 0.75 / 1.0 ----
//
// ⚠️ 只 freeze「目标那一幅」，不要用 freezeAll。
//    freezeAll 会把长廊里 12 个已登记画框**全部**钉到同一进度，
//    远景画框跟着一起变色，对照图就失去了"这一幅被上色、其他仍是
//    素描"的说服力。freeze(key, v) 才是精确控制。
//
//    但怎么知道目标画框的 key？—— 注册表键是实例序号（rev-N），
//    与 artworkId 不是一对一（长廊循环映射，同一 id 有多个实例）。
//    办法：先 freezeAll(0) 把全部清零，再只对目标那一幅设值。
//    目标实例的 key 通过 DebugBridge 的 paints() 拿不到，
//    所以这里换个思路：用 hover 触发它自己的 setTarget，
//    再立刻 freeze 住它的进度 —— 但 freeze 需要 key……
//
//    最简可靠的办法：先全部清零（freezeAll(0)），然后逐个 key 试
//    freeze(0.55)，每次截图看"这一幅是不是目标画框（屏幕中心那幅）"，
//    命中就停。12 个 key 最多试 12 次，成本可接受，且完全确定性。
const targetKey = await b.json(`(() => {
  const D = window.__PORTFOLIO_DEBUG__;
  const cam = D.camera;
  const V3 = cam.position.constructor;
  const ids = D.reveal.ids();
  // 先全部清零
  D.reveal.freezeAll(0);
  // 逐个试探：把某 key 钉到 0.5，看屏幕中心那块画框是否变色。
  // 无法在页面内读像素，所以这里改为返回所有候选，
  // 由 Node 侧截图判定（见下）。
  return ids.map((k) => ({ key: k, ok: !!D.reveal.freeze(k, 0.5) }));
})()`)
await b.evaluate('window.__PORTFOLIO_DEBUG__.reveal.freezeAll(0)')
await sleep(500)

/** 量一块屏幕区域的平均饱和度（判断目标画框有没有被上色） */
function regionSat(pngPath, cx, cy) {
  const img = decodePng(fs.readFileSync(pngPath))
  let sum = 0, n = 0
  for (let y = Math.max(0, cy - 55); y < Math.min(697, cy + 55); y += 2)
    for (let x = Math.max(0, cx - 75); x < Math.min(1248, cx + 75); x += 2) { sum += sat(img, x, y); n++ }
  return n ? Math.round((sum / n) * 10) / 10 : 0
}

let picked = null
const probePng = path.join(outDir, '_probe.png')
for (const c of targetKey) {
  await b.evaluate('window.__PORTFOLIO_DEBUG__.reveal.freezeAll(0)')
  await sleep(120)
  await b.evaluate(`window.__PORTFOLIO_DEBUG__.reveal.freeze(${JSON.stringify(c.key)}, 1)`)
  await sleep(420)
  await b.screenshot(probePng)
  const s = regionSat(probePng, sx, sy)
  console.log(`  试探 ${c.key} -> 中心区域饱和度 ${s}`)
  if (s > 25) { picked = c.key; console.log(`  ✅ 目标画框是 ${c.key}`); break }
}
try { fs.unlinkSync(probePng) } catch {}

if (!picked) {
  console.error('❌ 没能定位目标画框的 key，退化为 freezeAll 模式（远景也会变色）')
}

async function setProgress(v) {
  if (picked) {
    await b.evaluate(`(() => { const D = window.__PORTFOLIO_DEBUG__; D.reveal.freezeAll(0); D.reveal.freeze(${JSON.stringify(picked)}, ${v}); })()`)
  } else {
    await b.evaluate(`window.__PORTFOLIO_DEBUG__.reveal.freezeAll(${v})`)
  }
}

const STEPS = [
  { v: 0.0, name: '04-frame-sketch.png', label: '素描（progress=0）' },
  { v: 0.35, name: '05a-frame-painting-35.png', label: '上色中 35%' },
  { v: 0.55, name: '05-frame-hover-painting.png', label: '上色中 55%' },
  { v: 0.75, name: '05b-frame-painting-75.png', label: '上色中 75%' },
  { v: 1.0, name: '06-frame-painted.png', label: '全彩（progress=1）' },
]

for (const s of STEPS) {
  await setProgress(s.v)
  await sleep(700)
  const f = path.join(outDir, s.name)
  await b.screenshot(f)
  try {
    const img = decodePng(fs.readFileSync(f))
    let colored = 0, total = 0
    for (let y = Math.max(0, sy - 65); y < Math.min(697, sy + 65); y += 2)
      for (let x = Math.max(0, sx - 85); x < Math.min(1248, sx + 85); x += 2) {
        total++; if (sat(img, x, y) > 45) colored++
      }
    console.log(`  ${s.label} -> ${Math.round((colored / total) * 1000) / 10}% 彩色`)
  } catch { }
  console.log('  写入', s.name)
}

// ---- 4. 恢复自然状态（解冻），方便人工继续玩 ----
await b.evaluate('window.__PORTFOLIO_DEBUG__.reveal.freezeAll(null)')

for (const f of fs.readdirSync(outDir)) {
  if (/^_/.test(f)) { try { fs.unlinkSync(path.join(outDir, f)) } catch {} }
}

await b.close()
process.exit(0)
