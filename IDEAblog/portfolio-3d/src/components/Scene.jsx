import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import InfiniteCorridor from './InfiniteCorridor'
import useInfiniteCamera from '../hooks/useInfiniteCamera'
import DebugBridge from './DebugBridge'
import { useInteraction } from '../context/InteractionContext'
import { CAMERA_HEIGHT, CORRIDOR_START_Z } from '../constants/corridor'

/**
 * 主场景
 * ==================================================================
 * 长廊是「白纸盒子」，墙面/地板/天花板全部用 meshBasicMaterial
 * （不吃光照，直接输出贴图颜色），所以这里的光**不负责空间亮度**，
 * 只做两件事：
 *   1. 给画框射灯、道具这类 Standard 材质提供一点明暗层次；
 *   2. 让后续 Module 5 上色后的画作有真实的受光感。
 *
 * 曾经踩过的坑：把这里的环境光压到 0.14，又给墙面用 Standard 材质
 * 配近黑色贴图，结果整屏全黑。现在不会再出现这个问题，
 * 因为空间亮度已经由 basic 材质 + 白色贴图决定了。
 */

/** 把相机摆到长廊入口，朝 -Z 看（长廊延伸方向）。 */
function CorridorCamera({ enabled }) {
  const { camera } = useThree()
  const placed = useRef(false)

  useFrame(() => {
    if (placed.current) return
    camera.position.set(0, CAMERA_HEIGHT, CORRIDOR_START_Z)
    camera.rotation.order = 'YXZ'
    camera.rotation.set(0, 0, 0)
    camera.updateProjectionMatrix()
    placed.current = true
  })

  // 相机就位后接管，交给漫游 hook 驱动
  useInfiniteCamera({ enabled })

  return null
}

/**
 * 雾效与背景
 * ------------------------------------------------------------------
 * 纸白长廊里，雾色必须是纸色（接近白），否则远处的白墙会突然
 * 撞进一片黑雾里，像画面被切断。
 * 参考项目没有用雾；我们用一点点雾来做"画廊尽头渐隐"，
 * 这也是它那种记录视频里远处的观感。
 *
 * 直接操作 scene.fog / scene.background 而不是在 JSX 里写
 * <fog attach="fog" />：Scene 的返回结果是 Canvas 的多个子节点，
 * attach 会尝试挂到最近的父对象上，行为不完全可控。
 */
function CorridorAtmosphere({ fogColor = '#f1eee6', fogNear = 26, fogFar = 96, bg = '#f1eee6' }) {
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    const prevFog = scene.fog
    const prevBg = scene.background
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar)
    scene.background = new THREE.Color(bg)
    return () => {
      scene.fog = prevFog
      scene.background = prevBg
    }
  }, [scene, fogColor, fogNear, fogFar, bg])

  return null
}

export default function Scene({ onReady, controlsEnabled = true }) {
  const fired = useRef(false)
  const { isOpen } = useInteraction()

  useFrame(() => {
    if (fired.current) return
    fired.current = true
    onReady?.()
  })

  // 弹窗打开时停掉漫游：否则鼠标移去点关闭按钮的路上，
  // 相机还会跟着转，底下的画面在动，弹窗却不动 —— 很晕。
  const roaming = controlsEnabled && !isOpen

  return (
    <>
      <CorridorCamera enabled={roaming} />
      <CorridorAtmosphere />
      <DebugBridge />

      {/* --- 光照：只为 Standard 材质（画框射灯等）提供层次 ---
          数值不需要很大，因为空间亮度已经由 basic 材质决定。 */}
      <ambientLight intensity={0.55} color="#fdfbf6" />
      <hemisphereLight args={['#fffdf8', '#cfc9bb', 0.5]} />
      <directionalLight position={[2, 9, 6]} intensity={0.35} color="#fff8ea" />

      {/* --- 长廊主体 --- */}
      <InfiniteCorridor />
    </>
  )
}
