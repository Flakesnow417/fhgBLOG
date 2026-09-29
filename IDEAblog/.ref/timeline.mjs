// 时序截图：在多个时间点抓帧，验证开场动画的推进
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs'

const TARGET_URL = process.argv[2] || 'http://localhost:5173/'
const PORT = 9334
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag3'
const OUTDIR = 'E:/fhgBLOG/IDEAblog/.ref/frames'

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
    if (!hs) {
      const i = buf.indexOf('\r\n\r\n')
      if (i === -1) return
      hs = true
      buf = buf.subarray(i + 4)
    }
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
      setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)) } }, 20000)
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
  fs.mkdirSync(OUTDIR, { recursive: true })

  const child = spawn(CHROME, [
    '--headless=new',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,800',
    'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()

  let version
  for (let i = 0; i < 30; i++) {
    try { version = await httpGet('/json/version'); break } catch { await sleep(500) }
  }
  if (!version) throw new Error('Chrome 未就绪')

  const ws = makeWs(version.webSocketDebuggerUrl)
  await sleep(400)
  const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' })
  await sleep(500)
  const targets = await httpGet('/json/list')
  const target = targets.find((t) => t.id === targetId)
  const page = makeWs(target.webSocketDebuggerUrl)
  await sleep(400)

  const errors = []
  page.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      errors.push(d.exception?.description || d.text)
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('[console.error] ' + (m.params.args || []).map((a) => a.value ?? a.description).join(' '))
    }
  })

  await page.send('Runtime.enable')
  await page.send('Page.enable')

  await page.send('Page.navigate', { url: TARGET_URL })

  // 在多个时间点抓帧 + 读取 introPhase
  const marks = [400, 900, 1400, 1900, 2400, 3000, 4000]
  let prev = 0
  const report = []

  for (const t of marks) {
    await sleep(t - prev)
    prev = t

    const probe = await page.send('Runtime.evaluate', {
      expression: `(() => {
        const tear = document.querySelector('.paper-tear');
        const left = document.querySelector('.paper-tear__half--left');
        const right = document.querySelector('.paper-tear__half--right');
        const cs = (el) => el ? getComputedStyle(el) : null;
        return JSON.stringify({
          phase: document.body.dataset.introPhase ?? null,
          tearDisplay: cs(tear)?.display ?? null,
          tearOpacity: cs(tear)?.opacity ?? null,
          leftTransform: cs(left)?.transform ?? null,
          rightTransform: cs(right)?.transform ?? null,
          titleVisible: !!document.querySelector('.paper-tear__title'),
          loadingVisible: !!document.querySelector('.paper-tear__loading'),
          badge: document.querySelector('.boot-badge')?.textContent?.slice(0, 30) ?? null,
        });
      })()`,
      returnByValue: true,
    })

    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    const file = `${OUTDIR}/t${String(t).padStart(4, '0')}.png`
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
    report.push(`t=${t}ms ${probe.result.value}`)
  }

  console.log('=== 时序报告 ===')
  for (const r of report) console.log(r)
  console.log('=== 异常 (' + errors.length + ') ===')
  for (const e of errors.slice(0, 10)) console.log(e.slice(0, 800))
  console.log('帧已保存到 ' + OUTDIR)

  process.exit(0)
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
