import io

p = 'E:/fhgBLOG/IDEAblog/portfolio-3d/src/components/DebugBridge.jsx'
s = io.open(p, encoding='utf-8').read()

old = """            hasNoiseFn: !!(p.shader?.fragmentShader || '').includes('paintNoise'),
            hasMapFragmentInject: !!(p.shader?.fragmentShader || '').includes('paintThreshold'),
            programKey: m.customProgramCacheKey ? m.customProgramCacheKey() : null,"""

new = """            hasNoiseFn: !!(p.shader?.fragmentShader || '').includes('paintNoise'),
            hasMapFragmentInject: !!(p.shader?.fragmentShader || '').includes('paintThreshold'),
            // 注入自检结果（由材质自己在 onBeforeCompile 里写）
            injectionTried: !!(p.injection && p.injection.tried),
            injectionOk: !!(p.injection && p.injection.ok),
            injectionMissing: (p.injection && p.injection.missing) || [],
            revealSpan: p.revealSpan,
            programKey: m.customProgramCacheKey ? m.customProgramCacheKey() : null,"""

assert old in s, 'paints anchor missing'
s = s.replace(old, new)

old2 = """        return {
          count: list.length,
          compiledCount: list.filter((r) => r.compiled).length,
          injectedCount: list.filter((r) => r.hasMapFragmentInject).length,
          samples: list.slice(0, 6),
        }"""

new2 = """        return {
          count: list.length,
          compiledCount: list.filter((r) => r.compiled).length,
          injectedCount: list.filter((r) => r.hasMapFragmentInject).length,
          injectionOkCount: list.filter((r) => r.injectionOk).length,
          maxProgress: list.reduce((a, r) => Math.max(a, r.progress), 0),
          samples: list.slice(0, 6),
        }"""

assert old2 in s, 'return anchor missing'
s = s.replace(old2, new2)

io.open(p, 'w', encoding='utf-8').write(s)
print('patched DebugBridge')
