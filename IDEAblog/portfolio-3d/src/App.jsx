import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { useContextBridge } from '@react-three/drei'
import * as THREE from 'three'
import Scene from './components/Scene.jsx'
import PaperTearIntro from './components/PaperTearIntro.jsx'
import ArtworkDetail from './components/ArtworkDetail.jsx'
import {
  InteractionProvider,
  InteractionContext,
  useInteraction,
} from './context/InteractionContext'
import { INTRO_PHASE, INTRO_TIMING } from './constants/intro'

/**
 * 应用根组件
 * ==================================================================
 * 负责四件事：
 *   1. 挂载 R3F 的 <Canvas>，把渲染器全局参数定下来；
 *   2. 用 <Suspense> 兜住异步资源（贴图、字体、模型）；
 *   3. 编排开场流程（Module 2）：先让 3D 场景在纸背后预热，
 *      等首帧真正画出来之后再撕纸，避免「撕开后还是黑屏」；
 *   4. 承载 Module 4 的交互状态，并把 context 桥接进 Canvas（见下）。
 *
 * ------------------------------------------------------------------
 * ⚠️ 关于 useContextBridge（这里很容易踩坑，别删）
 *   R3F 的 <Canvas> 内部使用的是**另一个 reconciler**，它会切断
 *   外层 React 树上的 context。也就是说：如果在最外层包一个
 *   <InteractionProvider>，Canvas 里的 <PictureFrame> 用 useContext
 *   是拿不到值的。必须把 context 实例交给 drei 的 useContextBridge，
 *   在 Canvas 内部再包一层，才能打通。
 *
 *   注意 useContextBridge 接收的是 **context 对象**（InteractionContext），
 *   不是 Provider 组件 —— 这是常见写法错误。
 *
 * ------------------------------------------------------------------
 * ⚠️ 关于 className="r3f-fill"（尺寸链，别删）
 *   R3F 的 <Canvas> 自己就会在 DOM 里渲染出这样的结构：
 *     <div style="position:relative;width:100%;height:100%">   ← 外层
 *       <div style="width:100%;height:100%">                   ← 容器
 *         <canvas style="display:block">
 *   也就是说**尺寸其实已经铺满了**，早先我以为它只给 canvas 设 100%
 *   而 wrapper 会塌缩，于是在 global.scss 里写了一条
 *   `#root > div > div { width:100%; height:100% }` 兜底。
 *   那条规则后来把右下角的 .boot-badge 一起命中了（它也是 .app 下的
 *   一个直接 div），把它拉成满屏高，糊住了右半边画面。
 *
 *   现在改成显式传 className：R3F 会把 props 展开到外层 div 上，
 *   于是我们有一个确定的钩子 `.r3f-fill`，不再依赖任何层级猜测。
 *   同时 global.scss 里那条结构选择器已经删除。
 */
export default function App() {
  return (
    // Provider 放在最外层：DOM 侧的 <ArtworkDetail /> 和
    // Canvas 内的 <PictureFrame /> 都要读这份状态。
    <InteractionProvider>
      <PortfolioShell />
    </InteractionProvider>
  )
}

