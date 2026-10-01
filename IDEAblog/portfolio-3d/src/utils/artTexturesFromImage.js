/**
 * 真实作品图 → 素描稿 / 彩色稿 双贴图
 * ==================================================================
 * 背景：原来画框里是 sketchTextures.js 用 canvas 程序化画的假图
 *      （立方体 / 球体 / 石膏像 / 手）。
 *      现在要换成**真实作品图**（水墨画、油画等）。
 *
 * 难点不在"把图贴上去"，而在于：
 *   当前材质是 `sketchMap → paintedMap` 的交叉淡入（hover 时揭示）。
 *   如果直接贴真图，hover 前后是同一张图，**上色效果就消失了**。
 *
 * 所以必须从同一张真实图片**生成两份**：
 *   painted —— 原图（可以微微提饱和，让揭示更有"上色"感）
 *   sketch  —— 由原图**自动转成铅笔稿**（去色 + 边缘检测 + 排线）
 *
 * 幸运的是：两者共享同一份像素坐标，所以交叉淡入时
 * 造型完全重合，不会出现"上色时画面抖一下"。
 *
 * ⚠️ 与程序化版的关键区别：异步。
 *    canvas 画图是同步的，读图片是异步的。
 *    所以这里返回 Promise，组件要在 ready 之后才建材质。
 */

/* ------------------------------------------------------------------ */
/* 工具：读图                                                          */
/* ------------------------------------------------------------------ */

/**
 * 把一张图片读成 canvas（不缩放，保持原始尺寸）。
 * @param {string} url
 * @returns {Promise<HTMLCanvasElement>}
 */
function loadImageToCanvas(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()

    // ⚠️ crossOrigin 绝对不能无条件设成 'anonymous'。
    //
    // 原来是这么写的，理由看起来也对："不设的话 canvas 会被污染"。
    // 但在 file:// 下它是**致命的**：本地文件的 origin 是字符串 "null"，
    // 浏览器不会为它返回 Access-Control-Allow-Origin 头，
    // 于是带 crossOrigin 的请求直接 onerror —— **图根本加载不出来**。
    //
    // 实测（probe-file-img.mjs 的 2×2 对照）：
    //   crossOrigin + 相对路径 → error      | 不设 + 相对路径 → load ✅
    //   crossOrigin + 绝对路径 → error      | 不设 + 绝对路径 → load ✅
    //
    // 解决办法不是"干脆不设"（那在 file:// 下 canvas 会被污染、
    // getImageData 抛 SecurityError），而是**改用 base64 data URI**：
    // data URI 既不需要 crossOrigin，也不会污染 canvas，两种协议都通。
    // 见 src/constants/artworkImages.js。
    //
    // 这里保留条件设置，是为了将来真接了 CDN 时还能走跨域那条路。
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous'

    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth || img.width
      c.height = img.naturalHeight || img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      resolve(c)
    }
    img.onerror = () => reject(new Error('图片加载失败：' + url))
    img.src = url
  })
}

