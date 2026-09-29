import * as THREE from 'three'

/**
 * 程序化「纸面素描」贴图
 * ==================================================================
 * 参考项目（portfolio-itom）用的是手绘扫描贴图，实测亮度：
 *   wall_texture      avg(255,255,255)  范围 251~255  —— 几乎纯白，只有极细的脏点
 *   kawalekpodlogi    avg(223,224,222)  范围 182~252  —— 白底 + 铅笔木纹线稿
 *   ceiling_texture   avg(253,253,253)  范围 224~255  —— 白底 + 极淡的石膏板接缝
 *   ramkanazdjecieduza avg(230,230,230)               —— 透明底黑色线稿画框
 *
 * 结论（这里曾经搞反过，记下来）：
 *   这个风格**不是**深色长廊 + 亮画框，而是**白纸长廊 + 黑墨线稿**。
 *   参考项目里墙面/地面/天花板全部用 `meshBasicMaterial`（不吃灯光、
 *   直接输出贴图颜色），贴图本身接近白色，所以整个空间是「明亮的纸盒」，
 *   而画框是透明底的黑线稿，靠黑线在白纸上形成对比。
 *
 * 我第一版把这些参数当成了暗色调（基色 [42,40,36] 这类近黑值），
 * 又乘了 color:'#6b665c' 再压暗，再加上极低的环境光，
 * 结果整条走廊黑成一片、什么都看不见。修正方向：
 *   1. 贴图基色改成接近白纸（220~250）；
 *   2. 用 `meshBasicMaterial` 而不是 Standard —— 纸面是"平的"，
 *      不需要 PBR 光照，这也正是参考项目的做法，且性能更好；
 *   3. 光照只用于给画框/道具做层次，不再是空间亮度的主要来源。
 *
 * 三张图的差别：
 *   墙 —— 几乎纯白，只有很细的颗粒与极淡的横向接缝（像刷过漆的墙）
 *   地 —— 白底 + 铅笔画的木地板线稿（横向铺板 + 木纹圈 + 板缝）
 *   顶 —— 白底 + 石膏板分隔线 + 颗粒
 */

/** 可复现伪随机：同一 seed 每次生成一致，避免刷新后纹理跳变。 */
function makeRand(seed) {
  let s = seed * 9301 + 49297
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** 在 ctx 上铺一层细颗粒（纸浆/涂层质感）。 */
function paintGrain(ctx, size, rand, { amount = 5, alpha = 1 } = {}) {
  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount * 2
    d[i] = clamp255(d[i] + n)
    d[i + 1] = clamp255(d[i + 1] + n)
    d[i + 2] = clamp255(d[i + 2] + n)
  }
  ctx.putImageData(img, 0, 0)
  void alpha
}

