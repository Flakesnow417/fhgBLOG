import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import gsap from 'gsap'
import {
  createPaintRevealMaterial,
  setPaintOrigin,
  setPaintProgress,
} from '../utils/paintRevealMaterial'
import { PAINT_REVEAL_DEFAULTS } from '../constants/corridor'

/**
 * usePaintReveal
 * ==================================================================
 * Module 5 的驱动层：把「素描 → 彩色」的揭示过程接到 GSAP 上，
 * 并负责两件和渲染循环相关的杂事：
 *
 *   1. **画框原点的维护**
 *      揭示边界在世界空间里计算，而画框挂在会随分段移动的 group 下，
 *      所以原点必须每帧刷新（一次 `getWorldPosition`，成本可忽略）。
 *      不刷新的话，分段被回收/重用时原点会过期，揭示位置就会漂移。
 *
 *   2. **揭示进度的插值**
 *      progress 用 ref 保存并每帧向目标值逼近，而不是放进 React state。
 *      原因和 Module 4 一样：60fps 的 setState 是这个场景里最贵的事。
 *      这里用手写指数逼近而不是 GSAP，是因为这条曲线要支持
 *      "随时被反向打断"（鼠标快速掠过一串画框时）。GSAP 的 tween
 *      在这种高频打断场景下需要不断 kill/重建，反而更麻烦也更慢。
 *      ⇒ GSAP 用在**开场那种一次性、有节拍的**动画上
 *        （见 animateReveal），持续型、可打断的插值就手写。
 *
 * ------------------------------------------------------------------
 * 与参考项目的差异（有意为之）
 * 参考项目是"进入画廊时整面墙从上到下被画出来"，一次性 2.5s 的
 * 大动画，所以它用 GSAP tween 到 1.0 就够了。
 * 我们这里 hover 是**高频、双向、可打断**的交互，
 * 所以底层用指数逼近，同时对外仍暴露 GSAP 版的 `animateReveal`。
 */
