/**
 * 通廊内容数据
 * ==================================================================
 * 设计原则：把「内容」与「几何」彻底解耦。
 *
 * 长廊有无限多段，但内容只有这几幅。做法是把内容**循环映射**到
 * 不断增长的段索引上 —— 段 0 和段 6 会挂同一幅画。
 * 这样既能无限走下去，又不需要真的准备无限份素材。
 *
 * 数据分三层，与 Module 4/5 的渲染管线一一对应：
 *   sketchMap / paintedMap  —— Module 5 用：黑白素描贴图 → 上色贴图
 *   motif / seed            —— Module 4 用：程序化生成的速写占位图
 *                              （Module 5 完成后这两个字段会被贴图取代）
 *   detail                  —— Module 4 用：弹窗里的正文
 *   image                   —— 可选：真实作品图（base64 内联，见 artworkImages.js）
 *                              给了就用真图；不给则回退到 motif/seed 程序化占位图
 *
 * ⚠️ 占位内容替换指引
 *   下面每一段的 title / caption / detail 都是占位文案。
 *   要换成自己的信息，只需要改这个文件，不需要动任何组件。
 *   detail 的结构：
 *     { lead: 摘要, blocks: [{ heading, items: [...] }] }
 *   items 里的每一项是字符串；如果写成 { label, value } 对象，
 *   弹窗会自动渲染成"标签 + 值"的形式。
 */

import { ARTWORK_IMAGES } from './artworkImages'

/** 画框在墙上的位置：left / right 分别对应左右两面墙。 */
export const WALL_SIDE = {
  LEFT: 'left',
  RIGHT: 'right',
}

/** 详情弹窗里一个条目的分隔符常量（保持数据侧可读） */
const DASH = '——'

/**
 * 画作内容。
 * 顺序即沿长廊行走时依次出现的顺序；走完一轮会从头开始循环。
 */
