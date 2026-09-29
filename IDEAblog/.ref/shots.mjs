// 一次性抓多个时刻的截图，用于观察开场动画
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs'

const PORT = 9350
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag-shots'
const TARGET_URL = process.argv[2] || 'http://localhost:5173/'
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
      setTimeout(() => { if (pend.has(mid)) { pend.delete(mid); rej(new Error('to ' + method)) } }, 30000)
    })
  }
  L.push((m) => { if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } })
  return { send, on: (fn) => L.push(fn) }
}

async function main() {
  fs.mkdirSync('E:/fhgBLOG/IDEAblog/.ref/frames', { recursive: true })
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
  await page.send('Runtime.enable'); await page.send('Page.enable')
  await page.send('Page.navigate', { url: TARGET_URL })

  const plan = [['t250', 250], ['t500', 250], ['t800', 300], ['t1150', 350], ['t1500', 350], ['t2200', 700]]
  const probe = `(()=>{const e=document.querySelector('.paper-tear');const c=e?getComputedStyle(e):null;const l=document.querySelector('.paper-tear__half--left');return JSON.stringify({phase:document.body.dataset.introPhase||null,display:c?c.display:null,opacity:c?c.opacity:null,leftT:l?getComputedStyle(l).transform:null})})()`
  for (const [name, wait] of plan) {
    await sleep(wait)
    const st = await page.send('Runtime.evaluate', { expression: probe, returnByValue: true })
    const s = await page.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(`E:/fhgBLOG/IDEAblog/.ref/frames/tear-${name}.png`, Buffer.from(s.data, 'base64'))
    console.log(`${name}: ${st.result.value}`)
  }
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
