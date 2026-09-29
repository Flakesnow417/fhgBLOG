/**
 * verify-manual.mjs —— 验证「手册.html」在真实浏览器里能正常渲染
 *
 * 为什么要真实浏览器：这个页面靠 CDN 加载 marked / highlight.js / mermaid，
 * 又靠 fetch 读本地 .md。这两种都可能失败，且失败方式各不相同
 * （CDN 被墙、fetch 被同源策略挡、mermaid 语法错误）。
 * 光看 curl 200 是查不出来的 —— 必须跑真浏览器。
 */
import fs from 'node:fs'
import path from 'node:path'

const CDP = 'file:///C:/Users/Administrator/.workbuddy/skills/webgl-browser-verify/scripts/cdp.mjs'
const { launch, sleep, decodePng } = await import(CDP)

const outDir = 'E:/fhgBLOG/newtechnique/.verify'
fs.mkdirSync(outDir, { recursive: true })

const b = await launch({
  port: 9961, width: 1440, height: 900, headless: true, timeoutMs: 60000,
  readyExpression: 'document.readyState', readyValue: 'complete', settleMs: 4000,
})

const errs = []
const checks = []
const ok = (name, pass, detail) => { checks.push({ name, pass, detail }); if (!pass) errs.push(name + (detail ? ' :: ' + detail : '')) }

await b.goto('http://127.0.0.1:8127/%E6%89%8B%E5%86%8C.html')
await sleep(5000)

/* ---------- 1. 基础资源加载 ---------- */
const libs = await b.json(`({
  marked:   typeof window.marked,
  hljs:     typeof window.hljs,
  mermaid:  typeof window.mermaid,
  jquery:   'n/a',
})`)
console.log('库加载情况:', JSON.stringify(libs))
ok('marked 已加载', libs.marked === 'object' || libs.marked === 'function', libs.marked)
ok('highlight.js 已加载', libs.hljs === 'object', libs.hljs)
ok('mermaid 已加载', libs.mermaid === 'object', libs.mermaid)

/* ---------- 2. 文档有被渲染出来 ---------- */
const doc = await b.json(`(() => {
  const art = document.querySelector('#docs-root article.doc');
  const h2s = document.querySelectorAll('#docs-root h2');
  const pres = document.querySelectorAll('#docs-root pre');
  const tables = document.querySelectorAll('#docs-root table');
  const imgs = document.querySelectorAll('#docs-root img');
  const tocLinks = document.querySelectorAll('.toc a[data-target]');
  const buttons = document.querySelectorAll('#docbar button');
  return {
    hasArticle: !!art,
    textLen: art ? art.textContent.length : 0,
    h2: h2s.length, pre: pres.length, table: tables.length, img: imgs.length,
    toc: tocLinks.length, buttons: buttons.length,
    title: document.title,
  };
})()`)
console.log('渲染结果:', JSON.stringify(doc))
ok('文章已渲染', doc.hasArticle)
ok('正文有内容（>20000 字）', doc.textLen > 20000, doc.textLen + ' 字')
ok('h2 标题存在（>=10）', doc.h2 >= 10, doc.h2)
ok('代码块存在（>=40）', doc.pre >= 40, doc.pre)
ok('表格存在（>=5）', doc.table >= 5, doc.table)
ok('图片存在（>=3，主手册首屏引用 3 张）', doc.img >= 3, doc.img)
ok('侧边目录已生成（>=10）', doc.toc >= 10, doc.toc)
ok('文档切换按钮 7 个', doc.buttons === 7, doc.buttons)

/* ---------- 3. 代码高亮真的生效了 ---------- */
const hl = await b.json(`(() => {
  const codes = document.querySelectorAll('#docs-root pre > code');
  let highlighted = 0, total = 0;
  codes.forEach((c) => {
    total++;
    if (c.querySelector('span.hljs-keyword, span.hljs-string, span.hljs-comment, span.hljs-title, span.hljs-number, span.hljs-tag')) highlighted++;
  });
  return { total, highlighted };
})()`)
console.log('代码高亮:', JSON.stringify(hl))
ok('代码高亮生效（过半代码块有 hljs span）', hl.highlighted >= hl.total * 0.5, hl.highlighted + '/' + hl.total)

