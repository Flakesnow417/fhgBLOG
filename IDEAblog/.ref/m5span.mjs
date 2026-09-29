// Measure how far the reveal boundary must travel to sweep a frame, and
// report the actual projected extent of the artwork along the reveal dir.
//
// Why: revealSpan maps to `mix(-span, +span, progress)`. If span is much
// larger than half the frame's extent, the boundary leaves the frame long
// before progress reaches 1, so the tail of the hover animation does nothing.
// If span is too small, the frame snaps from sketch to painted in one step.
import { spawn } from 'node:child_process'
import net from 'node:net'
import crypto from 'node:crypto'

const PORT = 9450
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const sock = net.connect(Number(u.port), u.hostname, () => {
      sock.write(
        `GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      )
    })
    let buf = Buffer.alloc(0), up = false, id = 0
    const pending = new Map(), listeners = new Set()
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (!up) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; up = true; buf = buf.slice(i + 4); resolve(api) }
      for (;;) {
        if (buf.length < 2) break
        const b1 = buf[1]
        let len = b1 & 0x7f, off = 2
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
      const p = Buffer.from(str), mask = crypto.randomBytes(4)
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

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.cwd()}/.chrome-${PORT}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
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
await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
const t0 = Date.now()
while (Date.now() - t0 < 45000) {
  try {
    const r = await cdp.send('Runtime.evaluate', { expression: "document.body.dataset.introPhase||''", returnByValue: true })
    if (r.result?.value === 'done') break
  } catch {}
  await sleep(300)
}
await sleep(1200)

const json = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  const v = r.result?.value
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return v } }
  return v
}

const info = await json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  const V3 = d.camera.position.constructor;
  const out = [];
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.material?.userData?.paint;
    if (!p) return;
    const g = o.geometry?.parameters;
    if (!g?.width) return;
    o.updateWorldMatrix(true, false);
    const hw = g.width / 2, hh = g.height / 2;
    // reveal direction, read from the live uniform
    const dir = p.shader ? p.shader.uniforms.uPaintDir.value.clone() : null;
    if (!dir) return;
    // project the 4 corners onto the reveal direction, relative to the origin
    const origin = p.shader.uniforms.uPaintOrigin.value.clone();
    let mn = Infinity, mx = -Infinity;
    [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].forEach(([x,y]) => {
      const w = new V3(x, y, 0).applyMatrix4(o.matrixWorld).sub(origin);
      const t = w.dot(dir);
      if (t < mn) mn = t;
      if (t > mx) mx = t;
    });
    out.push({
      pos: o.getWorldPosition(new V3()).toArray().map(n => +n.toFixed(2)),
      frameW: g.width, frameH: g.height,
      extentAlongDir: +(mx - mn).toFixed(3),
      minT: +mn.toFixed(3), maxT: +mx.toFixed(3),
      span: p.shader.uniforms.uPaintSpan.value,
      amp1: p.shader.uniforms.uPaintAmp1.value,
      amp2: p.shader.uniforms.uPaintAmp2.value,
      edge: p.shader.uniforms.uPaintEdge.value,
    });
  });
  return JSON.stringify(out);
})()`)

console.log('=== 每个画框沿揭示方向的几何范围 ===')
info.forEach((r) => {
  const halfTravel = r.span
  const needed = r.extentAlongDir / 2 + r.amp1 + r.amp2 + r.edge
  console.log(
    `  pos=${JSON.stringify(r.pos)}  frame=${r.frameW}x${r.frameH}\n` +
      `     沿 dir 的投影范围 = [${r.minT}, ${r.maxT}]  跨度=${r.extentAlongDir}\n` +
      `     当前 span=${r.span}（走盘 ±${halfTravel}，总行程 ${(halfTravel * 2).toFixed(1)}）\n` +
      `     完全扫过所需 span ≈ ${needed.toFixed(2)}  (跨度/2 + 噪声${r.amp1}+${r.amp2} + 湿边${r.edge})\n` +
      `     富余比 = ${(halfTravel / needed).toFixed(2)}x  ->  ${halfTravel / needed > 1.6 ? '⚠️ 收尾过早，后半段 progress 是空转' : 'OK'}`,
  )
})

cdp.close()
chrome.kill()