export const CORRIDOR_ARTWORKS = [
  {
    id: 'about',
    title: '关于我',
    caption: '一个喜欢把界面当成纸上草稿来画的人',
    side: WALL_SIDE.LEFT,
    motif: 2,
    seed: 101,
    accent: '#c8532f',
    // 真实作品图：水墨 · 墨潭跃鲤
    // 为什么把这张给「关于我」——它是三张里"半工笔半写意"最明显的一张，
    // hover 时从干笔素描渐变到浓墨重彩，最能解释 caption 里那句
    // "把界面当成纸上草稿来画"：先起草，再上色。
    image: ARTWORK_IMAGES['ink-koi-splash'],
    // 提饱和稍高一点，让"上色"那一下的反差更明显（这张本身彩度就集中）
    imageSaturate: 1.24,
    detail: {
      lead: `把复杂的东西拆开、画在纸上、再一块块拼回去 ${DASH} 这是我做产品也做代码的方式。`,
      blocks: [
        {
          heading: '我是谁',
          items: [
            '前端工程师，主攻三维交互与可视化方向',
            '习惯先用草图推敲结构，再写实现',
            '偏好把"性能"和"手感"当成功能来对待，而不是事后优化',
          ],
        },
        {
          heading: '我在意什么',
          items: [
            '一个界面是否让人愿意多停留三秒',
            '一次交互是否在正确的时机给出正确的反馈',
            '一份代码半年后是否还读得懂',
          ],
        },
      ],
    },
  },
  {
    id: 'skills',
    title: '技能',
    caption: '前端工程 / 三维交互 / 着色器',
    side: WALL_SIDE.RIGHT,
    motif: 0,
    seed: 202,
    accent: '#2f6f8f',
    // 真实作品图：油画 · 行星静物（伦勃朗式明暗对照）
    // 给「技能」是因为这张暗部占 83%，素描稿转出来线条最密、最有"图纸感"，
    // hover 后的暖色金木星与冷色地球又刚好对应标题里的"三维 / 着色器"。
    // 边缘强度调高：油画笔触细碎，默认值会让素描稿糊成一片灰。
    image: ARTWORK_IMAGES['oil-planet-fruit'],
    imageEdge: 1.35,
    // 原图已经很浓，不加饱和，否则暗部会浮出噪点
    imageSaturate: 1.0,
    detail: {
      lead: '不追求名词的堆叠，只说真正能独立交付的部分。',
      blocks: [
        {
          heading: '前端工程',
          items: [
            { label: '框架', value: 'React 19 / Vue 3，熟悉并发特性与渲染调度' },
            { label: '构建', value: 'Vite 配置与插件、产物分包、按需加载' },
            { label: '样式', value: 'Sass / CSS 变量体系、设计令牌落地' },
          ],
        },
        {
          heading: '三维与图形',
          items: [
            { label: '运行时', value: 'Three.js / React Three Fiber，含自定义渲染循环' },
            { label: '着色器', value: 'GLSL 片元与顶点着色器、材质补丁（onBeforeCompile）' },
            { label: '资产', value: '程序化贴图生成、几何优化、draw call 控制' },
          ],
        },
        {
          heading: '工程协作',
          items: ['Git 分支与评审流程', '可复现的调试脚本与验收手段', '文档与交接'],
        },
      ],
    },
  },
  {
    id: 'projects',
    title: '项目作品',
    caption: '几个从零搭起来的交互实验',
    side: WALL_SIDE.LEFT,
    motif: 3,
    seed: 303,
    accent: '#7a5c9e',
    // 真实作品图：水墨 · 山峦化猫（一只打哈欠的猫，身体是远山与雾）
    // 给「项目作品」是私心：底下列的项目也是"把不搭界的东西缝在一起"
    // （水墨 + 漫剧、棋盘 + 第一人称），和这只山猫是同一种趣味。
    image: ARTWORK_IMAGES['ink-cat-mountain'],
    // 这张纸面大片留白，素描稿本来就干净，不需要额外加线
    imageEdge: 0.95,
    detail: {
      lead: '下面这几个都从空白仓库开始，没有现成模板。',
      blocks: [
        {
          heading: '素描长廊 · 本作品集',
          items: [
            'Vite + React Three Fiber 分段流式长廊，无限延伸',
            'GSAP 驱动的纸张撕裂开场，2D 遮罩过渡到 3D 空间',
            '程序化生成铅笔质感贴图，零外部图片依赖',
            'GLSL 材质补丁实现"素描 → 上色"的 hover 揭示',
          ],
        },
        {
          heading: '水墨漫剧风格化界面',
          items: [
            '把国风漫画的水墨质感落地到网页：远山、竹林、雾气分层',
            '静态雾层用多层视差实现，避免动画带来的持续重绘',
          ],
        },
        {
          heading: '第一人称棋盘实验',
          items: [
            '相机固定在棋子"眼睛"高度，按棋子朝向呈现画面',
            '棋盘纹理按入局状态重生成，解决纹理无变化的观感问题',
          ],
        },
      ],
    },
  },
  {
    id: 'experience',
    title: '工作经历',
    caption: '在团队协作里打磨工程能力',
    side: WALL_SIDE.RIGHT,
    motif: 1,
    seed: 404,
    accent: '#2f8f6f',
    // 真实作品图：中世纪油画 · 圣徒献金梨
    // 用一幅带奇幻彩蛋的中世纪宴席表现工作经历：古老画法承载新想法，
    // 小龙和发光金梨让严肃的“工程履历”多一点玩心。
    image: ARTWORK_IMAGES['oil-medieval-saint-dragon'],
    imageEdge: 1.18,
    imageSaturate: 1.04,
    detail: {
      lead: '按时间倒序，只保留对现在还有影响的部分。',
      blocks: [
        {
          heading: '前端工程师 · 三维交互方向',
          items: [
            { label: '时间', value: '至今' },
            '负责三维可视化模块的技术选型与实现，从原型推进到线上',
            '把首屏的模型与贴图加载拆成两阶段，让可交互时间提前',
            '建立了一套"先测资源、再定参数"的调试流程，减少返工',
          ],
        },
        {
          heading: '前端工程师 · 中后台方向',
          items: [
            '主导组件库的样式令牌改造，统一了多项目的视觉基线',
            '把构建产物体积压到原来的一半左右',
          ],
        },
        {
          heading: '实习 · 交互开发',
          items: [
            '第一次接触 WebGL，从此决定往图形方向走',
            '独立完成过一个粒子可视化 demo',
          ],
        },
      ],
    },
  },
  {
    id: 'education',
    title: '教育背景',
    caption: '从课堂作业到独立产品',
    side: WALL_SIDE.LEFT,
    motif: 0,
    seed: 505,
    accent: '#a8802f',
    // 真实作品图：千禧油画 · 鼠标水果星球
    // 把“从课堂作业到独立产品”画成一场太空水果保龄球：光盘轨道、
    // 鼠标飞船和水果行星都带着千禧年的玩具感，颜色则保留油画厚涂的重量。
    image: ARTWORK_IMAGES['oil-y2k-mouse-fruit'],
    imageEdge: 1.28,
    imageSaturate: 1.02,
    detail: {
      lead: '学校里学到的最大收获，是"把一个问题彻底弄清楚"的耐心。',
      blocks: [
        {
          heading: '本科 · 计算机相关专业',
          items: [
            '课程重心：数据结构、图形学基础、人机交互',
            '毕业设计做的是一个可视化的算法演示系统',
          ],
        },
        {
          heading: '自学部分',
          items: [
            '图形学：从光栅化原理一路补到 PBR 与着色器',
            '设计：排版、色彩、信息层级 —— 让界面不只是"能用"',
            '这些自学内容后来直接变成了工作的方向',
          ],
        },
      ],
    },
  },
  {
    id: 'contact',
    title: '联系方式',
    caption: '欢迎来信聊聊',
    side: WALL_SIDE.RIGHT,
    motif: 3,
    seed: 606,
    accent: '#c8532f',
    // 真实作品图：中式古风 · 人物入画
    // 联系方式是长廊的最后一块画：行旅者一脚踏进画卷，狐灵替他卷住
    // 画轴，把“欢迎来信”变成一次轻巧的入画彩蛋。
    image: ARTWORK_IMAGES['ink-enter-painting'],
    imageEdge: 1.02,
    imageSaturate: 1.08,
    detail: {
      lead: '对三维交互、可视化、或者只是"这个东西怎么做出来的"感兴趣，都可以直接找我。',
      blocks: [
        {
          heading: '找到我',
          items: [
            { label: '邮箱', value: 'hello@example.com' },
            { label: 'GitHub', value: 'github.com/example' },
            { label: '主页', value: 'example.com' },
          ],
        },
        {
          heading: '关于回复',
          items: [
            '一般 1~2 个工作日内回信',
            '如果是合作意向，附上一句话背景和目标，沟通会快很多',
          ],
        },
      ],
    },
  },
]

/**
 * 给定段索引与该段内的画框序号，取出对应的内容。
 * 用取模实现循环，所以长廊可以无限延伸而内容始终有限。
 */
export function getArtworkFor(segmentIndex, slotIndex) {
  const total = CORRIDOR_ARTWORKS.length
  const i = ((segmentIndex * 4 + slotIndex) % total + total) % total
  return CORRIDOR_ARTWORKS[i]
}
