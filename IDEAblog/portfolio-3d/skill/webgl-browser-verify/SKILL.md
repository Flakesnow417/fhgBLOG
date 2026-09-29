---
name: webgl-browser-verify
description: 用零依赖的 Chrome DevTools Protocol 脚本，在真实浏览器里验证 WebGL / Three.js / React Three Fiber / Canvas 页面——拿真实像素、派发真实鼠标键盘事件、抓运行时异常。当"构建通过了但页面就是不对""3D 场景/着色器效果没法确认""hover 点击没反应""要证明改对了而不是我以为改对了""渲染出来和预期不一样"时使用。也覆盖"Vite build 全绿但运行时炸"这类构建检查抓不到的问题。
agent_created: true
---

# 真实浏览器验证 WebGL / 3D 页面

## 核心原则

**构建通过 ≠ 能跑。** 这一条是本技能存在的全部理由。以下三类问题**全都骗得过 `vite build`**，只在运行时暴露：

| 问题 | 构建表现 | 真实表现 |
|---|---|---|
| 模板字符串里出现反引号 | ✅ 绿 | 运行时 `ReferenceError` |
| `onBeforeCompile` 锚点没命中 | ✅ 绿 | 效果静默失效，页面照常渲染 |
| uniform 名拼错 / 类型不对 | ✅ 绿 | 效果静默失效或全黑 |

我踩过最典型的一个：GLSL 注入代码写在 JS 模板字符串里，注释中为了排版写了 `` `(1.0 - smoothstep(...))` `` —— 那对反引号**直接结束了模板字符串**，后面的 `smoothstep(...)` 变成 JS 在模块顶层求值，浏览器报 `ReferenceError: smoothstep is not defined`，报错栈指向 `onBeforeCompile`，看起来完全是"着色器 API 用错了"。**611 个模块全部编译通过，构建零警告。**

**所以：任何着色器 / 3D / 动画改动，必须跑真实浏览器拿真实像素。** 光看构建和 DEV 日志不算验证。

**不要装 puppeteer / playwright。** 几百 MB、常因代理下载失败。用本技能的 `scripts/cdp.mjs`：只用 Node 内置模块（`node:net` + `node:crypto` + `node:zlib`），自己实现 WebSocket 帧，200 行搞定。

## Step 0 · 先给页面加一个调试桥（最重要的一步）

**没有调试桥，你几乎无法定位 3D 场景里的东西。** 在应用里挂一个全局对象，暴露透视内部状态的只读接口：

```js
// src/components/DebugBridge.jsx —— 挂在 Canvas 内部
useEffect(() => {
  window.__DEBUG__ = {
    camera, scene, gl,
    stats: () => ({ meshes, triangles, drawCalls }),
    probe: () => [...],        // 每个 mesh 的关键信息
    paints: () => ({...}),     // 着色器材质的状态：编译/注入/进度
  }
  return () => { delete window.__DEBUG__ }
}, [camera, scene, gl])
```

**必须暴露的东西**（都是实测中救过场的）：

- `camera` —— 冻结相机、投影坐标到屏幕都要它
- `scene` —— 遍历找目标物体
- 材质状态：`userData` 里存**注入是否成功**（`injection: { tried, ok, missing }`）
- 一个**冻结/覆写 API**（比如 `reveal.freezeAll(v)`）—— 见下面"状态只能有一个写入者"

在 `launch()` 里用 `debugGlobal: '__DEBUG__'` 指定名字（本技能的默认值）。

## Step 1 · 跑冒烟测试确认工具可用

```bash
cd <skill>/scripts
node smoke-test.mjs        # 需要被测项目已在 5173 跑着
```

它会连浏览器、截图、解 PNG、hover、点击、按 Esc，11 项断言。**先让这个过，再写自己的断言**——工具本身坏了的话，后面所有结论都不可信。

换项目时改 `smoke-test.mjs` 里的三处：`URL_`、`debugGlobal`、`projectBox` 的谓词。

## Step 2 · 写针对性的验证脚本

```js
import { launch, checker, sat, sleep } from './cdp.mjs'

const b = await launch({ port: 9480, debugGlobal: '__DEBUG__' })
await b.goto('http://127.0.0.1:5173/')

const c = checker()
c.check(await b.evaluate('!!window.__DEBUG__'), '调试桥挂载')

const img = await b.shot('shot.png')               // 截图 + 解码
console.log('平均饱和', avgSat(img, 100, 100, 1100, 600))
c.check(avgSat(img, ...) < 40, '整体是低饱和素描质感')

b.finish()                                          // 打印异常 + 设退出码
```

`checker()` 的退出码：全过 0，有失败 2 —— **可以直接用于 CI / 循环判定**。

## Step 3 · 派发真实事件，不要用 JS 模拟

**React Three Fiber 的指针事件是靠 raycast 派发的**，只对 `Mesh` / `Line` / `Points` / `Sprite` 生效。

