import * as THREE from 'three'

/**
 * ============================================================================
 *  paintRevealMaterial —— 素描 → 彩色 的"画笔揭示"材质
 * ============================================================================
 *
 * 做什么
 * ------
 * 给一张画框平面同时挂两张贴图：
 *   - sketchMap  ：铅笔素描（黑白），常规状态下显示的就是它
 *   - paintedMap ：上色后的版本，只在"已经刷过"的区域显示
 *
 * 用 uPaintProgress（0 → 1）控制一条**带噪声毛边的分界线**扫过画面：
 * progress = 0 全是素描，progress = 1 全是彩色，中间态是一半素描一半彩色，
 * 交界处有一条暖色"湿边"。边界不是直线——用两层值噪声（低频大轮廓 +
 * 高频毛刺）偏移阈值，所以看起来像笔刷/颜料漫过去，而不是 CSS 蒙版。
 *
 * 参考项目的实现方式：不写自定义 ShaderMaterial，而是在 three 内置的
 * MeshBasicMaterial 上做 onBeforeCompile 注入，这样能白拿 three 的
 * 光照/贴图/颜色空间处理，只往管线里塞自己要的代码，其余照旧：
 *   - 顶点阶段：在 #include <worldpos_vertex> 之后拿到世界坐标
 *   - 片元阶段：在 #include <common> 之后放噪声函数
 *   - 片元阶段：在 #include <map_fragment> 之后做素描/彩色的选择
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 两个必须知道的坑（都真实踩过）
 * ---------------------------------------------------------------------------
 *
 * 【坑 1】String.prototype.replace 在找不到目标字符串时**直接返回原串**，
 * 不报错、不警告。也就是说如果我写的锚点名（比如 #include <map_fragment>）
 * 在这个版本的 three 里拼错或不存在，注入会**静默失效**：
 * 页面照常渲染，只是永远不上色，极难排查。
 * 所以本文件做了自检：
 *   1. 检查注入后的代码里是否出现了我们的标识符（paintNoise /
 *      paintThreshold）；
 *   2. 把结果写进 userData.paint.injection，供调试桥读取；
 *   3. 若锚点未命中，打一条 console.error。
 *
 * 【坑 2】（本次新增，坑得很隐蔽）
 * 注入用的 GLSL 是写在 JS **模板字符串**里的。模板字符串里出现反引号
 * 会**直接结束字符串**！我在 GLSL 注释里为了排版写了一句
 *     // 第一版写成 `(1.0 - smoothstep(...))`
 * 那对反引号把模板字符串提前截断了，后面的 smoothstep(...) 变成了
 * **JavaScript 代码**在模块顶层求值 —— 于是浏览器报
 *     ReferenceError: smoothstep is not defined
 * 而且报错栈指向 onBeforeCompile（因为模板字符串的求值延迟到调用时），
 * 看起来像是"着色器 API 用错了"，其实是字符串语法错误。
 * 教训：**注入的 GLSL 片段里绝对不要出现反引号**，注释里也别写。
 * 需要引用代码时写成「」或去掉反引号。
 *
 * ---------------------------------------------------------------------------
 * 另一个关键点：uniform 必须挂到 material.userData
 * ---------------------------------------------------------------------------
 * onBeforeCompile 里新建的 uniform（shader.uniforms.uMapPainted）是挂在
 * shader 对象上的，材质本身没有这个字段。three 在材质重建时会重新
 * 拿材质的 uniforms 去覆盖，所以只塞进 shader.uniforms 的话，
 * 材质重建后贴图就会丢。
 * 因此把两张贴图**同时**挂在材质实例的 userData.paint 上作为唯一事实来源。
 */

/** 用于检查注入是否命中；改锚点时必须同步改这里。 */
const ANCHORS = {
  vertexCommon: '#include <common>',
  vertexWorldPos: '#include <worldpos_vertex>',
  fragCommon: '#include <common>',
  fragMap: '#include <map_fragment>',
}

