/** shot-scroll.mjs —— 截取滚动到指定位置后的页面 */
const CDP = 'file:///C:/Users/Administrator/.workbuddy/skills/webgl-browser-verify/scripts/cdp.mjs'
const { launch, sleep } = await import(CDP)

const [, , out, url, scrollY, waitMs, w, h] = process.argv
if (!out || !url) { console.error('用法: node shot-scroll.mjs <out.png> <url> [scrollY] [waitMs]'); process.exit(2) }

const b = await launch({
  port: 9960 + Math.floor(Math.random() * 30),
  width: Number(w || 1248),
  height: Number(h || 697),
  headless: true,
  timeoutMs: 40000,
  readyExpression: 'document.readyState',
  readyValue: 'complete',
  settleMs: Number(waitMs || 2500),
})

await b.goto(url)
const y = Number(scrollY || 0)
if (y) {
  await b.evaluate(`window.scrollTo(0, ${y})`)
  await sleep(1400)
}
await b.screenshot(out)
console.log('OK ->', out, ' scrollY=', await b.evaluate('Math.round(window.scrollY)'))
await b.close()
process.exit(0)
