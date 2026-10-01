import { useMemo } from 'react'
import * as THREE from 'three'
import {
  CORRIDOR_WIDTH,
  CORRIDOR_HEIGHT,
  SEGMENT_LENGTH,
  CORRIDOR_START_Z,
  FRAME_MARGIN,
  FRAME_WALL_GAP,
  BASEBOARD_HEIGHT,
} from '../constants/corridor'
import { getArtworkFor } from '../constants/artworks'
import {
  createWallTexture,
  createFloorTexture,
  createCeilingTexture,
  createNightSkyTexture,
} from '../utils/sketchTextures'
import PictureFrame from './PictureFrame'

/**
 * 长廊的单个分段
 * ==================================================================
 * 美术方向（对齐参考项目，这段方向曾经搞反过，务必看完再改）：
 *
 *   参考项目实测：墙面贴图 avg(255,255,255)、地板 avg(223,224,222)、
 *   天花板 avg(253,253,253)，并且全部用 **meshBasicMaterial**（不吃光照，
 *   直接输出贴图颜色）。也就是说整个空间是「一个明亮的白纸盒子，
 *   上面用铅笔线稿画出地板/接缝/画框」。
 *
 *   我最初把它做成了深色长廊（近黑贴图 + 低环境光 + Standard 材质），
 *   结果整屏几乎全黑。现在改为：
 *     - 墙/地/顶统一用 meshBasicMaterial，贴图基色接近白纸；
 *     - 光照只给画框射灯这类 Standard 材质提供层次；
 *     - 纵深依靠**透视线稿**表达（板缝、踢脚线、画框、结构描边）。
 *
 * 结构：
 *   墙面用独立 Plane 而不是 Box 内面 —— Box 六个面的 UV 方向不一致，
 *   挂线稿会出现镜像/旋转，而这些线稿的方向必须可控。
 *
 * 画框已拆到独立的 PictureFrame.jsx（Module 4 让它变得很重：
 * 分层、hover、点击、着色器替换点，留在本文件里会淹没长廊几何）。
 * 本文件的职责收敛为「一段长廊的墙地顶 + 画框摆位」。
 */

/**
 * 结构描边
 * ------------------------------------------------------------------
 * 用 <lineSegments> 手工列举顶点，把长廊的骨架勾出来：
 *   - 4 条沿 Z 方向的长线（左右墙与地/天的交界）—— 负责透视收拢
 *   - 每段两端的矩形轮廓 —— 负责表达"一段"的接缝
 *
 * 白墙上这些深色线段就是全部的空间信息。
 *
 * ⚠️ lineSegments 必须 frustumCulled={false}：
 *   手工构造的 BufferGeometry 没有 computeBoundingSphere 的机会
 *   （或者说包围球是按局部坐标算的，而我们的顶点用了世界坐标直觉），
 *   一旦相机贴得很近就会被误剔除，线段突然消失。
 */
function StructureOutlines({ startZ, width, height, length, color, opacity }) {
  const geometry = useMemo(() => {
    const hw = width / 2
    const z0 = startZ
    const z1 = startZ - length
    const pts = []

    // 4 条纵向长线
    for (const x of [-hw, hw]) {
      for (const y of [0.002, height]) {
        pts.push(x, y, z0, x, y, z1)
      }
    }

    // 段两端的截面轮廓
    for (const z of [z0, z1]) {
      pts.push(-hw, 0.002, z, -hw, height, z)
      pts.push(hw, 0.002, z, hw, height, z)
      pts.push(-hw, 0.002, z, hw, 0.002, z)
      pts.push(-hw, height, z, hw, height, z)
    }

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [startZ, width, height, length])

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </lineSegments>
  )
}

/**
 * 踢脚线：地板与墙面交界处的深色窄条。
 * 素描里这条线非常重要 —— 它把墙面和地面彻底分开，
 * 没有它，白墙和白地板会糊成一片。
 */
