/**
 * cdp.mjs —— 零依赖 Chrome DevTools Protocol 客户端
 *
 * 为什么要它：验证 WebGL / 3D / 动画类页面，光看构建结果和 DEV 日志不够，
 * 必须**跑真实浏览器**、拿真实像素。而 puppeteer / playwright 动辄几百 MB，
 * 还常因代理/下载失败装不上。这里只用 Node 内置模块：
 *   node:net      → TCP 连接
 *   node:crypto   → WebSocket 握手 key + 掩码
 *   node:zlib     → 解 PNG 的 IDAT
 * 自己实现 WebSocket 帧解析，总共 200 行，无任何第三方依赖。
 *
 * 用法：
 *   import { launch, sleep, decodePng } from './cdp.mjs'
 *   const browser = await launch({ port: 9410, width: 1248, height: 697 })
 *   await browser.goto('http://127.0.0.1:5173/')
 *   const png = await browser.screenshot('shot.png')
 *   const img = decodePng(png)          // { w, h, bpp, data }
 *   console.log(sat(img, 100, 200))
 *   browser.close()
 *
 * 关键设计：
 *   - 每个脚本 spawn 自己的 Chrome（独立 user-data-dir + 独立端口），
 *     互不干扰；不要复用同一个调试端口跑多脚本，会抢 target。
 *   - problems 数组只在"导航完成之后"开始收集。见下面 launch() 的 ready 标志：
 *     早期异常（HMR 残留、扩展报错）会污染判断，让你误以为"还有 bug"。
 *   - evaluate 默认 JSON 序列化返回，绕开 CDP 的
 *     "Object reference chain is too long"（returnByValue 深序列化活对象图会炸）。
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import zlib from 'node:zlib'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ */
/* WebSocket（RFC 6455 客户端子集）                                      */
/* ------------------------------------------------------------------ */

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const sock = net.connect(Number(u.port), u.hostname, () => {
      sock.write(
        `GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`,
      )
    })

    let buf = Buffer.alloc(0)
    let handshook = false
    let msgId = 0
    const pending = new Map()
    const listeners = new Set()

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])

      if (!handshook) {
        const i = buf.indexOf('\r\n\r\n')
        if (i < 0) return
        handshook = true
        buf = buf.slice(i + 4)
        resolve(api)
      }

      // 逐帧解析。服务端 → 客户端不加掩码，但仍按规范读长度字段。
      for (;;) {
        if (buf.length < 2) break
        const b1 = buf[1]
        let len = b1 & 0x7f
        let off = 2
        if (len === 126) {
          if (buf.length < 4) break
          len = buf.readUInt16BE(2)
          off = 4
        } else if (len === 127) {
          if (buf.length < 10) break
          len = Number(buf.readBigUInt64BE(2))
          off = 10
        }
        if (buf.length < off + len) break
        const payload = buf.slice(off, off + len).toString()
        buf = buf.slice(off + len)
        try {
          const msg = JSON.parse(payload)
          if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg)
            pending.delete(msg.id)
          } else {
            listeners.forEach((f) => f(msg))
          }
        } catch {
          /* 非 JSON 帧（如 ping 文本）忽略 */
        }
      }
    })
    sock.on('error', reject)

    const api = {
      send(method, params) {
        const mid = ++msgId
        return new Promise((res, rej) => {
          pending.set(mid, (m) =>
            m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result),
          )
          sock.write(frame(JSON.stringify({ id: mid, method, params: params || {} })))
        })
      },
      on(f) {
        listeners.add(f)
      },
      close() {
        sock.end()
      },
    }

    // 客户端 → 服务端必须加掩码，否则 Chrome 直接断连（不报错，很坑）
    function frame(str) {
      const p = Buffer.from(str)
      const mask = crypto.randomBytes(4)
      let hdr
      if (p.length < 126) {
        hdr = Buffer.from([0x81, 0x80 | p.length])
      } else if (p.length < 65536) {
        hdr = Buffer.alloc(4)
        hdr[0] = 0x81
        hdr[1] = 0x80 | 126
        hdr.writeUInt16BE(p.length, 2)
      } else {
        hdr = Buffer.alloc(10)
        hdr[0] = 0x81
        hdr[1] = 0x80 | 127
        hdr.writeBigUInt64BE(BigInt(p.length), 2)
      }
      const m = Buffer.alloc(p.length)
      for (let i = 0; i < p.length; i++) m[i] = p[i] ^ mask[i % 4]
      return Buffer.concat([hdr, mask, m])
    }
  })
}

