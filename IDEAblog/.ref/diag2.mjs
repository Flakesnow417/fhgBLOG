// 自包含诊断：spawn Chrome → CDP 连接 → 抓 console/异常 → 截图
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs'

const TARGET_URL = process.argv[2] || 'http://localhost:5173/'
const PORT = 9333
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag2'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(new Error('bad json: ' + d.slice(0, 200))) }
      })
    })
    req.on('error', reject)
  })
}

function makeWs(url) {
  const u = new URL(url)
  const sock = net.connect(Number(u.port), u.hostname)
  let handshakeDone = false
  let buf = Buffer.alloc(0)
  const listeners = []

  const emit = (msg) => { for (const fn of listeners) fn(msg) }

  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    if (!handshakeDone) {
      const idx = buf.indexOf('\r\n\r\n')
      if (idx === -1) return
      handshakeDone = true
      buf = buf.subarray(idx + 4)
    }
    while (buf.length >= 2) {
      const b1 = buf[1]
      let len = b1 & 0x7f
      let off = 2
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
      if (buf.length < off + len) return
      const payload = buf.subarray(off, off + len).toString('utf8')
      buf = buf.subarray(off + len)
      try { emit(JSON.parse(payload)) } catch { /* ignore */ }
    }
  })

  const key = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
  sock.write(
    `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.hostname}:${u.port}\r\n` +
    `Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  )

  let id = 0
  const pending = new Map()

  function send(method, params = {}) {
    const msgId = ++id
    const payload = Buffer.from(JSON.stringify({ id: msgId, method, params }), 'utf8')
    const mask = Buffer.from([1, 2, 3, 4])
    const masked = Buffer.alloc(payload.length)
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4]

    let header
    if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length])
    else if (payload.length < 65536) {
      header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126
      header.writeUInt16BE(payload.length, 2)
    } else {
      header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(payload.length), 2)
    }
    sock.write(Buffer.concat([header, mask, masked]))

    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject })
      setTimeout(() => { if (pending.has(msgId)) { pending.delete(msgId); reject(new Error('timeout ' + method)) } }, 20000)
    })
  }

  listeners.push((msg) => {
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })

  return { send, on: (fn) => listeners.push(fn), close: () => sock.destroy() }
}

async function main() {
  // 1. 启动 Chrome
  const child = spawn(CHROME, [
    '--headless=new',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900',
    'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()

  // 2. 等端口
  let version = null
  for (let i = 0; i < 30; i++) {
    try { version = await httpGet('/json/version'); break } catch { await sleep(500) }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪')

  const ws = makeWs(version.webSocketDebuggerUrl)
  await sleep(400)

  const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' })
  await sleep(500)
  const targets = await httpGet('/json/list')
  const target = targets.find((t) => t.id === targetId)
  if (!target) throw new Error('未找到目标页')

  const page = makeWs(target.webSocketDebuggerUrl)
  await sleep(400)

  const logs = []
  const errors = []
  const netFails = []

  page.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || [])
        .map((a) => a.value ?? a.description ?? a.unserializableValue ?? `<${a.type}>`)
        .join(' ')
      logs.push({ type: msg.params.type, text })
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      errors.push({ text: d.text, desc: d.exception?.description || '', line: d.lineNumber, url: d.url })
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry
      logs.push({ type: `log:${e.level}`, text: `[${e.source}] ${e.text} ${e.url || ''}` })
    }
    if (msg.method === 'Network.loadingFailed') {
      netFails.push(`${msg.params.type} ${msg.params.errorText} ${msg.params.requestId}`)
    }
  })

  await page.send('Runtime.enable')
  await page.send('Log.enable')
  await page.send('Page.enable')
  await page.send('Network.enable')

  await page.send('Page.navigate', { url: TARGET_URL })
  await sleep(7000)

  const probe = await page.send('Runtime.evaluate', {
    expression: `(() => {
      const c = document.querySelector('canvas');
      let glOk = false, glErr = '';
      try {
        const t = document.createElement('canvas');
        const g = t.getContext('webgl2') || t.getContext('webgl');
        glOk = !!g;
        if (g) { const d = g.getExtension('WEBGL_debug_renderer_info');
          glErr = d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'no-debug-ext'; }
      } catch (e) { glErr = String(e); }
      return JSON.stringify({
        canvas: !!c,
        canvasW: c ? c.width : 0,
        canvasH: c ? c.height : 0,
        rootChildren: document.getElementById('root')?.children.length ?? -1,
        badge: document.querySelector('.boot-badge')?.textContent?.slice(0,50) ?? null,
        hint: document.querySelector('.boot-hint')?.textContent ?? null,
        webglAvailable: glOk,
        renderer: glErr,
      });
    })()`,
    returnByValue: true,
  })

  console.log('=== PROBE ===')
  console.log(probe.result.value)
  console.log('=== CONSOLE (' + logs.length + ') ===')
  for (const l of logs.slice(0, 50)) console.log(`[${l.type}] ${l.text.slice(0, 500)}`)
  console.log('=== EXCEPTIONS (' + errors.length + ') ===')
  for (const e of errors.slice(0, 15)) {
    console.log(`- ${e.text} @line ${e.line} ${e.url}`)
    if (e.desc) console.log(e.desc.slice(0, 1500))
  }
  console.log('=== NET FAILS (' + netFails.length + ') ===')
  for (const n of netFails.slice(0, 20)) console.log(n)

  try {
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync('E:/fhgBLOG/IDEAblog/.ref/diag-shot.png', Buffer.from(shot.data, 'base64'))
    console.log('screenshot -> .ref/diag-shot.png')
  } catch (e) { console.log('screenshot failed: ' + e.message) }

  process.exit(0)
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
