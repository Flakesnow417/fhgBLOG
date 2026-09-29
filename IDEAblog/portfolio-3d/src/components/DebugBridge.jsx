import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { freezeAllReveals, freezeReveal, revealRegistryIds, revealRegistrySize } from '../utils/revealRegistry'

/**
 * 调试桥
 * ------------------------------------------------------------------
 * 把关键内部状态挂到 window.__PORTFOLIO_DEBUG__，供自动化脚本读取。
 *
 * 为什么需要它：
 *   R3F 的内部 store 挂在 canvas 元素的 __r3f 属性上，但版本间结构会变
 *   （v9 起层级调整过），从外部 traverse 拿不到稳定引用 ——
 *   实测 `canvas.__r3f` 在 v9.8.1 里是 undefined，`canvas.parentElement`
 *   上也没有。与其依赖内部结构，不如在自己代码里显式暴露。
 *
 * 暴露的内容分三类：
 *   stats()  —— 场景统计（物体数、灯数、相机位姿），给人看的概览；
 *   probe()  —— 逐 mesh 明细（几何尺寸、世界坐标、材质、指针事件），
 *               给自动化脚本做断言用。Module 4 调试 hover 失效时就是
 *               靠它发现"所有 mesh 的 __r3f.handlers 都是空数组"，
 *               从而定位到"事件被写在了材质上"这个错误。
 *   paints() —— Module 5 的着色器揭示状态（每块画作的 progress /
 *               是否已编译 / 着色器是否真的拿到了注入后的代码）。
 *               这个是本次新增：着色器编译失败**不会抛异常**，
 *               只会让材质渲染成黑色或原样，所以必须有个办法
 *               从外部读"程序到底编出来没有、uniform 有没有生效"。
 *
 * 生产环境不产生任何副作用：只是一次浅赋值。
 */
