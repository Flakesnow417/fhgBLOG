// 定位「米白色块」到底来自哪个 DOM 元素
// 用法: node probe-beige.mjs
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs'

const PORT = 9345
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag-beige'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(d.slice(0, 200))) } })
    })
    req.on('error', reject)
  })
}
function makeWs(u0) {
  const u = new URL(u0)
  const sock = net.connect(Number(u.port), u.hostname)
  let hs = false; let buf = Buffer.alloc(0); const listeners = []
  const emit = (m) => { for (const fn of listeners) fn(m) }
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    if (!hs) { const i = buf.indexOf('\r\n\r\n'); if (i === -1) return; hs = true; buf = buf.subarray(i + 4) }
    while (buf.length >= 2) {
      let len = buf[1] & 0x7f, off = 2
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
      if (buf.length < off + len) return
      const p = buf.subarray(off, off + len).toString('utf8')
      buf = buf.subarray(off + len)
      try { emit(JSON.parse(p)) } catch {}
    }
  })
  sock.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.hostname}:${u.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
  let id = 0; const pending = new Map()
  function send(method, params = {}) {
    const mid = ++id
    const payload = Buffer.from(JSON.stringify({ id: mid, method, params }), 'utf8')
    const mask = Buffer.from([1, 2, 3, 4]); const masked = Buffer.alloc(payload.length)
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4]
    let h
    if (payload.length < 126) h = Buffer.from([0x81, 0x80 | payload.length])
    else if (payload.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(payload.length, 2) }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(payload.length), 2) }
    sock.write(Buffer.concat([h, mask, masked]))
    return new Promise((res, rej) => {
      pending.set(mid, { res, rej })
      setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)) } }, 25000)
    })
  }
  listeners.push((m) => { if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } })
  return { send, on: (fn) => listeners.push(fn) }
}

function decodePng(buf) {
  let p = 8, w = 0, h = 0, colorType = 6
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const stride = w * ch
  const out = Buffer.alloc(h * stride)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0
      const b = prev[i]
      const c = i >= ch ? prev[i - ch] : 0
      let v = line[i]
      if (ft === 1) v = (v + a) & 0xff
      else if (ft === 2) v = (v + b) & 0xff
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (ft === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
      cur[i] = v
    }
    cur.copy(out, y * stride)
    prev = cur
  }
  return { w, h, ch, data: out }
}
const zlib = await import('node:zlib')

async function main() {
  fs.mkdirSync('E:/fhgBLOG/IDEAblog/.ref/frames', { recursive: true })
  const child = spawn(CHROME, [
    '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', 'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  let version
  for (let i = 0; i < 30; i++) { try { version = await httpGet('/json/version'); break } catch { await sleep(500) } }
  const ws = makeWs(version.webSocketDebuggerUrl)
  await sleep(400)
  const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' })
  await sleep(500)
  const targets = await httpGet('/json/list')
  const page = makeWs(targets.find((t) => t.id === targetId).webSocketDebuggerUrl)
  await sleep(400)
  await page.send('Runtime.enable'); await page.send('Page.enable')
  await page.send('Page.navigate', { url: 'http://localhost:5173/' })
  await sleep(7000)

  // 1) 列出所有覆盖中心点的元素及其背景色
  const expr = `(() => {
    const cx = Math.floor(innerWidth / 2), cy = Math.floor(innerHeight / 2);
    const out = { viewport: [innerWidth, innerHeight], point: [cx, cy], covering: [] };
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (!(r.left <= cx && r.right >= cx && r.top <= cy && r.bottom >= cy)) return;
      const cs = getComputedStyle(el);
      out.covering.push({
        tag: el.tagName.toLowerCase(),
        cls: el.className && typeof el.className === 'string' ? el.className.slice(0, 60) : '',
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        bg: cs.backgroundColor,
        bgImage: cs.backgroundImage.slice(0, 60),
        display: cs.display,
        opacity: cs.opacity,
        z: cs.zIndex,
        radius: cs.borderRadius,
        transform: cs.transform,
      });
    });
    const body = getComputedStyle(document.body);
    const html = getComputedStyle(document.documentElement);
    out.bodyBg = body.backgroundColor;
    out.htmlBg = html.backgroundColor;
    out.bodyBgImage = body.backgroundImage.slice(0, 80);
    return JSON.stringify(out, null, 1);
  })()`
  const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true })
  console.log('=== 覆盖中心的元素 ===')
  console.log(r.result.value)

  // 2) 逐个隐藏可疑元素后采样截图颜色
  const suspects = ['.boot-badge', '.paper-tear', 'canvas', '.paper-tear__title']
  for (const sel of suspects) {
    await page.send('Runtime.evaluate', {
      expression: `document.querySelectorAll('${sel}').forEach(e => { e.style.display = 'none' })`,
      returnByValue: true,
    })
    await sleep(400)
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(`E:/fhgBLOG/IDEAblog/.ref/frames/beige-${sel.replace(/[^a-z]/g, '')}.png`, Buffer.from(shot.data, 'base64'))
    const img = decodePng(Buffer.from(shot.data, 'base64'))
    const i = (Math.floor(img.h / 2) * img.w + Math.floor(img.w / 2)) * img.ch
    console.log(`隐藏 ${sel.padEnd(22)} 后中心像素 = ${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`)
  }
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
