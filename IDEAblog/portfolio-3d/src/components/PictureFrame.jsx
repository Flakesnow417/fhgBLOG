import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FRAME_WIDTH, FRAME_HEIGHT, PAINT_REVEAL_DEFAULTS } from '../constants/corridor'
import {
  createFrameLineTexture,
  createSketchArtTexture,
  createPaintedArtTexture,
} from '../utils/sketchTextures'
import { createArtTexturesFromImage } from '../utils/artTexturesFromImage'
import { useInteraction } from '../context/InteractionContext'
import { usePaintReveal } from '../hooks/usePaintReveal'
import { registerReveal } from '../utils/revealRegistry'

/**
 * 贴图缓存 + 「程序化占位 → 真实图片」的渐进升级
 * ==================================================================
 * 两套来源：
 *   A. sketchTextures.js  —— 同步、程序化画出来的假图（立方体/球/石膏像/手）
 *   B. artTexturesFromImage.js —— 异步、从真实图片转出来的（去色+边缘检测+排线）
 *
 * 为什么要保留 A？
 *   因为 B 是**异步**的。如果一上来就等图片，画框会有一段时间是空的，
 *   长廊在快速前进时会出现"墙上先空一块、再补上"的闪动。
 *   所以策略是：
 *     1) 先用 A 立刻填上（零等待，保证任何时候墙上都有东西）
 *     2) B 加载完成后**无缝替换**
 *   这样无论网络快慢、图片多大，观感都不会破。
 *
 * 另外：A 还是**兜底**。图片 404 / 格式不对时，
 * 页面上依然是完整的画廊，而不是一堆空白画框。
 */
const artTexCache = new Map()

/**
 * 已就绪的贴图。返回 null 表示"真实图片还没准备好，先用程序化占位"。
 * 组件在挂载时读一次，并在 Promise resolve 后触发重渲染。
 */
function getArtTextures(artwork) {
  const key = `${artwork.motif}-${artwork.seed}`

  // ① 真实图片：有 image 字段才走这条路
  if (artwork.image) {
    const imgKey = `img:${artwork.image}`
    const hit = artTexCache.get(imgKey)
    if (hit && hit.ready) return hit.tex
    if (!hit || !hit.pending) {
      // 首次请求：立刻启动加载，同时把 pending 标记记下来，避免重复加载
      const entry = { ready: false, pending: true, tex: null, listeners: [] }
      artTexCache.set(imgKey, entry)
      createArtTexturesFromImage(artwork.image, {
        size: 1024,
        seed: artwork.seed,
        saturate: artwork.imageSaturate ?? 1.18,
        edgeStrength: artwork.imageEdge ?? 1,
      })
        .then(({ sketch, painted }) => {
          entry.tex = {
            sketch: toTexture(sketch),
            painted: toTexture(painted),
            source: 'image',
          }
          entry.ready = true
          entry.pending = false
          entry.listeners.forEach((fn) => fn())
          entry.listeners.length = 0
        })
        .catch((err) => {
          // 不抛出：图片挂了也要让画廊照常可用
          console.warn('[PictureFrame] 真实作品图加载失败，回退到程序化贴图：', artwork.image, err)
          entry.pending = false
          entry.failed = true
        })
    }
    // 还没好 → 返回 null，调用方用程序化版兜底
    return null
  }

  // ② 程序化占位（也是没有 image 字段时的唯一来源）
  if (!artTexCache.has(key)) {
    artTexCache.set(key, {
      ready: true,
      tex: {
        sketch: createSketchArtTexture({ seed: artwork.seed, motif: artwork.motif }),
        painted: createPaintedArtTexture({ seed: artwork.seed, motif: artwork.motif }),
        source: 'procedural',
      },
    })
  }
  return artTexCache.get(key).tex
}

/** 订阅某张图的加载完成事件（用于触发重渲染）。 */
function onArtTextureReady(artwork, fn) {
  if (!artwork.image) return () => {}
  const entry = artTexCache.get(`img:${artwork.image}`)
  if (!entry || entry.ready || entry.failed) return () => {}
  entry.listeners.push(fn)
  return () => {
    const i = entry.listeners.indexOf(fn)
    if (i >= 0) entry.listeners.splice(i, 1)
  }
}

