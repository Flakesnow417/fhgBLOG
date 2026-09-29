/**
 * Static guard against the "backtick inside injected GLSL" bug.
 *
 * Background
 * ----------
 * paintRevealMaterial.js injects GLSL through JS template literals. A backtick
 * written inside a GLSL comment silently TERMINATES the template literal. The
 * GLSL that followed becomes JavaScript, which throws at draw time:
 *
 *     ReferenceError: smoothstep is not defined
 *       at material.onBeforeCompile (...paintRevealMaterial.js:209:17)
 *
 * The stack blames onBeforeCompile, so it reads like a shader-API mistake.
 *
 * How
 * ---
 * A real scanner with two states, so block comments outside template literals
 * (e.g. the file header) are never false-flagged:
 *
 *   OUTSIDE: // line comments and block comments are skipped; a backtick
 *            enters TEMPLATE.
 *   TEMPLATE: a raw backtick ends the literal (record its position); \` is an
 *            escape and is skipped; no comment syntax applies.
 *
 * After scanning, every region between a TEMPLATE-close and the next
 * TEMPLATE-open must be plain JS. If that region holds a bare GLSL call, the
 * literal closed early -- exactly the bug.
 *
 * Exit 0 = clean, 2 = broken.
 */
import fs from 'node:fs'

// 用法：node check-backticks.mjs <file.js> [more.js ...]
// 不给参数时报错退出，避免误以为"检查过了"。
const FILES = process.argv.slice(2)
if (!FILES.length) {
  console.error('用法：node check-backticks.mjs <file.js> [more.js ...]')
  process.exit(1)
}
const GLSL_CALL = /\b(?:smoothstep|mix|clamp|fract|floor|abs|dot|texture2D|paintNoise|paintHash)\s*\(/

let bad = 0

for (const file of FILES) {
  const src = fs.readFileSync(file, 'utf8')
  const name = file.split(/[\\/]/).pop()
  console.log(`\n== ${name} ==`)

  // --- scanner -------------------------------------------------------------
  const opens = []
  const closes = []
  let inTemplate = false
  let inLine = false
  let inBlock = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const d = src[i + 1]

    if (inLine) {
      if (c === '\n') inLine = false
      continue
    }
    if (inBlock) {
      if (c === '*' && d === '/') { inBlock = false; i++ }
      continue
    }
    if (!inTemplate) {
      if (c === '/' && d === '/') { inLine = true; i++; continue }
      if (c === '/' && d === '*') { inBlock = true; i++; continue }
      if (c === '`') { inTemplate = true; opens.push(i); continue }
      continue
    }
    // inside template literal
    if (c === '\\') { i++; continue }        // escaped char (handles \`)
    if (c === '`') { inTemplate = false; closes.push(i); continue }
  }

  console.log(`   template literals opened: ${opens.length}, closed: ${closes.length}`)
  if (opens.length !== closes.length || inTemplate) {
    console.log('   !! unterminated template literal')
    bad++
  }

  // --- inspect the gaps between close and next open -------------------------
  let flagged = 0
  for (let k = 0; k < closes.length; k++) {
    const from = closes[k] + 1
    const to = opens[k + 1] === undefined ? src.length : opens[k + 1]
    const gap = src.slice(from, to)
    const m = gap.match(GLSL_CALL)
    if (m) {
      const line = src.slice(0, closes[k]).split('\n').length
      console.log(`   !! literal closed at line ${line}, following JS has GLSL call "${m[0]}"`)
      console.log(`      ${JSON.stringify(gap.replace(/\s+/g, ' ').slice(0, 140))}`)
      flagged++
      bad++
    }
  }
  if (!flagged) console.log('   every template-literal boundary lands on clean JS: OK')
}

if (bad) {
  console.log('\nRESULT: FAIL')
  process.exit(2)
}
console.log('\nRESULT: PASS')