/**
 * 创建揭示材质
 * @param {object} opts
 * @param {THREE.Texture} opts.sketchMap   素描贴图（作为基础 map）
 * @param {THREE.Texture} opts.paintedMap  彩色贴图
 * @param {number} [opts.dirX=1]           揭示方向（世界空间），会归一化
 * @param {number} [opts.dirY=0]
 * @param {number} [opts.dirZ=0.5]
 * @param {number} [opts.noiseScale1=3.2]  低频噪声频率（大块轮廓）
 * @param {number} [opts.noiseScale2=11]   高频噪声频率（毛刺）
 * @param {number} [opts.noiseAmp1=0.62]   低频噪声振幅
 * @param {number} [opts.noiseAmp2=0.22]   高频噪声振幅
 * @param {number} [opts.edgeWidth=0.5]    湿边带宽（世界单位）
 * @param {number} [opts.revealSpan=1.9]   边界从 -span 扫到 +span
 */
export function createPaintRevealMaterial({
  sketchMap,
  paintedMap,
  dirX = 1,
  dirY = 0,
  dirZ = 0.5,
  noiseScale1 = 3.2,
  noiseScale2 = 11.0,
  noiseAmp1 = 0.62,
  noiseAmp2 = 0.22,
  edgeWidth = 0.5,
  revealSpan = 1.9,
} = {}) {
  const material = new THREE.MeshBasicMaterial({
    map: sketchMap,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })

  // 唯一事实来源：所有实例状态都挂在材质上
  material.userData.paint = {
    sketchMap: sketchMap || null,
    paintedMap: paintedMap || null,
    progress: 0,
    origin: new THREE.Vector3(),
    noiseScale1,
    noiseScale2,
    noiseAmp1,
    noiseAmp2,
    edgeWidth,
    revealSpan,
    shader: null,
    injection: { tried: false, ok: false, missing: [] },
  }

  /**
   * three 用这个 key 判断"这个材质的 shader 程序能不能复用"。
   * 默认实现只看材质类型与一些特征位，**看不到我们注入的代码差异**。
   * 如果不同画框的揭示方向不同却共用了同一个程序，
   * 就会有一半画框沿错误方向上色 —— 而且现象很迷惑（"有的画正常有的不正常"）。
   * 把注入参数编进 key 就彻底避免了。
   */
  material.customProgramCacheKey = () =>
    `paintReveal|${dirX.toFixed(2)}|${dirY.toFixed(2)}|${dirZ.toFixed(2)}|` +
    `${noiseScale1}|${noiseScale2}|${noiseAmp1}|${noiseAmp2}|${edgeWidth}|${revealSpan}`

  material.onBeforeCompile = (shader) => {
    const p = material.userData.paint
    const missing = []

    shader.uniforms.uPaintProgress = { value: p.progress }
    shader.uniforms.uPaintOrigin = { value: p.origin }
    shader.uniforms.uMapPainted = { value: p.paintedMap }
    shader.uniforms.uPaintAmp1 = { value: p.noiseAmp1 }
    shader.uniforms.uPaintAmp2 = { value: p.noiseAmp2 }
    shader.uniforms.uPaintEdge = { value: p.edgeWidth }
    shader.uniforms.uPaintScale1 = { value: p.noiseScale1 }
    shader.uniforms.uPaintScale2 = { value: p.noiseScale2 }
    shader.uniforms.uPaintSpan = { value: p.revealSpan }
    shader.uniforms.uPaintDir = { value: new THREE.Vector3(dirX, dirY, dirZ).normalize() }

    // 保留引用：逐帧更新直接改 shader.uniforms.x.value，
    // 绝不能设 material.needsUpdate（那会重编译整个程序，毫秒级卡顿）。
    p.shader = shader

    /* ---------------- 顶点阶段 ---------------- */
    const vc = shader.vertexShader
    shader.vertexShader = shader.vertexShader
      .replace(
        ANCHORS.vertexCommon,
        `#include <common>
         varying vec3 vPaintWorldPos;`,
      )
      .replace(
        ANCHORS.vertexWorldPos,
        `#include <worldpos_vertex>
         vPaintWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`,
      )
    if (shader.vertexShader === vc) missing.push('vertex:common|worldpos')

    /* ---------------- 片元阶段 ---------------- */
    const fc = shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader
      .replace(
        ANCHORS.fragCommon,
        `#include <common>
         uniform float uPaintProgress;
         uniform vec3  uPaintOrigin;
         uniform vec3  uPaintDir;
         uniform sampler2D uMapPainted;
         uniform float uPaintAmp1;
         uniform float uPaintAmp2;
         uniform float uPaintEdge;
         uniform float uPaintScale1;
         uniform float uPaintScale2;
         uniform float uPaintSpan;
         varying vec3  vPaintWorldPos;

         // 一维哈希：sin 点乘 + 大数取小数。便宜，够用。
         float paintHash(vec2 p) {
           return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
         }

         // 二维值噪声：四角哈希 + 双线性插值 + smoothstep 缓动。
         // 用值噪声而不是纯 hash：纯 hash 是白噪声，边界会像电视雪花；
         // 值噪声在空间上连续，边界才像"颜料漫过去"。
         float paintNoise(vec2 x) {
           vec2 i = floor(x);
           vec2 f = fract(x);
           float a = paintHash(i);
           float b = paintHash(i + vec2(1.0, 0.0));
           float c = paintHash(i + vec2(0.0, 1.0));
           float d = paintHash(i + vec2(1.0, 1.0));
           vec2 u = f * f * (3.0 - 2.0 * f);
           return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
         }`,
      )
      .replace(
        ANCHORS.fragMap,
        `#include <map_fragment>

         // --- 相对画框原点的局部坐标 ---
         // 必须减原点：长廊靠后的分段世界坐标是几百，
         // 直接拿绝对坐标做噪声/阈值，远处画框永远越不过阈值，
         // 揭示会"时灵时不灵"（参考项目注释里明确记录过这个坑）。
         vec3 paintLocal = vPaintWorldPos - uPaintOrigin;

         // 揭示方向上的投影距离。progress 0→1 时把边界从
         // -span 推到 +span，正好扫过整幅画。
         float paintDist = dot(paintLocal, uPaintDir);

         // 两层噪声调制边界：低频给大块轮廓，高频给毛刺。
         // 单层低频太"圆滑"像蒙版，单层高频太碎像噪点。
         //
         // 注意：噪声的采样坐标用 (y, z) 而不是 (x, y)。
         //   左墙的画框 rotation.y = +pi/2，它的局部 X 轴指向世界的 -Z，
         //   右墙相反。如果用局部 xy 采样，两面墙的噪声图案会沿不同
         //   世界轴延展，同一段走廊上左右两侧的画会出现"笔触方向不一致"。
         //   改用 (y, z) —— 这两轴对左右墙是共通的，笔触就统一了。
         float paintN = paintNoise(paintLocal.yz * uPaintScale1) * uPaintAmp1
                      + paintNoise(paintLocal.yz * uPaintScale2) * uPaintAmp2;

         // progress 映射到阈值：0 时阈值很小（几乎全素描），
         // 1 时阈值很大（全彩色）。span 决定"刷"过去的速度感。
         float paintThreshold = mix(-uPaintSpan, uPaintSpan, uPaintProgress) + paintN;

         // 到边界的**有符号**距离：> 0 表示还没被涂到，< 0 表示已涂到。
         float paintToEdge = paintDist - paintThreshold;

         if (paintToEdge < 0.0) {
           // --- 已涂到：换成彩色贴图 ---
           vec4 paintedColor = texture2D(uMapPainted, vMapUv);
           // alpha 取两者较小值：贴图各自的透明区域都要尊重
           diffuseColor = vec4(paintedColor.rgb, diffuseColor.a * paintedColor.a);
         } else if (uPaintProgress > 0.002 && uPaintProgress < 0.998) {
           // --- 未涂到、且正在揭示中：沿边界描一道暖色，模拟湿颜料 ---
           //
           // 这里踩过一次坑，务必看清"带状"和"整体"的区别：
           //   第一版写成 (1.0 - smoothstep(0.0, uPaintEdge, paintToEdge))，
           //   本意是"离边界越近越亮"。但边界在**画面另一侧**时，
           //   paintToEdge 对全画面都是一个中等正值，smoothstep 给不出 0，
           //   于是整幅画被均匀蒙上一层暖色 ——
           //   实测 progress=0.1 时 82% 的像素被判定为"中间调"，
           //   那就是这层雾，而不是湿边。
           //
           //   正确的带状写法是"带通"：内侧在边界处为 1 并向画面内侧
           //   衰减到 0，这样离边界远的地方严格为 0。
           //   smoothstep(edge0, edge1, x) 在 edge0 > edge1 时会反向，
           //   于是下面这行得到"从边界往内逐渐变弱"的一道光。
           //
           //   但只做"往内衰减"还不够 —— 第二次实测发现：
           //   边界还在画面外很远处时，paintToEdge 对全画面都是大正数，
           //   smoothstep 本应给 0，可噪声会在局部把它压低，
           //   于是渗出淡淡的暖色却没有可见边界：
           //   progress=0.20 时中间调 5.1%、平均饱和 8.9→18.3，
           //   而"有边界的行数 = 0"。
           //   所以要做成真正的双侧带通：边界离画面超过约 4 倍湿边宽度
           //   就严格归零（edgeOutside 负责这一侧）。
           float edgeInside = smoothstep(uPaintEdge, 0.0, paintToEdge);
           float edgeOutside = smoothstep(uPaintEdge * 4.0, 0.0, -paintToEdge);
           float edgeBand = edgeInside * (1.0 - edgeOutside);
           // 揭示刚开始/快结束时整体淡出，避免端点突变
           float revealEnvelope = 1.0 - abs(uPaintProgress * 2.0 - 1.0);
           float wet = edgeBand * revealEnvelope;
           diffuseColor.rgb += vec3(0.10, 0.07, 0.03) * wet;
         }`,
      )
    if (shader.fragmentShader === fc) missing.push('fragment:common|map_fragment')

    /* ---------------- 注入自检 ---------------- */
    const ok =
      shader.fragmentShader.includes('paintNoise') &&
      shader.fragmentShader.includes('paintThreshold') &&
      shader.vertexShader.includes('vPaintWorldPos')

    p.injection = { tried: true, ok, missing }

    if (!ok) {
      console.error(
        '[paintRevealMaterial] 着色器注入失败，揭示效果不会生效。' +
          ' 未命中的锚点：' +
          (missing.length ? missing.join('、') : '(代码替换未生效，但锚点存在)') +
          '。若刚升级过 three，请核对 ANCHORS 里的 chunk 名是否还存在。',
      )
    }
  }

  return material
}

/**
 * 逐帧把进度写进 uniform。
 * 直接改 shader.uniforms.x.value 而**不是** material.needsUpdate = true：
 * 后者会让 three 重新编译 shader 程序（毫秒级卡顿），
 * 而 uniform 更新只是一次内存写入。
 */
export function setPaintProgress(material, progress) {
  if (!material) return
  const p = material.userData?.paint
  if (!p) return
  p.progress = progress
  if (p.shader) {
    p.shader.uniforms.uPaintProgress.value = progress
  }
}

/** 写入画框原点（世界坐标）。传 THREE.Vector3 */
export function setPaintOrigin(material, origin) {
  if (!material) return
  const p = material.userData?.paint
  if (!p) return
  p.origin.copy(origin)
  if (p.shader) {
    p.shader.uniforms.uPaintOrigin.value.copy(origin)
  }
}
