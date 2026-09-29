/**
 * check-refs.mjs —— 检查所有 .md 里引用的本地文件和图片是否真实存在
 *
 * 为什么要单独查：手册里写错一个图片路径，页面上只会显示一个碎图图标，
 * 不报错、不提示。12 张图里错一张，很容易漏掉。
 */
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2] || 'E:/fhgBLOG/newtechnique'
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))

let bad = 0
let total = 0

for (const f of files) {
  const full = path.join(dir, f)
  const text = fs.readFileSync(full, 'utf8')
  const lines = text.split(/\r?\n/)

  const refs = []

  // Markdown 图片 ![alt](path)
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) refs.push({ kind: 'img', p: m[1] })
  // Markdown 链接 [text](path) —— 只关心本地的（不带 http / # / mailto）
  for (const m of text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const p = m[1]
    if (/^(https?:|#|mailto:|tel:)/i.test(p)) continue
    refs.push({ kind: 'link', p })
  }
  // 反引号里提到的文件名（只查 images/ 下的）
  for (const m of text.matchAll(/`([^`]*images\/[^`]+\.(png|jpg|jpeg|gif|svg))`/gi)) refs.push({ kind: 'code-img', p: m[1] })

  for (const r of refs) {
    total++
    // 去掉锚点和 URL 编码
    let p = r.p.split('#')[0].split('?')[0]
    try { p = decodeURIComponent(p) } catch { /* 保持原样 */ }
    const target = path.resolve(dir, p)
    if (!fs.existsSync(target)) {
      bad++
      // 找行号
      const idx = lines.findIndex((l) => l.includes(r.p))
      console.log(`❌ ${f}${idx >= 0 ? ':' + (idx + 1) : ''}  [${r.kind}] ${r.p}  → 文件不存在`)
    }
  }
}

console.log(`\n检查了 ${files.length} 份 .md，${total} 个本地引用，失效 ${bad} 个`)

// 顺便报告 images 目录里有哪些图没被任何文档引用
const imgDir = path.join(dir, 'images')
if (fs.existsSync(imgDir)) {
  const onDisk = fs.readdirSync(imgDir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
  const allText = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
  const unused = onDisk.filter((n) => !allText.includes(n))
  console.log(`images 目录 ${onDisk.length} 张图，未被引用 ${unused.length} 张`)
  if (unused.length) unused.forEach((n) => console.log('   未引用:', n))
}

process.exit(bad === 0 ? 0 : 1)
