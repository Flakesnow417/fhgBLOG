// 深挖：列出场景里所有 mesh 的详细信息，定位画框
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'

const TARGET_URL = process.argv[2] || 'http://localhost:5173/'
const WAIT = Number(process.argv[3] || 5000)
const PORT = 9337
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag7'

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

function makeWs(url) {
  const u = new URL(url)
  const sock = net.connect(Number(u.port), u.hostname)
  let hs = false
  let buf = Buffer.alloc(0)
  const listeners = []
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
  sock.write(
    `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.hostname}:${u.port}\r\n` +
    `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
    `Sec-WebSocket-Key: ${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}\r\n` +
    `Sec-WebSocket-Version: 13\r\n\r\n`,
  )
  let id = 0
  const pending = new Map()
  function send(method, params = {}) {
    const mid = ++id
    const payload = Buffer.from(JSON.stringify({ id: mid, method, params }), 'utf8')
    const mask = Buffer.from([1, 2, 3, 4])
    const masked = Buffer.alloc(payload.length)
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
  listeners.push((m) => {
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
    }
  })
  return { send, on: (fn) => listeners.push(fn) }
}

async function main() {
  const child = spawn(CHROME, [
    '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', 'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()

  let version
  for (let i = 0; i < 30; i++) { try { version = await httpGet('/json/version'); break } catch { await sleep(500) } }
  if (!version) throw new Error('Chrome 未就绪')

  const ws = makeWs(version.webSocketDebuggerUrl)
  await sleep(400)
  const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' })
  await sleep(500)
  const targets = await httpGet('/json/list')
  const target = targets.find((t) => t.id === targetId)
  const page = makeWs(target.webSocketDebuggerUrl)
  await sleep(400)
  await page.send('Runtime.enable')
  await page.send('Page.enable')
  await page.send('Page.navigate', { url: TARGET_URL })
  await sleep(WAIT)

  const expr = `(() => {
    const d = window.__PORTFOLIO_DEBUG__;
    if (!d) return JSON.stringify({ error: 'no debug bridge' });
    const scene = d.scene, cam = d.camera;
    const rows = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const wp = o.getWorldPosition(new o.position.constructor());
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      const sz = bb ? [bb.max.x-bb.min.x, bb.max.y-bb.min.y, bb.max.z-bb.min.z] : null;
      // 是否在相机前方
      const dz = wp.z - cam.position.z; // 负数=前方
      rows.push({
        geo: g.type,
        world: [wp.x, wp.y, wp.z].map(n=>+n.toFixed(2)),
        size: sz ? sz.map(n=>+n.toFixed(2)) : null,
        color: o.material?.color ? '#'+o.material.color.getHexString() : null,
        emissive: o.material?.emissive ? '#'+o.material.emissive.getHexString() : null,
        dz: +dz.toFixed(1),
        parentVisible: (()=>{let q=o,v=true;while(q){if(!q.visible)v=false;q=q.parent}return v})(),
      });
    });
    // 只保留相机附近的
    const near = rows.filter(r => r.world[2] > -30 && r.world[2] < 32);
    return JSON.stringify({ total: rows.length, nearCount: near.length, camZ: cam.position.z, camX: cam.position.x, rows: near }, null, 0);
  })()`

  const out = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true })
  const v = out.result.value
  try {
    const j = JSON.parse(v)
    console.log('cam:', j.camX, j.camZ, '| total meshes:', j.total, '| 附近:', j.nearCount)
    console.log('--- 相机附近的物体（world z 在 -30..32）---')
    for (const r of j.rows) {
      console.log(
        (r.visible === false ? 'X' : r.parentVisible ? ' ' : 'x') + ' ' +
        String(r.geo).padEnd(22) + ' ' +
        'w=' + JSON.stringify(r.world).padEnd(24) +
        'sz=' + JSON.stringify(r.size).padEnd(24) +
        'dz=' + String(r.dz).padStart(6) +
        '  c=' + (r.color || '-') +
        (r.emissive && r.emissive !== '#000000' ? ' em=' + r.emissive : '')
      )
    }
  } catch { console.log(v) }

  process.exit(0)
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
