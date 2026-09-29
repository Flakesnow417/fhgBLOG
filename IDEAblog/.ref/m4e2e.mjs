/**
 * m4e2e.mjs —— Module 4 端到端验收
 * ==================================================================
 * 和旧的 m4test.mjs 的区别：
 *   1. 相机朝向**由代码显式设置**，投影也由页面里的 THREE 自己算
 *      （用 d.camera 上现成的投影矩阵），不再手写旋转公式 ——
 *      旧版手写的那套在 rotation.order='YXZ' 下容易算错，
 *      而且它挑的"最近的画框"不看左右墙，会挑到相机背后那一侧的画。
 *   2. 目标点是**命中面的世界坐标**（从 probe() 里拿），
 *      而且会在页面里用 THREE.Vector3 做 project()，
 *      保证"屏幕上这个点确实落在画框里"。
 *   3. 顺带验证：hover 后光标变 pointer、body dataset 有值、
 *      上色层 opacity 从 0 涨到 >0.5、点击后弹窗 role/aria/尺寸、
 *      Esc 关闭后弹窗卸载且 body 滚动恢复。
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const PORT = 9380
const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:5173/'
const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT_DIR = 'E:/fhgBLOG/IDEAblog/.ref/frames'

const profile = path.join('E:/tmp', `cdp-m4e2e-${crypto.randomBytes(4).toString('hex')}`)
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
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
  let last = null
  while (Date.now() - t0 < timeoutMs) {
    try {
      return await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json())
    } catch (e) {
      last = e
      await sleep(200)
    }
  }
  throw new Error('CDP 未就绪: ' + last?.message)
}

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
        let mk = null
        if (masked) {
          if (buf.length < off + 4) return
          mk = buf.subarray(off, off + 4)
          off += 4
        }
        if (buf.length < off + len) return
        const pl = Buffer.from(buf.subarray(off, off + len))
        if (mk) for (let i = 0; i < pl.length; i++) pl[i] ^= mk[i % 4]
        buf = buf.subarray(off + len)
        if (opcode === 0x8) return
        if (opcode === 0x9) {
          this.sendFrame(0xa, pl)
          continue
        }
        if (!fin) continue
        try {
          this.handle(JSON.parse(pl.toString('utf8')))
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
  sendFrame(opcode, pl) {
    const len = pl.length
    let h
    if (len < 126) {
      h = Buffer.alloc(6)
      h[0] = 0x80 | opcode
      h[1] = 0x80 | len
      crypto.randomFillSync(h, 2, 4)
    } else if (len < 65536) {
      h = Buffer.alloc(8)
      h[0] = 0x80 | opcode
      h[1] = 0x80 | 126
      h.writeUInt16BE(len, 2)
      crypto.randomFillSync(h, 4, 4)
    } else {
      h = Buffer.alloc(14)
      h[0] = 0x80 | opcode
      h[1] = 0x80 | 127
      h.writeUInt32BE(Math.floor(len / 2 ** 32), 2)
      h.writeUInt32BE(len >>> 0, 6)
      crypto.randomFillSync(h, 10, 4)
    }
    const mk = h.subarray(h.length - 4)
    const out = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) out[i] = pl[i] ^ mk[i % 4]
    this.ws.write(Buffer.concat([h, out]))
  }
  send(method, params = {}) {
    const id = ++this.id
    this.sendFrame(0x1, Buffer.from(JSON.stringify({ id, method, params }), 'utf8'))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('CDP 超时: ' + method))
        }
      }, 30000)
    })
  }
  on(fn) {
    this.listeners.add(fn)
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
    }
    return r.result.value
  }
  async evaluateJson(expression) {
    const wrapped =
      '(() => { try { return JSON.stringify(' + expression + ') } ' +
      'catch (e) { return JSON.stringify({ __err: String(e) }) } })()'
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
    `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\n` +
      `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  )
  let head = Buffer.alloc(0)
  await new Promise((res, rej) => {
    const onData = (c) => {
      head = Buffer.concat([head, c])
      const i = head.indexOf('\r\n\r\n')
      if (i >= 0) {
        sock.removeListener('data', onData)
        if (!/101/.test(head.subarray(0, i).toString())) {
          rej(new Error('WS 握手失败'))
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

/* ================================================================
   页面内脚本
   ================================================================ */

