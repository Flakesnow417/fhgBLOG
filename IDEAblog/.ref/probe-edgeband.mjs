// Isolated check: does the paint material's onBeforeCompile throw?
// Uses the page's own debug bridge, in a fresh tab, and reports ONLY
// exceptions that occur after navigation completes.
import { spawn } from 'node:child_process'
import net from 'node:net'
import crypto from 'node:crypto'

const PORT = 9430
const TARGET_URL = 'http://127.0.0.1:5173/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const key = crypto.randomBytes(16).toString('base64')
    const sock = net.connect(Number(u.port), u.hostname, () => {
      sock.write(
        `GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      )
    })
    let buf = Buffer.alloc(0)
    let handshook = false
    const handlers = []
    let id = 0
    const pending = new Map()
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (!handshook) {
        const i = buf.indexOf('\r\n\r\n')
        if (i < 0) return
        handshook = true
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
          const msg = JSON.parse(payload)
          if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
          else handlers.forEach((h) => h(msg))
        } catch {}
      }
    })
    sock.on('error', reject)
    const api = {
      send(method, params) {
        const mid = ++id
        return new Promise((res) => { pending.set(mid, res); sock.write(frame(JSON.stringify({ id: mid, method, params: params || {} }))) })
      },
      on(h) { handlers.push(h) },
      close() { sock.end() },
    }
    function frame(str) {
      const p = Buffer.from(str)
      const mask = crypto.randomBytes(4)
      let header
      if (p.length < 126) header = Buffer.from([0x81, 0x80 | p.length])
      else if (p.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(p.length, 2) }
      else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(p.length), 2) }
      const masked = Buffer.alloc(p.length)
      for (let i = 0; i < p.length; i++) masked[i] = p[i] ^ mask[i % 4]
      return Buffer.concat([header, mask, masked])
    }
  })
}

const chrome = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
   `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
   '--user-data-dir=' + process.cwd() + '/.chrome-' + PORT, 'about:blank'],
  { stdio: 'ignore', detached: false },
)

let ver = null
for (let i = 0; i < 60; i++) {
  try { ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()); break } catch { await sleep(500) }
}
if (!ver) { console.error('CDP 未就绪'); process.exit(1) }

const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())
const cdp = await wsConnect(target.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')
await cdp.send('Log.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1248, height: 697, deviceScaleFactor: 1, mobile: false })

const problems = []
let navDone = false
cdp.on((m) => {
  if (!navDone) return
  if (m.method === 'Runtime.exceptionThrown') problems.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 400))
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push('LOG: ' + m.params.entry.text.slice(0, 400))
})

await cdp.send('Page.navigate', { url: TARGET_URL })
const p0 = Date.now()
while (Date.now() - p0 < 45000) {
  try { const ph = await cdp.evaluate("document.body.dataset.introPhase || null"); if (ph === 'done') break } catch {}
  await sleep(300)
}
navDone = true
await sleep(2000)

const json = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  const v = r.result?.result?.value
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return v } }
  return v
}

const paints = await json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  return JSON.stringify(d.paints());
})()`)

console.log('=== paints() ===')
console.log(JSON.stringify(paints, null, 2))

console.log('=== problems after nav ===')
if (!problems.length) console.log('(none)')
problems.slice(0, 6).forEach((p) => console.log('  ' + p))

cdp.close()
chrome.kill()
process.exit(problems.length ? 2 : 0)