/** canvas → THREE.CanvasTexture，统一设置色彩空间与采样。 */
function toTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas)
  // 所有手绘贴图都是"颜色信息"，必须标成 sRGB，
  // 否则在 renderer.outputColorSpace = sRGB 的管线下会被当成线性值再转一次，
  // 画面会发灰、发闷。
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  // 画框是竖直平面，纹理不需要重复平铺
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.needsUpdate = true
  return t
}

/**
 * 可交互画框
 * ==================================================================
 * 负责：
 *   1. 用平面拼出一个「裱在卡纸上的线稿画框」;
 *   2. hover 时用噪声揭示着色器把素描「涂成」彩色，并微微前倾、外发光；
 *   3. 点击打开详情弹窗。
 *
 * ------------------------------------------------------------------
 * 分层（从墙往外，全部是平面；Z 间距 0.004~0.008 用来防 z-fighting）：
 *   [0.004] 衬纸     比画略大的米白卡纸，把画从白墙上"垫"出来
 *   [0.012] 素描稿   黑白线稿
 *   [0.016] 揭示层   ★ Module 5：噪声揭示材质，素描↔彩色由 shader 决定
 *   [0.020] 框线     透明底黑墨画框
 *   [0.024] 光晕     hover 时才出现的暖色柔光
 *   [0.030] 命中面   全透明，唯一挂载指针事件的对象
 *
 * ------------------------------------------------------------------
 * ⚠️ 踩过的坑 1：指针事件必须挂在 <mesh> 上，不能挂在材质上
 * ------------------------------------------------------------------
 * 最初把 `{...interactiveProps}` 展开到 `<meshBasicMaterial>` 元素上，
 * 结果 hover / click 完全不触发，探针显示所有 mesh 的
 * `__r3f.handlers` 都是 `[]`、`eventCount` 都是 0。
 *
 * 原因：R3F 的指针事件按 raycast 命中的**场景对象**分发，只认
 * Mesh / Line / Points / Sprite。材质不在场景图里、没有 raycast 方法，
 * 写在它上面的 handler 就是个无人问津的普通 prop —— 不报错、不生效。
 *
 * 现在的做法：只有一个专门的命中面挂事件，其余装饰层
 * 全部 `raycast={() => null}` 退出射线检测。好处有两个：
 *   - 命中区域唯一且明确（= 画框外沿），不会因为各层尺寸不同
 *     而在边缘出现"亮着却点不到"；
 *   - 每幅画的射线检测从 7 个面降到 1 个，长廊里几十幅画，很值。
 *
 * 命中面不能用 `visible={false}`：three 的 Raycaster 会跳过
 * `visible === false` 的对象。所以必须 visible 为真，
 * 靠 `transparent + opacity=0 + depthWrite=false + colorWrite=false`
 * 达到视觉不可见。
 *
 * ------------------------------------------------------------------
 * ⚠️ 踩过的坑 2：Module 5 换材质后 hover 一度失效
 * ------------------------------------------------------------------
 * 原因是揭示层从 `<meshBasicMaterial>`（R3F 元素）换成了
 * `<primitive object={material} />`，而插入位置不小心落到了
 * 命中面**之后**。R3F 的射线检测取的是"最近的交点"，
 * 一个 opacity=0 的平面如果排在后面不影响，但如果
 * 揭示层用了 transparent 又参与了 raycast，它就会抢走事件。
 * 所以揭示层也必须 `raycast={() => null}`。
 *
 * ------------------------------------------------------------------
 * 着色器揭示 vs Module 4 的 opacity 淡入
 * ------------------------------------------------------------------
 * Module 4 是"把彩色贴图的整体透明度从 0 抬到 1"——
 * 画面会先变成半透明的浑浊中间态，像隔了一层毛玻璃。
 * Module 5 换成噪声边界：每个像素只有"素描"或"彩色"两种状态，
 * 边界呈不规则的笔触状，前沿还有一道湿边高光，
 * 视觉上才像"一支笔把颜色刷上去"。
 */