/* ------------------------------------------------------------------ */
/* PNG 解码（零依赖，支持 colortype 0/2/4/6）                            */
/* ------------------------------------------------------------------ */

/**
 * Chrome 截图的 PNG 是 **colortype 2（RGB, bpp=3）**，不是 RGBA。
 * 按 bpp=4 解会 IndexError —— 这是第一个必踩的坑。
 * IHDR 的 colorType 字节直接决定每像素字节数：0→1, 2→3, 4→2, 6→4。
 */
export function decodePng(buf) {
  let off = 8
  const idat = []
  let w, h, colorType, bitDepth
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    }
    if (type === 'IDAT') idat.push(data)
    off += 12 + len
  }
  if (bitDepth !== 8) throw new Error('只支持 8bit PNG，实际 ' + bitDepth)
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!bpp) throw new Error('不支持的 colorType ' + colorType)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const out = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const ft = raw[p++]
    const line = raw.subarray(p, p + stride)
    p += stride
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      // 5 种 filter：0 None / 1 Sub / 2 Up / 3 Average / 4 Paeth
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 255
    }
  }
  return { w, h, bpp, colorType, data: out }
}

/** 饱和度（0-255）。用于判断"这像素是灰的还是有颜色的"。 */
export function sat(img, x, y) {
  const i = (y * img.w + x) * img.bpp
  const r = img.data[i]
  const g = img.data[i + 1]
  const b = img.data[i + 2]
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  return mx === 0 ? 0 : ((mx - mn) / mx) * 255
}

/** 平均亮度。 */
export function lum(img, x, y) {
  const i = (y * img.w + x) * img.bpp
  return (img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114)
}

/* ------------------------------------------------------------------ */
/* 浏览器控制                                                            */
/* ------------------------------------------------------------------ */

const SWIFTSHADER_FLAGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', // 没有这个，无头模式下 WebGL 直接拿不到 context
  '--enable-webgl',
  '--ignore-gpu-blocklist',
]

/**
 * @param {object} opts
 * @param {number}  opts.port        调试端口，多脚本并行时务必各用各的
 * @param {number}  [opts.width]     视口宽，默认 1248
 * @param {number}  [opts.height]    视口高，默认 697
 * @param {string}  [opts.chrome]    Chrome 可执行文件路径
 * @param {boolean} [opts.headless]  默认 true
 * @param {string}  [opts.readyExpression]
 *        判断"页面可以开始测了"的表达式。默认等 body[data-*] 里的进场动画完成；
 *        没有这个标记的站点就传 'true'，靠下面 settleMs 兜底。
 * @param {number}  [opts.settleMs]  就绪后额外等待，默认 1500ms
 */