```js
// ❌ 不行：绕过真实事件管线，测不到 R3F 的 raycast
element.dispatchEvent(new MouseEvent('click', { clientX, clientY }))

// ✅ 正确：走 Chrome 的输入管线
await b.click(x, y)        // 内部 dispatchMouseEvent down/up
await b.hover(x, y, 900)   // move + 等待
```

**要测 hover 就必须真有 `mouseMoved`**，R3F 的 `onPointerOver` 不会因为元素"在鼠标下面"而自动触发。

### 坐标从哪来：用页面自己的投影

```js
// ✅ 让页面用它自己的 Vector3.project()，别自己在 Node 里算矩阵
const box = await b.projectBox(`(o) => o.material && o.material.userData && o.material.userData.paint`)
```

原因：相机可能被 GSAP 控着，你在 Node 里手算的矩阵和渲染那一帧用的往往不一致。

**写断言前先冻结相机**，否则漫游中的相机会把目标扫出视野，测试随机失败：

```js
await b.json(`(() => {
  window.__FREEZE_CAMERA__ = true;
  const cam = window.__DEBUG__.camera;
  cam.position.set(2, 2.15, 24);
  cam.rotation.order = 'YXZ'; cam.rotation.set(0, Math.PI/2, 0);
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  return { ok: true };
})()`)
```

## 坑清单（全是实测踩出来的）

### CDP / 序列化

- **`json()` 返回 `undefined`？** CDP 的 `Runtime.evaluate` 响应是 `{ result: { type, value } }`，而 `cdp.send()` 已经把最外层信封剥掉了。多读一层 `.result` 就永远拿到 `undefined`。本技能已修正，自己写时注意。
- **`Object reference chain is too long`** —— `returnByValue` 深序列化活对象图（THREE.Mesh 通过 `__reactFiber` 循环引用）。**解法：在页面内先 `JSON.stringify` 再传回字符串。**
- **THREE.Mesh 无法穿过 CDP 边界。** 所以 `projectBox` 的参数是**谓词**（`(o) => ...`，在页面内对每个 mesh 求值），而不是"返回对象的表达式"。只有纯数字（包围盒、坐标）能传回来。
- **`Runtime.exceptionThrown` 要在导航完成后才开始收集。** 否则 HMR 残留、扩展报错会污染判断，让你误以为"还有 bug"。`launch()` 里的 `collecting` 标志就是干这个的。

### 截图 / 像素

- **Chrome 截图的 PNG 是 colortype 2（RGB, bpp=3），不是 RGBA。** 按 `bpp=4` 解会 `IndexError`。正确做法：读 IHDR 的 colorType，映射 `{0:1, 2:3, 4:2, 6:4}`。
- **PNG 的 5 种行 filter 都要实现**（0 None / 1 Sub / 2 Up / 3 Average / 4 Paeth），只处理 None 会得到花屏。
- **别信"截图被裁小了"的直觉。** 有一次我以为是裁切 bug，其实是显示端缩放造成的错觉；写脚本量出来真的是 1248×697。
- **判定"有没有颜色"用饱和度**，不要用 RGB 阈值 —— 素描是低饱和的灰，上色后饱和会从 ~10 跳到 ~150，区分度极大。

### 无头 WebGL

- 必须带 `--use-angle=swiftshader --enable-unsafe-swiftshader`，否则**拿不到 WebGL context**。已封装在 `launch()` 里。
- 每个脚本 spawn 自己的 Chrome（独立 `--user-data-dir` + 独立端口）。**不要复用同一个调试端口跑多脚本**，会抢 target。

### 采样与断言设计

- **别只扫一行像素做断言。** 我第一版只扫画幅中线一行 + 硬阈值，把噪声边界和整幅泛色全判成"正常"。换成**全画幅统计**（彩色% / 中间调% / 灰度% + 平均饱和 + 边界位置 + 有边界的行数）才看见问题。
- **固定屏幕框会骗人**：物体在动画中"抬起"时，边缘像素进出采样框，覆盖率曲线就不单调了。用投影包围盒动态跟随。
- **测试脚本本身也会说谎。** 断言和实现一样要审。有两次"失败"最后查出来是断言写错了（比如要求"着色器全部编译"，但 three 只在首次绘制时编译程序，被视锥剔除的分段合法地没有程序）。
- **给"中间态"留容差**：`p=0.5` 时框内大部分已上色是正常的，别断言"必须有 50% 混合区"。

### 状态只能有一个写入者

**这是最难查的一类问题。** 如果 `useFrame` 每帧把 `progressRef → uniform` 写一遍，那么外部测试代码直接改 uniform **会在 16ms 内被覆盖**，表现为"我设了值但完全没反应"。

```js
// ❌ 测试直接改 uniform —— 下一帧就被 useFrame 覆盖
material.userData.paint.shader.uniforms.uPaintProgress.value = 0.5

// ✅ 通过所有者提供的冻结 API
window.__DEBUG__.reveal.freezeAll(0.5)
```

