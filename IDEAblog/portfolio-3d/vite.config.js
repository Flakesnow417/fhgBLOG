import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vite.dev/config/
//
// ======================================================================
// 「双击 dist/index.html 就能跑」到底需要什么？—— 一段踩坑记录
// ======================================================================
//
// 【目标】
//   把打包产物变成一个**不需要服务器**、双击就能打开的文件。
//
// 【第一次尝试：只加 base: './'（不够！）】
//   Vite 默认把资源写成绝对路径：
//       <script src="/assets/index-xxx.js">
//   开头的 / 表示「网站根目录」。用 http:// 打开时没问题，
//   但双击本地文件（file:// 协议）时，这个 / 会被解析成**磁盘根目录**：
//       file:///E:/assets/index-xxx.js     ← 找不到
//   而文件其实在：
//       file:///E:/fhgBLOG/IDEAblog/portfolio-3d/dist/assets/index-xxx.js
//   于是白屏 + 一堆 404。
//
//   所以先加 base: './'，让路径变成相对当前 HTML 的：
//       <script src="./assets/index-xxx.js">
//   —— 路径对了，但仍然白屏！因为还有第二道墙 ↓
//
// 【第二道墙：file:// 下 ES module 和 CSS 被 CORS 拦死】
//   浏览器实测报错原文：
//       Access to script at 'file:///.../assets/index-xxx.js' from origin 'null'
//       has been blocked by CORS policy: Cross origin requests are only supported
//       for protocol schemes: chrome, chrome-extension, chrome-untrusted, data,
//       http, https, isolated-app.
//       net::ERR_FAILED
//   （CSS 同样被拦，报错文案一样，只是把 script 换成 stylesheet）
//
//   为什么？因为 <script type="module"> 和 <link rel="stylesheet"> 在 file://
//   下会被当作**跨域请求**处理，而本地文件的 Origin 是字符串 "null"，
//   根本不在上面的白名单里（白名单只有 http/https/data 等协议）。
//
//   ⚠️ 关键结论：这个限制**和路径写得对不对无关**。
//      哪怕你把路径写成绝对正确的 file:///E:/... ，它照样拦。
//      —— 所以 base: './' 是「必要条件」，但**不是充分条件**。
//      网上很多教程只写 base: './' 就说「双击能跑」，对纯 JS 老式脚本成立，
//      对 Vite（DOM 里默认就是 type="module"）不成立。
//
// 【最终方案：把所有资源**内联**进一个 HTML（本配置在做的事）】
//   vite-plugin-singlefile 会把 JS / CSS 全部塞进 <script> / <style> 标签，
//   产物变成**唯一一个 index.html**。
//   没有外部请求 → 就没有跨域问题 → 双击必开。
//   代价是单文件约 1.2 MB（未压缩），这在这个体积下完全可以接受。
//
// 【顺带一提：Google Fonts】
//   index.html 里的 Google Fonts 是 https:// 字体，file:// 下能加载
//   （字体走 CORS 白名单里的 https），但**断网就退回系统字体**。
//   要彻底离线自足，就把 ttf 放进 public/fonts 再改成本地引用。
// ======================================================================

export default defineConfig({
  plugins: [
    react(),

    // 把 JS/CSS 内联进 index.html。这是「双击即开」的决定性一步。
    // 只在 build 时生效；`npm run dev` 完全不受影响（dev 走 HMR，
    // 本来就是多文件）。
    viteSingleFile({
      // 默认就会把体积小的资源转成 base64 内联。
      // removeViteModuleLoader: 删掉 Vite 自己的模块预加载器，
      // 单文件形态下它只会多出几行无用代码。
      removeViteModuleLoader: true,
    }),
  ],

  // file:// 下没有服务器做路径解析，所有路径必须是相对的。
  // 这是「必要条件」——虽然单靠它不够（原因见上面第二道墙），
  // 但少了它，保底方案（把 dist 丢到任意子目录）也会挂。
  base: './',

  // GLSL 着色器以内联字符串形式写在 .js 里，这里只是显式声明，
  // 方便后续如果把 shader 拆成 .glsl 文件时自动热更新。
  assetsInclude: ['**/*.glsl'],

  server: {
    // index.html 里的入口链接写死了 http://localhost:5173。
    // strictPort: true 的意思是「端口被占用就直接报错，不许偷偷顺延到 5174」——
    // 否则 Vite 换了端口而链接还指着 5173，点了就是打不开，且很难想到原因。
    // 宁可在终端里看到一条明确的报错。
    port: 5173,
    strictPort: true,
    open: true,
  },

  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
    // 单文件模式下，代码分割反而会制造出多个无法被 file:// 加载的 chunk，
    // 所以关掉它，保证只有一个 bundle。
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // 强制所有代码进一个 chunk（配合 viteSingleFile）
        inlineDynamicImports: true,
      },
    },
  },
})
