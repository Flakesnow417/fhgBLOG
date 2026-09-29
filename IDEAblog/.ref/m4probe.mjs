// 诊断：为什么 hover 没生效 —— 检查画框 mesh 的可见性、材质与 R3F 事件
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs'

const PORT = 9361
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag-m4p'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function httpGet(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(d.slice(0, 150))) } })
    })
    req.on('error', reject)
  })
}
function makeWs(u0) {
  const u = new URL(u0)
  const sock = net.connect(Number(u.port), u.hostname)
  let hs = false; let buf = Buffer.alloc(0); const L = []
  sock.on('data', (c) => {
    buf = Buffer.concat([buf, c])
    if (!hs) { const i = buf.indexOf('\r\n\r\n'); if (i === -1) return; hs = true; buf = buf.subarray(i + 4) }
    while (buf.length >= 2) {
      let len = buf[1] & 0x7f, off = 2
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
      if (buf.length < off + len) return
      const p = buf.subarray(off, off + len).toString('utf8')
      buf = buf.subarray(off + len)
      try { const m = JSON.parse(p); L.forEach((fn) => fn(m)) } catch {}
    }
  })
  sock.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.hostname}:${u.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
  let id = 0; const pend = new Map()
  function send(method, params = {}) {
    const mid = ++id
    const pl = Buffer.from(JSON.stringify({ id: mid, method, params }), 'utf8')
    const mask = Buffer.from([1, 2, 3, 4]); const mk = Buffer.alloc(pl.length)
    for (let i = 0; i < pl.length; i++) mk[i] = pl[i] ^ mask[i % 4]
    let h
    if (pl.length < 126) h = Buffer.from([0x81, 0x80 | pl.length])
    else if (pl.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(pl.length, 2) }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(pl.length), 2) }
    sock.write(Buffer.concat([h, mask, mk]))
    return new Promise((res, rej) => {
      pend.set(mid, { res, rej })
      setTimeout(() => { if (pend.has(mid)) { pend.delete(mid); rej(new Error('timeout ' + method)) } }, 30000)
    })
  }
  L.push((m) => { if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } })
  return { send, on: (fn) => L.push(fn) }
}

const EXPR = `(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  if (!d) return JSON.stringify({ err: 'no bridge' });
  let meshes = 0, raycastable = 0, samples = [];
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    if (typeof o.raycast === 'function') raycastable++;
    // 注意：getWorldPosition 需要一个真正的 THREE.Vector3，
    // 传普通对象会报 "target.setFromMatrixPosition is not a function"。
    // 这里直接用 matrixWorld 自己解出平移分量，避免依赖 THREE。
    const el = o.matrixWorld.elements;
    const wp = { x: el[12], y: el[13], z: el[14] };
    // 找墙上的画框层（世界 x ≈ ±4.48，y ≈ 2.15）
    if (Math.abs(Math.abs(wp.x) - 4.5) < 0.2 && Math.abs(wp.y - 2.15) < 0.7 && samples.length < 14) {
      samples.push({
        type: o.geometry ? o.geometry.type : '',
        wp: [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)],
        visible: o.visible,
        mat: o.material ? o.material.type : null,
        transparent: !!(o.material && o.material.transparent),
        depthWrite: o.material ? o.material.depthWrite : null,
        side: o.material ? o.material.side : null,
        // R3F v9 把交互信息放在 __r3f.store / __r3f.handlers 里。
        // handlers 在 v9 是一个「按事件名索引」的对象；
        // 若为空对象说明这个 mesh 根本没注册任何事件。
        handlerKeys: o.__r3f && o.__r3f.handlers ? Object.keys(o.__r3f.handlers) : null,
        eventCount: o.__r3f ? o.__r3f.eventCount : null,
        r3fKeys: o.__r3f ? Object.keys(o.__r3f) : null,
      });
    }
  });
  const cv = document.querySelector('canvas');
  const r = cv.getBoundingClientRect();
  const wrap = cv.parentElement;
  const wr = wrap ? wrap.getBoundingClientRect() : null;
  const wcs = wrap ? getComputedStyle(wrap) : null;
  return JSON.stringify({
    meshes, raycastable, samples,
    canvasRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    canvasPointerEvents: getComputedStyle(cv).pointerEvents,
    wrapTag: wrap ? wrap.tagName : null,
    wrapRect: wr ? [Math.round(wr.left), Math.round(wr.top), Math.round(wr.width), Math.round(wr.height)] : null,
    wrapPointerEvents: wcs ? wcs.pointerEvents : null,
    eventsEnabled: !!(d.scene && d.scene.__r3f),
  }, null, 1);
})()`

async function main() {
  const child = spawn(CHROME, [
    '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', 'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  let v
  for (let i = 0; i < 30; i++) { try { v = await httpGet('/json/version'); break } catch { await sleep(500) } }
  const ws = makeWs(v.webSocketDebuggerUrl)
  await sleep(400)
  const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' })
  await sleep(400)
  const tg = await httpGet('/json/list')
  const page = makeWs(tg.find((t) => t.id === targetId).webSocketDebuggerUrl)
  await sleep(500)
  await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Log.enable')
  const errors = []
  page.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 400))
    if (m.method === 'Log.entryAdded') errors.push(m.params.entry.level.toUpperCase() + ': ' + m.params.entry.text.slice(0, 320))
  })
  await page.send('Page.navigate', { url: 'http://localhost:5173/' })
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    const r = await page.send('Runtime.evaluate', { expression: `document.body.dataset.introPhase || '?'`, returnByValue: true })
    if (r.result.value === 'done') break
  }
  await page.send('Runtime.evaluate', { expression: 'window.__PORTFOLIO_FREEZE_CAMERA__ = true', returnByValue: true })
  await sleep(400)
  const r = await page.send('Runtime.evaluate', { expression: EXPR, returnByValue: true })
  fs.writeFileSync("E:/fhgBLOG/IDEAblog/.ref/frames/probe.json", r.result.value)
  console.log('--- console ---')
  errors.slice(0, 20).forEach((e) => console.log('  ', e))
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
