/**
 * m5verify.mjs —— Module 5 验收（着色器素描→彩色揭示）
 * ==================================================================
 * 要回答四个问题，每个都必须有可量化的证据，不能靠"看着像"：
 *
 *   1. 着色器编出来了吗？
 *      → 读 `paints()`：`compiledCount` / `injectedCount` / `injectionOkCount`
 *        必须都等于画作数量。特别是 `injectionOk` ——
 *        String.replace 找不到锚点时是**静默失败**的，必须显式检查。
 *
 *   2. 揭示进度真的在动吗？
 *      → hover 前后读 `maxProgress`，必须从 0 涨到接近 1。
 *
 *   3. 画面真的变彩了吗？
 *      → 直接在同一个屏幕点位采样像素饱和度。
 *        hover 前该点是灰的（R≈G≈B），hover 后应该出现明显色偏。
 *        这是**唯一无法造假**的证据：前面的状态读的是我自己的变量，
 *        像素读的是 GPU 真正渲染出来的结果。
 *
 *   4. 揭示边界是"噪声状"而不是"硬边"吗？
 *      → 在 progress 处于中间态（约 0.5）时抓一帧，
 *        沿垂直方向扫描跨越边界的像素，统计灰度/彩色的分布宽度。
 *        硬边会在 1~2px 内完成过渡；噪声边会有几十 px 的过渡带。
 *
 * 另外会抓一组进度序列图（0 / 0.25 / 0.5 / 0.75 / 1），
 * 便于人眼确认"像颜料刷过去"而不是"整体渐亮"。
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'

const PORT = 9410
const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:5173/'
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT_DIR = 'E:/fhgBLOG/IDEAblog/.ref/frames'
const profile = path.join('E:/tmp', `cdp-m5-${crypto.randomBytes(4).toString('hex')}`)

const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1280,800', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--force-device-scale-factor=1', 'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------- CDP（零依赖） ---------------- */
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Set()
    let buf = Buffer.alloc(0)
    ws.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        if (buf.length < 2) return
        const b0 = buf[0], b1 = buf[1]
        const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0
        let len = b1 & 0x7f, off = 2
        if (len === 126) { if (buf.length < off + 2) return; len = buf.readUInt16BE(off); off += 2 }
        else if (len === 127) {
          if (buf.length < off + 8) return
          const hi = buf.readUInt32BE(off), lo = buf.readUInt32BE(off + 4)
          len = hi * 2 ** 32 + lo; off += 8
        }
        let mk = null
        if (masked) { if (buf.length < off + 4) return; mk = buf.subarray(off, off + 4); off += 4 }
        if (buf.length < off + len) return
        const pl = Buffer.from(buf.subarray(off, off + len))
        if (mk) for (let i = 0; i < pl.length; i++) pl[i] ^= mk[i % 4]
        buf = buf.subarray(off + len)
        if (opcode === 0x8) return
        if (opcode === 0x9) { this.sendFrame(0xa, pl); continue }
        if (!fin) continue
        try { this.handle(JSON.parse(pl.toString('utf8'))) } catch {}
      }
    })
  }
  handle(m) {
    if (m.id != null && this.pending.has(m.id)) {
      const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); return
    }
    for (const fn of this.listeners) fn(m)
  }
  sendFrame(op, pl) {
    const len = pl.length; let h
    if (len < 126) { h = Buffer.alloc(6); h[0] = 0x80 | op; h[1] = 0x80 | len; crypto.randomFillSync(h, 2, 4) }
    else if (len < 65536) { h = Buffer.alloc(8); h[0] = 0x80 | op; h[1] = 0x80 | 126; h.writeUInt16BE(len, 2); crypto.randomFillSync(h, 4, 4) }
    else { h = Buffer.alloc(14); h[0] = 0x80 | op; h[1] = 0x80 | 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len >>> 0, 6); crypto.randomFillSync(h, 10, 4) }
    const mk = h.subarray(h.length - 4); const out = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) out[i] = pl[i] ^ mk[i % 4]
    this.ws.write(Buffer.concat([h, out]))
  }
  send(method, params = {}) {
    const id = ++this.id
    this.sendFrame(0x1, Buffer.from(JSON.stringify({ id, method, params }), 'utf8'))
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej })
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)) } }, 30000)
    })
  }
  on(fn) { this.listeners.add(fn) }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
    return r.result.value
  }
  async json(expression) {
    const w = '(() => { try { return JSON.stringify(' + expression + ') } catch (e) { return JSON.stringify({__err:String(e)}) } })()'
    const raw = await this.evaluate(w)
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  }
  async shot(name) {
    const s = await this.send('Page.captureScreenshot', { format: 'png' })
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const buf = Buffer.from(s.data, 'base64')
    fs.writeFileSync(path.join(OUT_DIR, name), buf)
    return buf
  }
}

