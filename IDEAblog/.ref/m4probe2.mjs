/**
 * m4probe2.mjs —— 验证指针事件是否正确挂载
 * ==================================================================
 * 从 window.__PORTFOLIO_DEBUG__ 读 probe()，检查：
 *   1. 有多少 mesh 挂着指针事件（期望：每幅画框恰好 1 个命中面）；
 *   2. handlers 的键是否包含 onPointerOver / onPointerOut / onClick；
 *   3. R3F 事件系统是否 connected。
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const PORT = 9370
const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:5173/'
const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT_DIR = 'E:/fhgBLOG/IDEAblog/.ref/frames'

const userDataDir = path.join('E:/tmp', `cdp-m4probe2-${crypto.randomBytes(4).toString('hex')}`)

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1280,800',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForCdp(timeoutMs = 25000) {
  const t0 = Date.now()
  let lastErr = null
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      return await res.json()
    } catch (e) {
      lastErr = e
      await sleep(200)
    }
  }
  throw new Error('CDP 端口未就绪: ' + lastErr?.message)
}

/* ---------------- 极简 CDP WebSocket 客户端（零依赖） ---------------- */
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.listeners = new Set()
    let buf = Buffer.alloc(0)

    ws.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        if (buf.length < 2) return
        const b0 = buf[0]
        const b1 = buf[1]
        const fin = (b0 & 0x80) !== 0
        const opcode = b0 & 0x0f
        const masked = (b1 & 0x80) !== 0
        let len = b1 & 0x7f
        let off = 2
        if (len === 126) {
          if (buf.length < off + 2) return
          len = buf.readUInt16BE(off)
          off += 2
        } else if (len === 127) {
          if (buf.length < off + 8) return
          const hi = buf.readUInt32BE(off)
          const lo = buf.readUInt32BE(off + 4)
          len = hi * 2 ** 32 + lo
          off += 8
        }
        let maskKey = null
        if (masked) {
          if (buf.length < off + 4) return
          maskKey = buf.subarray(off, off + 4)
          off += 4
        }
        if (buf.length < off + len) return
        const payload = Buffer.from(buf.subarray(off, off + len))
        if (maskKey) {
          for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4]
        }
        buf = buf.subarray(off + len)

        if (opcode === 0x8) return
        if (opcode === 0x9) {
          this.sendFrame(0xa, payload)
          continue
        }
        if (!fin) continue
        try {
          this.handle(JSON.parse(payload.toString('utf8')))
        } catch {
          /* ignore */
        }
      }
    })
  }

  handle(msg) {
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
      return
    }
    for (const fn of this.listeners) fn(msg)
  }

  sendFrame(opcode, payload) {
    const len = payload.length
    let header
    if (len < 126) {
      header = Buffer.alloc(6)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | len
      crypto.randomFillSync(header, 2, 4)
    } else if (len < 65536) {
      header = Buffer.alloc(8)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 126
      header.writeUInt16BE(len, 2)
      crypto.randomFillSync(header, 4, 4)
    } else {
      header = Buffer.alloc(14)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 127
      header.writeUInt32BE(Math.floor(len / 2 ** 32), 2)
      header.writeUInt32BE(len >>> 0, 6)
      crypto.randomFillSync(header, 10, 4)
    }
    const maskKey = header.subarray(header.length - 4)
    const masked = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ maskKey[i % 4]
    this.ws.write(Buffer.concat([header, masked]))
  }

  send(method, params = {}) {
    const id = ++this.id
    this.sendFrame(0x1, Buffer.from(JSON.stringify({ id, method, params }), 'utf8'))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, 30000)
    })
  }

  on(fn) {
    this.listeners.add(fn)
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) {
      throw new Error(
        '页面异常: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)),
      )
    }
    return r.result.value
  }

  /**
   * 在页面里 JSON.stringify 之后再返回。
   * 直接把一个引用了 WebGL / DOM / Map 的活对象交给 returnByValue 时，
   * CDP 的深拷贝会撞上 "Object reference chain is too long"。
   * 序列化成字符串就没这个问题 —— 而我们的 probe() 结果本来就是数据。
   */
  async evaluateJson(expression) {
    const wrapped =
      '(() => { try { return JSON.stringify(' + expression + ') } ' +
      'catch (e) { return JSON.stringify({ __stringifyError: String(e) }) } })()'
    const raw = await this.evaluate(wrapped)
    if (typeof raw !== 'string') return raw
    return JSON.parse(raw)
  }
}

