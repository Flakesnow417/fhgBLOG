/**
 * link-check.mjs —— 验证 index.html 与 portfolio-3d 的互跳链接真的能用。
 *
 * 检查项：
 *   1. dev server 在 5173 上响应
 *   2. portfolio-3d 页面里存在「返回一念未落」链接，且 href 指向 index.html
 *   3. index.html 里所有 http://localhost:5173 链接都指向真实的 dev server
 *   4. 那 4 个本地 .html 目标文件都真实存在（file:// 下 404 是静默的，必须显式查）
 *   5. 页面无 JS 异常
 *
 * 用到的工具来自 skill: webgl-browser-verify
 */
// Windows 绝对路径在 ESM 里必须写成 file:// URL，否则报
// ERR_UNSUPPORTED_ESM_URL_SCHEME（收到协议 'c:' 不知如何处理）。
import { launch, checker, sleep } from 'file:///C:/Users/Administrator/.workbuddy/skills/webgl-browser-verify/scripts/cdp.mjs'
import fs from 'node:fs'

const SITE = 'E:/fhgBLOG/IDEAblog'
const DEV = 'http://localhost:5173'

const c = checker()

/* ---------- 1. dev server 活着 ---------- */
let devOk = false
try {
  const r = await fetch(DEV + '/', { signal: AbortSignal.timeout(5000) })
  devOk = r.ok
} catch (e) {
  devOk = false
}
c.check(devOk, `dev server 在 5173 响应（${devOk ? 'HTTP OK' : '连不上' }）`)
if (!devOk) {
  console.log('\n⚠️ dev server 没起，请在 portfolio-3d 里跑 npm run dev')
  c.done('链接检查')
  process.exit(2)
}

/* ---------- 2. portfolio-3d 里的返回链接 ---------- */
const b = await launch({
  port: 9480,
  debugGlobal: '__PORTFOLIO_DEBUG__',
  readyValue: 'done',
})
await b.goto(DEV + '/')

const backLink = await b.json(`(() => {
  const a = document.querySelector('a.back-home');
  if (!a) return { found: false };
  const r = a.getBoundingClientRect();
  const cs = getComputedStyle(a);
  return {
    found: true,
    href: a.getAttribute('href'),
    text: a.textContent.trim(),
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    display: cs.display,
    visibility: cs.visibility,
    position: cs.position,
    height: cs.height,
  };
})()`)

c.check(backLink.found, `返回链接存在（文案「${backLink.text}」）`)
c.check(
  backLink.found && backLink.href === 'file:///E:/fhgBLOG/IDEAblog/index.html',
  `href 指向 index.html（${backLink.href}）`,
)
// fixed 元素的经典坑：高度被撑满视口
c.check(
  backLink.found && backLink.rect[3] < 60,
  `返回链接高度正常，没被拉成满屏（${backLink.rect[3]}px，rect=${JSON.stringify(backLink.rect)}）`,
)

/* ---------- 3. 检查 index.html 的链接（用 fetch 读源码，不依赖浏览器） ---------- */
const html = fs.readFileSync(`${SITE}/index.html`, 'utf8')
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
const local5173 = hrefs.filter((h) => h === DEV)
c.check(local5173.length >= 3, `index.html 里有 ${local5173.length} 处指向 ${DEV} 的链接`)

/* ---------- 4. 本地文件目标是否真实存在 ---------- */
const localFiles = [...new Set(
  hrefs.filter((h) => !/^(https?:|data:|mailto:|#)/.test(h)),
)]
const missing = []
for (const f of localFiles) {
  if (!fs.existsSync(`${SITE}/${f}`)) missing.push(f)
}
c.check(
  missing.length === 0,
  missing.length
    ? `本地链接目标缺失：${missing.join('、')}`
    : `全部 ${localFiles.length} 个本地链接目标都存在（${localFiles.join('、')}）`,
)

/* ---------- 5. 无异常 ---------- */
c.check(b.problems.length === 0, `无 JS 异常（${b.problems.length}）`)

const failed = c.done('链接检查')

if (b.problems.length) {
  console.log('\n异常明细：')
  b.problems.slice(0, 5).forEach((p) => console.log('  ' + p))
}

b.close()
process.exit(failed ? 2 : 0)
