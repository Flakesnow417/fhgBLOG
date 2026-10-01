# art-source —— 作品图原始文件（不参与打包）

这里放的是六张作品图的**原始 1024px PNG**，只作为"母版"保留。前三张是第一批水墨/油画作品，后三张包含中世纪西方油画、千禧油画和中式古风人物入画。

## 它们是怎么进到页面里的

```
art-source/*.png  (1024px, 2.4MB 左右)
      │
      │  ① resize-textures.mjs 768
      │     双线性缩到 768px（不能最近邻，墨韵会有锯齿）
      ▼
.tools/.tmp-textures/*.png  (768px, 1.3MB 左右)
      │
      │  ② embed-textures.mjs 768
      │     转 base64，生成 src/constants/artworkImages.js
      ▼
src/constants/artworkImages.js  (10.9 MB, base64)
      │
      │  ③ vite build（vite-plugin-singlefile 内联）
      ▼
dist/index.html  (13.3 MB, 单文件)
```

**关键：这个目录不在 `public/` 下。**
`public/` 里的东西 Vite 会原样拷贝到 `dist/`，
而这些图已经 base64 进 HTML 了，再拷一份就是白白多 7 MB。

## 为什么不用「放 public/ 用相对路径引」

因为 **`file://` 下这条路是死的**，而且死得很隐蔽。

实测（`E:/wbDATA/Claw/.tools/probe-file-img.mjs`，2×2 对照）：

| 写法 | 结果 |
|---|---|
| `crossOrigin='anonymous'` + 相对路径 | ❌ 图**根本加载不出来** |
| `crossOrigin='anonymous'` + 绝对路径 | ❌ 同上 |
| 不设 crossOrigin + 相对路径 | ✅ 图能显示 |
| 不设 crossOrigin + 绝对路径 | ✅ 图能显示 |

但"能显示"不等于"能用"：

- file:// 下从磁盘读来的图会**污染 canvas**，
  `getImageData()` 抛 `SecurityError`。
- 而"真图 → 素描稿"的转换**必须**读像素（去色 / Sobel 边缘 / 排线）。

所以路径方案的结局是：**画能显示出来，但 hover 时素描→上色的揭示哑掉**，
而且不报错（代码里 catch 住回退到程序化占位贴图），你只会觉得"上色效果没了"。

实测（`probe-datauri.mjs`）**base64 data URI 完全没有这个问题**：
能 load、`getImageData` 正常读到像素（灰度均值 178，与离线计算一致）、无污染。

## 分辨率为什么定 768

不是"越清晰越好"，要按**屏幕上真正占多大**来定，否则纯属浪费体积。

实测（`final-measure2.mjs`，视口 1248×697，相机 lookAt 画框）：

| 情形 | 画框屏幕宽度 |
|---|---|
| 整幅画都在视野内（相机 X=-2.5，距离 2.12） | 386 px |
| 极端贴墙、只剩 2 个角在视野内（距离 1.11） | 713 px |

768 已覆盖两种情形；1024 属于约 2× 的过采样，
单张仍用 768px，六张合计 base64 约 10.9 MB；如果全部用 1024px，体积还会继续明显上涨。

> 顺带记录一个坑：`crop-and-fit.mjs` 曾经因为一条错误的 `mv` 链
> 把油画那张覆盖掉了。所以这里的文件名要**用像素内容校验**，
> 不能只看文件名 —— 见 `.tools/identify-images.mjs`。

## 想换图怎么办

1. 把新图放进这个目录（建议正方、1024px 以上、右下角别有平台水印）
2. 如果带水印：`node crop-and-fit.mjs`（裁底部 15% + 双线性拉回正方形）
3. `node resize-textures.mjs 768`
4. `node embed-textures.mjs 768`
5. `cd portfolio-3d && npx vite build`

改完记得回 `src/constants/artworks.js` 确认 `image:` 指向的 key 还在
（key 就是去掉 `.png` 的文件名，见 `artworkImages.js` 里的 `ARTWORK_IMAGES`）。
