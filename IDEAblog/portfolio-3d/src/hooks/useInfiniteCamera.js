import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CAMERA_HEIGHT, CORRIDOR_WIDTH, CAMERA_SPEED } from '../constants/corridor'

/**
 * 长廊漫游相机
 * ------------------------------------------------------------------
 * 交互设计（对齐视频里的体验）：
 *   - 鼠标左右移动 → 视线左右转（yaw），带缓动，不跟手到晕
 *   - 鼠标上下移动 → 视线上下抬（pitch），限位在 ±35°
 *   - 滚轮 / W S / 上下键 → 沿长廊前后走
 *   - 触屏：拖动转向，双指或自动前进
 *
 * 为什么用「自由漫游」而不是 PointerLockControls：
 *   PointerLock 需要用户先点击授权，且退出后体验断裂；
 *   参考视频里是「鼠标一动就转」的轻交互，这里沿用同一路线。
 *
 * 行走被限制在走廊内（X 轴夹取），避免穿墙；Z 轴不作限制，
 * 因为长廊是无限延伸的。
 */

const PITCH_LIMIT = THREE.MathUtils.degToRad(35)
const YAW_RANGE = THREE.MathUtils.degToRad(72) // 视线左右摆动的极限

export default function useInfiniteCamera({ enabled = true } = {}) {
  const { camera, gl } = useThree()

  // 归一化鼠标位置 (-1..1)，由 pointermove 更新
  const pointer = useRef({ x: 0, y: 0 })
  // 平滑后的实际朝向，逐帧向 pointer 靠拢
  const smoothed = useRef({ yaw: 0, pitch: 0 })
  // 前进速度（由滚轮/按键设定，带阻尼衰减）
  const velocity = useRef(0)
  // 键盘按住状态
  const keys = useRef({ forward: false, back: false })
  // 触屏拖动追踪
  const touch = useRef({ active: false, lastX: 0, lastY: 0, x: 0, y: 0 })

  // ---------------------------------------------------------------
  // 事件绑定
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return
    const el = gl.domElement

    const onPointerMove = (e) => {
      const rect = el.getBoundingClientRect()
      // 映射到 -1..1
      pointer.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.current.y = ((e.clientY - rect.top) / rect.height) * 2 - 1
    }

    const onWheel = (e) => {
      // 向下滚 → 前进（走进长廊）
      velocity.current += e.deltaY * 0.0022
    }

    // --- 触屏 ---
    const onTouchStart = (e) => {
      const t = e.touches[0]
      if (!t) return
      touch.current.active = true
      touch.current.lastX = t.clientX
      touch.current.lastY = t.clientY
    }
    const onTouchMove = (e) => {
      if (!touch.current.active) return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - touch.current.lastX
      const dy = t.clientY - touch.current.lastY
      touch.current.lastX = t.clientX
      touch.current.lastY = t.clientY
      // 拖动转视角：累加式，和鼠标的绝对定位不同
      touch.current.x = THREE.MathUtils.clamp(touch.current.x + dx * 0.004, -1, 1)
      touch.current.y = THREE.MathUtils.clamp(touch.current.y + dy * 0.004, -1, 1)
      pointer.current.x = touch.current.x
      pointer.current.y = touch.current.y
    }
    const onTouchEnd = () => {
      touch.current.active = false
    }

    // --- 键盘 ---
    const onKeyDown = (e) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.current.forward = true
      if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.current.back = true
    }
    const onKeyUp = (e) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.current.forward = false
      if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.current.back = false
    }

    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [enabled, gl])

  // ---------------------------------------------------------------
  // 每帧推进
  // ---------------------------------------------------------------
  useFrame((_, rawDelta) => {
    if (!enabled) return

    // 调试开关：自动化脚本把这个标志置 true 后，hook 不再写相机，
    // 于是脚本可以把相机摆到任意位置（俯视、俯拍某段）来观察场景。
    // 注意必须放在最前面，否则本帧的写入会覆盖脚本刚设置的位置。
    if (typeof window !== 'undefined' && window.__PORTFOLIO_FREEZE_CAMERA__) return

    // delta 夹取：切标签页回来时 rawDelta 可能是好几秒，会让相机瞬移
    const delta = Math.min(rawDelta, 0.1)

    // --- 朝向平滑 ---
    const targetYaw = -pointer.current.x * YAW_RANGE
    const targetPitch = -pointer.current.y * PITCH_LIMIT
    // 用指数平滑而非线性插值，手感更顺、且与帧率无关
    const ease = 1 - Math.exp(-6 * delta)
    smoothed.current.yaw += (targetYaw - smoothed.current.yaw) * ease
    smoothed.current.pitch += (targetPitch - smoothed.current.pitch) * ease

    // 直接把朝向写进相机的旋转顺序，避免四元数累积误差
    camera.rotation.order = 'YXZ'
    camera.rotation.y = smoothed.current.yaw
    camera.rotation.x = smoothed.current.pitch
    camera.rotation.z = 0

    // --- 前进 ---
    // 键盘给一个恒定推力，滚轮给一个会衰减的冲量
    const keyThrust = (keys.current.forward ? 1 : 0) - (keys.current.back ? 1 : 0)
    velocity.current += keyThrust * delta * 3.4
    // 阻尼：不按键时逐渐停下
    velocity.current *= Math.exp(-2.4 * delta)
    // 限速，防止滚轮狂滚后飞出去
    velocity.current = THREE.MathUtils.clamp(velocity.current, -1, 1)

    const speed = velocity.current * CAMERA_SPEED
    camera.position.z -= speed * delta

    // --- 侧移：轻微跟随鼠标，营造"探头看画"的感觉 ---
    const targetSideX = pointer.current.x * (CORRIDOR_WIDTH * 0.22)
    camera.position.x += (targetSideX - camera.position.x) * (1 - Math.exp(-3 * delta))
    // 夹在走廊内，绝不穿墙
    camera.position.x = THREE.MathUtils.clamp(
      camera.position.x,
      -CORRIDOR_WIDTH / 2 + 0.8,
      CORRIDOR_WIDTH / 2 - 0.8,
    )

    // 视高固定，轻微呼吸起伏让它不像"飘在轨道上"
    const t = performance.now() * 0.0011
    camera.position.y = CAMERA_HEIGHT + Math.sin(t) * 0.012
  })
}
