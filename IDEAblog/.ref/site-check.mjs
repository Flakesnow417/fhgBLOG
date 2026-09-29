/**
 * site-check.mjs —— 用真实浏览器打开 file:// 的 index.html，
 * 确认它加载正常、导航齐全、且 3D 长廊入口可点。
 *
 * 关键点：file:// 打开的页面里，相对路径 404 是**静默的**——
 * 页面不会报错，只是白屏或少样式。所以必须真的打开看像素。
 */
import { launch, checker } from 'file:///C:/Users/Administrator/.workbuddy/skills/webgl-browser-verify/scripts/cdp.mjs'

const c = checker()

const b = await launch({
  port: 9484,
  // index.html 是纯 DOM 页面，没有调试桥；把就绪条件放宽成"DOM 建好"
  debugGlobal: '__DEBUG__',
  readyExpression: "document.readyState === 'complete'",
  readyValue: true,
  settleMs: 3000, // 它自己的 WebGL 水墨场景要一点时间
})

await b.goto('file:///E:/fhgBLOG/IDEAblog/index.html')

// 1. 页面标题（说明 HTML 本身解析正常）
const title = await b.evaluate('document.title')
c.check(!!title, `页面标题读取正常（${title}）`)

// 2. 样式生效了吗 —— 用具体元素的 computed style 反证 CSS 加载成功
const styled = await b.json(`(() => {
  const h = document.querySelector('.idea-brand');
  if (!h) return { found: false };
  const cs = getComputedStyle(h);
  return { found: true, color: cs.color, fontFamily: cs.fontFamily.slice(0, 40) };
})()`)
c.check(
  styled.found && styled.color !== 'rgb(0, 0, 0)',
  `样式生效（品牌字色 ${styled.color}，说明 style.css 加载成功）`,
)

// 3. 导航链接清单
const nav = await b.json(`(() => {
  const as = [...document.querySelectorAll('.idea-nav a')];
  return as.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') }));
})()`)
c.check(nav.length >= 4, `导航有 ${nav.length} 项：${nav.map((n) => n.text).join(' / ')}`)
c.check(
  nav.some((n) => n.href === 'http://localhost:5173'),
  '导航里有「3D 长廊」入口指向 dev server',
)

// 4. 下潜终点入口（主按钮）
const enter = await b.json(`(() => {
  const a = document.querySelector('.idea-dive-enter');
  if (!a) return { found: false };
  return { found: true, href: a.getAttribute('href'), text: a.textContent.trim(),
           target: a.getAttribute('target') };
})()`)
c.check(
  enter.found && enter.href === 'http://localhost:5173',
  `主入口「${enter.text}」→ ${enter.href}（target=${enter.target}）`,
)

// 5. 降级封面里的链接也要是好的（用户 WebGL 不可用时唯一出路）
const fallback = await b.json(`(() => {
  const a = document.querySelector('.idea-webgl-fallback a');
  if (!a) return { found: false };
  return { found: true, href: a.getAttribute('href') };
})()`)
c.check(
  fallback.found && fallback.href === 'http://localhost:5173',
  `降级封面链接也正确（${fallback.href}）`,
)

// 6. 水墨 3D 场景是否真的初始化了（这是这个页面的核心）
const glReady = await b.evaluate('!!window.IDEA_GL_READY')
const hasWebglClass = await b.evaluate(
  "!document.body.classList.contains('idea-no-webgl')",
)
c.check(
  glReady || hasWebglClass,
  `水墨 3D 场景状态：IDEA_GL_READY=${glReady}，未触发降级=${hasWebglClass}`,
)

// 7. 截图存档
const img = await b.shot('E:/fhgBLOG/IDEAblog/.ref/frames/landing-full.png')
c.check(img.w > 0 && img.h > 0, `截图成功 ${img.w}x${img.h}`)

// 8. 异常
c.check(b.problems.length === 0, `无 JS 异常（${b.problems.length}）`)

const failed = c.done('index.html 站点检查')
if (b.problems.length) {
  console.log('\n异常明细：')
  b.problems.slice(0, 5).forEach((p) => console.log('  ' + p))
}
b.close()
process.exit(failed ? 2 : 0)