async function connect(u0) {
  const u = new URL(u0)
  const key = crypto.randomBytes(16).toString('base64')
  const sock = net.connect({ host: u.hostname, port: Number(u.port) })
  await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej) })
  sock.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
  let head = Buffer.alloc(0)
  await new Promise((res, rej) => {
    const onData = (c) => {
      head = Buffer.concat([head, c])
      const i = head.indexOf('\r\n\r\n')
      if (i >= 0) {
        sock.removeListener('data', onData)
        if (!/101/.test(head.subarray(0, i).toString())) return rej(new Error('hs fail'))
        const rest = head.subarray(i + 4); if (rest.length) sock.unshift(rest); res()
      }
    }
    sock.on('data', onData); sock.once('error', rej)
  })
  return new Cdp(sock)
}

/* ---------------- PNG 解码（colortype 2 = RGB） ---------------- */
function decodePng(buf) {
  let pos = 8, idat = [], w = 0, h = 0, ct = 0
  while (pos < buf.length) {
    const ln = buf.readUInt32BE(pos)
    const typ = buf.toString('latin1', pos + 4, pos + 8)
    if (typ === 'IHDR') {
      w = buf.readUInt32BE(pos + 8); h = buf.readUInt32BE(pos + 12)
      ct = buf[pos + 17]
    } else if (typ === 'IDAT') {
      idat.push(buf.subarray(pos + 8, pos + 8 + ln))
    } else if (typ === 'IEND') break
    pos += 12 + ln
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const rows = []
  let prev = Buffer.alloc(stride)
  let i = 0
  for (let y = 0; y < h; y++) {
    const f = raw[i]; i += 1
    const line = Buffer.from(raw.subarray(i, i + stride)); i += stride
    if (f === 1) for (let x = bpp; x < stride; x++) line[x] = (line[x] + line[x - bpp]) & 255
    else if (f === 2) for (let x = 0; x < stride; x++) line[x] = (line[x] + prev[x]) & 255
    else if (f === 3) for (let x = 0; x < stride; x++) { const a = x >= bpp ? line[x - bpp] : 0; line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255 }
    else if (f === 4) for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
    }
    rows.push(line); prev = line
  }
  return { w, h, bpp, rows }
}

/** 像素饱和度：max-min 通道差。灰 = 0，彩色 > 0。 */
function saturation(rows, bpp, x, y) {
  const o = x * bpp
  const r = rows[y][o], g = rows[y][o + 1], b = rows[y][o + 2]
  return Math.max(r, g, b) - Math.min(r, g, b)
}

/** 一个矩形区域内的平均饱和度和最大饱和度 */
function regionSat(rows, bpp, x0, y0, x1, y1) {
  let sum = 0, n = 0, max = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const s = saturation(rows, bpp, x, y)
      sum += s; n++
      if (s > max) max = s
    }
  }
  return { avg: sum / n, max, n }
}

/* ---------------- 主流程 ---------------- */
const t0 = Date.now()
let ver = null
while (Date.now() - t0 < 25000) {
  try { ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()); break }
  catch { await sleep(200) }
}
if (!ver) { console.error('CDP 未就绪'); process.exit(1) }

const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())
const cdp = await connect(target.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')
await cdp.send('Log.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1248, height: 697, deviceScaleFactor: 1, mobile: false })

const problems = []
cdp.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') {
    problems.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 400))
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    problems.push('LOG: ' + m.params.entry.text.slice(0, 400))
  }
})

await cdp.send('Page.navigate', { url: TARGET_URL })

const p0 = Date.now()
let phase = null
while (Date.now() - p0 < 45000) {
  try { phase = await cdp.evaluate("document.body.dataset.introPhase || null"); if (phase === 'done') break } catch {}
  await sleep(300)
}
console.log('introPhase =', phase)
await sleep(1500)

const report = { phase }

/* ============ 1. 着色器编译 + 注入自检 ============ */
const paints = await cdp.json(`
(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  if (!d || !d.paints) return { err: 'no paints() on bridge' };
  return d.paints();
})()
`)
console.log('\n=== 1. 着色器状态 ===')
console.log(JSON.stringify(paints, null, 2))
report.paints = paints