/** 拆一层，是为了能在 InteractionProvider 内部读到它的状态。 */
function PortfolioShell() {
  const [phase, setPhase] = useState(INTRO_PHASE.LOADING)
  const [sceneReady, setSceneReady] = useState(false)
  const [timeoutHit, setTimeoutHit] = useState(false)
  const [galleryTheme, setGalleryTheme] = useState(() => {
    if (typeof window === 'undefined') return 'day'
    try {
      return window.localStorage.getItem('portfolio-gallery-theme') === 'night' ? 'night' : 'day'
    } catch {
      return 'day'
    }
  })

  const { isOpen } = useInteraction()

  /**
   * 「返回一念未落」的地址，两种运行方式各用各的（原因见 JSX 里的长注释）。
   *   dev server  → file:///E:/fhgBLOG/IDEAblog/index.html
   *   双击 dist    → ../../index.html
   *
   * 目录关系（双击模式下）：
   *   E:\fhgBLOG\IDEAblog\index.html            ← 落地页，要回到这里
   *   E:\fhgBLOG\IDEAblog\portfolio-3d\dist\    ← 当前页在这个文件夹里
   *   dist 里写 ../../index.html → 上两层 → IDEAblog\index.html  ✅
   */
  const backHomeHref = useMemo(() => {
    if (typeof window === 'undefined') return './'
    return window.location.protocol === 'file:'
      ? '../../index.html'
      : 'file:///E:/fhgBLOG/IDEAblog/index.html'
  }, [])

  // R3F 的 context 桥：把外层的 context 实例带进 Canvas 内的另一棵 React 树。
  const Bridge = useContextBridge(InteractionContext)

  const handleSceneReady = useCallback(() => setSceneReady(true), [])
  const handleTearComplete = useCallback(() => setPhase(INTRO_PHASE.DONE), [])

  // 兜底计时器：低端设备 / 软件光栅环境下首帧可能迟迟不出现，
  // 不能让用户干等。到点后就撕纸，3D 场景可以边显示边继续预热。
  useEffect(() => {
    const timer = window.setTimeout(() => setTimeoutHit(true), INTRO_TIMING.maxLoadWait)
    return () => window.clearTimeout(timer)
  }, [])

  // 满足任一条件即可开撕：
  //   - 首帧已经画出来（正常情况，体验最好）
  //   - 等到最长等待上限（兜底，保证不会无限白屏）
  useEffect(() => {
    if (phase !== INTRO_PHASE.LOADING) return
    if (!sceneReady && !timeoutHit) return

    const timer = window.setTimeout(() => {
      setPhase(INTRO_PHASE.TEARING)
    }, INTRO_TIMING.prewarmDelay)

    return () => window.clearTimeout(timer)
  }, [sceneReady, timeoutHit, phase])

  // 把阶段和主题挂到 body 上，方便 DOM 控件与 CSS 依据状态做整体表现。
  // 主题也写入本地，用户下次进入时保持上一次的选择。
  useEffect(() => {
    document.body.dataset.introPhase = phase
    document.body.dataset.galleryTheme = galleryTheme
    try {
      window.localStorage.setItem('portfolio-gallery-theme', galleryTheme)
    } catch {
      // file:// 某些浏览器会禁用 localStorage，主题仍可正常切换。
    }
  }, [phase, galleryTheme])

  // 弹窗打开时禁掉底层滚动，避免滚轮穿透到页面
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // 开场还没结束、或者弹窗开着时，都不显示漫游提示
  const showBadge = phase === INTRO_PHASE.DONE && !isOpen

  return (
    <div className="app">
      {/* 当前场景不依赖真实阴影；关闭 shadow map 可减少首屏 framebuffer
          和每帧阴影绘制成本。高分屏限制到 1.5 倍 DPR，降低 GPU 压力。 */}
      <Canvas
        className="r3f-fill"
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        }}
        camera={{ fov: 62, near: 0.1, far: 500 }}
        style={{ position: 'absolute', inset: 0 }}
        onCreated={({ gl, scene, size }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.0
          scene.background = new THREE.Color(galleryTheme === 'night' ? '#071527' : '#f1eee6')
          console.log('[boot] canvas size =', size.width, 'x', size.height)
        }}
      >
        <Suspense fallback={null}>
          {/* Bridge 负责把外层 context 透传进 R3F 的 reconciler */}
          <Bridge>
            <Scene onReady={handleSceneReady} theme={galleryTheme} />
          </Bridge>
        </Suspense>
      </Canvas>

      {/* 开场遮罩：无论哪个阶段都保持挂载，内部用 display 控制显隐 */}
      <PaperTearIntro phase={phase} onTearComplete={handleTearComplete} />

      <div className="gallery-controls" role="group" aria-label="长廊灯光模式">
        <span className="gallery-controls__label">游廊灯</span>
        <button
          type="button"
          className={`gallery-theme-toggle gallery-theme-toggle--${galleryTheme}`}
          onClick={() => setGalleryTheme((theme) => (theme === 'day' ? 'night' : 'day'))}
          aria-pressed={galleryTheme === 'night'}
          aria-label={galleryTheme === 'day' ? '切换到夜游模式' : '切换到白天模式'}
        >
          <span className="gallery-theme-toggle__sun" aria-hidden="true">日</span>
          <span className="gallery-theme-toggle__moon" aria-hidden="true">月</span>
          <span className="gallery-theme-toggle__text">{galleryTheme === 'day' ? '白天' : '夜游'}</span>
        </button>
      </div>

      {/* 纸张还没撕开时的呼吸提示：放在纸的上层，不随纸撕走 */}
      {phase === INTRO_PHASE.LOADING && (
        <div className="paper-tear__loading">正在准备素描长廊</div>
      )}

      {/* 返回首页：3D 长廊是独立工程，需要一个出口回到 index.html。
       *
       * ⚠️ 这个链接要同时应付两种运行方式，所以不能写死：
       *
       *   ① 开发服务器模式（http://localhost:5173）
       *      当前页是 http://，而落地页 index.html 是本地文件。
       *      跨协议只能用完整绝对 URL；写相对路径会被解析成
       *      http://localhost:5173/index.html（那是 dev server 的入口，不是落地页）。
       *      → 必须用 file:///E:/fhgBLOG/IDEAblog/index.html
       *
       *   ② 打包双击模式（file:///E:/…/portfolio-3d/dist/index.html）
       *      当前页和落地页都是 file://，但两者隔了两层目录
       *      （dist → portfolio-3d → IDEAblog）。
       *      此时写 file:///E:/… 这种绝对路径虽然也能通，但**换台电脑就废了**。
       *      → 应该用相对路径 ../../index.html，跟着文件夹一起搬走也不会坏。
       *
       * 判据用 location.protocol：dev server 下是 'http:'，双击时是 'file:'。
       * 这是运行时才知道的信息，所以在组件里算一次就够了
       * （用 useMemo 而不是每次渲染都算 —— 虽然代价很小，但语义更清楚）。 */}
      <a className="back-home" href={backHomeHref}>
        ← 返回一念未落
      </a>

      {/* 漫游操作提示（弹窗打开时收起，避免与弹窗争视觉） */}
      {showBadge && (
        <div className="boot-badge">
          鼠标移动转向 · <b>W/S</b> 或滚轮前进 · 点击画框查看详情
        </div>
      )}

      {/* Module 4 的出口：画作详情弹窗（纯 DOM，覆盖在 Canvas 之上） */}
      <ArtworkDetail />
    </div>
  )
}
