// Fix the residual wet-edge wash. (CRLF-safe, matches on a short unique tail.)
//
// Symptom (measured): at progress 0.10-0.20 the frame reports
//   中间调 0.9% -> 5.1%, 平均饱和 8.9 -> 15 -> 18.3, rows-with-boundary = 0
// i.e. a faint warm tint appears even though NO boundary is inside the frame.
//
// Cause: smoothstep(uPaintEdge, 0.0, paintToEdge) should be 0 when the
// boundary is far off-frame, but the noise term dips paintToEdge locally and
// leaks a wash. Fix = a genuine two-sided band-pass that only lights up when
// the boundary is within ~4x the edge width of the surface.
import fs from 'node:fs'

const P = 'E:/fhgBLOG/IDEAblog/portfolio-3d/src/utils/paintRevealMaterial.js'
let s = fs.readFileSync(P, 'utf8')

// Match the two executable lines only, so CRLF and quote style are irrelevant.
const OLD = 'float edgeBand = smoothstep(uPaintEdge, 0.0, paintToEdge);'
const NEW =
  'float edgeInside = smoothstep(uPaintEdge, 0.0, paintToEdge);\n' +
  '           float edgeOutside = smoothstep(uPaintEdge * 4.0, 0.0, -paintToEdge);\n' +
  '           float edgeBand = edgeInside * (1.0 - edgeOutside);'

if (!s.includes(OLD)) {
  console.error('!! anchor line not found; aborting')
  process.exit(2)
}

// Also append the explanation to the comment block above, right after the
// sentence that already explains the band-pass idea.
const EXPLAIN_ANCHOR =
  '           //   于是下面这行得到"从边界往内逐渐变弱"的一道光。'
const EXPLAIN_NEW = EXPLAIN_ANCHOR + '\n' +
  '           //\n' +
  '           //   但只做"往内衰减"还不够 —— 第二次实测发现：\n' +
  '           //   边界还在画面外很远处时，paintToEdge 对全画面都是大正数，\n' +
  '           //   smoothstep 本应给 0，可噪声会在局部把它压低，\n' +
  '           //   于是渗出淡淡的暖色却没有可见边界：\n' +
  '           //   progress=0.20 时中间调 5.1%、平均饱和 8.9→18.3，\n' +
  '           //   而"有边界的行数 = 0"。\n' +
  '           //   所以要做成真正的双侧带通：边界离画面超过约 4 倍湿边宽度\n' +
  '           //   就严格归零（edgeOutside 负责这一侧）。'

if (s.includes(EXPLAIN_ANCHOR)) s = s.replace(EXPLAIN_ANCHOR, EXPLAIN_NEW)
s = s.replace(OLD, NEW)

fs.writeFileSync(P, s)
console.log('wet-edge two-sided band-pass applied')
console.log('edgeInside:', s.includes('edgeInside'))
console.log('edgeOutside:', s.includes('edgeOutside'))