export function usePaintReveal({
  originRef,
  dirX = PAINT_REVEAL_DEFAULTS.dirX,
  dirY = PAINT_REVEAL_DEFAULTS.dirY,
  dirZ = PAINT_REVEAL_DEFAULTS.dirZ,
  revealRate = 9.0,
  hideRate = 5.0,
} = {}) {
  const materialRef = useRef(null)
  const progressRef = useRef(0)
  const targetRef = useRef(0)
  const tweenRef = useRef(null)
  /**
   * 冻结值：非 null 时 progress 被钉住，跳过插值。
   *
   * 为什么需要它：
   *   useFrame 每帧都会把 progressRef 写进 uniform，所以自动化测试
   *   从外部直接改 uniform 或 p.progress 会被**下一帧立刻覆盖** ——
   *   脚本读到的永远是同一个值，看起来像"改不动"。
   *   这不是 bug，是"状态只有唯一写入者"该有的样子；
   *   要给测试留入口，就该由拥有这份状态的一方显式提供。
   *
   * 声明位置必须在 useFrame 之前：WebGL 的帧回调虽然也是"稍后执行"，
   * 但 hook 内部是同一次渲染里从上到下跑的，写在使用点之后会命中
   * `const` 的暂时性死区（TDZ），直接抛 ReferenceError。
   */
  const freezeRef = useRef(null)

  // 复用一个 Vector3，避免每帧 new（长廊里几十幅画，每帧几十次分配不划算）
  const worldPos = useMemo(() => new THREE.Vector3(), [])

  /**
   * 创建材质。调用方在 useMemo 里建一次。
   * sketchMap / paintedMap 变化时必须重建（贴图换了程序要重编）。
   */
  const createMaterial = useCallback(
    (sketchMap, paintedMap, extra = {}) =>
      createPaintRevealMaterial({
        sketchMap,
        paintedMap,
        dirX,
        dirY,
        dirZ,
        ...extra,
      }),
    [dirX, dirY, dirZ],
  )

  // 组件卸载时确保 tween 被清掉，否则它会继续操作已销毁的材质
  useEffect(() => {
    return () => {
      if (tweenRef.current) {
        tweenRef.current.kill()
        tweenRef.current = null
      }
    }
  }, [])

  /**
   * 每帧：
   *   a) 把画框的世界坐标写进 uniform（原点会随分段移动）
   *   b) 让 progress 向 target 指数逼近
   */
  useFrame((_, rawDelta) => {
    const material = materialRef.current
    if (!material) return

    // 先把原点对齐。注意这一步在冻结模式下也要做 ——
    // 测试摆相机之后原点会变，不更新的话揭示位置会整体偏移。
    if (originRef?.current) {
      originRef.current.getWorldPosition(worldPos)
      setPaintOrigin(material, worldPos)
    }

    // 冻结模式：把 progress 钉住，跳过插值
    if (freezeRef.current !== null) {
      progressRef.current = freezeRef.current
      targetRef.current = freezeRef.current
      setPaintProgress(material, freezeRef.current)
      return
    }

    // rawDelta 在标签页切回来时会是个巨大的值，必须夹住，
    // 否则 progress 会一步跳到位、动画"啪"地闪过。
    const delta = Math.min(rawDelta, 0.1)
    const diff = targetRef.current - progressRef.current
    if (Math.abs(diff) < 0.0005) {
      progressRef.current = targetRef.current
    } else {
      // 揭示比收回快：对上色的期待是即时的，收回慢一点避免闪烁
      const rate = diff > 0 ? revealRate : hideRate
      progressRef.current += diff * (1 - Math.exp(-rate * delta))
    }
    setPaintProgress(material, progressRef.current)
  })

  /** 设置目标进度（0=素描，1=彩色）。可随时反向，不会卡住。 */
  const setTarget = useCallback((value) => {
    // 目标值一变就退出冻结模式，否则 hover 会完全失效
    freezeRef.current = null
    targetRef.current = Math.max(0, Math.min(1, value))
    // 手写插值接管后要把 GSAP 的 tween 停掉，否则两边抢同一个值
    if (tweenRef.current) {
      tweenRef.current.kill()
      tweenRef.current = null
    }
  }, [])

  /**
   * GSAP 驱动的"一次性"揭示，用于开场这类有节拍的场景。
   * 和 setTarget 是两条互斥的路径。
   */
  const animateReveal = useCallback(
    ({ to = 1, duration = 2.5, delay = 0, ease = 'power2.inOut' } = {}) => {
      if (tweenRef.current) tweenRef.current.kill()
      freezeRef.current = null
      const proxy = { v: progressRef.current }
      targetRef.current = to
      tweenRef.current = gsap.to(proxy, {
        v: to,
        duration,
        delay,
        ease,
        onUpdate: () => {
          progressRef.current = proxy.v
          // progressRef 与 targetRef 保持一致，避免 tween 结束后
          // 手写插值又把值拉回去
          targetRef.current = proxy.v
          if (materialRef.current) setPaintProgress(materialRef.current, proxy.v)
        },
        onComplete: () => {
          progressRef.current = to
          targetRef.current = to
          tweenRef.current = null
        },
      })
      return tweenRef.current
    },
    [],
  )

  /** 不动画、直接落到某个值（用于预热 / 传送跳过动画） */
  const snapTo = useCallback((value) => {
    if (tweenRef.current) {
      tweenRef.current.kill()
      tweenRef.current = null
    }
    freezeRef.current = null
    progressRef.current = value
    targetRef.current = value
    if (materialRef.current) setPaintProgress(materialRef.current, value)
  }, [])

  /**
   * 把 progress 钉在某个值上（自动化测试用，见 freezeRef 的注释）。
   * 传 null 恢复正常运行。
   */
  const setFrozenProgress = useCallback((value) => {
    freezeRef.current = value === null ? null : Math.max(0, Math.min(1, value))
    if (value !== null && materialRef.current) {
      setPaintProgress(materialRef.current, freezeRef.current)
    }
  }, [])

  return {
    materialRef,
    progressRef,
    createMaterial,
    setTarget,
    animateReveal,
    snapTo,
    setFrozenProgress,
  }
}
