/**
 * m4badge.mjs —— 追查 .boot-badge 为什么高 697px
 * 思路：把计算样式里所有与尺寸/定位相关的属性全部打出来，
 *       再看它的 offsetParent / 包含块，以及是否命中了别的规则。
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import crypto from 'node:crypto'

const PORT = 9395
const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:5173/'
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = path.join('E:/tmp', `cdp-m4badge-${crypto.randomBytes(4).toString('hex')}`)

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
  async evalJson(expr) {
    const w = '(() => { try { return JSON.stringify(' + expr + ') } catch (e) { return JSON.stringify({__err:String(e)}) } })()'
    const r = await this.send('Runtime.evaluate', { expression: w, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description)
    return typeof r.result.value === 'string' ? JSON.parse(r.result.value) : r.result.value
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
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1248, height: 697, deviceScaleFactor: 1, mobile: false })
await cdp.send('Page.navigate', { url: TARGET_URL })

const p0 = Date.now()
while (Date.now() - p0 < 45000) {
  try { const ph = await cdp.evalJson('(document.body.dataset.introPhase || null)'); if (ph === 'done') break } catch {}
  await sleep(300)
}
await sleep(1200)

const info = await cdp.evalJson(`(() => {
  const e = document.querySelector('.boot-badge');
  if (!e) return { err: 'no badge' };
  const cs = getComputedStyle(e);
  const r = e.getBoundingClientRect();
  const keys = ['position','inset','top','right','bottom','left','width','height','maxWidth','maxHeight',
                'minHeight','display','alignSelf','flexGrow','marginTop','marginBottom','paddingTop','paddingBottom',
                'boxSizing','transform','writingMode','lineHeight','fontSize','overflow'];
  const computed = {};
  for (const k of keys) computed[k] = cs[k];
  // 它的包含块是谁
  const parent = e.parentElement;
  const pc = parent ? getComputedStyle(parent) : null;
  return {
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    offsetHeight: e.offsetHeight,
    clientHeight: e.clientHeight,
    scrollHeight: e.scrollHeight,
    computed,
    parent: parent ? {
      tag: parent.tagName,
      cls: String(parent.className).slice(0, 60),
      display: pc.display,
      position: pc.position,
      height: pc.height,
      alignItems: pc.alignItems,
      rect: (() => { const q = parent.getBoundingClientRect(); return [Math.round(q.x), Math.round(q.y), Math.round(q.width), Math.round(q.height)] })(),
    } : null,
    // 命中的 CSS 规则（Chrome 的 inspector API 可从 CDP 拿，这里退一步：
    // 直接遍历 document.styleSheets 找出含 boot-badge 的规则，与元素 matches 的列出）
    matchedRules: (() => {
      const out = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules } catch { continue }
        for (const rule of rules) {
          if (!rule.selectorText) continue;
          let ok = false;
          try { ok = e.matches(rule.selectorText) } catch {}
          if (ok) out.push({ sel: rule.selectorText, css: rule.style.cssText.slice(0, 300) });
        }
      }
      return out;
    })(),
  };
})()`)

console.log(JSON.stringify(info, null, 2))

chrome.kill('SIGKILL')
process.exit(0)
