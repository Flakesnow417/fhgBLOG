/**
 * shot.mjs —— 给「新手教学手册」抓真实截图用的小工具
 *
 * 为什么单独写一个：教学手册里的插图必须是**真实页面截图**，
 * 手绘示意图会误导新手（"教程上的图和我的屏幕不一样"是最劝退的体验之一）。
 * 这个脚本复用 webgl-browser-verify 技能里的零依赖 CDP 客户端，
 * 打开真实页面 → 等页面自己汇报"我准备好了" → 截图。
 *
 * 用法：
 *   node shot.mjs <输出png> <url> [waitMs] [width] [height] [readyExpr] [readyVal]
 *   node shot.mjs ../images/01-index.png http://127.0.0.1:5173/ 4000
 *   node shot.mjs ../images/00-landing.png file:///E:/fhgBLOG/IDEAblog/index.html 9000 1248 697 "window.IDEA_GL_READY===true" ""
 *
 * 注意：readyVal 传空字符串表示"只等表达式为真"。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const CDP = 'file:///C:/Users/Administrator/.workbuddy/skills/webgl-browser-verify/scripts/cdp.mjs'
const { launch, sleep } = await import(CDP)

const [, , outPath, url, waitMsArg, wArg, hArg, readyExprArg, readyValArg] = process.argv
if (!outPath || !url) {
  console.error('用法: node shot.mjs <out.png> <url> [waitMs] [width] [height] [readyExpr] [readyVal]')
  process.exit(2)
}

const waitMs = Number(waitMsArg || 4000)
const width = Number(wArg || 1248)
const height = Number(hArg || 697)

const launchOpts = {
  port: 9500 + Math.floor(Math.random() * 400),
  width,
  height,
  headless: true,
}

// 只有显式给了 readyExpr 才用"等条件"的模式；否则等固定时长。
if (readyExprArg) {
  launchOpts.readyExpression = readyExprArg
  if (readyValArg) launchOpts.readyValue = readyValArg
}

let browser
try {
  browser = await launch(launchOpts)
  await browser.goto(url)
  await sleep(waitMs)
  const abs = path.resolve(outPath)
  await browser.screenshot(abs)
  const problems = (browser.problems || []).slice(0, 8)
  console.log('OK  ->', abs)
  if (problems.length) {
    console.log('页面异常(前8条):')
    for (const p of problems) console.log('   -', String(p).slice(0, 220))
  } else {
    console.log('页面异常: 0 条')
  }
  await browser.close()
  process.exit(0)
} catch (e) {
  console.error('FAIL:', e?.message || e)
  try { await browser?.close() } catch {}
  process.exit(1)
}