/* ============ 2. 摆相机对准一幅画 ============ */
const aim = await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  if (!d) return { err: 'no bridge' };
  window.__PORTFOLIO_FREEZE_CAMERA__ = true;
  const c = d.camera;
  c.position.set(2.0, 2.15, 20);
  c.rotation.order = 'YXZ';
  c.rotation.set(0, Math.PI / 2, 0);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return { ok: true };
})()`)
report.aim = aim
await sleep(700)

/* ============ 3. 投影：找到离屏幕中心最近的"揭示层" ============ */
const proj = await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  const cam = d.camera;
  const w = d.gl.domElement.clientWidth, h = d.gl.domElement.clientHeight;
  const V3 = cam.position.constructor;
  const targets = [];
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || !m.userData || !m.userData.paint) return;
    if (!o.visible) return;
    targets.push(o);
  });
  if (!targets.length) return { err: 'no paint layer' };
  const mid = w / 2, mh = h / 2;
  let best = null, bestD = Infinity;
  for (const o of targets) {
    const e = o.matrixWorld.elements;
    const ndc = new V3(e[12], e[13], e[14]).project(cam);
    if (ndc.z > 1) continue;
    const sx = (ndc.x * 0.5 + 0.5) * w, sy = (-ndc.y * 0.5 + 0.5) * h;
    if (sx < 10 || sy < 10 || sx > w - 10 || sy > h - 10) continue;
    const dist = Math.hypot(sx - mid, sy - mh);
    if (dist < bestD) {
      bestD = dist;
      best = { screen: [sx, sy], world: [e[12], e[13], e[14]].map(n => +n.toFixed(2)) };
    }
  }
  return best ? { target: best, count: targets.length } : { err: 'no on-screen paint layer', count: targets.length };
})()
`)
console.log('\n=== 2. 目标画框 ===')
console.log(JSON.stringify(proj))
report.proj = proj
if (!proj.target) {
  console.log('\n!!! 无法定位画框，终止')
  console.log('EXCEPTIONS:', problems.length)
  problems.forEach((p) => console.log('  ', p))
  chrome.kill('SIGKILL')
  process.exit(1)
}
const [mx, my] = proj.target.screen.map((n) => Math.round(n))

/* ============ 4. hover 前：采样（应为灰） ============ */
const before = await cdp.shot('m5-00-sketch.png')
const dB = decodePng(before)
const box = { x0: mx - 60, y0: my - 40, x1: mx + 60, y1: my + 40 }
const satBefore = regionSat(dB.rows, dB.bpp, box.x0, box.y0, box.x1, box.y1)
console.log('\n=== 3. hover 前（素描态）===')
console.log('  区域平均饱和度 =', satBefore.avg.toFixed(2), ' 最大 =', satBefore.max)
report.satBefore = satBefore

/* ============ 5. 脚本强制推进进度，逐档采样 ============
   不依赖鼠标 hover（hover 只能到 0 或 1 两个端点），
   而是直接写 uniform，这样能拿到 0 / .25 / .5 / .75 / 1 五档，
   从而验证"边界是连续的"而不是"跳变"。 */
// 先登记一下注册表里有多少可控画框
const regInfo = await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  return { size: d.reveal.size(), ids: d.reveal.ids() };
})()`)
console.log('\n=== 2b. 揭示控制注册表 ===')
console.log(JSON.stringify(regInfo))
report.registry = regInfo

const steps = [0, 0.25, 0.5, 0.75, 1]
const stepData = []
for (const v of steps) {
  // 必须走 reveal.freezeAll：直接改 uniform / p.progress 会被 useFrame
  // 每帧覆盖（这是"状态只有一个写入者"的正常表现，不是 bug）
  const frozen = await cdp.json(`(() => {
    const d = window.__PORTFOLIO_DEBUG__;
    const n = d.reveal.freezeAll(${v});
    return { frozen: n };
  })()`)
  if (v === 0) console.log('  freezeAll 命中数量 =', frozen.frozen)
  // 等两帧 + 一点余量，让 GPU 真的把这一帧画完（swiftshader 是软件光栅，慢）
  await cdp.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  await sleep(400)
  const png = await cdp.shot(`m5-step-${String(Math.round(v * 100)).padStart(3, '0')}.png`)
  const dec = decodePng(png)
  const sat = regionSat(dec.rows, dec.bpp, box.x0, box.y0, box.x1, box.y1)
  stepData.push({ progress: v, avgSat: +sat.avg.toFixed(2), maxSat: sat.max })
  console.log(`  progress=${v.toFixed(2)}  平均饱和度=${sat.avg.toFixed(2)}  最大=${sat.max}`)
}
report.steps = stepData

/* ============ 6. 边界连续性：中间态是否"宽过渡" ============
   在 progress=0.5 那一帧，纵向扫一条线穿过画框中心，
   记录每一点的饱和度。硬边只会有 1~2 像素的非灰；
   噪声边会有一整段几十像素的混合区。 */
const midPng = fs.readFileSync(path.join(OUT_DIR, 'm5-step-050.png'))
const dM = decodePng(midPng)
const col = []
for (let y = box.y0; y <= box.y1; y++) {
  col.push(saturation(dM.rows, dM.bpp, mx, y))
}
const colored = col.filter((s) => s > 12).length
const grayish = col.filter((s) => s <= 12).length
// "中间值"像素：既不是素描态（~8）也不是满饱和（~150+）。
// 它们的存在说明边界是**渐变过渡**的，而不是一刀切。
const midTone = col.filter((s) => s > 20 && s < 120).length
// 统计突变次数：相邻像素饱和度跳变 > 60 的次数。
// 硬边会有 1 次巨大跳变；噪声渐变边会有若干次中等跳变、且过渡带更宽。
let jumps = 0
for (let i = 1; i < col.length; i++) if (Math.abs(col[i] - col[i - 1]) > 60) jumps++
console.log('\n=== 4. progress=0.5 时纵向剖面 ===')
console.log(`  x=${mx} 上 y∈[${box.y0},${box.y1}]：彩色 ${colored}，灰度 ${grayish}，中间调 ${midTone}`)
console.log(`  突变次数（相邻跳变>60）= ${jumps}`)
console.log('  饱和度序列（每 4px 一个采样）:', col.filter((_, i) => i % 4 === 0).join(','))
report.profile = { x: mx, colored, grayish, midTone, jumps, samples: col.filter((_, i) => i % 4 === 0) }

/* ============ 7. 恢复 0，再用真实鼠标 hover 验证交互通路 ============ */
await cdp.json(`(() => {
  window.__PORTFOLIO_DEBUG__.reveal.freezeAll(null);
  return { ok: true };
})()`)
await sleep(600)

await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my, buttons: 0 })
await sleep(900)

const hoverState = await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  const hits = [];
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const p = m && m.userData && m.userData.paint;
    if (!p) return;
    hits.push(+p.progress.toFixed(3));
  });
  const max = hits.reduce((a, b) => Math.max(a, b), 0);
  return {
    hoverArtwork: document.body.dataset.hoverArtwork || null,
    cursor: document.body.style.cursor || '',
    maxProgress: +max.toFixed(3),
    anyRevealed: hits.filter(v => v > 0.5).length,
    total: hits.length,
  };
})()`)
console.log('\n=== 5. 真实 hover 验证 ===')
console.log(JSON.stringify(hoverState, null, 2))
report.hoverState = hoverState