async function connect(wsUrl) {
  const u = new URL(wsUrl)
  const key = crypto.randomBytes(16).toString('base64')
  const sock = net.connect({ host: u.hostname, port: Number(u.port) })
  await new Promise((res, rej) => {
    sock.once('connect', res)
    sock.once('error', rej)
  })
  sock.write(
    `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
      `Host: ${u.host}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\n` +
      `Sec-WebSocket-Version: 13\r\n\r\n`,
  )
  let head = Buffer.alloc(0)
  await new Promise((res, rej) => {
    const onData = (c) => {
      head = Buffer.concat([head, c])
      const i = head.indexOf('\r\n\r\n')
      if (i >= 0) {
        sock.removeListener('data', onData)
        if (!/101/.test(head.subarray(0, i).toString())) {
          rej(new Error('WS 握手失败: ' + head.subarray(0, i).toString()))
          return
        }
        const rest = head.subarray(i + 4)
        if (rest.length) sock.unshift(rest)
        res()
      }
    }
    sock.on('data', onData)
    sock.once('error', rej)
  })
  return new Cdp(sock)
}

/* ---------------- 主流程 ---------------- */
await waitForCdp()
const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, {
  method: 'PUT',
}).then((r) => r.json())
const cdp = await connect(target.webSocketDebuggerUrl)

await cdp.send('Runtime.enable')
await cdp.send('Page.enable')
await cdp.send('Log.enable')

const exceptions = []
cdp.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(m.params.exceptionDetails?.exception?.description || 'unknown')
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    exceptions.push('[console.error] ' + m.params.entry.text)
  }
})

await cdp.send('Page.navigate', { url: TARGET_URL })

const t0 = Date.now()
let phase = null
while (Date.now() - t0 < 45000) {
  try {
    phase = await cdp.evaluate('document.body.dataset.introPhase || null')
    if (phase === 'done') break
  } catch {
    /* loading */
  }
  await sleep(300)
}
await sleep(1500)

const summary = await cdp.evaluateJson(`
(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  if (!d) return { error: '__PORTFOLIO_DEBUG__ 未就绪' };
  const p = d.probe();
  // events() 返回的对象里可能间接引用 Map/WebGL 上下文，returnByValue
  // 深拷贝时会报 "Object reference chain is too long"，所以这里只取标量。
  let ev = { hasEvents: false, connected: null, handlerObjects: null };
  try {
    const evr = d.events();
    ev = {
      hasEvents: evr.hasEvents === true,
      connected: evr.connected === true,
      handlerObjects: typeof evr.handlerObjects === 'number' ? evr.handlerObjects : null,
    };
  } catch (e) {
    ev.error = String(e);
  }
  // 只保留"可交互"与"疑似命中面"两类，避免整体 JSON 过大
  const hitLike = p.meshes.filter(m => m.opacity === 0 && m.colorWrite === false && !m.hasMap);
  return {
    meshCount: p.meshCount,
    visibleCount: p.visibleCount,
    withHandlers: p.withHandlers,
    interactive: p.interactive,
    hitTargetCount: hitLike.length,
    hitTargets: hitLike.slice(0, 6),
    size: p.size,
    events: ev,
  };
})()
`)

console.log(JSON.stringify(summary, null, 2))
console.log('EXCEPTIONS:', exceptions.length)
for (const e of exceptions) console.log('  -', e)

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, 'm4probe2.json'), JSON.stringify({ summary, exceptions }, null, 2))
console.log('written ->', path.join(OUT_DIR, 'm4probe2.json'))

chrome.kill('SIGKILL')
process.exit(0)
