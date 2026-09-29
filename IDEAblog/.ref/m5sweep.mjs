/**
 * m5sweep.mjs —— 用细密的 progress 档位看清"揭示边界到底怎么走"
 * 目的：确认边界是在画面上连续扫过（像刷子），
 *       还是某一档之间突然整幅跳变（那就是参数失衡）。
 *
 * 采样策略：不取固定屏幕框，而是统计**整幅画所在区域**
 * 里"彩色像素占比"，这样能直接看出覆盖率随 progress 的曲线。
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'

const PORT = 9420
const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:5173/'
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT_DIR = 'E:/fhgBLOG/IDEAblog/.ref/frames'
const profile = path.join('E:/tmp', `cdp-m5sweep-${crypto.randomBytes(4).toString('hex')}`)

const chrome = spawn(CHROME, [
  '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,800', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--force-device-scale-factor=1', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
        else if (len === 127) { if (buf.length < off + 8) return; len = buf.readUInt32BE(off) * 2 ** 32 + buf.readUInt32BE(off + 4); off += 8 }
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails))
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

function decodePng(buf) {
  let pos = 8, idat = [], w = 0, h = 0, ct = 0
  while (pos < buf.length) {
    const ln = buf.readUInt32BE(pos)
    const typ = buf.toString('latin1', pos + 4, pos + 8)
    if (typ === 'IHDR') { w = buf.readUInt32BE(pos + 8); h = buf.readUInt32BE(pos + 12); ct = buf[pos + 17] }
    else if (typ === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + ln))
    else if (typ === 'IEND') break
    pos += 12 + ln
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const rows = []
  let prev = Buffer.alloc(stride), i = 0
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

const sat = (rows, bpp, x, y) => {
  const o = x * bpp
  const r = rows[y][o], g = rows[y][o + 1], b = rows[y][o + 2]
  return Math.max(r, g, b) - Math.min(r, g, b)
}

/* 主流程 */
const t0 = Date.now()
let ver = null
while (Date.now() - t0 < 25000) {
  try { ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()); break } catch { await sleep(200) }
}
if (!ver) { console.error('CDP 未就绪'); process.exit(1) }

const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())
const cdp = await connect(target.webSocketDebuggerUrl)
await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Log.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1248, height: 697, deviceScaleFactor: 1, mobile: false })

const problems = []
cdp.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') problems.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 300))
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push('LOG: ' + m.params.entry.text.slice(0, 300))
})

await cdp.send('Page.navigate', { url: TARGET_URL })
const p0 = Date.now()
while (Date.now() - p0 < 45000) {
  try { const ph = await cdp.evaluate("document.body.dataset.introPhase || null"); if (ph === 'done') break } catch {}
  await sleep(300)
}
await sleep(1500)

await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  window.__PORTFOLIO_FREEZE_CAMERA__ = true;
  const c = d.camera;
  c.position.set(2.0, 2.15, 20);
  c.rotation.order = 'YXZ'; c.rotation.set(0, Math.PI / 2, 0);
  c.updateMatrixWorld(true); c.updateProjectionMatrix();
  return { ok: true };
})()`)
await sleep(800)

// 找到目标画框的精确屏幕矩形（投影它的四个角）
const rect = await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  const cam = d.camera;
  const w = d.gl.domElement.clientWidth, h = d.gl.domElement.clientHeight;
  const V3 = cam.position.constructor;
  let best = null, bestD = Infinity;
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || !m.userData || !m.userData.paint) return;
    const e = o.matrixWorld.elements;
    const ndc = new V3(e[12], e[13], e[14]).project(cam);
    if (ndc.z > 1) return;
    const sx = (ndc.x*0.5+0.5)*w, sy = (-ndc.y*0.5+0.5)*h;
    const dist = Math.hypot(sx-w/2, sy-h/2);
    if (dist < bestD) { bestD = dist; best = o; }
  });
  if (!best) return { err: 'none' };
  const p = best.geometry.parameters;
  const hw = p.width/2, hh = p.height/2;
  // 四个角：local 平面在 z=0，但 material 面片本身没有旋转，
  // 用 matrixWorld 变换 local 角点即可
  const corners = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([x,y]) => {
    const v = new V3(x, y, 0).applyMatrix4(best.matrixWorld).project(cam);
    return [(v.x*0.5+0.5)*w, (-v.y*0.5+0.5)*h];
  });
  const xs = corners.map(c=>c[0]), ys = corners.map(c=>c[1]);
  return { screen: corners, box: [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys))], size: [p.width, p.height] };
})()
`)
console.log('目标画框屏幕框:', JSON.stringify(rect))
if (rect.err) { console.error('定位失败'); process.exit(1) }
const [rx0, ry0, rx1, ry1] = rect.box

/** 统计画框区域内的彩色像素占比 + 直方图 */
function analyse(rows, bpp) {
  let colored = 0, mid = 0, gray = 0, total = 0
  const hist = new Array(10).fill(0)
  for (let y = ry0 + 2; y <= ry1 - 2; y++) {
    for (let x = rx0 + 2; x <= rx1 - 2; x++) {
      const s = sat(rows, bpp, x, y)
      total++
      const b = Math.min(9, Math.floor(s / 20))
      hist[b]++
      if (s > 60) colored++
      else if (s > 15) mid++
      else gray++
    }
  }
  return { colored: +(colored / total * 100).toFixed(1), mid: +(mid / total * 100).toFixed(1), gray: +(gray / total * 100).toFixed(1), hist }
}

console.log('\n=== progress 细扫（看覆盖率曲线是否连续）===')
const fine = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
const rowsOut = []
for (const v of fine) {
  await cdp.json(`(() => { window.__PORTFOLIO_DEBUG__.reveal.freezeAll(${v}); return 1 })()`)
  await cdp.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  await sleep(300)
  const png = await cdp.shot(`m5sweep-${String(Math.round(v * 100)).padStart(3, '0')}.png`)
  const d = decodePng(png)
  const a = analyse(d.rows, d.bpp)
  rowsOut.push({ p: v, ...a })
  console.log(`  p=${v.toFixed(2)}  彩色=${String(a.colored).padStart(5)}%  中间调=${String(a.mid).padStart(5)}%  灰=${String(a.gray).padStart(5)}%`)
}

console.log('\nEXCEPTIONS:', problems.length)
problems.forEach((p) => console.log('  ', p))
fs.writeFileSync(path.join(OUT_DIR, 'm5sweep.json'), JSON.stringify({ rect, rows: rowsOut, problems }, null, 2))
console.log('written -> frames/m5sweep.json')

chrome.kill('SIGKILL')
process.exit(0)