/** 按 cover 方式把源画布画进 target×target 的正方形里（不拉伸变形，居中裁切）。 */
function drawCover(ctx, srcCanvas, target) {
  const sw = srcCanvas.width
  const sh = srcCanvas.height
  const scale = Math.max(target / sw, target / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(srcCanvas, (target - dw) / 2, (target - dh) / 2, dw, dh)
}

/* ------------------------------------------------------------------ */
/* 核心：把彩色图转成"铅笔素描稿"                                       */
/* ------------------------------------------------------------------ */

/**
 * 灰度 + 边缘检测 + 排线，产出一张**保留原图造型**的铅笔稿。
 *
 * 思路（三步，都是图像处理里最经典的操作）：
 *   1) 灰度：按人眼对三原色的敏感度加权（不是简单平均）
 *   2) Sobel 边缘：找"亮度变化快"的地方 —— 那就是轮廓线
 *   3) 排线：在暗部叠一层斜线，模拟铅笔的笔触
 *
 * 为什么不直接"灰度 + 反相"？
 *   那样得到的是一张灰蒙蒙的照片，不像"画"。
 *   素描的特点是**只有线、没有连续色调**，所以必须做边缘检测。
 *
 * @param {HTMLCanvasElement} srcCanvas
 * @param {object} opts
 * @param {number} opts.size        输出边长
 * @param {number} opts.seed        排线随机种子
 * @param {number} opts.edgeStrength 边缘强度（1 = 标准，>1 线更深）
 * @param {number} opts.paperTone   纸的亮度（0-255，越大越白）
 */
async function toSketchCanvas(srcCanvas, { size = 640, seed = 7, edgeStrength = 1, paperTone = 247 } = {}) {
  const work = document.createElement('canvas')
  work.width = work.height = size
  const wctx = work.getContext('2d')
  drawCover(wctx, srcCanvas, size)

  const img = wctx.getImageData(0, 0, size, size)
  const d = img.data
  const n = size * size

  // --- 1) 灰度 ---
  // 系数来自 ITU-R BT.601：人眼对绿最敏感、对蓝最不敏感。
  // 直接 (r+g+b)/3 会让红色和蓝色显得比实际更亮，画面会"发飘"。
  const gray = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    gray[i] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114
  }
  // 先让浏览器处理一次绘制和输入，再进入最重的卷积阶段。
  await yieldToBrowser()

  // --- 2) Sobel 边缘检测 ---
  // 两个 3×3 卷积核分别算"横向变化"和"纵向变化"，
  // 合起来就是这一点的梯度强度 ≈ 轮廓的深浅。
  const edge = new Float32Array(n)
  let maxEdge = 1
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x
      const tl = gray[i - size - 1]
      const tc = gray[i - size]
      const tr = gray[i - size + 1]
      const ml = gray[i - 1]
      const mr = gray[i + 1]
      const bl = gray[i + size - 1]
      const bc = gray[i + size]
      const br = gray[i + size + 1]

      const gx = tl + 2 * ml + bl - (tr + 2 * mr + br)
      const gy = tl + 2 * tc + tr - (bl + 2 * bc + br)
      const mag = Math.sqrt(gx * gx + gy * gy)
      edge[i] = mag
      if (mag > maxEdge) maxEdge = mag
    }
    // 每 32 行让出一次主线程，避免 6 张图连续计算时冻结首屏。
    if (y % 32 === 0) await yieldToBrowser()
  }

  // --- 3) 合成：纸底 + 线 + 排线 ---
  const out = document.createElement('canvas')
  out.width = out.height = size
  const octx = out.getContext('2d')
  const outImg = octx.createImageData(size, size)
  const od = outImg.data

  const rand = mulberry32(seed)
  // 排线的方向与间距（每 ~9px 一条，斜 45°）
  const hatchPeriod = 9
  // 暗部的判定阈值：灰度低于它才叠排线
  const darkThreshold = 150

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const p = i * 4

      // 纸的底色 + 一点横向的颗粒感（模仿纸纹）
      const grain = (rand() - 0.5) * 5
      let v = paperTone + grain

      // ① 轮廓线：边缘越强，画得越黑
      //    归一化后开方，是为了让"弱边缘"也还能看见一点，
      //    否则只有最硬的边能出线，画面会太空。
      const e = Math.sqrt(edge[i] / maxEdge) * edgeStrength
      v -= Math.min(e, 1) * 205

      // ② 暗部排线：只在阴影区叠，模拟铅笔一遍遍加深
      const g = gray[i]
      if (g < darkThreshold && edge[i] < maxEdge * 0.35) {
        // 用 45° 斜线做调制：满足条件的地方才落笔
        const diag = (x + y) % hatchPeriod
        if (diag < 1.6) {
          const depth = (darkThreshold - g) / darkThreshold // 越暗越深
          v -= depth * 78 * (0.5 + rand() * 0.5)
        }
      }

      // ③ 高光：很亮的地方留白（不做任何处理，就是纸本身）
      od[p] = od[p + 1] = od[p + 2] = Math.max(0, Math.min(255, v))
      od[p + 3] = 255
    }
    // 合成阶段同样分块让出主线程；画框先保持程序化占位，不会空白。
    if (y % 32 === 0) await yieldToBrowser()
  }
  octx.putImageData(outImg, 0, 0)

  // 旧纸的边缘压暗，和程序化版保持一致的观感
  const vg = octx.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size * 0.78)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(60,52,40,0.16)')
  octx.fillStyle = vg
  octx.fillRect(0, 0, size, size)

  return out
}

/** 小巧的确定性随机数（同一 seed 每次结果一样，方便复现）。 */
function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* 对外：给定图片，产出一对贴图                                          */
/* ------------------------------------------------------------------ */

/**
 * 把一张真实作品图变成 { sketch, painted } 一对 canvas。
 *
 * @param {string} url      图片地址（放在 public/textures/ 下，用 './textures/xxx.jpg'）
 * @param {object} opts
 * @param {number} opts.size        贴图边长（显存里是 size² × 4 字节 × 2 张）
 * @param {number} opts.seed        排线种子
 * @param {number} opts.saturate    上色稿的饱和度增益（1 = 不变）
 * @param {number} opts.edgeStrength 线条强度
 * @returns {Promise<{sketch: HTMLCanvasElement, painted: HTMLCanvasElement}>}
 */
export async function createArtTexturesFromImage(url, opts = {}) {
  const { size = 640, saturate = 1.18, edgeStrength = 1, paperTone = 247 } = opts
  const srcCanvas = await loadImageToCanvas(url)

  // painted：原图，微微提饱和。
  // 为什么要提饱和？因为 hover 的语义是"上色"，
  // 如果原图本来就是彩色的，1:1 贴上去视觉冲击不够
  // （观众看到的就是"什么都没变"）。
  const painted = document.createElement('canvas')
  painted.width = painted.height = size
  const pctx = painted.getContext('2d')
  drawCover(pctx, srcCanvas, size)
  if (saturate !== 1) {
    const pimg = pctx.getImageData(0, 0, size, size)
    const pd = pimg.data
    for (let i = 0; i < pd.length; i += 4) {
      const l = pd[i] * 0.299 + pd[i + 1] * 0.587 + pd[i + 2] * 0.114
      pd[i] = Math.max(0, Math.min(255, l + (pd[i] - l) * saturate))
      pd[i + 1] = Math.max(0, Math.min(255, l + (pd[i + 1] - l) * saturate))
      pd[i + 2] = Math.max(0, Math.min(255, l + (pd[i + 2] - l) * saturate))
    }
    pctx.putImageData(pimg, 0, 0)
  }

  const sketch = await toSketchCanvas(srcCanvas, { size, seed: opts.seed || 7, edgeStrength, paperTone })
  return { sketch, painted }
}

/**
 * 预生成一份"素描稿缓存" —— 把结果存成 dataURL 放进 localStorage 之类，
 * 是为了刷新页面时不用重算。当前规模（6 张图）不需要，留作扩展点。
 */
export const __internal = { toSketchCanvas, drawCover, mulberry32 }
