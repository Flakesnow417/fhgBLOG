/**
 * 揭示控制注册表
 * ==================================================================
 * 自动化测试需要从页面外部"钉住"某幅画的揭示进度来观察渲染结果。
 *
 * 为什么不直接在测试脚本里改 uniform：
 *   `usePaintReveal` 的 useFrame 每帧都会把 progressRef 写进 uniform，
 *   外部写入会在 16ms 内被覆盖，脚本读到的永远是同一个值 ——
 *   看起来像"改不动"，实际是"状态只有一个写入者"。
 *   所以正确做法是由拥有状态的一方（hook）显式提供冻结入口，
 *   再由组件在这里登记，最后通过 DebugBridge 暴露给测试。
 *
 * ------------------------------------------------------------------
 * ⚠️ 踩过的坑：不能用 artwork.id 当键
 * ------------------------------------------------------------------
 * 第一版用 `registerReveal(artwork.id, ...)`，结果 freezeAll 只影响
 * 一部分画框，而"被影响的那部分"恰好全是**没被渲染过**的。
 *
 * 原因：长廊的内容是**循环映射**的（`getArtworkFor` 用取模把 6 幅画
 * 铺到无限多段上），所以同一时刻场景里会存在多个 PictureFrame
 * 共享同一个 `artwork.id`。`Map.set(id, ...)` 会互相覆盖，
 * 注册表里每个 id 只剩最后一个挂载的实例；freezeAll 遍历注册表，
 * 自然只能碰到"每个 id 各一个"，其余实例完全收不到指令。
 *
 * 这个 bug 特别隐蔽：注册表 `size` 看起来是对的（6），
 * `freezeAll` 的返回值也是对的（6），但真正想冻结的那一幅
 * 就是不在里面 —— 因为它是同 id 的另一个实例。
 *
 * ⇒ 键必须是**实例唯一**的。这里用一个自增计数器。
 *   为什么不用 `Math.random()`：随机值在日志里无法对应到具体实例，
 *   排查时看不出"我冻的是哪一个"。
 *   为什么不用 index：段会随相机移动增删，index 不稳定。
 */
let seq = 0

const registry = new Map()

/**
 * 由 PictureFrame 在挂载时登记，卸载时注销。
 * @returns {() => void} 注销函数
 */
export function registerReveal(controls) {
  const key = `rev-${++seq}`
  registry.set(key, controls)
  return () => {
    registry.delete(key)
  }
}

/** 冻结某幅画的揭示进度。value 传 0~1，传 null 恢复。 */
export function freezeReveal(key, value) {
  const c = registry.get(key)
  if (!c) return false
  c.setFrozenProgress(value)
  return true
}

/** 冻结**所有**已登记的画框（测试里用来一次性摆好整条长廊的状态）。 */
export function freezeAllReveals(value) {
  let n = 0
  for (const c of registry.values()) {
    c.setFrozenProgress(value)
    n++
  }
  return n
}

/** 当前已登记的数量（调试用）。 */
export function revealRegistrySize() {
  return registry.size
}

/** 列出已登记的键（调试用）。实例唯一，所以能对应到具体画框。 */
export function revealRegistryIds() {
  return [...registry.keys()]
}