**实现侧要主动提供这个 API**（比如 hook 里加 `setFrozenProgress`，并在 `useFrame` 里优先响应冻结值）。**这不是测试的锅，是设计的锅** —— 遇到"设了值没反应"，先查有没有第二个写入者。

### 注册表要按实例 key，不能按业务 id

数据在多个实例间循环复用（比如 6 个作品映射到无限长廊的多个分段）时，用业务 id 做 Map 的 key 会**静默碰撞**：`Map.set(id, ...)` 只保留最后一个实例，操作会作用到错误的物体上。

```js
// ❌ 6 个作品铺满 12 个画框 → 同 id 多个实例，互相覆盖
registerReveal(artwork.id, controls)

// ✅ 模块级自增
let seq = 0
registerReveal(controls)   // key = `rev-${++seq}`
```

现象很迷惑："有的物体响应，有的不响应，而且是随机的一半"。

## 着色器专项

### 注入必须自检

`String.prototype.replace` 在**找不到锚点时直接返回原串**，不报错、不警告。所以注入后必须验证：

```js
shader.fragmentShader = shader.fragmentShader.replace(ANCHOR, injected)
const ok =
  shader.fragmentShader.includes('paintNoise') &&      // 我们的标识符出现了吗
  shader.fragmentShader.includes('paintThreshold')
material.userData.paint.injection = { tried: true, ok, missing }
if (!ok) console.error('[material] 注入失败，效果不会生效。未命中锚点：', missing)
```

**把 `injection` 挂到 `userData` 上**，调试桥才能读到（这个字段救过好几次场）。

### 用静态守卫拦住"反引号截断模板字符串"

本技能带 `scripts/check-backticks.mjs`，一个带状态的扫描器（区分 template literal / `//` / `/* */`），检查模板字符串关闭后紧跟的 JS 里有没有裸 GLSL 调用。

```bash
node check-backticks.mjs <file.js>
```

**改完任何注入型着色器都跑一遍。** 它已用"故意重新注入 bug"的方式反证过能抓到（报错精确到行号）。

**根本预防：注入的 GLSL 片段里绝对不要出现反引号，注释里也别写。**

### `customProgramCacheKey` 必须编码注入参数

three 默认的 key 看不到你注入的代码差异。不同物体注入不同常量却共用同一个程序 → 一半物体表现错误，现象是"有的正常有的不正常"。

```js
material.customProgramCacheKey = () =>
  `paintReveal|${dirX}|${dirY}|${dirZ}|${noiseScale1}|${span}`
```

### uniform 更新 vs `needsUpdate`

```js
// ✅ 逐帧：直接改 value，只是一次内存写入
shader.uniforms.uProgress.value = p

// ❌ 绝不要逐帧设这个：触发完整程序重编译，毫秒级卡顿
material.needsUpdate = true
```

## 用数量级代替估算

**"我觉得这个参数差不多"几乎总是错的。**

实测案例：一个揭示动画的扫描跨度，我先后估过 1.34、1.6、2.6，全错。写了个脚本量出物体沿揭示方向的**实际投影范围**只有 0.671，正确答案是 1.9。

```js
// 量出真实几何量，而不是猜
const info = await b.json(`(() => {
  const cam = window.__DEBUG__.camera;
  const V3 = cam.position.constructor;
  // ... 把 4 个角投影到揭示方向，取 min/max
})()`)
```

**先量，再改。** 量出来的数还能反过来暴露"我原来的理解错在哪"（那次就发现揭示方向主要沿 Z，物体的 X 跨度几乎不投影上去）。

## 视觉确认不能省

数字全绿不等于"看起来对"。本技能带 `scripts/crop-magnify.mjs`：

```bash
node crop-magnify.mjs shot.png 557 301 691 396 3
```

它做三件事：
1. 裁剪指定区域并 **3x 最近邻放大**成 PNG（自己手写 PNG 编码器，零依赖）
2. 打印 **ASCII 饱和度图** —— 在终端里就能看出形状，不用开图片
3. 输出可读的 PNG，可以直接用 Read 工具查看

**关键技巧：把"起点"和"终点"截图并排看。** 我用它确认了 p=0 是纯铅笔线框、p=1 是暖琥珀上色且铅笔轮廓仍在上层、p=0.5 边界正穿过画面——这三张图比任何断言都有说服力。

## 交付形态建议

- 每个模块/改动配一个 `mNverify.mjs`，退出码 0/2
- 回归：改完 X 模块，**重跑 Y 模块的脚本**（我就靠这个确认了着色器改动没影响交互）
- 脚本放项目外的 `.ref/` 目录，别混进 `src/`
- 收尾清理 `rm -rf .chrome-*`（每个端口一个 profile 目录，会攒很多）
