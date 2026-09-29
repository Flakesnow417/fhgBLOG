// Module 4 验收：模拟真实指针事件 / 点击，验证 hover 上色与弹窗
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs'

const PORT = 9360
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = 'C:\\Users\\Administrator\\.chrome-diag-m4'
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
      setTimeout(() => { if (pend.has(mid)) { pend.delete(mid); rej(new Error('timeout ' + method)) } }, 30000)
    })
  }
  L.push((m) => { if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } })
  return { send, on: (fn) => L.push(fn) }
}

/** 在页面中查找一个"能点到 3D 画框"的屏幕坐标：取画框世界坐标投影。 */
const PROJECT_EXPR = `(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  if (!d) return JSON.stringify({ err: 'no bridge' });
  const cam = d.camera;
  // 收集所有画框 group（PictureFrame 的外层 group 上带了 3 个以上子节点，
  // 且 local position 在墙上）。这里直接扫 mesh 的父 group。
  const found = [];
  d.scene.traverse((o) => {
    if (!o.isGroup) return;
    // 画框特征：位置贴墙（|x| ≈ 4.48）且高度 ≈ 2.15
    if (Math.abs(Math.abs(o.position.x) - 4.48) > 0.2) return;
    if (Math.abs(o.position.y - 2.15) > 0.2) return;
    found.push(o);
  });
  if (!found.length) return JSON.stringify({ err: 'no frames' });
  // 选一个在相机前方、距离最近的
  let best = null, bestD = 1e9;
  for (const g of found) {
    const wp = new (g.constructor.prototype.constructor === Object ? Object : Object)();
    const v = { x: g.position.x, y: g.position.y, z: g.position.z };
    const dz = cam.position.z - v.z;
    if (dz <= 0.5) continue;
    if (dz < bestD) { bestD = dz; best = v; }
  }
  if (!best) return JSON.stringify({ err: 'no frame ahead' });
  // 手动做一次投影（不依赖 THREE，避免取不到类）
  const p = best;
  // 相机在原点朝向 -Z（rotation 已应用），先转成相机空间
  const cy = Math.cos(-cam.rotation.y), sy = Math.sin(-cam.rotation.y);
  const cx = Math.cos(-cam.rotation.x), sx = Math.sin(-cam.rotation.x);
  let x = p.x - cam.position.x, y = p.y - cam.position.y, z = p.z - cam.position.z;
  // 先绕 Y 逆旋转
  let x1 = x * cy - z * sy;
  let z1 = x * sy + z * cy;
  // 再绕 X 逆旋转
  let y1 = y * cx - z1 * sx;
  let z2 = y * sx + z1 * cx;
  if (z2 >= -0.01) return JSON.stringify({ err: 'behind' });
  const fov = cam.fov * Math.PI / 180;
  const f = 1 / Math.tan(fov / 2);
  const aspect = innerWidth / innerHeight;
  const ndcX = (x1 * f / aspect) / (-z2);
  const ndcY = (y1 * f) / (-z2);
  return JSON.stringify({
    world: best,
    screen: [ (ndcX * 0.5 + 0.5) * innerWidth, (-ndcY * 0.5 + 0.5) * innerHeight ],
    ndc: [ndcX, ndcY],
  });
})()`

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
  await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Log.enable'); await page.send('Network.enable')

  const errors = []
  page.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 400))
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('LOG: ' + m.params.entry.text.slice(0, 400))
  })

  await page.send('Page.navigate', { url: TARGET_URL })

  // 等开场结束 + 相机冻结
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    const r = await page.send('Runtime.evaluate', {
      expression: `document.body.dataset.introPhase || '?'`, returnByValue: true,
    })
    if (r.result.value === 'done') break
  }
  await page.send('Runtime.evaluate', { expression: 'window.__PORTFOLIO_FREEZE_CAMERA__ = true', returnByValue: true })
  // 把相机摆到能看清第一幅画的位置（正对左墙画框）
  await page.send('Runtime.evaluate', {
    expression: `(()=>{const c=window.__PORTFOLIO_DEBUG__.camera;c.position.set(-1.4,2.15,11.2);c.rotation.order='YXZ';c.rotation.set(0,1.15,0);c.updateProjectionMatrix();return 1})()`,
    returnByValue: true,
  })
  await sleep(700)

  // 1) 先截一张没有 hover 的基准图
  let s = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync('E:/fhgBLOG/IDEAblog/.ref/frames/m4-before.png', Buffer.from(s.data, 'base64'))

  // 2) 人工把鼠标移到一个确定命中的位置 —— 用 CDP 的 Input.dispatchMouseEvent
  //    先算出画框在屏幕上的位置
  const proj = await page.send('Runtime.evaluate', { expression: PROJECT_EXPR, returnByValue: true })
  console.log('投影:', proj.result.value)
  const info = JSON.parse(proj.result.value)
  if (info.err) { console.log('!!! 定位失败', info.err); }

  const target = info.screen || [640, 350]
  console.log('目标屏幕坐标:', target.map((n) => Math.round(n)))

  // 3) 派发真实的 mouseMoved 事件触发 hover
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(target[0]), y: Math.round(target[1]), buttons: 0,
  })
  await sleep(900)
  const hoverState = await page.send('Runtime.evaluate', {
    expression: `JSON.stringify({hoverArtwork: document.body.dataset.hoverArtwork || null, cursor: document.body.style.cursor || ''})`,
    returnByValue: true,
  })
  console.log('hover 状态:', hoverState.result.value)
  s = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync('E:/fhgBLOG/IDEAblog/.ref/frames/m4-hover.png', Buffer.from(s.data, 'base64'))

  // 4) 点击
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(target[0]), y: Math.round(target[1]), button: 'left', clickCount: 1, buttons: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(target[0]), y: Math.round(target[1]), button: 'left', clickCount: 1, buttons: 0 })
  await sleep(900)

  const dialogState = await page.send('Runtime.evaluate', {
    expression: `(()=>{
      const d=document.querySelector('.detail');
      if(!d) return JSON.stringify({open:false});
      const panel=d.querySelector('.detail__panel');
      const title=d.querySelector('.detail__title');
      const blocks=d.querySelectorAll('.detail__block').length;
      const items=d.querySelectorAll('.detail__item').length;
      const cs=getComputedStyle(panel);
      const r=panel.getBoundingClientRect();
      return JSON.stringify({open:true,title:title?title.textContent:null,blocks,items,
        rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],
        opacity:cs.opacity, focusIn: document.activeElement===panel, isOpenAttr: document.body.style.overflow});
    })()`,
    returnByValue: true,
  })
  console.log('弹窗状态:', dialogState.result.value)
  s = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync('E:/fhgBLOG/IDEAblog/.ref/frames/m4-dialog.png', Buffer.from(s.data, 'base64'))

  // 5) Esc 关闭
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(700)
  const afterClose = await page.send('Runtime.evaluate', {
    expression: `JSON.stringify({detailExists: !!document.querySelector('.detail'), overflow: document.body.style.overflow})`,
    returnByValue: true,
  })
  console.log('关闭后:', afterClose.result.value)

  console.log('EXCEPTIONS:', errors.length)
  errors.slice(0, 10).forEach((e) => console.log('  ', e))
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
