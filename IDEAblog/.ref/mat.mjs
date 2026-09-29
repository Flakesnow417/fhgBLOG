import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'

const PORT = 9341
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag11'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function httpGet(p) {
  return new Promise((res, rej) => {
    const q = http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let d = ''
      r.on('data', (c) => (d += c))
      r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(new Error(d.slice(0, 150))) } })
    })
    q.on('error', rej)
  })
}

function makeWs(u0) {
  const u = new URL(u0)
  const sock = net.connect(Number(u.port), u.hostname)
  let hs = false
  let buf = Buffer.alloc(0)
  const L = []
  const emit = (m) => { for (const f of L) f(m) }
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
      try { emit(JSON.parse(p)) } catch {}
    }
  })
  const wsKey = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
  sock.write(
    'GET ' + u.pathname + u.search + ' HTTP/1.1\r\n' +
    'Host: ' + u.hostname + ':' + u.port + '\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Key: ' + wsKey + '\r\nSec-WebSocket-Version: 13\r\n\r\n'
  )
  let id = 0
  const pend = new Map()
  function send(m, p = {}) {
    const mid = ++id
    const pl = Buffer.from(JSON.stringify({ id: mid, method: m, params: p }), 'utf8')
    const mask = Buffer.from([1, 2, 3, 4])
    const ms = Buffer.alloc(pl.length)
    for (let i = 0; i < pl.length; i++) ms[i] = pl[i] ^ mask[i % 4]
    let h
    if (pl.length < 126) h = Buffer.from([0x81, 0x80 | pl.length])
    else if (pl.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(pl.length, 2) }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(pl.length), 2) }
    sock.write(Buffer.concat([h, mask, ms]))
    return new Promise((res, rej) => {
      pend.set(mid, { res, rej })
      setTimeout(() => { if (pend.has(mid)) { pend.delete(mid); rej(new Error('timeout ' + m)) } }, 25000)
    })
  }
  L.push((m) => {
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id)
      pend.delete(m.id)
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
    }
  })
  return { send, on: (f) => L.push(f) }
}

const EXPR = `(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  if (!d) return 'no bridge';
  const rows = [];
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const wp = o.getWorldPosition(new o.position.constructor());
    rows.push({
      geo: o.geometry.type,
      mapRepeat: m.map ? m.map.repeat.toArray() : null,
      mapImgW: m.map && m.map.image ? m.map.image.width : null,
      mapNeedsUpdate: m.map ? m.map.needsUpdate : null,
      mat: m.type,
      world: [wp.x, wp.y, wp.z].map(n => +n.toFixed(1)),
      color: m.color ? '#' + m.color.getHexString() : null,
      emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
      emI: m.emissiveIntensity,
      side: m.side,
      transparent: m.transparent,
      opacity: m.opacity,
      hasMap: !!m.map,
      toneMapped: m.toneMapped,
      visible: o.visible,
    });
  });
  const su = rows.filter(r => (r.emissive && r.emissive !== '#000000') || r.side === 2 || r.transparent);
  return JSON.stringify({ total: rows.length, suspicious: su.length, su: su.slice(0, 24) }, null, 1);
})()`

async function main() {
  const ch = spawn(CHROME, [
    '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', 'about:blank',
  ], { detached: true, stdio: 'ignore' })
  ch.unref()

  let v
  for (let i = 0; i < 30; i++) { try { v = await httpGet('/json/version'); break } catch { await sleep(500) } }
  const ws = makeWs(v.webSocketDebuggerUrl)
  await sleep(400)
  const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' })
  await sleep(500)
  const ts = await httpGet('/json/list')
  const t = ts.find((x) => x.id === targetId)
  const pg = makeWs(t.webSocketDebuggerUrl)
  await sleep(400)
  await pg.send('Runtime.enable')
  await pg.send('Page.enable')
  await pg.send('Page.navigate', { url: 'http://localhost:5173/' })
  await sleep(6000)

  const out = await pg.send('Runtime.evaluate', { returnByValue: true, expression: EXPR })
  console.log(out.result.value)
  process.exit(0)
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
