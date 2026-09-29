// Normalise line endings to CRLF throughout the file (the file was authored
// with CRLF; a couple of edits introduced lone LF lines). Mixed endings are
// harmless to Vite but make diffs noisy and break naive string matching.
import fs from 'node:fs'

const P = 'E:/fhgBLOG/IDEAblog/portfolio-3d/src/utils/paintRevealMaterial.js'
const raw = fs.readFileSync(P, 'utf8')
const lf = (raw.match(/\n/g) || []).length
const crlf = (raw.match(/\r\n/g) || []).length
console.log(`before: total LF=${lf}, CRLF=${crlf}, lone LF=${lf - crlf}`)

const fixed = raw.replace(/\r?\n/g, '\r\n')
fs.writeFileSync(P, fixed)

const lf2 = (fixed.match(/\n/g) || []).length
const crlf2 = (fixed.match(/\r\n/g) || []).length
console.log(`after:  total LF=${lf2}, CRLF=${crlf2}, lone LF=${lf2 - crlf2}`)
