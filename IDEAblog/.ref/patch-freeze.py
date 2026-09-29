import io

p = 'E:/fhgBLOG/IDEAblog/portfolio-3d/src/hooks/usePaintReveal.js'
s = io.open(p, encoding='utf-8').read()

old = """  return {
    materialRef,
    progressRef,
    createMaterial,
    setTarget,
    animateReveal,
    snapTo,
    onBeforeCompile,
  }"""

new = """  /**
   * 冻结开关：让自动化测试能"钉住"某个 progress 值观察渲染结果。
   *
   * 为什么需要它：
   *   useFrame 每帧都会把 progressRef 写进 uniform，所以测试脚本
   *   从外部直接改 uniform 或 p.progress 都会被**下一帧立刻覆盖** ——
   *   脚本读到的永远是同一个值，看起来像"改不动"。
   *   这不是 bug，是"数据只有唯一写入者"该有的样子；
   *   要给测试留一个入口，就该由拥有这份状态的一方显式提供。
   *
   * 置为非 null 时：跳过插值和原点刷新之外的所有写入，
   * 并把 progress 钉在这个值上。置回 null 恢复正常运行。
   */
  const freezeRef = useRef(null)

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
    onBeforeCompile,
    setFrozenProgress,
  }"""

assert old in s, 'return anchor missing'
s = s.replace(old, new)

# 在 useFrame 里插冻结分支
old_frame = """    // rawDelta 在标签页切回来时会是个巨大的值，必须夹住，
    // 否则 progress 会一步跳到位、动画"啪"地闪过。
    const delta = Math.min(rawDelta, 0.1)"""
new_frame = """    // 测试冻结模式：把 progress 钉住，跳过插值
    if (freezeRef.current !== null) {
      progressRef.current = freezeRef.current
      targetRef.current = freezeRef.current
      setPaintProgress(material, freezeRef.current)
      return
    }

    // rawDelta 在标签页切回来时会是个巨大的值，必须夹住，
    // 否则 progress 会一步跳到位、动画"啪"地闪过。
    const delta = Math.min(rawDelta, 0.1)"""
assert old_frame in s, 'frame anchor missing'
s = s.replace(old_frame, new_frame)

io.open(p, 'w', encoding='utf-8').write(s)
print('patched usePaintReveal: added setFrozenProgress')