function Baseboard({ side, startZ, length, theme = 'day' }) {
  const h = BASEBOARD_HEIGHT
  const x = side === 'left' ? -CORRIDOR_WIDTH / 2 + 0.014 : CORRIDOR_WIDTH / 2 - 0.014
  const rotY = side === 'left' ? Math.PI / 2 : -Math.PI / 2

  return (
    <group>
      {/* 踢脚线板面 */}
      <mesh position={[x, h / 2, startZ - length / 2]} rotation={[0, rotY, 0]}>
        <planeGeometry args={[length, h]} />
        <meshBasicMaterial color={theme === 'night' ? '#1b3654' : '#dcd6c7'} toneMapped={false} />
      </mesh>
      {/* 踢脚线顶沿的墨线：素描里的"收口线" */}
      <mesh position={[x, h, startZ - length / 2]} rotation={[0, rotY, 0]}>
        <planeGeometry args={[length, 0.018]} />
        <meshBasicMaterial color={theme === 'night' ? '#6c90ae' : '#5a5348'} toneMapped={false} />
      </mesh>
    </group>
  )
}

/**
 * 走廊尽头的封口板
 * ------------------------------------------------------------------
 * 只有最后一段（段 0，也就是相机出生点所在、再往前没有段的那一端）
 * 才需要。它解决两个问题：
 *   1. 相机出生在 z=14，身后（+Z 方向）没有任何段落，
 *      如果不封口，从纸背后透过来的是纯背景色，会看到一条刺眼的亮块；
 *   2. 在美术上给长廊一个"起点"，像画廊入口处的墙。
 * 位置在段起点之后 0.05，正面朝向走廊（rotation Y = π）。
 */
