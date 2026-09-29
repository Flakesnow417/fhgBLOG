/**
 * shot-intro.mjs —— 抓「开场纸张撕裂」的过程帧
 *
 * ⚠️ 这个脚本存在的唯一理由，是一个很容易误判的坑：
 *
 *   cdp.mjs 的 launch() 默认 readyValue = 'done' —— 这是当初为本项目
 *   定制留下的默认值。于是 goto() 会**一直等到开场动画播完**才返回。
 *   之后无论怎么截图、怎么读 dataset.introPhase，看到的都是终态 'done'，
 *   极容易被误判成「开场动画根本没播放 / 有 bug」。
 *
 *   实测（Page.addScriptToEvaluateOnNewDocument 在文档创建前埋钩子）：
 *     586ms  -> loading
 *     4168ms -> tearing
 *     5832ms -> done
 *   动画是完全正常的，5 秒左右，只是 CDP 采样时机太晚。
 *
 * 解法：把 readyExpression 换成一个**导航后立刻成立**的条件（如
 * 'document.readyState'），或者干脆用 cdp.send('Page.navigate') 自己发，
 * 然后按 30ms 轮询抢节奏。本脚本采用后者。
 */
import fs from 'node:fs'
import path from 'node:path'

const CDP = 'file:///C:/Users/Administrator/.workbuddy/skills/webgl-browser-verify/scripts/cdp.mjs'
const { launch, sleep } = await import(CDP)

const outDir = process.argv[2] || 'E:/fhgBLOG/newtechnique/images'
const url = process.argv[3] || 'http://127.0.0.1:5173/'
fs.mkdirSync(outDir, { recursive: true })

const b = await launch({
  port: 9944,
  width: 1248,
  height: 697,
  headless: true,
  timeoutMs: 40000,
  // 关键：不给 readyExpression 传 'done'。用 readyState 让 goto 尽早返回。
  readyExpression: "'interactive'",
  readyValue: 'interactive',
  settleMs: 0,
})

await b.goto(url)

// goto 返回后立刻轮询，30ms 一次，抢 tearing 窗口（约 1.25s 宽，足够）
const t0 = Date.now()
const timeline = []
let lastPhase = null
let shots = 0

for (let i = 0; i < 500; i++) {
  let p = ''
  try { p = await b.evaluate("document.body.dataset.introPhase||''") } catch { /* 导航中 */ }
  if (p && p !== lastPhase) {
    timeline.push(`${Date.now() - t0}ms -> ${p}`)
    lastPhase = p
  }
  if (p === 'tearing') {
    // 抓 6 帧，覆盖整个撕开过程
    const f = path.join(outDir, `_tear-${String(shots).padStart(2, '0')}.png`)
    try { await b.screenshot(f); shots++ } catch {}
    await sleep(150)
    continue
  }
  if (p === 'done' && shots > 0) break
  await sleep(30)
}

console.log('阶段时间线:')
for (const l of timeline) console.log('  ', l)
console.log('抓到撕裂帧:', shots, '张 ->', outDir)
await b.close()
process.exit(shots > 0 ? 0 : 1)
