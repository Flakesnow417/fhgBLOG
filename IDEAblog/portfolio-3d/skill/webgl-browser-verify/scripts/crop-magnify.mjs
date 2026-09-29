// Magnify a crop of a screenshot into a viewable PNG (nearest-neighbour,
// 3x), so the paint boundary and wet edge can be inspected by eye.
// Also prints an ASCII saturation map so the shape is legible in the terminal.
import fs from 'node:fs'
import zlib from 'node:zlib'

function decodePng(buf) {
  let off = 8
  const idat = []
  let w, h, ct
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9] }
    if (type === 'IDAT') idat.push(data)
    off += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]
  const stride = w * bpp
  const out = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const ft = raw[p++]
    const line = raw.subarray(p, p + stride)
    p += stride
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 255
    }
  }
  return { w, h, bpp, data: out }
}

function encodePng(w, h, rgb) {
  const stride = w * 3
  const raw = Buffer.alloc(h * (stride + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  const chunks = []
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const t = Buffer.from(type, 'ascii')
    const crcTable = []
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
    let crc = 0xffffffff
    const all = Buffer.concat([t, data])
    for (const b of all) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    chunks.push(len, t, data, crcBuf)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  chunk('IHDR', ihdr)
  chunk('IDAT', idat)
  chunk('IEND', Buffer.alloc(0))
  return Buffer.concat(chunks)
}

const [file, x0, y0, x1, y1, scale] = process.argv.slice(2)
const S = Number(scale || 3)
const d = decodePng(fs.readFileSync(file))
const X0 = Number(x0), Y0 = Number(y0), X1 = Number(x1), Y1 = Number(y1)
const cw = X1 - X0, ch = Y1 - Y0

const rgb = Buffer.alloc(cw * S * ch * S * 3)
for (let y = 0; y < ch * S; y++) {
  for (let x = 0; x < cw * S; x++) {
    const sx = X0 + Math.floor(x / S), sy = Y0 + Math.floor(y / S)
    const i = (sy * d.w + sx) * d.bpp
    const o = (y * cw * S + x) * 3
    rgb[o] = d.data[i]; rgb[o + 1] = d.data[i + 1]; rgb[o + 2] = d.data[i + 2]
  }
}
const outName = file.replace(/\.png$/, `-crop${X0}_${Y0}-${X1}_${Y1}-x${S}.png`)
fs.writeFileSync(outName, encodePng(cw * S, ch * S, rgb))
console.log('wrote', outName, `${cw * S}x${ch * S}`)

// ASCII saturation map (2x2 blocks) so the shape is readable in text
const satAt = (sx, sy) => {
  const i = (sy * d.w + sx) * d.bpp
  const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2]
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  return mx === 0 ? 0 : ((mx - mn) / mx) * 255
}
const ramp = ' .:-=+*#%@'
console.log(`\n饱和度图 (${X0},${Y0})-(${X1},${Y1})，每格 3x3 像素，越亮=越彩：`)
for (let y = Y0; y < Y1; y += 3) {
  let line = ''
  for (let x = X0; x < X1; x += 2) {
    let s = 0
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 2; dx++) s += satAt(Math.min(X1 - 1, x + dx), Math.min(Y1 - 1, y + dy))
    s /= 6
    line += ramp[Math.min(9, Math.floor((s / 180) * 10))]
  }
  console.log('  ' + line)
}