/**
 * 把相机摆到"正对右墙上 z=20 那幅画"的位置。
 * 右墙在 x=+4.5，画框朝向 -X，所以相机要站在它左边并朝 +X 看。
 *   camera.position  = (2.0, 2.15, 20)   —— 离墙 2.5m，正对画的中心高度
 *   camera.rotation.y = Math.PI / 2      —— 使相机 -Z 轴指向 +X
 * 这样画框正好落在画面正中央，是个最稳的命中目标。
 */
const AIM_SCRIPT = `(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  if (!d) return { err: 'no bridge' };
  window.__PORTFOLIO_FREEZE_CAMERA__ = true;   // 先冻住漫游，否则下一帧就被 hook 覆盖
  const c = d.camera;
  c.position.set(2.0, 2.15, 20);
  c.rotation.order = 'YXZ';
  c.rotation.set(0, Math.PI / 2, 0);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return {
    pos: [c.position.x, c.position.y, c.position.z],
    rot: [c.rotation.x, c.rotation.y, c.rotation.z],
  };
})()`

/**
 * 找到"离屏幕中心最近"的命中面，并用 THREE 自己的 project() 算屏幕坐标。
 * 用 project 而不是手写投影：它内部用 camera.matrixWorldInverse 和
 * projectionMatrix，rotation.order='YXZ'、fov、aspect 都会被正确考虑。
 * 手写那套在 YXZ 下顺序很容易搞反。
 */
const PROJECT_SCRIPT = `(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  if (!d) return { err: 'no bridge' };
  const cam = d.camera;
  const w = d.gl.domElement.clientWidth;
  const h = d.gl.domElement.clientHeight;

  // three 的 Vector3 从这里拿：相机 position 的构造函数就是 Vector3
  const V3 = cam.position.constructor;

  // 命中面特征：opacity===0 && colorWrite===false && 无贴图
  const targets = [];
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.opacity !== 0 || m.colorWrite !== false || m.map) return;
    if (!o.visible) return;
    targets.push(o);
  });
  if (!targets.length) return { err: 'no hit target' };

  const mid = w / 2, mh = h / 2;
  let best = null, bestD = Infinity;
  for (const o of targets) {
    const e = o.matrixWorld.elements;
    const v = new V3(e[12], e[13], e[14]);
    const ndc = v.clone().project(cam);
    if (ndc.z > 1) continue;                 // 在相机后面
    const sx = (ndc.x * 0.5 + 0.5) * w;
    const sy = (-ndc.y * 0.5 + 0.5) * h;
    if (sx < 8 || sy < 8 || sx > w - 8 || sy > h - 8) continue;
    const dist = Math.hypot(sx - mid, sy - mh);
    if (dist < bestD) {
      bestD = dist;
      best = { world: [e[12], e[13], e[14]].map(n => +n.toFixed(2)), screen: [sx, sy], ndc: [ndc.x, ndc.y] };
    }
  }
  return best ? { target: best, count: targets.length, viewport: [w, h] }
              : { err: 'no on-screen target', count: targets.length, viewport: [w, h] };
})()`

/** 读 hover 相关状态 + 上色层 opacity（取离屏幕中心最近那幅的）。 */
const HOVER_STATE_SCRIPT = `(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  const cam = d.camera;
  const V3 = cam.position.constructor;
  const w = d.gl.domElement.clientWidth, h = d.gl.domElement.clientHeight;
  // 找到最靠中间的那幅画，读它的上色层 opacity
  // 上色层特征：transparent && 有 map && depthWrite===false && opacity<1 且 position.z 约 0.016
  let best = null, bestD = Infinity;
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || !m.transparent) return;
    const e = o.matrixWorld.elements;
    const v = new V3(e[12], e[13], e[14]);
    const ndc = v.clone().project(cam);
    if (ndc.z > 1) return;
    const sx = (ndc.x*0.5+0.5)*w, sy = (-ndc.y*0.5+0.5)*h;
    const dist = Math.hypot(sx-w/2, sy-h/2);
    if (dist < bestD) { bestD = dist; best = { opacity: m.opacity, hasMap: !!m.map, z: e[14] }; }
  });
  return {
    hoverArtwork: document.body.dataset.hoverArtwork || null,
    cursor: document.body.style.cursor || '',
    bodyCursorComputed: getComputedStyle(document.body).cursor,
    nearestTransparentOpacity: best ? +best.opacity.toFixed(3) : null,
  };
})()`

