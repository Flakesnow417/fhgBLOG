// 终极诊断：把 canvas 的像素读回来，统计颜色分布，判断画面到底是什么
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs'

const PORT = 9342
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag12'
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

// 读回 canvas 像素，统计颜色直方图与方差
const PIXEL_EXPR = `(() => {
  const cv = document.querySelector('canvas');
  if (!cv) return 'no canvas';
  // 用 2D 画布把 WebGL canvas 画下来再读像素（preserveDrawingBuffer 为 false 时
  // 直接 getImageData 会拿到空白，所以走 drawImage 这条稳妥路径）
  const w = 160, h = 100;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(cv, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  const hist = {};
  let minL = 255, maxL = 0;
  const lums = [];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    sumR += r; sumG += g; sumB += b; n++;
    const lum = Math.round(0.2126*r + 0.7152*g + 0.0722*b);
    lums.push(lum);
    if (lum < minL) minL = lum;
    if (lum > maxL) maxL = lum;
    const bucket = Math.floor(lum / 16);
    hist[bucket] = (hist[bucket] || 0) + 1;
  }
  const mean = lums.reduce((a,b)=>a+b,0) / lums.length;
  const variance = lums.reduce((a,b)=>a+(b-mean)*(b-mean),0) / lums.length;
  return JSON.stringify({
    meanRGB: [Math.round(sumR/n), Math.round(sumG/n), Math.round(sumB/n)],
    luminance: { min: minL, max: maxL, mean: +mean.toFixed(1), std: +Math.sqrt(variance).toFixed(1) },
    histBucketsOf16: hist,
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

  // 冻结相机到走廊内
  const setup = `(() => {
    window.__PORTFOLIO_FREEZE_CAMERA__ = true;
    const d = window.__PORTFOLIO_DEBUG__;
    if (!d) return 'no bridge';
    d.camera.position.set(0, 1.65, 8);
    d.camera.rotation.order = 'YXZ';
    d.camera.rotation.set(-0.05, 0, 0);
    d.camera.updateProjectionMatrix();
    d.scene.fog = null;
    return 'ok';
  })()`
  for (let i = 0; i < 10; i++) { await sleep(120); await pg.send('Runtime.evaluate', { expression: setup, returnByValue: true }) }
  await sleep(800)

  const out = await pg.send('Runtime.evaluate', { expression: PIXEL_EXPR, returnByValue: true })
  console.log('=== canvas 像素统计（160x100 采样）===')
  console.log(out.result.value)
  if (out.exceptionDetails) console.log('EXC', JSON.stringify(out.exceptionDetails).slice(0, 400))

  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
