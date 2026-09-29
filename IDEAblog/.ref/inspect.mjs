// 隔离诊断：冻结漫游相机，把它摆到指定位置，关闭雾，观察真实几何
// 用法: node inspect.mjs <url> <x> <y> <z> <rx> <ry> <rz> <outname> [noLight] [noFog]
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs'

const [url, x, y, z, rx, ry, rz, outname, noLight, noFog] = process.argv.slice(2)
const TARGET_URL = url || 'http://localhost:5173/'
const PORT = 9340
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag10'

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
  const target = targets.find((t) => t.id === targetId)
  const page = makeWs(target.webSocketDebuggerUrl)
  await sleep(400)
  await page.send('Runtime.enable'); await page.send('Page.enable')
  await page.send('Page.navigate', { url: TARGET_URL })
  await sleep(6000)

  // 冻结漫游，然后摆相机
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
    ${process.env.HIDE_CANVAS ? "document.querySelector('canvas').style.display='none';" : ''}
    ${noLight === 'noLight' ? `
      d.scene.traverse((o) => { if (o.isLight) o.intensity = 0; });
    ` : ''}
    return JSON.stringify({
      cam: [c.position.x, c.position.y, c.position.z],
      rot: [c.rotation.x, c.rotation.y, c.rotation.z].map(n=>+n.toFixed(3)),
      fog: d.scene.fog ? d.scene.fog.far : null,
    });
  })()`

  for (let i = 0; i < 12; i++) {
    await sleep(120)
    const r = await page.send('Runtime.evaluate', { expression: setup, returnByValue: true })
    if (i === 0) console.log('setup:', r.result.value)
  }

  await sleep(700)
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`E:/fhgBLOG/IDEAblog/.ref/frames/${outname || 'inspect'}.png`, Buffer.from(shot.data, 'base64'))
  console.log(`shot -> frames/${outname || 'inspect'}.png`)
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