const DIALOG_SCRIPT = `(() => {
  const el = document.querySelector('.detail');
  if (!el) return { open: false };
  const panel = document.querySelector('.detail__panel');
  const r = panel ? panel.getBoundingClientRect() : null;
  const cs = panel ? getComputedStyle(panel) : null;
  const titleEl = document.querySelector('.detail__title');
  return {
    open: true,
    role: panel ? panel.getAttribute('role') : null,
    ariaModal: panel ? panel.getAttribute('aria-modal') : null,
    labelledBy: panel ? panel.getAttribute('aria-labelledby') : null,
    title: titleEl ? titleEl.textContent : null,
    blocks: document.querySelectorAll('.detail__block').length,
    items: document.querySelectorAll('.detail__item').length,
    rect: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null,
    opacity: cs ? cs.opacity : null,
    animationName: cs ? cs.animationName : null,
    focusInPanel: panel ? panel.contains(document.activeElement) : false,
    activeTag: document.activeElement ? document.activeElement.tagName : null,
    bodyOverflow: document.body.style.overflow,
    veilExists: !!document.querySelector('.detail__veil') || !!el.querySelector('.detail'),
  };
})()`

/* ================================================================ */
const ver = await waitForCdp()
const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())
const cdp = await connect(target.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')
await cdp.send('Log.enable')

const problems = []
cdp.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') {
    problems.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 500))
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    problems.push('LOG: ' + m.params.entry.text.slice(0, 500))
  }
})

await cdp.send('Page.navigate', { url: TARGET_URL })

// --- 等开场结束 ---
const t0 = Date.now()
let phase = null
while (Date.now() - t0 < 45000) {
  try {
    phase = await cdp.evaluate("document.body.dataset.introPhase || null")
    if (phase === 'done') break
  } catch {
    /* loading */
  }
  await sleep(300)
}
console.log('introPhase =', phase)
await sleep(1200)

// --- 1. 摆相机 ---
const aim = await cdp.evaluateJson(AIM_SCRIPT)
console.log('相机:', JSON.stringify(aim))
await sleep(600)

const shot = async (name) => {
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(s.data, 'base64'))
}
await shot('m4e2e-01-before.png')

// --- 2. 投影命中面 ---
const proj = await cdp.evaluateJson(PROJECT_SCRIPT)
console.log('投影:', JSON.stringify(proj))
if (!proj.target) {
  console.log('!!! 找不到可命中的画框，终止')
  console.log('EXCEPTIONS:', problems.length)
  problems.forEach((p) => console.log('  ', p))
  chrome.kill('SIGKILL')
  process.exit(1)
}
const [mx, my] = proj.target.screen.map((n) => Math.round(n))
console.log('目标屏幕坐标:', mx, my)

// --- 3. hover ---
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my, buttons: 0 })
await sleep(500)
const hoverA = await cdp.evaluateJson(HOVER_STATE_SCRIPT)
console.log('hover(500ms):', JSON.stringify(hoverA))
await sleep(500)
const hoverB = await cdp.evaluateJson(HOVER_STATE_SCRIPT)
console.log('hover(1000ms):', JSON.stringify(hoverB))
await shot('m4e2e-02-hover.png')

// --- 4. click ---
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mousePressed', x: mx, y: my, button: 'left', clickCount: 1, buttons: 1,
})
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mouseReleased', x: mx, y: my, button: 'left', clickCount: 1, buttons: 0,
})
await sleep(800)
const dialog = await cdp.evaluateJson(DIALOG_SCRIPT)
console.log('弹窗:', JSON.stringify(dialog, null, 2))
await shot('m4e2e-03-dialog.png')

// --- 5. Esc 关闭 ---
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await sleep(800)
const after = await cdp.evaluateJson(
  "({ detailExists: !!document.querySelector('.detail'), overflow: document.body.style.overflow, hoverArtwork: document.body.dataset.hoverArtwork || null })",
)
console.log('关闭后:', JSON.stringify(after))
await shot('m4e2e-04-closed.png')

console.log('EXCEPTIONS:', problems.length)
problems.forEach((p) => console.log('  ', p))

fs.writeFileSync(
  path.join(OUT_DIR, 'm4e2e.json'),
  JSON.stringify({ phase, aim, proj, hoverA, hoverB, dialog, after, problems }, null, 2),
)
console.log('written ->', path.join(OUT_DIR, 'm4e2e.json'))

chrome.kill('SIGKILL')
process.exit(0)
