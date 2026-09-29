import { useEffect, useMemo, useRef } from 'react'
import gsap from 'gsap'
import {
  INTRO_PHASE,
  TEAR_TIMING,
  generateTearPoints,
  tearPointsToSvgPath,
  tearPointsToLeftClip,
  tearPointsToRightClip,
} from '../constants/intro'

/**
 * PaperTearIntro —— 开场纸张撕裂遮罩
 * ------------------------------------------------------------------
 * 视觉逻辑：
 *   屏幕被一张「纸」盖住，纸的中间有一道随机毛边的裂缝。
 *   动画开始时两半纸各自向外平移并轻微旋转，裂缝张开，
 *   露出后面的 3D 长廊。两半纸用 clip-path 裁成互补的形状，
 *   所以拼合时完全无缝、撕开时边缘是真实的毛边。
 *
 * 实现要点（都是踩过坑的）：
 *   1. 两半纸共用**同一条**裂缝路径，右侧把点序反转 —— 这样边缘严格互补。
 *   2. 组件**始终挂载**，结束时隐藏而不是 return null。
 *      原因：复杂 SVG path 首次挂载有解析开销，若卸载后再挂载会再付一次代价。
 *   3. 撕裂路径只在挂载时随机生成一次（useMemo 空依赖），
 *      避免 React 重渲染时裂缝形状变化导致画面抖动。
 *   4. **显隐必须由 React 的 phase 驱动，不能依赖 GSAP 的 onComplete 去设
 *      display:none。** 这里踩过一个很难查的坑：
 *      phase 切到 DONE 时组件重渲染 → effect cleanup 执行 timeline.kill()，
 *      而 kill() 有可能在 GSAP 跑完 onComplete 之前发生，于是
 *      「撕完隐藏遮罩」这一步被吞掉，整张纸色遮罩就永久留在屏幕上，
 *      表现为「画面被一层米白糊住」（而它在深色背景下极难被察觉是遮罩）。
 *      现在 done 分支直接由 React 把 display 设为 none，动画只负责位移/淡出。
 */

/** 叠在纸上的一条裂缝墨线，让撕裂口更有"纸被撕开"的实体感。 */
function TearLine({ pathData }) {
  return (
    <svg
      className="paper-tear__line"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={pathData}
        fill="none"
        stroke="var(--ink)"
        strokeWidth="0.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export default function PaperTearIntro({ phase, onTearComplete }) {
  const containerRef = useRef(null)
  const leftHalfRef = useRef(null)
  const rightHalfRef = useRef(null)
  const timelineRef = useRef(null)

  // 裂缝只在首次挂载时随机一次
  const { svgPath, leftClip, rightClip } = useMemo(() => {
    const points = generateTearPoints()
    return {
      svgPath: tearPointsToSvgPath(points),
      leftClip: tearPointsToLeftClip(points),
      rightClip: tearPointsToRightClip(points),
    }
  }, [])

  // ---------------------------------------------------------------
  // 阶段 1：LOADING —— 两半合拢盖住屏幕
  // ---------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    const left = leftHalfRef.current
    const right = rightHalfRef.current
    if (!container || !left || !right) return

    if (phase !== INTRO_PHASE.LOADING) return

    gsap.set(container, { display: 'block', opacity: 1, pointerEvents: 'auto' })
    gsap.set(left, { xPercent: 0, rotation: 0 })
    gsap.set(right, { xPercent: 0, rotation: 0 })
  }, [phase])

  // ---------------------------------------------------------------
  // 阶段 2：TEARING —— 两半向外撕开
  // ---------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    const left = leftHalfRef.current
    const right = rightHalfRef.current
    if (!container || !left || !right) return

    if (phase !== INTRO_PHASE.TEARING) return

    // 清掉可能存在的旧时间线，避免重复触发时叠加
    if (timelineRef.current) {
      timelineRef.current.kill()
      timelineRef.current = null
    }

    const tl = gsap.timeline()
    timelineRef.current = tl

    const { tearDuration, rotation } = TEAR_TIMING

    // 两半同时向外飞出：位移 + 轻微反向旋转，模拟纸张被扯开的翻飞
    tl.to(left, { xPercent: -100, rotation: -rotation, duration: tearDuration, ease: 'power3.inOut' }, 'tear')
    tl.to(right, { xPercent: 100, rotation: rotation, duration: tearDuration, ease: 'power3.inOut' }, 'tear')

    // 纸飞走的过程中整体淡出
    tl.to(container, { opacity: 0, duration: 0.4 }, `-=${0.35}`)

    // 动画结束后仅通知父级推进状态机。
    // 注意：这里不负责隐藏 —— 隐藏由下面对 DONE 的处理统一完成。
    tl.eventCallback('onComplete', () => {
      onTearComplete?.()
    })

    return () => {
      // 卸载/阶段变化时停掉动画，防止纸停在半路
      if (timelineRef.current) {
        timelineRef.current.kill()
        timelineRef.current = null
      }
    }
  }, [phase, onTearComplete])

  // ---------------------------------------------------------------
  // 阶段 3：DONE —— 彻底移除遮罩
  // 这一步用 React 直接改，不走 GSAP 回调，避免回调被 kill 吞掉。
  // ---------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    if (phase === INTRO_PHASE.DONE) {
      container.style.display = 'none'
      container.style.pointerEvents = 'none'
    }
  }, [phase])

  return (
    <div className="paper-tear" ref={containerRef}>
      <div className="paper-tear__half paper-tear__half--left" ref={leftHalfRef} style={{ clipPath: leftClip }}>
        <TearLine pathData={svgPath} />
      </div>

      <div
        className="paper-tear__half paper-tear__half--right"
        ref={rightHalfRef}
        style={{ clipPath: rightClip }}
      >
        <TearLine pathData={svgPath} />
      </div>

      {/* 遮罩期间显示的作品集标题，随纸一起被撕开 */}
      <div className="paper-tear__title">
        <span className="paper-tear__title-main">PORTFOLIO</span>
        <span className="paper-tear__title-sub">素描长廊 · 一个可漫游的作品集</span>
      </div>
    </div>
  )
}
