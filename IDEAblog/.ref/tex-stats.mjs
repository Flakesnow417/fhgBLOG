// 用无头 Chrome 解码参考项目贴图，测出平均亮度 —— 用来校准我们程序化贴图的基色
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'

const PORT = 9348
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag-tex3'
const TARGET = 'http://127.0.0.1:5202/public/tex-probe.html'
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
      setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)) } }, 30000)
    })
  }
  listeners.push((m) => { if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } })
  return { send, on: (fn) => listeners.push(fn) }
}

async function main() {
  const child = spawn(CHROME, [
    '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=800,600', 'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  let version
  for (let i = 0; i < 30; i++) { try { version = await httpGet('/json/version'); break } catch { await sleep(500) } }
  if (!version) throw new Error('chrome not ready')
  const ws = makeWs(version.webSocketDebuggerUrl)
  await sleep(400)
  const { targetId } = await ws.send('Target.createTarget', { url: TARGET })
  await sleep(4000)
  const targets = await httpGet('/json/list')
  const page = makeWs(targets.find((t) => t.id === targetId).webSocketDebuggerUrl)
  await sleep(600)
  await page.send('Runtime.enable'); await page.send('Page.enable')
  await page.send('Page.navigate', { url: TARGET })
  await sleep(4000)
  const dump = await page.send('Runtime.evaluate', {
    expression: "document.getElementById('out').textContent",
    returnByValue: true,
  })
  console.log(JSON.stringify(dump, null, 1).slice(0,2000))
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
