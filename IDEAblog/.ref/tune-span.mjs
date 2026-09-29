// Tune the two art-direction constants in paintRevealMaterial.js:
//   revealSpan 2.6 -> 1.9   (measured: frame extent along reveal dir is only
//                            0.671, so 2.6 left the boundary off-frame for the
//                            whole second half of progress -- wasted animation)
//   wet tint    0.16,0.11,0.05 -> 0.10,0.07,0.03  (weaker so the pre-paint
//                            area stays clean sketch, verified 0px coloured)
import fs from 'node:fs'

const P = 'E:/fhgBLOG/IDEAblog/portfolio-3d/src/utils/paintRevealMaterial.js'
let s = fs.readFileSync(P, 'utf8')
const before = s

// 1) JSDoc default
s = s.replace('[opts.revealSpan=2.6]', '[opts.revealSpan=1.9]')

// 2) function signature default
s = s.replace('revealSpan = 2.6,', 'revealSpan = 1.9,')

// 3) soften the wet edge tint
s = s.replace('vec3(0.16, 0.11, 0.05) * wet', 'vec3(0.10, 0.07, 0.03) * wet')

fs.writeFileSync(P, s)

const left = (s.match(/2\.6/g) || []).length
console.log('changed:', s !== before)
console.log("remaining '2.6' occurrences:", left)
console.log("revealSpan default line:", s.split('\n').find((l) => l.includes('revealSpan = ')).trim())
console.log("wet tint line:", s.split('\n').find((l) => l.includes('* wet')).trim())