/* ---------- 4. 图片真的能加载（不是碎图） ---------- */
const imgOk = await b.json(`(() => {
  const imgs = Array.from(document.querySelectorAll('#docs-root img'));
  return imgs.map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight, ok: i.naturalWidth > 100 }));
})()`)
const broken = (imgOk || []).filter((i) => !i.ok)
console.log('图片加载:', imgOk.length, '张, 失败', broken.length, '张')
if (broken.length) console.log('失败列表:', JSON.stringify(broken))
ok('所有图片都加载成功', broken.length === 0, broken.map((b) => b.src).join(', '))

/* ---------- 5. 截图（正文首屏） ---------- */
await b.screenshot(path.join(outDir, 'manual-top.png'))

/* ---------- 6. 逐个切换文档，确保每份都能渲染 ---------- */
const docList = ['guide', 'concept', 'mind', 'cheat', 'res', 'manual', 'resume']
const perDoc = []
for (const id of docList) {
  await b.evaluate(`document.querySelector('#docbar button[data-id="${id}"]').click()`)
  await sleep(2600)
  const r = await b.json(`(() => {
    const art = document.querySelector('#docs-root article.doc');
    return {
      id: '${id}',
      textLen: art ? art.textContent.length : 0,
      h2: document.querySelectorAll('#docs-root h2').length,
      mermaid: document.querySelectorAll('#docs-root .mermaid').length,
      mermaidDone: document.querySelectorAll('#docs-root .mermaid svg').length,
      toc: document.querySelectorAll('.toc a[data-target]').length,
      err: document.querySelector('#docs-root [style*="border:2px solid var(--zhu)"]') ? 'load-error-banner' : '',
    };
  })()`)
  perDoc.push(r)
  console.log(`  ${id.padEnd(8)} 字数=${String(r.textLen).padStart(6)} h2=${String(r.h2).padStart(2)} mermaid=${r.mermaid}${r.mermaidDone ? '(已渲染' + r.mermaidDone + ')' : ''} toc=${r.toc} ${r.err}`)
  if (id === 'mind') await b.screenshot(path.join(outDir, 'manual-mindmap.png'))
}
perDoc.forEach((r) => {
  ok(`文档「${r.id}」渲染成功`, r.textLen > 2000 && !r.err, '字数 ' + r.textLen + (r.err ? ' ' + r.err : ''))
})

/* ---------- 7. Mermaid 图是否真渲染成 SVG ---------- */
const mind = perDoc.find((r) => r.id === 'mind')
ok('思维导图 mermaid 渲染成 SVG', mind && mind.mermaid > 0 && mind.mermaidDone === mind.mermaid,
   `mermaid 块 ${mind ? mind.mermaid : 0}，渲染完成 ${mind ? mind.mermaidDone : 0}`)

/* ---------- 8. 页面 JS 异常 ---------- */
const problems = (b.problems || []).filter((p) => !/favicon|Failed to load resource/i.test(String(p)))
console.log('页面异常:', problems.length)
if (problems.length) problems.slice(0, 8).forEach((p) => console.log('  *', String(p).slice(0, 260)))
ok('无页面 JS 异常', problems.length === 0, String(problems[0] || '').slice(0, 200))

/* ---------- 9. 回到主手册并截一张带代码高亮的图 ---------- */
await b.evaluate(`document.querySelector('#docbar button[data-id="manual"]').click()`)
await sleep(2600)
await b.evaluate(`window.scrollTo(0, 3600)`)
await sleep(900)
await b.screenshot(path.join(outDir, 'manual-code.png'))

await b.close()

/* ---------- 汇总 ---------- */
console.log('\n================ 验证结果 ================')
let pass = 0
for (const c of checks) {
  console.log((c.pass ? '  PASS  ' : '  FAIL  ') + c.name + (c.pass ? '' : '  <<< ' + (c.detail || '')))
  if (c.pass) pass++
}
console.log(`\n${pass}/${checks.length} 通过`)
process.exit(pass === checks.length ? 0 : 1)
