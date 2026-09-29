// 严格验收：等待 introPhase === 'done' 且 .paper-tear 真正 display:none，再截图
// 用法: node verify.mjs <url> <x> <y> <z> <rx> <ry> <rz> <outname> [noFog] [noLight]
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs'
import zlib from 'node:zlib'

const [url, x, y, z, rx, ry, rz, outname, noFog, noLight] = process.argv.slice(2)
const TARGET_URL = url || 'http://localhost:5173/'
const PORT = 9344
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag-verify'

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

// ---------- PNG 解码（IHDR/IDAT + inflate + 反滤波），用于像素级验收 ----------
function decodePng(buf) {
  let p = 8, w = 0, h = 0, bitDepth = 8, colorType = 6
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1
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
function sample(img, x, y) {
  const i = (y * img.w + x) * img.ch
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}

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
  if (!version) throw new Error('chrome 未就绪')
  const ws = makeWs(version.webSocketDebuggerUrl)
  await sleep(400)
  const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' })
  await sleep(500)
  const targets = await httpGet('/json/list')
  const target = targets.find((t) => t.id === targetId)
  const page = makeWs(target.webSocketDebuggerUrl)
  await sleep(400)
  await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Log.enable')

  const errors = []
  page.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 300))
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('LOG: ' + m.params.entry.text.slice(0, 300))
  })

  await page.send('Page.navigate', { url: TARGET_URL })

  // 轮询等待 introPhase 进入 done 且遮罩真的 display:none
  const probeExpr = `(() => {
    const el = document.querySelector('.paper-tear');
    const cs = el ? getComputedStyle(el) : null;
    const cvs = document.querySelector('canvas');
    return JSON.stringify({
      phase: document.body.dataset.introPhase || null,
      maskExists: !!el,
      maskDisplay: cs ? cs.display : null,
      maskOpacity: cs ? cs.opacity : null,
      canvas: cvs ? [cvs.width, cvs.height] : null,
      bridge: !!window.__PORTFOLIO_DEBUG__,
    });
  })()`

  let state = null
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    const r = await page.send('Runtime.evaluate', { expression: probeExpr, returnByValue: true })
    state = JSON.parse(r.result.value)
    if (state.phase === 'done' && state.maskDisplay === 'none') break
  }
  console.log('phase/mask:', JSON.stringify(state))

  if (state.phase !== 'done') console.log('!!! 超时：phase 未到 done')
  if (state.maskDisplay !== 'none') console.log('!!! 遮罩未隐藏，display =', state.maskDisplay)

  // 冻结相机并摆位
  const setup = `(() => {
    window.__PORTFOLIO_FREEZE_CAMERA__ = true;
    const d = window.__PORTFOLIO_DEBUG__;
    if (!d) return 'no bridge';
    const c = d.camera;
    c.position.set(${x}, ${y}, ${z});
    c.rotation.order = 'YXZ';
    c.rotation.set(${rx}, ${ry}, ${rz});
    c.updateProjectionMatrix();
    ${noFog === 'noFog' ? 'd.scene.fog = null;' : ''}
    ${noLight === 'noLight' ? "d.scene.traverse((o) => { if (o.isLight) o.intensity = 0; });" : ''}
    return JSON.stringify({
      cam: [c.position.x, c.position.y, c.position.z],
      fog: d.scene.fog ? d.scene.fog.far : null,
      stats: d.stats ? d.stats() : null,
    });
  })()`

  for (let i = 0; i < 10; i++) {
    await sleep(150)
    const r = await page.send('Runtime.evaluate', { expression: setup, returnByValue: true })
    if (i === 0) console.log('setup:', r.result.value)
  }

  await sleep(900)
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  const file = `E:/fhgBLOG/IDEAblog/.ref/frames/${outname || 'verify'}.png`
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  console.log(`shot -> frames/${outname || 'verify'}.png`)

  // 像素验收：判断画面是否仍是"纸色"
  const img = decodePng(Buffer.from(shot.data, 'base64'))
  const pts = {
    '左上': [6, 6],
    '中心': [Math.floor(img.w / 2), Math.floor(img.h / 2)],
    '上中': [Math.floor(img.w / 2), 6],
    '下中': [Math.floor(img.w / 2), img.h - 7],
    '左缘': [6, Math.floor(img.h / 2)],
    '右缘': [img.w - 7, Math.floor(img.h / 2)],
    '下1/4': [Math.floor(img.w / 2), Math.floor(img.h * 0.75)],
  }
  console.log(`尺寸 ${img.w}x${img.h}`)
  let paperCount = 0
  for (const [k, [px, py]] of Object.entries(pts)) {
    const c = sample(img, px, py)
    const isPaper = Math.abs(c[0] - 239) < 8 && Math.abs(c[1] - 234) < 8 && Math.abs(c[2] - 224) < 8
    if (isPaper) paperCount++
    console.log(`${k.padEnd(6)} ${c.join(',')}${isPaper ? '  <= 纸色!' : ''}`)
  }
  console.log(paperCount === 0 ? '>> 遮罩已彻底移除（无纸色像素）' : `>> 仍有 ${paperCount} 个采样点是纸色`)
  console.log('EXCEPTIONS:', errors.length)
  errors.slice(0, 8).forEach((e) => console.log('  ', e))
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