export default function DebugBridge() {
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const events = useThree((s) => s.events)
  const size = useThree((s) => s.size)

  useEffect(() => {
    const dbg = {
      camera,
      scene,
      gl,

      /** 场景统计：一眼看出有多少物体、多少灯 */
      stats() {
        let meshes = 0
        let visibleMeshes = 0
        let lights = 0
        const groups = []
        scene.traverse((o) => {
          if (o.isMesh) {
            meshes++
            let v = true
            let q = o
            while (q) {
              if (!q.visible) {
                v = false
                break
              }
              q = q.parent
            }
            if (v) visibleMeshes++
          }
          if (o.isLight) lights++
          if (o.isGroup && o.children.length > 0) {
            groups.push({
              visible: o.visible,
              pos: [o.position.x, o.position.y, o.position.z].map((n) => +n.toFixed(2)),
              children: o.children.length,
            })
          }
        })
        return {
          meshes,
          visibleMeshes,
          lights,
          fog: scene.fog ? { near: scene.fog.near, far: scene.fog.far } : null,
          camera: {
            pos: [camera.position.x, camera.position.y, camera.position.z].map((n) => +n.toFixed(2)),
            rot: [camera.rotation.x, camera.rotation.y, camera.rotation.z].map((n) => +n.toFixed(3)),
          },
          groups: groups.slice(0, 24),
        }
      },

      /**
       * 逐个 mesh 的明细。
       * 重点字段：
       *   handlers  —— R3F 为这个对象注册了哪些指针事件。
       *                空数组 = 这个对象不可交互。
       *   eventCount —— R3F 内部的事件计数器，>0 说明参与事件分发。
       */
      probe() {
        const meshes = []
        scene.traverse((o) => {
          if (!o.isMesh) return
          const m = Array.isArray(o.material) ? o.material[0] : o.material
          const p = o.geometry?.parameters || {}
          const e = o.matrixWorld.elements
          const r3f = o.__r3f || {}
          meshes.push({
            geo: o.geometry?.type,
            w: p.width != null ? +p.width.toFixed(3) : null,
            h: p.height != null ? +p.height.toFixed(3) : null,
            pos: [+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)],
            visible: o.visible,
            mat: m?.type,
            opacity: m?.opacity,
            colorWrite: m?.colorWrite,
            hasMap: !!m?.map,
            hasPaint: !!m?.userData?.paint,
            handlers: Object.keys(r3f.handlers || {}),
            eventCount: r3f.eventCount ?? null,
          })
        })

        const withHandlers = meshes.filter((r) => r.handlers.length > 0)

        return {
          meshCount: meshes.length,
          visibleCount: meshes.filter((r) => r.visible).length,
          withHandlers: withHandlers.length,
          interactive: withHandlers.slice(0, 8),
          meshes,
          size: { width: size.width, height: size.height },
          hitTargets: meshes.filter((r) => r.opacity === 0 && r.colorWrite === false && !r.hasMap).length,
        }
      },

      /**
       * Module 5：着色器揭示状态。
       * 逐块画作报告：
       *   progress      —— 当前揭示进度（0 素描，1 彩色）
       *   compiled      —— onBeforeCompile 是否已经跑过（拿到 shader 引用）
       *   hasPainted    —— uniform 里的彩色贴图是否就位
       *   uniformValues —— 从 shader.uniforms 里读回的关键值。
       *                    **这是判断"注入是否真的生效"最直接的证据**：
       *                    如果 shader.uniforms.uPaintProgress 不存在，
       *                    说明替换锚点没命中，注入静默失败了。
       *   injected      —— 编译后的片元代码里是否含我们注入的函数名。
       *                    three 会把 program 存在 material 上
       *                    （`material.__webglShader` / program 的 cacheKey），
       *                    这里退一步：直接查 __r3f 之外我们能拿到的
       *                    `material.userData.paint.verified`（由材质自己标记）。
       */
      paints() {
        const list = []
        scene.traverse((o) => {
          if (!o.isMesh) return
          const m = Array.isArray(o.material) ? o.material[0] : o.material
          const p = m?.userData?.paint
          if (!p) return
          const e = o.matrixWorld.elements
          const u = p.shader?.uniforms
          list.push({
            pos: [+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)],
            progress: +p.progress.toFixed(4),
            compiled: !!p.shader,
            hasPainted: !!p.paintedMap,
            hasSketch: !!p.sketchMap,
            uniformProgress: u?.uPaintProgress ? +u.uPaintProgress.value.toFixed(4) : null,
            uniformPaintedTex: u?.uMapPainted ? (u.uMapPainted.value ? 'tex' : 'null') : null,
            uniformOrigin: u?.uPaintOrigin
              ? [u.uPaintOrigin.value.x, u.uPaintOrigin.value.y, u.uPaintOrigin.value.z].map((n) => +n.toFixed(2))
              : null,
            uniformDir: u?.uPaintDir
              ? [u.uPaintDir.value.x, u.uPaintDir.value.y, u.uPaintDir.value.z].map((n) => +n.toFixed(3))
              : null,
            hasNoiseFn: !!(p.shader?.fragmentShader || '').includes('paintNoise'),
            hasMapFragmentInject: !!(p.shader?.fragmentShader || '').includes('paintThreshold'),
            // 注入自检结果（由材质自己在 onBeforeCompile 里写）
            injectionTried: !!(p.injection && p.injection.tried),
            injectionOk: !!(p.injection && p.injection.ok),
            injectionMissing: (p.injection && p.injection.missing) || [],
            revealSpan: p.revealSpan,
            programKey: m.customProgramCacheKey ? m.customProgramCacheKey() : null,
          })
        })
        return {
          count: list.length,
          compiledCount: list.filter((r) => r.compiled).length,
          injectedCount: list.filter((r) => r.hasMapFragmentInject).length,
          injectionOkCount: list.filter((r) => r.injectionOk).length,
          maxProgress: list.reduce((a, r) => Math.max(a, r.progress), 0),
          samples: list.slice(0, 6),
        }
      },

      /**
       * Module 5 测试用：把揭示进度钉住。
       *
       * 为什么不能直接在测试里改 uniform —— 见 usePaintReveal 里
       * freezeRef 的注释：useFrame 每帧覆盖，外部写入无效。
       * 所以这里转发给 hook 提供的冻结入口。
       *
       *   freezeReveal(id, v)  —— 单幅
       *   freezeAllReveals(v)  —— 全部
       *   传 null 恢复
       */
      reveal: {
        // 键是实例唯一的（rev-1 / rev-2 ...），不是 artwork.id ——
        // 因为长廊内容循环映射，多个画框会共享同一个 artwork.id。
        size: () => revealRegistrySize(),
        ids: () => revealRegistryIds(),
        freeze: (key, value) => freezeReveal(key, value),
        freezeAll: (value) => freezeAllReveals(value),
      },

      /** R3F 的事件系统概览（connected=false 通常意味着 canvas 还没挂上） */
      events() {
        return {
          hasEvents: !!events,
          connected: events?.connected ?? null,
          handlerObjects: events?.handlers?.size ?? null,
        }
      },
    }
    window.__PORTFOLIO_DEBUG__ = dbg
    return () => {
      delete window.__PORTFOLIO_DEBUG__
    }
  }, [camera, scene, gl, events, size])

  return null
}
