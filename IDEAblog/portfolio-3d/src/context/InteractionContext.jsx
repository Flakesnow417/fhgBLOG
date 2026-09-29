import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

/**
 * 交互状态上下文
 * ==================================================================
 * Module 4 引入。它解决的问题是：**3D 画框和 DOM 弹窗需要共享状态，
 * 但两者在不同的 React 树分支里**（画框在 <Canvas> 内，弹窗在 Canvas 外）。
 *
 * R3F 的 <Canvas> 会创建自己的 reconciler 与上下文边界，
 * 所以在 Canvas 外 <App> 里创建的 Context，Canvas 内的组件
 * 是**读不到**的 —— 这是 R3F 常见的一个坑。解决办法有两个：
 *   a) 用 drei 的 <useContextBridge> 把外层的 context 透传进 Canvas；
 *   b) 不依赖 React context，改用模块级的订阅（如 zustand / 自定义 store）。
 *
 * 这里选了 a) 的轻量版：状态放在 App 层的 Provider 里，
 * 再在 Canvas 内套一层 <ContextBridge>（见 Scene.jsx）。
 * 好处是状态仍受 React 管理，DevTools 可读，也方便后续加过渡动画。
 *
 * 状态设计：
 *   hoveredId —— 当前鼠标悬停的画框 id（用于 hover 上色的目标判定）
 *   activeId  —— 当前打开弹窗的画框 id，null 表示没有弹窗
 *   isOpen    —— 是否正在弹窗（漫游相机需要据此暂停）
 *
 * 为什么 hover 要放进共享状态而不是画框本地 state：
 *   1. hover 时要同时做两件事 —— 画框本身开始上色 + 页面光标变化 +
 *      底部出现标题提示，这三处跨了 3D/DOM 边界；
 *   2. Module 5 的着色器需要知道「当前应该揭示到哪一幅」，
 *      也就是至少要有一个全局唯一的 hover 目标。
 */
const InteractionContext = createContext(null)

export function InteractionProvider({ children }) {
  const [hoveredId, setHoveredId] = useState(null)
  const [activeId, setActiveId] = useState(null)

  // 用一个 ref 镜像 activeId，给 useFrame 里的高频读取用。
  // （useFrame 每帧跑，直接读 state 会拿到闭包里的旧值，
  //   或者需要把 activeId 放进依赖数组导致 hook 反复重建。）
  const activeIdRef = useRef(null)

  const openArtwork = useCallback((id) => {
    setActiveId(id)
    activeIdRef.current = id
  }, [])

  const closeArtwork = useCallback(() => {
    setActiveId(null)
    activeIdRef.current = null
  }, [])

  const value = useMemo(
    () => ({
      hoveredId,
      setHoveredId,
      activeId,
      activeIdRef,
      isOpen: activeId !== null,
      openArtwork,
      closeArtwork,
    }),
    [hoveredId, activeId, openArtwork, closeArtwork],
  )

  return <InteractionContext.Provider value={value}>{children}</InteractionContext.Provider>
}

/** 读取交互状态。必须在 <InteractionProvider> 内使用。 */
export function useInteraction() {
  const ctx = useContext(InteractionContext)
  if (!ctx) {
    throw new Error('useInteraction 必须在 <InteractionProvider> 内部使用')
  }
  return ctx
}

export { InteractionContext }
