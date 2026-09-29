// Boundary tracker: for each frozen progress, find WHERE the paint boundary
// sits across one scanline through the target frame. A healthy reveal shows
// the boundary marching monotonically in one direction. A broken one either
// never moves, jumps the whole frame at once, or covers the whole surface
// at every value (the "fog wash" bug).
//
// Prints, per progress: the first x where saturation crosses the painted
// threshold, plus a coarse coverage number.
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'

const PORT = 9440
const TARGET_URL = 'http://127.0.0.1:5173/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = 'E:/fhgBLOG/IDEAblog/.ref/frames'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------- minimal CDP over raw WebSocket ---------------- */
function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const sock = net.connect(Number(u.port), u.hostname, () => {
      sock.write(
        `GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      )
    })
    let buf = Buffer.alloc(0)
    let up = false
    let id = 0
    const pending = new Map()
    const listeners = new Set()
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (!up) {
        const i = buf.indexOf('\r\n\r\n')
        if (i < 0) return
        up = true
        buf = buf.slice(i + 4)
        resolve(api)
      }
      for (;;) {
        if (buf.length < 2) break
        const b1 = buf[1]
        let len = b1 & 0x7f
        let off = 2
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4 }
        else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10 }
        if (buf.length < off + len) break
        const payload = buf.slice(off, off + len).toString()
        buf = buf.slice(off + len)
        try {
          const m = JSON.parse(payload)
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
          else listeners.forEach((f) => f(m))
        } catch {}
      }
    })
    sock.on('error', reject)
    const api = {
      send(method, params) {
        const mid = ++id
        return new Promise((res, rej) => {
          pending.set(mid, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
          sock.write(frame(JSON.stringify({ id: mid, method, params: params || {} })))
        })
      },
      on(f) { listeners.add(f) },
      close() { sock.end() },
    }
    function frame(str) {
      const p = Buffer.from(str)
      const mask = crypto.randomBytes(4)
      let hdr
      if (p.length < 126) hdr = Buffer.from([0x81, 0x80 | p.length])
      else if (p.length < 65536) { hdr = Buffer.alloc(4); hdr[0] = 0x81; hdr[1] = 0x80 | 126; hdr.writeUInt16BE(p.length, 2) }
      else { hdr = Buffer.alloc(10); hdr[0] = 0x81; hdr[1] = 0x80 | 127; hdr.writeBigUInt64BE(BigInt(p.length), 2) }
      const m = Buffer.alloc(p.length)
      for (let i = 0; i < p.length; i++) m[i] = p[i] ^ mask[i % 4]
      return Buffer.concat([hdr, mask, m])
    }
  })
}

/* ---------------- PNG decode ---------------- */
function decodePng(buf) {
  let off = 8
  const idat = []
  let w, h, ct
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9] }
    if (type === 'IDAT') idat.push(data)
    off += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]
  const stride = w * bpp
  const out = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const ft = raw[p++]
    const line = raw.subarray(p, p + stride)
    p += stride
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 255
    }
  }
  return { w, h, bpp, data: out }
}

const chrome = spawn(CHROME, [
  '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.cwd()}/.chrome-${PORT}`,
  '--window-size=1248,697', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' })

let ver = null
for (let i = 0; i < 60; i++) {
  try { ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()); break } catch { await sleep(500) }
}
if (!ver) { console.error('CDP 未就绪'); process.exit(1) }

const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())
const cdp = await wsConnect(target.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1248, height: 697, deviceScaleFactor: 1, mobile: false })

const problems = []
let ready = false
cdp.on((m) => {
  if (!ready) return
  if (m.method === 'Runtime.exceptionThrown') problems.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 250))
})

await cdp.send('Page.navigate', { url: TARGET_URL })
const t0 = Date.now()
while (Date.now() - t0 < 45000) {
  try { if ((await cdp.send('Runtime.evaluate', { expression: "document.body.dataset.introPhase||''", returnByValue: true })).result?.value === 'done') break } catch {}
  await sleep(300)
}
ready = true
await sleep(1500)

const json = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  const v = r.result?.value
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return v } }
  return v
}