/* --------------------------------------------------------------------------
   贴图缓存
   --------------------------------------------------------------------------
   画框线稿全场景共享一张；速写与上色贴图按 motif+seed 缓存。
   不缓存的话，每挂载一段就会重新生成 4~6 张 512px canvas，
   画质不变但会明显卡顿。
   -------------------------------------------------------------------------- */
let cachedFrameTex = null
function getFrameTexture() {
  if (!cachedFrameTex) cachedFrameTex = createFrameLineTexture({ seed: 51 })
  return cachedFrameTex
}

/** 让某个 mesh 完全不参与射线检测（装饰层用）。 */
const noRaycast = () => null

/**
 * 揭示方向：按画框所在的墙决定"颜色从哪边刷过来"。
 * 左墙（rotation.y = +π/2）让颜色从走廊深处往外刷，
 * 右墙反之以保证观感对称。
 * 这里用归一化后的向量，具体幅度由 shader 里的阈值范围消化。
 */
function dirForSide(side) {
  if (side === 'left') return { dirX: -PAINT_REVEAL_DEFAULTS.dirX, dirY: 0, dirZ: 0.5 }
  return { dirX: PAINT_REVEAL_DEFAULTS.dirX, dirY: 0, dirZ: 0.5 }
}

export default function PictureFrame({ artwork, position, rotation }) {
  const { hoveredId, setHoveredId, openArtwork, isOpen } = useInteraction()

  const frameTex = getFrameTexture()

  // ---------------------------------------------------------------
  // 贴图：真实图片（异步）优先，程序化占位兜底
  // ---------------------------------------------------------------
  // 为什么需要这个 extra render 计数器：
  //   图片加载是异步的，resolve 之后 React 并不知道"该重渲染了"。
  //   这里用一个小小的 state 计数器，在 Promise 完成后 +1，
  //   就会触发一次重渲染，从而读到 getArtTextures 里已经就绪的贴图。
  // 为什么不直接把贴图塞进 state：
  //   因为贴图对象会被 useMemo 依赖（材质重建 = shader 重编译），
  //   放 state 里容易因为引用变化引发多余的重建。用计数器最省事、最稳。
  const [, bumpTextureVersion] = useState(0)

  // 先尝试真实图片（未就绪时返回 null）
  const imageTextures = getArtTextures(artwork)

  // 程序化占位：同步生成，任何时刻都可用
  const fallbackTextures = useMemo(() => {
    if (!artwork.image) return null
    return {
      sketch: createSketchArtTexture({ seed: artwork.seed, motif: artwork.motif }),
      painted: createPaintedArtTexture({ seed: artwork.seed, motif: artwork.motif }),
      source: 'procedural',
    }
  }, [artwork.image, artwork.seed, artwork.motif])

  const { sketch, painted } = imageTextures || fallbackTextures

  // 图片好了 → 触发一次重渲染，把占位换成真图
  useEffect(() => {
    if (!artwork.image || imageTextures) return undefined
    return onArtTextureReady(artwork, () => bumpTextureVersion((v) => v + 1))
  }, [artwork, imageTextures])

  // 各层尺寸：衬纸 > 画框 > 画心
  const matW = FRAME_WIDTH * 1.14
  const matH = FRAME_HEIGHT * 1.16
  const frameW = FRAME_WIDTH * 1.42
  const frameH = FRAME_HEIGHT * 1.52

  const anchorRef = useRef(null) // 外层的世界坐标，用作着色器的原点
  const innerRef = useRef(null) // 内层：承载 hover 偏移，避免覆写外层定位
  const haloMatRef = useRef(null) // 光晕层材质
  const lampRef = useRef(null) // 射灯材质

  const isHovered = hoveredId === artwork.id
  const [localHover, setLocalHover] = useState(false)

  // ---------------------------------------------------------------
  // 噪声揭示材质（Module 5 的核心）
  // ---------------------------------------------------------------
  const { dirX, dirY, dirZ } = useMemo(() => dirForSide(artwork.side), [artwork.side])
  const { materialRef, createMaterial, setTarget, setFrozenProgress } = usePaintReveal({
    originRef: anchorRef,
    dirX,
    dirY,
    dirZ,
  })

  // 材质只在贴图变化时重建（重建 = 重新编译 shader，必须避免每帧发生）
  const paintMaterial = useMemo(
    () => createMaterial(sketch, painted),
    [createMaterial, sketch, painted],
  )

  // 把材质交给 hook（hook 内部逐帧写 progress / origin）
  useEffect(() => {
    materialRef.current = paintMaterial
    // 卸载时清空引用，避免 useFrame 继续操作已废弃的材质
    return () => {
      materialRef.current = null
    }
  }, [materialRef, paintMaterial])

  // 材质重建后需要让 three 知道要重新编译一次。
  // needsUpdate 只在"换了贴图"这种低频事件上设置，不会每帧触发。
  useEffect(() => {
    paintMaterial.needsUpdate = true
  }, [paintMaterial])

  // 组件真正卸载时才销毁 GPU 资源。
  // 不能放在上面那个 effect 的 cleanup 里 —— 那里会在贴图变化时
  // 也执行，贴图一换就把旧材质 dispose 掉，而它可能还被别的
  // 分段引用着（贴图是全局缓存的）。
  useEffect(() => {
    return () => {
      // 贴图是共享缓存，不能在这里 dispose；只释放材质本身
      paintMaterial.dispose()
    }
  }, [paintMaterial])

  // 登记揭示控制权，供自动化测试冻结进度（见 revealRegistry 的说明）。
  // 这是唯一向"组件外部"暴露控制的地方，范围刻意收得很窄。
  //
  // ⚠️ 注意这里**不传 artwork.id**：长廊内容循环映射，
  // 同一时刻会有多个画框共享同一个 artwork.id，用 id 当键会互相覆盖，
  // 导致"冻不上想冻的那一幅"。注册表内部用自增序号保证实例唯一。
  useEffect(() => {
    return registerReveal({ setFrozenProgress, artworkId: artwork.id })
  }, [setFrozenProgress, artwork.id])

  // hover 状态 → 揭示目标。
  // 弹窗打开时不点亮任何画框，否则鼠标移到别处、弹窗还在，
  // 底下却有一幅画亮着，很乱。
  useEffect(() => {
    setTarget(isHovered && !isOpen ? 1 : 0)
  }, [isHovered, isOpen, setTarget])

  // 弹窗打开时，把已经亮起的画框收回去
  useEffect(() => {
    if (isOpen) setTarget(0)
  }, [isOpen, setTarget])

  // ---------------------------------------------------------------
  // 逐帧：只处理"跟着揭示进度走"的表现（光晕、前倾、射灯）
  // 揭示进度本身由 usePaintReveal 内部驱动
  // ---------------------------------------------------------------
  useFrame((_, rawDelta) => {
    const material = materialRef.current
    if (!material) return
    const p = material.userData?.paint

    // progress 是 hook 每帧写入的，这里只读，用来带动别的层。
    // （读同一个 ref 而不是各自再插值一次，保证所有表现完全同步。）
    const progress = p ? p.progress : 0

    if (haloMatRef.current) {
      haloMatRef.current.opacity = progress * 0.5
    }
    if (lampRef.current) {
      lampRef.current.emissiveIntensity = 1.0 + progress * 1.6
    }

    // 前倾：把整个画框朝走廊内侧推一点点，并极轻微地转向观众。
    // 位移只有 5cm、角度只有 1°，大了就会像"画飞出来"，很廉价。
    //
    // 为什么分成内外两层 group：
    //   外层的 position / rotation 来自 props，是画框在长廊里的定位，
    //   属于"场景数据"，不能每帧被覆写；
    //   内层只承载 hover 带来的偏移量，两者互不干扰。
    //
    // 注意 delta 要夹住：标签页切回来时 rawDelta 可能是几秒，
    // 不夹的话位移会一步跳到位。
    const delta = Math.min(rawDelta, 0.1)
    const inner = innerRef.current
    if (inner) {
      const targetZ = progress * 0.05
      const targetRotX = progress * 0.018
      const k = 1 - Math.exp(-12 * delta)
      inner.position.z += (targetZ - inner.position.z) * k
      inner.rotation.x += (targetRotX - inner.rotation.x) * k
    }
  })

  // ---------------------------------------------------------------
  // 指针事件（全部挂在唯一的命中面上）
  // ---------------------------------------------------------------
  const canInteract = !isOpen

  const handleOver = (e) => {
    e.stopPropagation()
    if (!canInteract) return
    setLocalHover(true)
    setHoveredId(artwork.id)
    // 给自动化测试和调试留的钩子
    document.body.dataset.hoverArtwork = artwork.id
    document.body.style.cursor = 'pointer'
  }

  const handleOut = (e) => {
    e.stopPropagation()
    setLocalHover(false)
    if (hoveredId === artwork.id) setHoveredId(null)
    delete document.body.dataset.hoverArtwork
    document.body.style.cursor = ''
  }

  const handleClick = (e) => {
    e.stopPropagation()
    if (!canInteract) return
    openArtwork(artwork.id)
  }

  return (
    <group position={position} rotation={rotation} ref={anchorRef}>
      {/* 内层 group 承担 hover 的位移/倾角，这样外层 position 保持纯净 */}
      <group ref={innerRef}>
        {/* --- 1. 衬纸 --- */}
        <mesh position={[0, 0, 0.004]} raycast={noRaycast}>
          <planeGeometry args={[matW, matH]} />
          <meshBasicMaterial color="#efe9dc" toneMapped={false} />
        </mesh>

        {/* --- 2. 素描稿（黑白，作为底色） --- */}
        <mesh position={[0, 0, 0.012]} raycast={noRaycast}>
          <planeGeometry args={[FRAME_WIDTH, FRAME_HEIGHT]} />
          <meshBasicMaterial map={sketch} toneMapped={false} />
        </mesh>

        {/* --- 3. 揭示层（Module 5 的核心） ---
             用 <primitive> 挂载自己构造的材质实例，
             而不是用 <meshBasicMaterial> 元素 —— 因为要在构造时
             接上 onBeforeCompile 与 userData。
             必须 raycast=false：它是 transparent 的平面，
             如果参与射线检测会挡住下面那层命中面。 */}
        <mesh position={[0, 0, 0.016]} raycast={noRaycast}>
          <planeGeometry args={[FRAME_WIDTH, FRAME_HEIGHT]} />
          <primitive object={paintMaterial} attach="material" />
        </mesh>

        {/* --- 4. 画框线稿 --- */}
        <mesh position={[0, 0, 0.02]} raycast={noRaycast}>
          <planeGeometry args={[frameW, frameH]} />
          <meshBasicMaterial
            map={frameTex}
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* --- 5. hover 光晕 --- */}
        <mesh position={[0, 0, 0.024]} raycast={noRaycast}>
          <planeGeometry args={[matW, matH]} />
          <meshBasicMaterial
            ref={haloMatRef}
            color={artwork.accent || '#ffcf8a'}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>

        {/* --- 6. 顶部射灯 --- */}
        <mesh
          position={[0, frameH / 2 - 0.06, 0.1]}
          rotation={[Math.PI / 9, 0, 0]}
          raycast={noRaycast}
        >
          <boxGeometry args={[0.3, 0.045, 0.12]} />
          <meshStandardMaterial
            ref={lampRef}
            color="#fff6e2"
            emissive="#ffe9bd"
            emissiveIntensity={1}
            roughness={0.4}
          />
        </mesh>

        {/* --- 7. 悬停时浮现的题签 --- */}
        {localHover && (
          <mesh position={[0, -matH / 2 - 0.075, 0.024]} raycast={noRaycast}>
            <planeGeometry args={[0.62, 0.052]} />
            <meshBasicMaterial
              color={artwork.accent || '#c8532f'}
              transparent
              opacity={0.85}
              toneMapped={false}
            />
          </mesh>
        )}

        {/* --- 8. 命中面（唯一挂指针事件的对象） ---
             尺寸取画框外沿（frameW × frameH），这样"看着能点到"
             和"实际能点到"完全一致。
             z 在最外层 0.03，保证它是最靠前的命中对象。 */}
        <mesh
          position={[0, 0, 0.03]}
          onPointerOver={handleOver}
          onPointerOut={handleOut}
          onClick={handleClick}
        >
          <planeGeometry args={[frameW, frameH]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}
