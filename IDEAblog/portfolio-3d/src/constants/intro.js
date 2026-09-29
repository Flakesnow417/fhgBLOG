/**
 * 开场阶段状态机
 * ------------------------------------------------------------------
 * Module 2「纸张撕裂开场」的生命周期，用最简单的枚举 + 常量表达，
 * 避免为了一个三态流程引入 Context 复杂度（Module 4 需要跨组件
 * 通信时再升级成 Context）。
 *
 * 流转：
 *   LOADING  —— 遮罩闭合中，同时在后台编译着色器 / 预载贴图
 *   TEARING  —— 纸张从中间撕开，露出后面的 3D 长廊
 *   DONE     —— 遮罩卸载，进入可交互状态
 */
export const INTRO_PHASE = {
  LOADING: 'loading',
  TEARING: 'tearing',
  DONE: 'done',
}

/** 开场时序参数（秒 / 毫秒），集中在此便于统一调手感。 */

export const INTRO_TIMING = {
  /** 首帧就绪后到开撕的预热停留，给贴图上传留出余量 */
  prewarmDelay: 300,
  /** 最长等待上限（ms）：超时就直接开撕，避免低端设备无限白屏 */
  maxLoadWait: 4000,
}

export const TEAR_TIMING = {
  /** 撕开耗时 */
  tearDuration: 1.25,
  /** 撕开后到卸载遮罩的延迟 */
  settleDelay: 0.15,
  /** 左右两半离场时的旋转角度（deg），制造纸张翻飞的随意感 */
  rotation: 2,
}

/**
 * 撕裂路径参数
 * ------------------------------------------------------------------
 * 生成的是一条贯穿屏幕的竖向裂缝：从顶部 [50,0] 到底部 [50,100]，
 * 中间每一段的 x 都带随机抖动，模拟纸张纤维被撕开的毛边。
 * 坐标系是 SVG 的 viewBox="0 0 100 100"，单位是百分比。
 */
export const TEAR_PATH = {
  /** 裂缝分成多少段（越多毛边越细碎） */
  segments: 12,
  /** 中心线位置（50 = 屏幕正中） */
  centerX: 50,
  /** 抖动幅度：x = centerX ± jitter/2 */
  jitter: 6,
}

/**
 * 生成撕裂路径的采样点。
 * 返回 [[x,y], ...]，首尾点固定在上下边缘且不抖动，
 * 保证纸张总是从正中开始撕、撕到底。
 */
export function generateTearPoints() {
  const { segments, centerX, jitter } = TEAR_PATH
  const points = [[centerX, 0]]

  for (let i = 1; i < segments; i++) {
    const y = (i / segments) * 100
    const x = centerX + (Math.random() - 0.5) * jitter
    points.push([x, y])
  }

  points.push([centerX, 100])
  return points
}

/** 把采样点转成 SVG path 的 d 属性。 */
export function tearPointsToSvgPath(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
}

/**
 * 左半张纸的 clip-path。
 * 路径：左上角 → 沿裂缝向下 → 左下角，闭合回来，正好框住裂缝左侧。
 */
export function tearPointsToLeftClip(points) {
  let poly = '0% 0%, '
  points.forEach((p) => {
    poly += `${p[0]}% ${p[1]}%, `
  })
  poly += '0% 100%'
  return `polygon(${poly})`
}

/**
 * 右半张纸的 clip-path。
 * 与左侧共用同一条裂缝，但点序相反，这样两半拼起来严丝合缝、不会露出缝隙。
 */
export function tearPointsToRightClip(points) {
  let poly = '100% 0%, 100% 100%, '
  const reversed = [...points].reverse()
  reversed.forEach((p) => {
    poly += `${p[0]}% ${p[1]}%, `
  })
  return `polygon(${poly.slice(0, -2)})`
}