// Freeze the camera facing one frame squarely.
await json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  window.__PORTFOLIO_FREEZE_CAMERA__ = true;
  const c = d.camera;
  c.position.set(2.0, 2.15, 24);
  c.rotation.order = 'YXZ'; c.rotation.set(0, Math.PI / 2, 0);
  c.updateMatrixWorld(true); c.updateProjectionMatrix();
  return 1;
})()`)

// Project the target frame to get its screen box.
const rect = await json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  const cam = d.camera;
  const V3 = cam.position.constructor;
  let best = null, bestD = Infinity;
  d.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.parameters?.width) return;
    if (!o.material?.userData?.paint) return;
    const e = o.matrixWorld.elements;
    const ndc = new V3(e[12], e[13], e[14]).project(cam);
    if (ndc.z > 1) return;
    const sx = (ndc.x * 0.5 + 0.5) * innerWidth, sy = (-ndc.y * 0.5 + 0.5) * innerHeight;
    const dist = Math.hypot(sx - innerWidth / 2, sy - innerHeight / 2);
    if (dist < bestD) { bestD = dist; best = o }
  });
  if (!best) return { err: 'no paint mesh' };
  const p = best.geometry.parameters, hw = p.width / 2, hh = p.height / 2;
  const cs = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([x,y]) => {
    const v = new V3(x, y, 0).applyMatrix4(best.matrixWorld).project(cam);
    return [(v.x*0.5+0.5)*innerWidth, (-v.y*0.5+0.5)*innerHeight];
  });
  const xs = cs.map(c=>c[0]), ys = cs.map(c=>c[1]);
  return { corners: cs, box: [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys))] };
})()`)

if (rect.err) { console.error('定位失败:', rect.err); process.exit(1) }
console.log('目标画框屏幕框:', JSON.stringify(rect.box))

const shot = async (name) => {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const buf = Buffer.from(r.data, 'base64')
  fs.writeFileSync(`${OUT}/${name}`, buf)
  return decodePng(buf)
}

const satAt = (d, x, y) => {
  const i = (y * d.w + x) * d.bpp
  const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2]
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  return mx === 0 ? 0 : ((mx - mn) / mx) * 255
}

const [bx0, by0, bx1, by1] = rect.box
const midY = Math.round((by0 + by1) / 2)

console.log('\n=== 边界扫描（在画幅中线 y=' + midY + ' 上找第一处"已上色"的 x）===')
console.log('  progress   边界x   已涂宽度   平均饱和度')
const trail = []
for (const p of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
  await json(`(() => { window.__PORTFOLIO_DEBUG__.reveal.freezeAll(${p}); return 1 })()`)
  await cdp.send('Runtime.evaluate', { expression: 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))', awaitPromise: true })
  await sleep(220)
  const d = await shot(`m5boundary-${String(Math.round(p * 100)).padStart(3, '0')}.png`)

  let firstColored = null
  let coloredCount = 0
  let sum = 0
  let n = 0
  for (let x = bx0 + 2; x <= bx1 - 2; x++) {
    const s = satAt(d, x, midY)
    sum += s; n++
    if (s > 60) { coloredCount++; if (firstColored === null) firstColored = x }
  }
  const avg = sum / n
  trail.push({ p, firstColored, width: coloredCount, avg: +avg.toFixed(1) })
  console.log(
    `    ${p.toFixed(2)}    ${String(firstColored === null ? '-' : firstColored).padStart(5)}   ` +
      `${String(coloredCount).padStart(6)}px   ${avg.toFixed(1).padStart(6)}`,
  )
}

/* ------------- judgement ------------- */
console.log('\n=== 判定 ===')
let fail = 0
const judge = (ok, msg) => { console.log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fail++ }

const widths = trail.map((t) => t.width)
judge(widths[0] === 0, 'progress=0 时完全没有彩色（纯素描）')
judge(widths[widths.length - 1] > widths[0], 'progress=1 时彩色宽度大于起点')

// monotonic non-decreasing coverage (allow small noise)
let drops = 0
for (let i = 1; i < widths.length; i++) if (widths[i] < widths[i - 1] - 3) drops++
judge(drops === 0, `覆盖率单调不减（异常回落 ${drops} 次）`)

// boundary must actually travel, not sit still
const moved = trail.filter((t) => t.firstColored !== null)
judge(moved.length >= 4, `边界在多个档位出现（${moved.length}/11 档）——说明是"扫过"而非整幅跳变`)

// the fog-wash regression: early progress must NOT tint the whole surface
const early = trail.find((t) => t.p === 0.1)
judge(early && early.width === 0, `progress=0.1 时无整幅泛色（彩色像素 ${early ? early.width : '?'}px）`)

judge(problems.length === 0, `无 JS 异常（${problems.length}）`)
if (problems.length) problems.slice(0, 3).forEach((p) => console.log('     ' + p))

console.log(fail ? `\nRESULT: FAIL (${fail})` : '\nRESULT: PASS')
cdp.close()
chrome.kill()
process.exit(fail ? 2 : 0)
