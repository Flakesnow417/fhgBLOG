// 查 DOM 层：找出画面里那层米白到底是什么元素
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs'

const PORT = 9343
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag13'
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
  let hs = false, buf = Buffer.alloc(0)
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
  const k = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
  sock.write('GET ' + u.pathname + u.search + ' HTTP/1.1\r\nHost: ' + u.hostname + ':' + u.port +
    '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + k +
    '\r\nSec-WebSocket-Version: 13\r\n\r\n')
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

// 用 elementFromPoint 网格采样，找出画面中央到底是什么元素
const EXPR = `(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  if (!d) return 'no bridge';
  const gl = d.gl.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  // 用一个较小的采样窗口，读屏幕中心的像素
  const sw = 64, sh = 48;
  const sx = Math.floor(W/2 - sw/2), sy = Math.floor(H/2 - sh/2);
  const buf = new Uint8Array(sw * sh * 4);
  // readPixels 原点在左下角，所以 y 要做翻转
  const glY = H - (sy + sh);
  gl.readPixels(sx, glY, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  // 统计
  let r=0,g=0,b=0,n=0,min=255,max=0;
  for (let i=0;i<buf.length;i+=4){
    r+=buf[i];g+=buf[i+1];b+=buf[i+2];n++;
    const l=(buf[i]*0.2126+buf[i+1]*0.7152+buf[i+2]*0.0722);
    if(l<min)min=l; if(l>max)max=l;
  }
  // 再取几个点
  const pt=(x,y)=>{const o=new Uint8Array(4);gl.readPixels(x,H-y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,o);return [o[0],o[1],o[2]];};
  return JSON.stringify({
    buffer: [W, H],
    drawingBufferType: d.gl.getContext().constructor.name,
    centerMean: [Math.round(r/n), Math.round(g/n), Math.round(b/n)],
    lumRange: [Math.round(min), Math.round(max)],
    points: {
      center: pt(W>>1, H>>1),
      topCenter: pt(W>>1, Math.floor(H*0.12)),
      bottomCenter: pt(W>>1, Math.floor(H*0.88)),
      leftWall: pt(Math.floor(W*0.06), H>>1),
      rightWall: pt(Math.floor(W*0.94), H>>1),
      centerFar: pt(W>>1, Math.floor(H*0.42)),
      belowFar: pt(W>>1, Math.floor(H*0.62)),
    },
  }, null, 1);
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
  await sleep(7000)

  const out = await pg.send('Runtime.evaluate', { expression: EXPR, returnByValue: true })
  console.log(out.result.value)
  await sleep(800)
  const shot = await pg.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync('E:/fhgBLOG/IDEAblog/.ref/frames/nobadge.png', Buffer.from(shot.data, 'base64'))
  console.log('shot -> frames/nobadge.png')
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