export async function launch({
  port,
  width = 1248,
  height = 697,
  chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless = true,
  readyExpression = "document.body.dataset.introPhase||''",
  readyValue = 'done',
  timeoutMs = 45000,
  settleMs = 1500,
  debugGlobal = '__DEBUG__',
} = {}) {
  const profile = `${process.cwd()}/.chrome-${port}`
  const args = [
    ...(headless ? ['--headless=new'] : []),
    ...SWIFTSHADER_FLAGS,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--force-device-scale-factor=1',
    'about:blank',
  ]

  const proc = spawn(chrome, args, { stdio: 'ignore' })

  // 等 CDP 端点起来
  let version = null
  for (let i = 0; i < 60; i++) {
    try {
      version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json())
      break
    } catch {
      await sleep(500)
    }
  }
  if (!version) {
    proc.kill()
    throw new Error(`CDP 端点未就绪（端口 ${port}）——Chrome 没起来或端口被占`)
  }

  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: 'PUT',
  }).then((r) => r.json())
  const cdp = await wsConnect(target.webSocketDebuggerUrl)

  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Log.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const problems = []
  let collecting = false // ← 关键：导航完成前不收异常

  cdp.on((m) => {
    if (!collecting) return
    if (m.method === 'Runtime.exceptionThrown') {
      problems.push(
        'EXC: ' +
          (m.params.exceptionDetails?.exception?.description || '').slice(0, 400),
      )
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      problems.push('LOG: ' + m.params.entry.text.slice(0, 400))
    }
  })

  const api = {
    cdp,
    problems,
    width,
    height,
    debugGlobal,

    /** Runtime.evaluate，默认在页面内 JSON.stringify 再解析，避开深序列化报错 */
    async evaluate(expr, { awaitPromise = true } = {}) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise,
      })
      if (r.exceptionDetails) {
        throw new Error('页面内求值异常: ' + (r.exceptionDetails.text || ''))
      }
      return r.result?.value
    },

    /** 求值并把结果当 JSON 解析（对象/数组安全） */
    async json(expr) {
      const raw = await cdp.send('Runtime.evaluate', {
        expression: `(() => { const v = (${expr}); return JSON.stringify(v) })()`,
        returnByValue: true,
      })
      // cdp.send() 已经把 CDP 外层信封剥到 { result: { type, value } }
      const s = raw.result?.value
      if (typeof s !== 'string') return s
      try {
        return JSON.parse(s)
      } catch {
        return s
      }
    },

    /** 等一帧 + 一小段真实时间，让 useFrame 把状态写完 */
    async settle(ms = 220) {
      await cdp.send('Runtime.evaluate', {
        expression:
          'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
        awaitPromise: true,
      })
      await sleep(ms)
    },

    /** 截图，返回 Buffer，可选直接落盘 */
    async screenshot(savePath) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
      const buf = Buffer.from(r.data, 'base64')
      if (savePath) fs.writeFileSync(savePath, buf)
      return buf
    },

    /** 截图并解码，直接拿到像素 */
    async shot(savePath) {
      return decodePng(await api.screenshot(savePath))
    },

    /** 派发真实鼠标事件（不是 JS 模拟事件 —— 走真事件管线才能测到 R3F 的指针系统） */
    async mouse(type, x, y, button = 'none') {
      const map = {
        move: 'mouseMoved',
        down: 'mousePressed',
        up: 'mouseReleased',
      }
      await cdp.send('Input.dispatchMouseEvent', {
        type: map[type] || type,
        x,
        y,
        button: button === 'none' ? 'none' : button,
        clickCount: type === 'move' ? 0 : 1,
        buttons: button === 'left' && type !== 'up' ? 1 : 0,
      })
    },

    /** 移到某点并停留，触发 hover */
    async hover(x, y, settleMs = 500) {
      await api.mouse('move', x, y)
      await sleep(settleMs)
    },

    async click(x, y, settleMs = 400) {
      await api.mouse('move', x, y)
      await sleep(60)
      await api.mouse('down', x, y, 'left')
      await sleep(40)
      await api.mouse('up', x, y, 'left')
      await sleep(settleMs)
    },

    /** 键盘 */
    async key(key, code, keyCode) {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      })
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      })
    },

    /**
     * 导航并等就绪。
     * 就绪判定两条路：默认轮询 readyExpression，另外无论如何都至少等 settleMs。
     */
    async goto(url) {
      await cdp.send('Page.navigate', { url })
      const t0 = Date.now()
      while (Date.now() - t0 < timeoutMs) {
        try {
          const v = await api.evaluate(readyExpression, { awaitPromise: false })
          if (v === readyValue || v === true) break
        } catch {
          /* 导航中途 DOM 还没建好，忽略 */
        }
        await sleep(300)
      }
      collecting = true
      await sleep(settleMs)
      return api
    },

    /**
     * 把某物体的世界坐标投影到屏幕像素坐标。
     * 必须在页面里用页面自己的 Vector3.project()，不要自己算矩阵 ——
     * 相机可能被 GSAP 控着，自己算的矩阵往往和渲染用的不一致。
     */
    async project(selectorExpression) {
      return api.json(`(() => {
        const cam = window[${JSON.stringify(debugGlobal)}].camera;
        const V3 = cam.position.constructor;
        const o = ${selectorExpression};
        if (!o) return { err: 'not found' };
        const e = o.matrixWorld.elements;
        const ndc = new V3(e[12], e[13], e[14]).project(cam);
        return {
          x: (ndc.x * 0.5 + 0.5) * innerWidth,
          y: (-ndc.y * 0.5 + 0.5) * innerHeight,
          z: ndc.z,
        };
      })()`)
    },

    /**
     * 在页面里**自己**挑选目标物体，然后把它投影成屏幕包围盒。
     *
     * ⚠️ 为什么参数是"谓词"而不是"表达式"：
     *   THREE.Mesh 对象**无法穿过 CDP 边界** —— 它通过 __reactFiber 形成循环引用，
     *   JSON.stringify 会抛错，于是 json() 静默返回 undefined。
     *   所以只能把"挑哪个"的判断留在页面内，只把纯数字（包围盒/坐标）传回来。
     *
     * @param {string} predicate  形如 "(o) => o.material && o.material.userData.paint"
     *                            的箭头函数源码，对 scene 里每个 mesh 求值
     * @param {object} [opts]
     * @param {string} [opts.boxSize]  "frame" 用 geometry 尺寸（默认），
     *                                 "point" 只取中心点
     * @param {string} [opts.nearestTo] "center"（默认）| "camera" 决定选哪个
     */
    async projectBox(predicate, { boxSize = 'frame', nearestTo = 'center' } = {}) {
      const src = `(() => {
        const d = window[${JSON.stringify(debugGlobal)}];
        if (!d || !d.camera) return { err: 'no ' + ${JSON.stringify(debugGlobal)} + '.camera' };
        const cam = d.camera;
        const V3 = cam.position.constructor;
        const match = ${predicate};
        let best = null, bestD = Infinity;
        d.scene.traverse((o) => {
          if (!o.isMesh) return;
          if (!match(o)) return;
          if (o.material && o.material.visible === false) return;
          o.updateWorldMatrix(true, false);
          const e = o.matrixWorld.elements;
          const ndc = new V3(e[12], e[13], e[14]).project(cam);
          if (ndc.z > 1) return;               // 在相机背后 / 视锥外
          const sx = (ndc.x*0.5+0.5)*innerWidth;
          const sy = (-ndc.y*0.5+0.5)*innerHeight;
          const dist = Math.hypot(sx-innerWidth/2, sy-innerHeight/2);
          if (dist < bestD) { bestD = dist; best = { o, sx, sy }; }
        });
        if (!best) return { err: 'no mesh matched the predicate' };
        const { o, sx, sy } = best;
        const pos = [o.matrixWorld.elements[12], o.matrixWorld.elements[13], o.matrixWorld.elements[14]]
          .map((n) => +n.toFixed(3));
        if ('${boxSize}' === 'point' || !o.geometry?.parameters?.width) {
          return { center: [Math.round(sx), Math.round(sy)], pos,
                   box: [Math.round(sx)-2, Math.round(sy)-2, Math.round(sx)+2, Math.round(sy)+2] };
        }
        const p = o.geometry.parameters;
        const hw = p.width/2, hh = p.height/2;
        const cs = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([x,y]) => {
          const v = new V3(x, y, 0).applyMatrix4(o.matrixWorld).project(cam);
          return [(v.x*0.5+0.5)*innerWidth, (-v.y*0.5+0.5)*innerHeight];
        });
        const xs = cs.map(c=>c[0]), ys = cs.map(c=>c[1]);
        return {
          corners: cs,
          center: [Math.round(sx), Math.round(sy)],
          pos,
          size: [p.width, p.height],
          box: [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)),
                Math.round(Math.max(...xs)), Math.round(Math.max(...ys))],
        };
      })()`
      return api.json(src)
    },

    /** 断言汇总 + 退出码。0 = 全过，2 = 有失败 */
    finish(label = 'RESULT') {
      console.log('\n=== ' + label + ' ===')
      if (problems.length) {
        console.log('问题 ' + problems.length + ' 条：')
        problems.slice(0, 6).forEach((p) => console.log('  ' + p))
      } else {
        console.log('无 JS 异常')
      }
      api.close()
      process.exit(problems.length ? 2 : 0)
    },

    close() {
      try {
        cdp.close()
      } catch {}
      proc.kill()
    },
  }

  return api
}

/** 简单断言收集器：跑完打印 ✅/❌ 并决定退出码 */
export function checker() {
  const results = []
  return {
    check(ok, msg) {
      results.push({ ok, msg })
      console.log(`  ${ok ? '✅' : '❌'} ${msg}`)
      return ok
    },
    get failed() {
      return results.filter((r) => !r.ok).length
    },
    done(label = 'RESULT') {
      const f = results.filter((r) => !r.ok).length
      console.log(f ? `\n${label}: FAIL (${f})` : `\n${label}: PASS`)
      return f
    },
  }
}
