/**
 * m5diag.mjs —— 诊断"冻结进度但画面不变"
 * 逐项确认冻结到底有没有写进 uniform、有没有真的传到 GPU。
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import crypto from 'node:crypto'

const PORT = 9415
const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:5173/'
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = path.join('E:/tmp', `cdp-m5diag-${crypto.randomBytes(4).toString('hex')}`)

const chrome = spawn(CHROME, [
  '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,800', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', 'about:blank',
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
        else if (len === 127) {
          if (buf.length < off + 8) return
          len = buf.readUInt32BE(off) * 2 ** 32 + buf.readUInt32BE(off + 4); off += 8
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  async json(expression) {
    const w = '(() => { try { return JSON.stringify(' + expression + ') } catch (e) { return JSON.stringify({__err:String(e)}) } })()'
    const raw = await this.evaluate(w)
    return typeof raw === 'string' ? JSON.parse(raw) : raw
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

// 摆相机对准 z=24 那幅
await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  window.__PORTFOLIO_FREEZE_CAMERA__ = true;
  const c = d.camera;
  c.position.set(2.0, 2.15, 20);
  c.rotation.order = 'YXZ';
  c.rotation.set(0, Math.PI / 2, 0);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return { ok: true };
})()`)
await sleep(800)

console.log('=== A. 冻结前后，读 uniform 与 p.progress ===')
const before = await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  const out = [];
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const p = m && m.userData && m.userData.paint;
    if (!p) return;
    const e = o.matrixWorld.elements;
    out.push({
      z: +e[14].toFixed(1),
      pProgress: p.progress,
      uProgress: p.shader ? p.shader.uniforms.uPaintProgress.value : null,
      compiled: !!p.shader,
    });
  });
  return out;
})()`)
console.log('冻结前:', JSON.stringify(before))

await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  const n = d.reveal.freezeAll(1);
  return { frozen: n };
})()`)
await sleep(500)

const after = await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  const out = [];
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const p = m && m.userData && m.userData.paint;
    if (!p) return;
    const e = o.matrixWorld.elements;
    out.push({
      z: +e[14].toFixed(1),
      pProgress: +p.progress.toFixed(4),
      uProgress: p.shader ? +p.shader.uniforms.uPaintProgress.value.toFixed(4) : null,
      compiled: !!p.shader,
    });
  });
  return out;
})()`)
console.log('freezeAll(1) 后:', JSON.stringify(after))

console.log('\n=== B. 等 2 秒后再读一次（确认没有被覆盖）===')
await sleep(2000)
const later = await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  const out = [];
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const p = m && m.userData && m.userData.paint;
    if (!p) return;
    const e = o.matrixWorld.elements;
    out.push({ z: +e[14].toFixed(1), pProgress: +p.progress.toFixed(4), uProgress: p.shader ? +p.shader.uniforms.uPaintProgress.value.toFixed(4) : null });
  });
  return out;
})()`)
console.log('2 秒后:', JSON.stringify(later))

console.log('\n=== C. 检查 useFrame 是否还在跑（帧计数）===')
const frameProbe = await cdp.json(`(async () => {
  let n = 0;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => { n++; if (performance.now() - t0 > 1000) return resolve(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  return { rafPerSecond: n };
})()`)
console.log(JSON.stringify(frameProbe))

console.log('\n=== D. 材质是否有 program / texture 是否上传 ===')
const matInfo = await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  const out = [];
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const p = m && m.userData && m.userData.paint;
    if (!p) return;
    const e = o.matrixWorld.elements;
    if (Math.abs(e[14] - 24) > 0.5) return;
    out.push({
      z: +e[14].toFixed(1),
      matType: m.type,
      // three 把编译后的程序挂在 renderer 的 properties 里，
      // 材质本身看不到；退一步看这些可读字段
      version: m.version,
      needsUpdate: m.needsUpdate,
      transparent: m.transparent,
      visible: o.visible,
      renderOrder: o.renderOrder,
      parentVisible: (() => { let q = o, v = true; while (q) { if (!q.visible) v = false; q = q.parent } return v })(),
      hasMap: !!m.map,
      mapUuid: m.map ? m.map.uuid.slice(0, 8) : null,
      paintedUuid: p.paintedMap ? p.paintedMap.uuid.slice(0, 8) : null,
      paintedImageW: p.paintedMap && p.paintedMap.image ? p.paintedMap.image.width : null,
    });
  });
  return out;
})()`)
console.log(JSON.stringify(matInfo, null, 2))

console.log('\nEXCEPTIONS:', problems.length)
problems.forEach((p) => console.log('  ', p))

chrome.kill('SIGKILL')
process.exit(0)