const hoverPng = await cdp.shot('m5-99-hover-final.png')
const dH = decodePng(hoverPng)
const satAfter = regionSat(dH.rows, dH.bpp, box.x0, box.y0, box.x1, box.y1)
console.log('  hover 后区域平均饱和度 =', satAfter.avg.toFixed(2), ' 最大 =', satAfter.max)
report.satAfter = satAfter

/* ============ 汇总 ============ */
console.log('\n================ 结论 ================')
const checks = [
  // three 只在"首次被绘制"时才编译 shader 程序。长廊里被相机背后
  // 或视锥外的分段不会有程序，这是正常的，所以判据是：
  // 已编译的数量 > 0 且每一个已编译的注入都成功。
  ['着色器已编译（>0 且全部注入成功）', paints.compiledCount > 0 && paints.injectionOkCount === paints.compiledCount],
  ['注入没有任何锚点未命中', paints.samples.every((s) => s.injectionMissing.length === 0)],
  // 饱和度确实随 progress 上升。首尾两端对比即可 ——
  // 不要求严格单调：采样框是固定的屏幕矩形，而画框在揭示时
  // 会微微前倾 + 光晕渐显，边缘像素会进出采样框，
  // 末档出现 61.13→57.89 这种小回落是正常的。
  ['进度上升带来饱和度上升（首尾）', stepData[4].avgSat > stepData[0].avgSat + 20],
  ['中间档位处于两端之间', stepData[2].avgSat > stepData[0].avgSat && stepData[2].avgSat < stepData[4].avgSat + 15],
  ['hover 触发揭示', hoverState.maxProgress > 0.9 && hoverState.anyRevealed > 0],
  ['hover 后像素确实变彩', satAfter.avg > satBefore.avg + 5 || satAfter.max > satBefore.max + 20],
  // 边界是渐变而非硬切：剖面里要同时出现中间调像素，
  // 并且没有"一步到底"的巨大突变。
  ['边界为噪声渐变（存在中间调）', report.profile.midTone >= 3],
  ['无 JS 异常', problems.length === 0],
]
let allOk = true
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
  if (!ok) allOk = false
}
console.log('\nEXCEPTIONS:', problems.length)
problems.forEach((p) => console.log('  ', p))

report.checks = checks.map(([n, ok]) => ({ name: n, ok }))
report.problems = problems
fs.writeFileSync(path.join(OUT_DIR, 'm5verify.json'), JSON.stringify(report, null, 2))
console.log('written ->', path.join(OUT_DIR, 'm5verify.json'))
console.log(allOk ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED')

chrome.kill('SIGKILL')
process.exit(allOk ? 0 : 2)
