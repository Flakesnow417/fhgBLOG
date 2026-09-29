// 用 CDP 直连 headless Chrome，抓取页面 console 报错与未捕获异常。
// 关键：不经过 shell 传递内联 JS，避免引号被破坏。
import net from 'node:net'
import http from 'node:http'

const TARGET_URL = process.argv[2] || 'http://localhost:5173/'
const PORT = 9222

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve(JSON.parse(data)))
      },
    )
    req.on('error', reject)
  })
}

// --- 手搓最小 WebSocket 客户端（文本帧） ---
function makeWs(url) {
  const u = new URL(url)
  const sock = net.connect(Number(u.port), u.hostname)
  let handshakeDone = false
  let buf = Buffer.alloc(0)
  const listeners = []
  const waiters = []

  function emit(msg) {
    for (const fn of listeners) fn(msg)
  }

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
      if (len === 126) {
        if (buf.length < 4) return
        len = buf.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (buf.length < 10) return
        len = Number(buf.readBigUInt64BE(2))
        off = 10
      }
      if (buf.length < off + len) return
      const payload = buf.subarray(off, off + len).toString('utf8')
      buf = buf.subarray(off + len)
      try {
        const msg = JSON.parse(payload)
        emit(msg)
        while (waiters.length && waiters[0].pred(msg)) {
          waiters.shift().resolve(msg)
        }
      } catch {
        /* ping/pong 忽略 */
      }
    }
  })

  const key = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
  sock.write(
    `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
      `Host: ${u.hostname}:${u.port}\r\n` +
      `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  )

  let id = 0
  const pending = new Map()

  function send(method, params = {}) {
    const msgId = ++id
    const json = JSON.stringify({ id: msgId, method, params })
    const payload = Buffer.from(json, 'utf8')
    const mask = Buffer.from([1, 2, 3, 4])
    const masked = Buffer.alloc(payload.length)
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4]

    let header
    if (payload.length < 126) {
      header = Buffer.from([0x81, 0x80 | payload.length])
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x81
      header[1] = 0x80 | 126
      header.writeUInt16BE(payload.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x81
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(payload.length), 2)
    }
    sock.write(Buffer.concat([header, mask, masked]))

    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject })
      setTimeout(() => {
        if (pending.has(msgId)) {
          pending.delete(msgId)
          reject(new Error(`timeout: ${method}`))
        }
      }, 20000)
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

  return { send, listeners, sock, on: (fn) => listeners.push(fn) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const version = await httpGet('/json/version')
  const ws = makeWs(version.webSocketDebuggerUrl)
  await sleep(300)

  const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' })
  const targets = await httpGet('/json/list')
  const target = targets.find((t) => t.id === targetId)
  const page = makeWs(target.webSocketDebuggerUrl)
  await sleep(300)

  const logs = []
  const errors = []

  page.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || [])
        .map((a) => a.value ?? a.description ?? a.unserializableValue ?? `<${a.type}>`)
        .join(' ')
      logs.push({ type: msg.params.type, text })
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      errors.push({
        text: d.text,
        desc: d.exception?.description || '',
        line: d.lineNumber,
        url: d.url,
      })
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry
      logs.push({ type: `log:${e.level}`, text: `[${e.source}] ${e.text} ${e.url || ''}` })
    }
  })

  await page.send('Runtime.enable')
  await page.send('Log.enable')
  await page.send('Page.enable')

  await page.send('Page.navigate', { url: TARGET_URL })
  await sleep(6000)

  // 探针：DOM 里有没有 canvas，WebGL 上下文是否拿到
  const probe = await page.send('Runtime.evaluate', {
    expression: `(() => {
      const c = document.querySelector('canvas');
      let glOk = false, glErr = '';
      try {
        const t = document.createElement('canvas');
        glOk = !!(t.getContext('webgl2') || t.getContext('webgl'));
      } catch (e) { glErr = String(e); }
      return JSON.stringify({
        canvas: !!c,
        canvasW: c ? c.width : 0,
        canvasH: c ? c.height : 0,
        rootChildren: document.getElementById('root')?.children.length ?? -1,
        badge: document.querySelector('.boot-badge')?.textContent?.slice(0,40) ?? null,
        hint: document.querySelector('.boot-hint')?.textContent ?? null,
        webglAvailable: glOk,
        glErr,
      });
    })()`,
    returnByValue: true,
  })

  console.log('=== PROBE ===')
  console.log(probe.result.value)

  console.log('=== CONSOLE (' + logs.length + ') ===')
  for (const l of logs.slice(0, 40)) console.log(`[${l.type}] ${l.text.slice(0, 400)}`)

  console.log('=== EXCEPTIONS (' + errors.length + ') ===')
  for (const e of errors.slice(0, 20)) {
    console.log(`- ${e.text} @ line ${e.line} ${e.url}`)
    if (e.desc) console.log(e.desc.slice(0, 1200))
  }

  await page.send('Page.captureScreenshot', { format: 'png' }).then(async (r) => {
    const fs = await import('node:fs')
    fs.writeFileSync('/e/fhgBLOG/IDEAblog/.ref/diag-shot.png', Buffer.from(r.data, 'base64'))
    console.log('screenshot saved')
  })

  process.exit(0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