/** 撒一层很淡的污点（模拟纸张上的灰点），参考项目墙面上就是这种细密脏点。 */
function paintSpecks(ctx, size, rand, { count = 1400, maxR = 1.6, alpha = 0.22 } = {}) {
  ctx.save()
  ctx.fillStyle = '#8a8579'
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha * (0.35 + rand() * 0.65)
    const x = rand() * size
    const y = rand() * size
    const r = 0.4 + rand() * maxR
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * 墙面：接近纯白的墙漆 + 极细颗粒 + 偶发脏点。
 * repeat 由调用方按「一个 tile ≈ 2 个世界单位」设置。
 */
export function createWallTexture({ size = 512, seed = 11 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const rand = makeRand(seed)

  ctx.fillStyle = 'rgb(246, 244, 238)'
  ctx.fillRect(0, 0, size, size)

  paintGrain(ctx, size, rand, { amount: 4.5 })
  paintSpecks(ctx, size, rand, { count: 1800, maxR: 1.5, alpha: 0.2 })

  // 几条极淡的横向接缝，暗示墙板分格
  ctx.save()
  ctx.strokeStyle = '#cdc8bd'
  ctx.globalAlpha = 0.3
  ctx.lineWidth = 1
  for (let i = 1; i < 4; i++) {
    const y = (size / 4) * i
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(size, y)
    ctx.stroke()
  }
  ctx.restore()

  // --- 大面积的淡排线 ---
  // 纯白墙在 3D 里会显得"空"，且近处贴图重复会露馅。
  // 铺一层几乎看不清的斜排线（alpha 0.05 级），近看有铅笔味道，
  // 远看会被平均成一层很淡的灰，正好把墙压到"纸"的亮度。
  // 角度只取两组，交叉太多会在远处产生摩尔纹。
  ctx.save()
  ctx.strokeStyle = '#5b5548'
  ctx.lineCap = 'round'
  const angles = [(Math.PI / 180) * 24, (Math.PI / 180) * -16]
  for (const ang of angles) {
    ctx.save()
    ctx.translate(size / 2, size / 2)
    ctx.rotate(ang)
    const spacing = 26
    for (let x = -size; x < size; x += spacing) {
      // 每条线的透明度与端点随机 → 分组感，不是均匀网
      ctx.globalAlpha = 0.02 + rand() * 0.035
      ctx.lineWidth = 0.8 + rand() * 1.4
      const y0 = -size + rand() * size * 0.35
      const y1 = size - rand() * size * 0.35
      ctx.beginPath()
      ctx.moveTo(x + (rand() - 0.5) * 3, y0)
      ctx.lineTo(x + (rand() - 0.5) * 3, y1)
      ctx.stroke()
    }
    ctx.restore()
  }
  ctx.restore()

  return finalize(canvas)
}

/**
 * 地板：白底 + 铅笔手绘木地板线稿。
 * 横向铺板（沿 U 方向长），每条板内有木纹圈和板缝。
 * 这是全场最强的「素描感」来源 —— 参考项目的地板就是这种线稿。
 */
export function createFloorTexture({
  size = 1024,
  seed = 23,
  planks = 7, // 一个 tile 内的板条数
} = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const rand = makeRand(seed)

  ctx.fillStyle = 'rgb(243, 241, 234)'
  ctx.fillRect(0, 0, size, size)
  paintGrain(ctx, size, rand, { amount: 3.5 })

  const ph = size / planks // 每条板的高度

  // --- 铅笔线稿：用两遍描线做出手绘的"毛"感 ---
  const inkStroke = (drawFn, { w = 1.5, alpha = 0.82 } = {}) => {
    ctx.save()
    ctx.strokeStyle = '#2b2721'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // 第一遍：主线
    ctx.globalAlpha = alpha
    ctx.lineWidth = w
    drawFn(0)
    // 第二遍：轻微抖动重描，模拟铅笔反复描边
    ctx.globalAlpha = alpha * 0.5
    ctx.lineWidth = w * 0.7
    drawFn(1)
    ctx.restore()
  }

  for (let p = 0; p < planks; p++) {
    const yTop = p * ph
    const yMid = yTop + ph / 2

    // 板缝：两条贴近的水平线（不是一条粗线，手绘就是会双线）
    const gapJitter = () => (rand() - 0.5) * 2.4
    inkStroke((pass) => {
      const off = pass * 0.9
      ctx.beginPath()
      ctx.moveTo(0, yTop + off + gapJitter() * 0.3)
      ctx.lineTo(size, yTop + off + gapJitter() * 0.3)
      ctx.stroke()
    }, { w: 1.3, alpha: 0.6 })

    // 板内的木纹：若干条不规则的横向波纹
    const grainLines = 3 + Math.floor(rand() * 3)
    for (let g = 0; g < grainLines; g++) {
      const baseY = yMid + (rand() - 0.5) * ph * 0.55
      const amp = 2 + rand() * ph * 0.09
      const freq = 1.2 + rand() * 1.8
      const phase = rand() * Math.PI * 2
      const dash = rand() > 0.55 // 有些木纹是断续的
      inkStroke(
        (pass) => {
          ctx.beginPath()
          if (dash) ctx.setLineDash([size * (0.06 + rand() * 0.16), size * (0.02 + rand() * 0.05)])
          for (let x = 0; x <= size; x += 8) {
            const y = baseY + Math.sin((x / size) * Math.PI * 2 * freq + phase) * amp + (pass ? 0.7 : 0)
            if (x === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
          ctx.setLineDash([])
        },
        { w: 1.0, alpha: 0.26 },
      )
    }

    // 木结疤：椭圆同心线，位置随机，出现概率不高
    if (rand() > 0.55) {
      const kx = rand() * size
      const ky = yMid + (rand() - 0.5) * ph * 0.3
      // 结疤大小差一个量级，看起来才不像复制粘贴
      const kr = ph * (0.05 + rand() * rand() * 0.28)
      inkStroke(
        (pass) => {
          for (let ring = 0; ring < 3; ring++) {
            const rr = kr * (1 - ring * 0.26)
            ctx.beginPath()
            ctx.ellipse(kx + pass * 0.6, ky, rr * 2.1, rr, (rand() - 0.5) * 0.35, 0, Math.PI * 2)
            ctx.stroke()
          }
        },
        { w: 1.1, alpha: 0.34 },
      )
    }

    // 板端接缝：竖向短线，把一条长板断开
    const seams = 1 + Math.floor(rand() * 2)
    for (let s = 0; s < seams; s++) {
      const sx = rand() * size
      inkStroke(
        (pass) => {
          ctx.beginPath()
          ctx.moveTo(sx + pass * 0.8, yTop + 1)
          ctx.lineTo(sx + pass * 0.8, yTop + ph - 1)
          ctx.stroke()
        },
        { w: 1.1, alpha: 0.4 },
      )
    }
  }

  // 踢脚线：底部一条更实的线
  inkStroke(
    (pass) => {
      ctx.beginPath()
      ctx.moveTo(0, size - 2 - pass)
      ctx.lineTo(size, size - 2 - pass)
      ctx.stroke()
    },
    { w: 1.8, alpha: 0.55 },
  )

  return finalize(canvas)
}

/**
 * 天花板：白底 + 石膏板分隔缝 + 颗粒。
 * 参考项目的天花板就是极淡的接缝，抬头不会抢戏。
 */
export function createCeilingTexture({ size = 512, seed = 37, cells = 2 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const rand = makeRand(seed)

  ctx.fillStyle = 'rgb(248, 247, 243)'
  ctx.fillRect(0, 0, size, size)
  paintGrain(ctx, size, rand, { amount: 3 })
  paintSpecks(ctx, size, rand, { count: 700, maxR: 1.2, alpha: 0.12 })

  // 石膏板缝：十字分隔，带一点点手绘的抖
  ctx.save()
  ctx.strokeStyle = '#b9b4a8'
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 1.6
  for (let i = 0; i <= cells; i++) {
    const p = (size / cells) * i
    ctx.beginPath()
    for (let y = 0; y <= size; y += 16) {
      const x = p + (rand() - 0.5) * 2.2
      if (y === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.beginPath()
    for (let x = 0; x <= size; x += 16) {
      const y = p + (rand() - 0.5) * 2.2
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.restore()

  return finalize(canvas)
}

/**
 * 画框线稿：透明底 + 黑墨描边的双层框（外框 + 内衬线）。
 * 参考项目的 ramkanazdjecieduza 就是「透明底黑色线稿」，
 * 叠在白纸上直接就是素描画框，完全不需要光照。
 */
export function createFrameLineTexture({ size = 512, seed = 51 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const rand = makeRand(seed)
  ctx.clearRect(0, 0, size, size)

  const ink = (w, alpha, drawFn) => {
    ctx.save()
    ctx.strokeStyle = '#211e19'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.globalAlpha = alpha
    ctx.lineWidth = w
    drawFn(0)
    ctx.globalAlpha = alpha * 0.45
    ctx.lineWidth = w * 0.65
    drawFn(1)
    ctx.restore()
  }

  const pad = size * 0.045
  const band = size * 0.085 // 外框宽度

  // 手绘矩形路径（带抖动的直线）
  const rect = (inset, pass) => {
    const x0 = pad + inset
    const y0 = pad + inset
    const x1 = size - pad - inset
    const y1 = size - pad - inset
    const j = () => (rand() - 0.5) * 1.8 + pass * 0.7
    ctx.beginPath()
    ctx.moveTo(x0 + j(), y0 + j())
    ctx.lineTo(x1 + j(), y0 + j())
    ctx.lineTo(x1 + j(), y1 + j())
    ctx.lineTo(x0 + j(), y1 + j())
    ctx.closePath()
    ctx.stroke()
  }

  // 外框：外沿 + 内沿 + 中间一条装饰细线
  ink(4.5, 0.95, (pass) => rect(0, pass))
  ink(2.6, 0.8, (pass) => rect(band, pass))
  ink(1.4, 0.5, (pass) => rect(band * 0.45, pass))

  // 画内衬线：贴着画心的那圈
  ink(1.6, 0.45, (pass) => rect(band * 1.18, pass))

  return finalize(canvas)
}

/**
 * 画作占位：白纸 + 一张"手绘速写"。
 * 不是真图，但用同一套墨线语言画几个抽象几何，
 * 保证在 3D 里看起来确实像挂在墙上的素描稿。
 */
/**
 * 某一幅画的题材定义
 * ------------------------------------------------------------------
 * 把「几何形状」与「渲染色」彻底拆开，这样同一份形状可以画两遍：
 *   一遍用铅笔（createSketchArtTexture）→ hover 前的黑白稿
 *   一遍用颜料（createPaintedArtTexture）→ hover 后的彩色稿
 * 因为两遍共用同一组坐标，所以交叉淡入时**线条完全重合**，
 * 不会出现"上色时画面抖一下"的问题。
 *
 * 返回一个数组，每一项是 { kind, ... }，由 drawMotif 统一解释执行。
 */
function getMotifSpec(motif, size) {
  const S = size
  const c = S * 0.5
  if (motif === 1) {
    // 球体 + 地平线
    return [
      { kind: 'ellipse', cx: c, cy: c - S * 0.02, rx: S * 0.19, ry: S * 0.19, weight: 1 },
      { kind: 'ellipse', cx: c, cy: c - S * 0.02, rx: S * 0.075, ry: S * 0.075, weight: 0.45 },
      { kind: 'line', x0: c - S * 0.3, y0: c + S * 0.22, x1: c + S * 0.3, y1: c + S * 0.22, weight: 0.6 },
      // 高光位置：颜料稿用它提亮，铅笔稿忽略
      { kind: 'glint', cx: c - S * 0.06, cy: c - S * 0.09, r: S * 0.05 },
    ]
  }
  if (motif === 2) {
    // 石膏像式头型轮廓
    return [
      {
        kind: 'head',
        cx: c,
        cy: c,
        scale: S,
        weight: 1,
      },
      { kind: 'glint', cx: c - S * 0.09, cy: c - S * 0.12, r: S * 0.045 },
    ]
  }
  if (motif === 3) {
    // 手（五指轮廓）
    return [
      { kind: 'hand', cx: c, cy: c, scale: S, weight: 1 },
    ]
  }
  // motif === 0：立方体（两点透视）
  const a = S * 0.3
  return [
    {
      kind: 'rect',
      x0: c - a,
      y0: c - a * 0.4,
      x1: c + a * 0.35,
      y1: c + a * 0.7,
      weight: 1,
    },
    {
      kind: 'poly',
      pts: [
        [c - a, c - a * 0.4],
        [c - a * 0.25, c - a],
        [c + a * 1.05, c - a],
        [c + a * 0.35, c - a * 0.4],
      ],
      weight: 1,
    },
    {
      kind: 'poly',
      pts: [
        [c - a * 0.25, c - a],
        [c - a * 0.25, c + a * 0.1],
        [c + a * 1.05, c + a * 0.1],
        [c + a * 1.05, c - a],
      ],
      weight: 1,
    },
    { kind: 'line', x0: c - a * 0.25, y0: c + a * 0.1, x1: c + a * 0.35, y1: c + a * 0.7, weight: 1 },
    // 立方体的两个可见面 —— 颜料稿用两种颜色区分明暗面
    { kind: 'face', pts: [[c - a, c + a * 0.7], [c - a, c - a * 0.4], [c + a * 0.35, c - a * 0.4], [c + a * 0.35, c + a * 0.7]], fill: 'front' },
    { kind: 'face', pts: [[c + a * 0.35, c - a * 0.4], [c + a * 1.05, c - a], [c + a * 1.05, c + a * 0.1], [c + a * 0.35, c + a * 0.7]], fill: 'side' },
    { kind: 'face', pts: [[c - a, c - a * 0.4], [c - a * 0.25, c - a], [c + a * 1.05, c - a], [c + a * 0.35, c - a * 0.4]], fill: 'top' },
  ]
}

/**
 * 把 getMotifSpec 的条目画成"铅笔线稿"。
 * 只画形状的描边，颜色固定为石墨黑。
 */
function drawMotifAsSketch(ctx, spec, size, weightScale, hatch) {
  const S = size
  const c = S * 0.5
  const W = 3.6 * weightScale

  const strokePath = (fn, w) => {
    for (let pass = 0; pass < 3; pass++) {
      ctx.globalAlpha = pass === 0 ? 1 : 0.42
      ctx.lineWidth = pass === 0 ? w : w * 0.55
      ctx.beginPath()
      fn(pass)
      ctx.stroke()
    }
  }

  for (const item of spec) {
    if (item.kind === 'ellipse') {
      const w = item.weight * W
      strokePath((p) => ctx.ellipse(item.cx + p, item.cy, item.rx, item.ry, 0, 0, Math.PI * 2), w)
    } else if (item.kind === 'line') {
      const w = item.weight * W * 0.75
      strokePath((p) => {
        ctx.moveTo(item.x0 + p, item.y0 + p)
        ctx.lineTo(item.x1 + p, item.y1 + p)
      }, w)
    } else if (item.kind === 'rect') {
      const w = item.weight * W
      strokePath((p) => {
        ctx.moveTo(item.x0 + p, item.y1 + p)
        ctx.lineTo(item.x0 + p, item.y0 + p)
        ctx.lineTo(item.x1 + p, item.y0 + p)
        ctx.lineTo(item.x1 + p, item.y1 + p)
        ctx.closePath()
      }, w)
    } else if (item.kind === 'poly') {
      const w = item.weight * W
      strokePath((p) => {
        item.pts.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo(x + p, y + p)
          else ctx.lineTo(x + p, y + p)
        })
        ctx.closePath()
      }, w)
    } else if (item.kind === 'head') {
      // 石膏头像：下巴圆、颅顶略窄、两侧颊线 —— 用四段贝塞尔闭合
      const { cx, cy, scale: sc } = item
      strokePath((p) => {
        ctx.moveTo(cx + p, cy - sc * 0.26 + p)
        ctx.bezierCurveTo(cx + sc * 0.14 + p, cy - sc * 0.26 + p, cx + sc * 0.16 + p, cy - sc * 0.04 + p, cx + sc * 0.09 + p, cy + sc * 0.04 + p)
        ctx.bezierCurveTo(cx + sc * 0.04 + p, cy + sc * 0.12 + p, cx + sc * 0.08 + p, cy + sc * 0.2 + p, cx + p, cy + sc * 0.24 + p)
        ctx.bezierCurveTo(cx - sc * 0.08 + p, cy + sc * 0.2 + p, cx - sc * 0.04 + p, cy + sc * 0.12 + p, cx - sc * 0.09 + p, cy + sc * 0.04 + p)
        ctx.bezierCurveTo(cx - sc * 0.16 + p, cy - sc * 0.04 + p, cx - sc * 0.14 + p, cy - sc * 0.26 + p, cx + p, cy - sc * 0.26 + p)
        ctx.closePath()
      }, W)
      hatch(cx - sc * 0.11, cy - sc * 0.02, sc * 0.26, sc * 0.44, Math.PI / 3, 24, 0.46)
    } else if (item.kind === 'hand') {
      const { cx, cy, scale: sc } = item
      strokePath((p) => {
        ctx.moveTo(cx - sc * 0.22 + p, cy + sc * 0.26 + p)
        ctx.lineTo(cx - sc * 0.2 + p, cy - sc * 0.02 + p)
        for (let i = 0; i < 4; i++) {
          const x = cx - sc * 0.2 + (sc * 0.4 / 3) * i + p
          const h = sc * (0.16 + 0.1 * Math.sin(i * 1.7))
          ctx.lineTo(x, cy - h + p)
          ctx.lineTo(x + sc * 0.05, cy - h + p)
          ctx.lineTo(x + sc * 0.05, cy - sc * 0.02 + p)
        }
        ctx.lineTo(cx + sc * 0.24 + p, cy + sc * 0.26 + p)
        ctx.closePath()
      }, W * 0.95)
      hatch(cx, cy + sc * 0.06, sc * 0.44, sc * 0.34, Math.PI / 5.5, 22, 0.46)
    }
    // 'face' / 'glint' 是颜料稿专用的，铅笔稿跳过
  }

  // 立方体在铅笔稿里也要有调子，否则三个面糊成一团
  if (spec.some((it) => it.kind === 'face')) {
    const a = S * 0.3
    hatch(c + a * 0.42, c + a * 0.3, a * 1.0, a * 1.0, Math.PI / 5, 22, 0.5)
  }
}

/**
 * 把 getMotifSpec 的条目画成"上色稿"。
 * 关键差别：先铺色块，再用**比底色更深的同色系**描边，
 * 而不是用黑色 —— 铅笔线稿上色之后，轮廓线应该变成"深色的固有色"，
 * 继续用纯黑会显得像贴图没换、只是盖了层透明色。
 */
function drawMotifAsPainted(ctx, spec, size, palette, hatch) {
  const S = size
  const c = S * 0.5

  // ---- 1. 先铺色块 ----
  for (const item of spec) {
    if (item.kind !== 'face') continue
    ctx.save()
    ctx.globalAlpha = 1
    ctx.fillStyle = item.fill === 'front' ? palette.front : item.fill === 'side' ? palette.side : palette.top
    ctx.beginPath()
    item.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.closePath()
    ctx.fill()
    // 给色块边缘一点白描的"纸感"缺口
    ctx.globalAlpha = 0.5
    ctx.strokeStyle = palette.paper
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.restore()
  }

  // 球体/头像这类形状：用径向渐变直接铺一个"体积"
  const hasVolume =
    spec.some((it) => it.kind === 'ellipse' && it.weight > 0.5) ||
    spec.some((it) => it.kind === 'head')
  if (hasVolume) {
    const rad = S * 0.34
    const g = ctx.createRadialGradient(
      c - rad * 0.34,
      c - rad * 0.42,
      rad * 0.06,
      c,
      c,
      rad * 1.15,
    )
    g.addColorStop(0, palette.hi)
    g.addColorStop(0.55, palette.base)
    g.addColorStop(1, palette.shadow)
    ctx.save()
    ctx.beginPath()
    ctx.arc(c, c, rad, 0, Math.PI * 2)
    ctx.fillStyle = g
    ctx.fill()
    ctx.restore()
  }

  // ---- 2. 用深色同色系重描轮廓（这是"线稿变成彩色画"的关键） ----
  const W = 3.4
  const strokePath = (fn, w) => {
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalAlpha = pass === 0 ? 0.92 : 0.4
      ctx.lineWidth = pass === 0 ? w : w * 0.6
      ctx.beginPath()
      fn(pass)
      ctx.stroke()
    }
  }

  ctx.save()
  ctx.strokeStyle = palette.line
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const item of spec) {
    if (item.kind === 'ellipse') {
      strokePath((p) => ctx.ellipse(item.cx + p, item.cy, item.rx, item.ry, 0, 0, Math.PI * 2), item.weight * W)
    } else if (item.kind === 'line') {
      strokePath((p) => {
        ctx.moveTo(item.x0 + p, item.y0 + p)
        ctx.lineTo(item.x1 + p, item.y1 + p)
      }, item.weight * W * 0.75)
    } else if (item.kind === 'rect') {
      strokePath((p) => {
        ctx.moveTo(item.x0 + p, item.y1 + p)
        ctx.lineTo(item.x0 + p, item.y0 + p)
        ctx.lineTo(item.x1 + p, item.y0 + p)
        ctx.lineTo(item.x1 + p, item.y1 + p)
        ctx.closePath()
      }, W)
    } else if (item.kind === 'poly') {
      strokePath((p) => {
        item.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x + p, y + p) : ctx.lineTo(x + p, y + p)))
        ctx.closePath()
      }, W)
    } else if (item.kind === 'head') {
      const { cx, cy, scale: sc } = item
      strokePath((p) => {
        ctx.moveTo(cx + p, cy - sc * 0.26 + p)
        ctx.bezierCurveTo(cx + sc * 0.14 + p, cy - sc * 0.26 + p, cx + sc * 0.16 + p, cy - sc * 0.04 + p, cx + sc * 0.09 + p, cy + sc * 0.04 + p)
        ctx.bezierCurveTo(cx + sc * 0.04 + p, cy + sc * 0.12 + p, cx + sc * 0.08 + p, cy + sc * 0.2 + p, cx + p, cy + sc * 0.24 + p)
        ctx.bezierCurveTo(cx - sc * 0.08 + p, cy + sc * 0.2 + p, cx - sc * 0.04 + p, cy + sc * 0.12 + p, cx - sc * 0.09 + p, cy + sc * 0.04 + p)
        ctx.bezierCurveTo(cx - sc * 0.16 + p, cy - sc * 0.04 + p, cx - sc * 0.14 + p, cy - sc * 0.26 + p, cx + p, cy - sc * 0.26 + p)
        ctx.closePath()
      }, W)
      // 面部排线：用暖褐而不是黑，模拟赭石调子
      hatch(cx - sc * 0.11, cy - sc * 0.02, sc * 0.26, sc * 0.44, Math.PI / 3, 22, 0.4, palette.hatch)
    } else if (item.kind === 'hand') {
      const { cx, cy, scale: sc } = item
      strokePath((p) => {
        ctx.moveTo(cx - sc * 0.22 + p, cy + sc * 0.26 + p)
        ctx.lineTo(cx - sc * 0.2 + p, cy - sc * 0.02 + p)
        for (let i = 0; i < 4; i++) {
          const x = cx - sc * 0.2 + (sc * 0.4 / 3) * i + p
          const h = sc * (0.16 + 0.1 * Math.sin(i * 1.7))
          ctx.lineTo(x, cy - h + p)
          ctx.lineTo(x + sc * 0.05, cy - h + p)
          ctx.lineTo(x + sc * 0.05, cy - sc * 0.02 + p)
        }
        ctx.lineTo(cx + sc * 0.24 + p, cy + sc * 0.26 + p)
        ctx.closePath()
      }, W * 1.1)
      hatch(cx, cy + sc * 0.06, sc * 0.44, sc * 0.34, Math.PI / 5.5, 20, 0.4, palette.hatch)
    }
  }
  ctx.restore()

  // 立方体内部也要有排线，否则色块太平
  if (spec.some((it) => it.kind === 'face')) {
    const a = S * 0.3
    hatch(c * 0.5 + a * 1.05, c + a * 0.35, a * 0.7, a * 0.9, Math.PI / 5, 18, 0.34, palette.hatch)
  }
}

/**
 * 生成「素描稿」：白纸 + 石墨线稿 + 排线。
 * 这是 hover 之前看到的样子。
 */
export function createSketchArtTexture({ size = 512, seed = 7, motif = 0 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const rand = makeRand(seed)

  ctx.fillStyle = 'rgb(247, 245, 239)'
  ctx.fillRect(0, 0, size, size)
  paintGrain(ctx, size, rand, { amount: 4 })

  ctx.save()
  ctx.strokeStyle = '#26231e'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  drawMotifAsSketch(ctx, getMotifSpec(motif, size), size, 1, makeHatch(ctx, rand, '#26231e'))
  ctx.restore()

  vignettePaper(ctx, size)
  return finalize(canvas)
}

/**
 * 生成「上色稿」：同一份几何，改用颜料的语言画。
 * 这是 hover 之后看到的样子 —— 与素描稿共用坐标，所以叠在一起完全对位。
 */
export function createPaintedArtTexture({ size = 512, seed = 7, motif = 0 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const rand = makeRand(seed)

  // 上色的纸：比素描纸略暖一点，像被颜料浸过的纸
  ctx.fillStyle = 'rgb(246, 242, 231)'
  ctx.fillRect(0, 0, size, size)
  paintGrain(ctx, size, rand, { amount: 4 })

  // 每幅画一套配色，按 motif 区分，保证六幅画各不相同
  const PALETTES = [
    // 0 立方体：赭石 + 群青
    { front: '#c98a4b', side: '#8a5a2e', top: '#e0ac72', line: '#5c3a1c', base: '#d09a5a', hi: '#f0d3a6', shadow: '#7a4a24', hatch: '#8a5a2e', paper: '#f6f2e7' },
    // 1 球体：青绿
    { front: '#5f9e91', side: '#3d6f66', top: '#93c4ba', line: '#2c5049', base: '#6aa89b', hi: '#c8e6de', shadow: '#33605a', hatch: '#3d6f66', paper: '#f6f2e7' },
    // 2 石膏头像：赭褐（最接近参考项目里"石膏像"的暖调）
    { front: '#c69468', side: '#8f6844', top: '#e5c39c', line: '#6b4a2e', base: '#c2946a', hi: '#f0ddc2', shadow: '#8a6042', hatch: '#8f6844', paper: '#f6f2e7' },
    // 3 手：砖红
    { front: '#c46a55', side: '#8e4736', top: '#e3a08e', line: '#6b3323', base: '#c0705c', hi: '#f0c3b3', shadow: '#8a4331', hatch: '#8e4736', paper: '#f6f2e7' },
  ]
  const palette = PALETTES[((motif % PALETTES.length) + PALETTES.length) % PALETTES.length]

  ctx.save()
  ctx.strokeStyle = palette.line
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  drawMotifAsPainted(ctx, getMotifSpec(motif, size), size, palette, makeHatch(ctx, rand, palette.line))
  ctx.restore()

  // 高光：白色小点/小弧，让"上色"有湿润的完成感
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 4
  const spec = getMotifSpec(motif, size)
  for (const it of spec) {
    if (it.kind !== 'glint') continue
    ctx.beginPath()
    ctx.arc(it.cx, it.cy, it.r, Math.PI * 1.1, Math.PI * 1.75)
    ctx.stroke()
  }
  ctx.restore()

  vignettePaper(ctx, size)
  return finalize(canvas)
}

/**
 * 排线工厂：抽出来是因为素描稿用石墨色、上色稿用"深色固有色"，
 * 两者算法完全一致，只是笔色不同。
 */
function makeHatch(ctx, rand, strokeStyle) {
  return (cx, cy, w, h, angle, count, alpha, colorOverride) => {
    ctx.save()
    ctx.strokeStyle = colorOverride || strokeStyle
    ctx.lineCap = 'round'
    ctx.translate(cx, cy)
    ctx.rotate(angle)
    for (let i = 0; i < count; i++) {
      const y = -h / 2 + (h / count) * i
      const shrink = rand() * 0.28
      const x0 = -w / 2 + (w / 2) * shrink * rand() + (rand() - 0.5) * 4
      const x1 = w / 2 - (w / 2) * shrink * (1 - rand()) + (rand() - 0.5) * 4
      ctx.globalAlpha = alpha
      ctx.lineWidth = 1.9
      ctx.beginPath()
      ctx.moveTo(x0, y + (rand() - 0.5) * 2)
      ctx.lineTo(x1, y + (rand() - 0.5) * 2)
      ctx.stroke()
      ctx.globalAlpha = alpha * 0.4
      ctx.lineWidth = 3.2
      ctx.beginPath()
      ctx.moveTo(x0 + 2, y + (rand() - 0.5) * 3)
      ctx.lineTo(x1 - 2, y + (rand() - 0.5) * 3)
      ctx.stroke()
    }
    ctx.restore()
  }
}

/** 纸张边缘压暗一点点，像被裱过。 */
function vignettePaper(ctx, size) {
  const c = size * 0.5
  ctx.save()
  const g = ctx.createRadialGradient(c, c, size * 0.25, c, c, size * 0.72)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(90,80,60,0.10)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  ctx.restore()
}

/** 统一收尾：包装成 CanvasTexture，设置重复与色彩空间。 */
function finalize(canvas) {
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}
