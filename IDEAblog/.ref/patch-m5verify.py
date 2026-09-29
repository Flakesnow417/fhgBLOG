import io

p = 'E:/fhgBLOG/IDEAblog/.ref/m5verify.mjs'
s = io.open(p, encoding='utf-8').read()

# 1) 修复逐档采样：改用 reveal.freezeAll 而不是直接改 uniform
old_step = """const steps = [0, 0.25, 0.5, 0.75, 1]
const stepData = []
for (const v of steps) {
  await cdp.json(`(() => {
    const d = window.__PORTFOLIO_DEBUG__;
    let n = 0;
    d.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const p = m && m.userData && m.userData.paint;
      if (!p) return;
      p.progress = ${v};
      if (p.shader) p.shader.uniforms.uPaintProgress.value = ${v};
      n++;
    });
    return { touched: n };
  })()`)
  // 强制同步渲染一帧并等 GPU 画完
  await cdp.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  await sleep(220)"""

new_step = """// 先登记一下注册表里有多少可控画框
const regInfo = await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  return { size: d.reveal.size(), ids: d.reveal.ids() };
})()`)
console.log('\\n=== 2b. 揭示控制注册表 ===')
console.log(JSON.stringify(regInfo))
report.registry = regInfo

const steps = [0, 0.25, 0.5, 0.75, 1]
const stepData = []
for (const v of steps) {
  // 必须走 reveal.freezeAll：直接改 uniform / p.progress 会被 useFrame
  // 每帧覆盖（这是"状态只有一个写入者"的正常表现，不是 bug）
  const frozen = await cdp.json(`(() => {
    const d = window.__PORTFOLIO_DEBUG__;
    const n = d.reveal.freezeAll(${v});
    return { frozen: n };
  })()`)
  if (v === 0) console.log('  freezeAll 命中数量 =', frozen.frozen)
  // 等两帧 + 一点余量，让 GPU 真的把这一帧画完（swiftshader 是软件光栅，慢）
  await cdp.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  await sleep(400)"""

assert old_step in s, 'step anchor missing'
s = s.replace(old_step, new_step)

# 2) 恢复阶段也改用 freezeAll(null)
old_restore = """await cdp.json(`(() => {
  const d = window.__PORTFOLIO_DEBUG__;
  d.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const p = m && m.userData && m.userData.paint;
    if (!p) return;
    p.progress = 0;
    if (p.shader) p.shader.uniforms.uPaintProgress.value = 0;
  });
  return { ok: true };
})()`)
await sleep(400)"""

new_restore = """await cdp.json(`(() => {
  window.__PORTFOLIO_DEBUG__.reveal.freezeAll(null);
  return { ok: true };
})()`)
await sleep(600)"""

assert old_restore in s, 'restore anchor missing'
s = s.replace(old_restore, new_restore)

# 3) 修正"全部编译"这条断言：three 只在首次绘制时才编译程序，
#    被视锥剔除/未绘制的分段没有程序是正常的。
old_check = """const checks = [
  ['着色器全部编译', paints.compiledCount === paints.count && paints.count > 0],
  ['注入全部命中锚点', paints.injectionOkCount === paints.count && paints.count > 0],"""
new_check = """const checks = [
  // three 只在"首次被绘制"时才编译 shader 程序。长廊里被相机背后
  // 或视锥外的分段不会有程序，这是正常的，所以判据是：
  // 已编译的数量 > 0 且每一个已编译的注入都成功。
  ['着色器已编译（>0 且全部注入成功）', paints.compiledCount > 0 && paints.injectionOkCount === paints.compiledCount],
  ['注入没有任何锚点未命中', paints.samples.every((s) => s.injectionMissing.length === 0)],"""
assert old_check in s, 'check anchor missing'
s = s.replace(old_check, new_check)

io.open(p, 'w', encoding='utf-8').write(s)
print('patched m5verify')