function SegmentCap({ z, width, height, theme = 'day' }) {
  const tex = useMemo(() => {
    const t = createWallTexture({ seed: 71 })
    t.repeat.set(width / 2.6, height / 2.6)
    return t
  }, [width, height])

  const outline = useMemo(() => {
    const hw = width / 2
    const hh = height / 2
    const pts = [
      -hw, -hh, 0, hw, -hh, 0,
      hw, -hh, 0, hw, hh, 0,
      hw, hh, 0, -hw, hh, 0,
      -hw, hh, 0, -hw, -hh, 0,
    ]
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [width, height])

  return (
    <group position={[0, height / 2, z]}>
      <mesh rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={tex} color={theme === 'night' ? '#102744' : '#e8e4d8'} toneMapped={false} />
      </mesh>
      {/* 一圈墨色边，让封口板读起来像"结构的端面" */}
      <lineSegments geometry={outline} frustumCulled={false}>
        <lineBasicMaterial
          color={theme === 'night' ? '#83a7c8' : '#4a453c'}
          transparent
          opacity={theme === 'night' ? 0.38 : 0.5}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  )
}

// 这些面片在所有长廊分段里完全相同。白天与夜游各缓存一套，切换时
// 只替换材质引用，不重复生成画框贴图，也不增加几何数量。
const sharedMaterialsByTheme = new Map()

function getSharedMaterials(theme = 'day') {
  const cached = sharedMaterialsByTheme.get(theme)
  if (cached) return cached

  const wallTex = createWallTexture({ seed: theme === 'night' ? 17 : 11 })
  wallTex.repeat.set(SEGMENT_LENGTH / 3.4, CORRIDOR_HEIGHT / 3.4)

  const floorTex = createFloorTexture({ seed: 23 })
  // 地板：沿 U（段长）铺 4 组，横向 V（宽度 9）铺 1.6 组。
  floorTex.repeat.set(SEGMENT_LENGTH / 5, CORRIDOR_WIDTH / 5.6)

  const ceilTex = theme === 'night'
    ? createNightSkyTexture({ seed: 83, stars: 720 })
    : createCeilingTexture({ seed: 37 })
  ceilTex.repeat.set(SEGMENT_LENGTH / 4, CORRIDOR_WIDTH / 4)

  const basic = (map, color = '#ffffff') =>
    new THREE.MeshBasicMaterial({ map, color, toneMapped: false })

  const materials = theme === 'night'
    ? {
        wall: basic(wallTex, '#122b49'),
        floor: basic(floorTex, '#6b3030'),
        ceiling: basic(ceilTex, '#ffffff'),
      }
    : {
        wall: basic(wallTex, '#f6f3ec'),
        floor: basic(floorTex, '#fdfcf8'),
        ceiling: basic(ceilTex, '#f4f2ec'),
      }

  sharedMaterialsByTheme.set(theme, materials)
  return materials
}

export default function CorridorSegment({ segmentIndex, isEndSegment = false, theme = 'day' }) {
  const startZ = CORRIDOR_START_Z - segmentIndex * SEGMENT_LENGTH
  const centerZ = startZ - SEGMENT_LENGTH / 2

  // 所有分段共用这三套材质；分段只负责几何位置和画框内容。
  const materials = useMemo(() => getSharedMaterials(theme), [theme])

  // ---------------------------------------------------------------
  // 画框排布：每段左右各 2 幅，左右交错
  // ---------------------------------------------------------------
  const frames = useMemo(() => {
    const list = []
    const perSide = 2
    const usable = SEGMENT_LENGTH - 4
    const step = usable / perSide

    for (let slot = 0; slot < perSide; slot++) {
      // 左侧靠段起点，右侧整体后移半个步长 → 两侧不同频
      const zL = startZ - 2 - slot * step
      const zR = zL - step / 2
      list.push({
        key: `L${slot}`,
        artwork: getArtworkFor(segmentIndex, slot * 2),
        position: [-CORRIDOR_WIDTH / 2 + FRAME_WALL_GAP, FRAME_MARGIN, zL],
        rotation: [0, Math.PI / 2, 0],
      })
      list.push({
        key: `R${slot}`,
        artwork: getArtworkFor(segmentIndex, slot * 2 + 1),
        position: [CORRIDOR_WIDTH / 2 - FRAME_WALL_GAP, FRAME_MARGIN, zR],
        rotation: [0, -Math.PI / 2, 0],
      })
    }
    return list
  }, [segmentIndex, startZ])

  return (
    <group>
      {/* --- 左墙 --- */}
      <mesh position={[-CORRIDOR_WIDTH / 2, CORRIDOR_HEIGHT / 2, centerZ]} rotation={[0, Math.PI / 2, 0]} material={materials.wall}>
        <planeGeometry args={[SEGMENT_LENGTH, CORRIDOR_HEIGHT]} />
      </mesh>

      {/* --- 右墙 --- */}
      <mesh position={[CORRIDOR_WIDTH / 2, CORRIDOR_HEIGHT / 2, centerZ]} rotation={[0, -Math.PI / 2, 0]} material={materials.wall}>
        <planeGeometry args={[SEGMENT_LENGTH, CORRIDOR_HEIGHT]} />
      </mesh>

      {/* --- 地板 --- */}
      <mesh position={[0, 0, centerZ]} rotation={[-Math.PI / 2, 0, 0]} material={materials.floor}>
        <planeGeometry args={[CORRIDOR_WIDTH, SEGMENT_LENGTH]} />
      </mesh>

      {/* --- 天花板 --- */}
      <mesh position={[0, CORRIDOR_HEIGHT, centerZ]} rotation={[Math.PI / 2, 0, 0]} material={materials.ceiling}>
        <planeGeometry args={[CORRIDOR_WIDTH, SEGMENT_LENGTH]} />
      </mesh>

      {/* --- 踢脚线 --- */}
      <Baseboard side="left" startZ={startZ} length={SEGMENT_LENGTH} theme={theme} />
      <Baseboard side="right" startZ={startZ} length={SEGMENT_LENGTH} theme={theme} />

      {/* --- 结构描边 --- */}
      <StructureOutlines
        startZ={startZ}
        width={CORRIDOR_WIDTH}
        height={CORRIDOR_HEIGHT}
        length={SEGMENT_LENGTH}
        color={theme === 'night' ? '#86a8c5' : '#4a453c'}
        opacity={theme === 'night' ? 0.34 : 0.4}
      />

      {/* --- 画框 --- */}
      {frames.map((f) => (
        <PictureFrame key={f.key} artwork={f.artwork} position={f.position} rotation={f.rotation} theme={theme} />
      ))}

      {/* --- 尽头封口（仅最后一段） --- */}
      {isEndSegment && (
        <SegmentCap
          z={startZ - 0.05}
          width={CORRIDOR_WIDTH}
          height={CORRIDOR_HEIGHT}
          theme={theme}
        />
      )}
    </group>
  )
}
