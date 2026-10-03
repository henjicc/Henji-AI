# 颜色、主题与材质

（`henji-ui-surface` 的参考文档。调颜色、写 CSS、加毛玻璃、改对比度时读这份。）

## 颜色必须跟随主题：种子 → 语义令牌 → 组件

颜色由主题引擎从少量**种子**推导（重要记录 002、010），界面代码**只引用语义令牌**，不写任何具体颜色：

| 层 | 内容 | 入口 |
|---|---|---|
| 种子 | 模式（深/浅）、底色色相、底色倾向（彩度）、窗口亮度、层级对比度、强调色。预设石墨（默认）/深海/胶片/纸白只是种子组合；设置里开放预设、强调色、层级对比三项 | `src/core/theme/themeEngine.ts`（`THEME_PRESETS`、`deriveThemeTokens`）、`themeSelection.ts` |
| 语义令牌 | OKLCH 推导：表面按“窗口 ± n 级”，`text2`/`text3` 按目标对比度 ≥ 4.5:1 求解，强调色亮度夹紧，实底上的字按对比度自动黑白；输出为 CSS 变量 `--{token}` 与不透明令牌的 `--{token}-rgb` | `themeCssVars.ts` → `runtimeTheme.ts` 写到根节点；`index.css` 的 `theme-tokens` 块是石墨静态默认值（首帧防闪色，测试保证与引擎一致） |
| 组件 | 组件内部把语义令牌组合成皮肤（`.ui-btn-*`、`.ui-glass*`、`styleTokens.ts` 的常量）；玻璃的 `--ui-glass-*` 组件层变量静态写在 `index.css`，毛玻璃关闭时整组改指实底 | `src/index.css`、`src/components/ui/styleTokens.ts` |

Tailwind 类名规则：**类名里的颜色名 = CSS 变量名去掉 `--`**（`--control-hover` → `bg-control-hover`，`--text2` → `text-text2`），
唯一例外是文字片段 `--clip-text` 的类叫 `clip-title`（避开 `bg-clip-text`）。常用：

| 用途 | 类 |
|---|---|
| 表面 | `bg-gap` 面板之间的间隙 / `bg-window` 窗口与工作区 / `bg-canvas` 画布 / `bg-panel` 面板与浮层 / `bg-raised` 字段与内嵌块 / `bg-control`(`-hover`/`-pressed`) 控件 / `bg-hover` 悬停 / `bg-selected` 选中 |
| 线 | `border-line` 发丝线 / `border-line-strong` 强分隔 / `edge` 受光边 |
| 文字 | `text-text1` 主要 / `text-text2` 次要 / `text-text3` 辅助（均 ≥ 4.5:1）/ `text-text-disabled` 禁用 |
| 强调 | `bg-accent`（填充，**不能作文字色**）/ `text-accent-text` 强调文字 / `text-on-accent` 强调实底上的字 / `ring-accent-ring` 焦点环 / `bg-accent-tint` 浅底 / `-hover`/`-pressed` |
| 状态 | `bg-danger-solid` 实底 / `text-danger-text` 文字 / `bg-danger-tint` 浅底 / `text-on-danger`；`success`、`warning` 同构；信息色复用强调色 |
| 媒体上（固定，不随主题） | `bg-media` 媒体底 / `bg-media-control`(`-hover`) / `bg-media-scrim` / `border-media-line` / `text-on-media` |
| 遮罩 | `bg-scrim` / `bg-scrim-soft` / `bg-scrim-solid`（按模式派生） |
| 剪辑片段与波形 | `bg-clip-video`/`-audio`/`-title` 与 `border-clip-*-line`、`text-clip-wave`；`text-wave` / `text-wave-played` / `text-wave-cut` |

旧类名（`bg-app`、`bg-bg-dark`、`bg-surface-dark`、`bg-layer`、`border-border-dark`、`text-text-dark`/`-muted`/`-soft`/`-faint`、
`brand-300/500/600/700`、不带后缀的 `text-danger`/`text-success`/`text-warning`）与旧 CSS 变量（`--app-rgb`、`--text-muted-rgb`、
`--ui-surface-panel` 等）是 1.3 的过渡别名，4.2 删除；`check:colors` 的 legacy 规则与旧变量规则拦截它们再次出现。
`veil` 六档是**固定白纱**（不随主题），只适合压在媒体与深色画布上，新代码压在媒体上优先用 `media-*` / `on-media`。

非 DOM 渲染面（Canvas 2D、WebGL/WebGPU、波形绘制）读令牌用 `useThemeTokens()`（`themeTokenStore` 订阅），不要硬编码或读 CSS 字符串再解析。
内容色（标注默认色、导出图配色、算法遮罩、端口类型色等，不属于界面皮肤）登记在 `src/core/theme/colorTokens.ts`；需要随模式变化时
按模式派生（如端口类型色用 `light-dark(浅, 深)`）。

`check:colors` 拦截：十六进制、Tailwind 任意十六进制、CSS 里的 rgb/rgba 字面量、旧 CSS 变量别名（以上不可登记）；
ts/tsx 里的固定调色板类、黑白类、rgba 字面量、命名色、旧别名类。登记文件 `scripts/check-color-tokens.allowlist.json` 只能下调：
palette / mono / named 已清零、不可再登记，其余规则总数不得超过脚本里的上限。ESLint 另拦 `zinc / gray / neutral / slate / stone`。

### 纯 CSS 文件同样受约束

`.css` 里不能写 `#hex` 也不能写 `rgba(数字…)`，只能写 `rgb(var(--xxx-rgb) / a)` 或 `var(--token)`。
`npm run check:colors` 会扫 `.ts/.tsx/.css` 三种；只有
`src/index.css` 与 `src/core/theme/colorTokens.ts` 两个「令牌定义处」豁免字面量规则（旧变量别名规则对它们同样生效）。

扩展这条检查时当场抓出 70 处存量硬编码，包括**三种互不相同的蓝**
（`#3b82f6` 才是应用强调色，`#007eff` 用在视频控件与分辨率面板，`#1890ff` 用在上传组件）
和一整套亮色主题回退值（`--color-*` 变量从未定义，实际回退到 `#ffffff`/`#18181b`）。

### 全局主题变量不能放懒加载的样式表里

`data-theme-tone` / `data-ui-radius` 的取值规则曾写在
`src/features/canvas/storyboard.css`——那个文件由 `CanvasWorkspace.tsx` 懒加载，
结果「设置 → 界面 → 圆角尺寸 / 色调」在用户没打开过画布之前完全不生效。
**全局主题变量只能放 `src/index.css`**（它在 `main.tsx` 里全局引入）。

⚠️ 另外：全仓没有 `dark:` 变体，深浅色由主题引擎改变量完成（Tailwind `darkMode: 'class'` 只是为了让误写的 `dark:` 永不生效）。
不要写 `text-zinc-600 dark:text-zinc-400` 这种双分支；需要按模式区分的内容色在 `colorTokens.ts` 用 `light-dark()` 派生。

### 布局定位不得藏在外观样式表里

> **样式表只做它的文件名承诺的事。**

`scrollbar.css` 只能负责滚动行为与滚动条外观，不得顺手把业务容器写成
`position: fixed`；否则读 JSX 时完全看不出元素脱离了哪个布局参照系，父级的
padding、flex 收缩与助手插入量也会被静默绕开。

- `position`、`top`、`right`、`bottom`、`left`、`z-index` 必须直接写在组件 `className`
- 动态 `zIndex` 使用 `Z_LAYERS`，不要把任意层级藏进 CSS
- 全局变量只放 `src/index.css`；局部样式表只影响对应局部模块
- 确实只能写在 CSS 的例外，必须在声明旁就地注释原因

判断标准：只读组件 JSX 时，应能看出元素是普通流、相对定位、绝对定位还是视口固定，
以及它以哪个父级作为包含块。

## 毛玻璃是一个「材质」，不是一个 blur 值

> **只写 `backdrop-filter: blur()` 得到的是「模糊 + 降不透明度」，看起来廉价。**

真正的玻璃质感需要四层一起上，缺一层就塌成贴纸：

| 层 | 作用 | 漏了会怎样 |
|---|---|---|
| `blur` | 虚化背景 | —— |
| `saturate(180%)` | 把颜色捞回来 | 背景摊平成灰泥（Apple 的 material 全部带这个） |
| 受光边缘 | 边缘描边 + 顶部内阴影 | 像一块贴纸，不像玻璃 |
| 噪点 | 极低透明度的 overlay 噪声 | 深色上出色带，看着像塑料（微软 Acrylic 把噪点列为必需层） |

**用法：写 `ui-glass` 一个类**（定义在 `src/index.css`），遮罩写 `ui-glass-scrim`。
圆角、尺寸、定位仍由调用方的 Tailwind 类给。**ESLint 硬拦一切 `backdrop-blur-*`**。

调质感只改 `src/index.css` 里那几个 `--ui-glass-*` 变量，全局一起变。

### 什么时候才该用

> 只用在**浮层压住内容不可预测的东西**上 —— 图片、视频、画布。

落点（都是同一套材质）：`ui-glass` 类、`UiPanel variant="glass"`、`Dropdown` / `PanelTrigger` 的 `surface="glass"`（默认 `solid`）、
遮罩 `ui-glass-scrim`。画布“返回项目”是 `ui-glass` 容器包静默 `UiButton`（重要记录 011）；压在图片/视频上的单个控件
用不透明的媒体叠层档（`UiButton variant="media"`、`UiIconButton tone="media"`），不必每个都上玻璃。

**"要不要给所有按钮/边框都加上模糊，省得有的有有的没有？"——不要，而且这不是审美问题。**

`backdrop-filter` 模糊的是**元素背后的东西**。按钮坐在 `bg-panel` 这种不透明底色上时，
背后只有一片纯色：把纯色模糊 24px，结果还是同一片纯色。
**视觉上零差别，代价是每个按钮多一个合成层。**

所以"有的有有的没有"不是不一致，是正确行为——模糊只在背景有变化时才可见。
判断方法一句话：**它背后是别的界面（纯色）还是用户的内容（图片/视频/画布）？**

真想让界面整体更有玻璃感，正确方向不是给按钮加模糊，而是**让浮层自身半透明**
（助手侧栏、模型选择面板、画布节点工具条），这样它们的模糊才有东西可模糊。
那是产品方向调整，动手前先和用户确认。

压在应用自身纯色 UI 上的浮层（通知、任务卡、普通面板）一律用不透明底色：更清楚，
也省掉一次读取背景纹理的合成开销。

### 性能：成本按「层数」算，不是按面积算

真实 Electron 实测（1440×900、60Hz 上限、背景每帧变化，即最坏情况）：

| 场景 | 帧率 |
|---|---|
| 60 层玻璃 | 60fps |
| 100 层 | 43.5fps |
| 150 层 | 27fps |
| 同样 792k px² 总面积：**4 块大的** | 58.4fps |
| 同样 792k px² 总面积：**150 块小的** | 27fps |
| 1 块全屏 blur24 | 60fps |
| 150 块，blur 从 4px 调到 64px | 50fps → 25fps |
| `saturate` / `brightness` 的增量 | 噪声范围内 |
| `opacity:0` / `visibility:hidden` / `display:none` 的玻璃 | 免费，浏览器跳过 |
| 背景静止 vs 每帧变化（同 150 层） | 52.7fps vs 28.4fps |
| 画布整体平移（玻璃随内容一起动） | 27.4fps |
| 平移期间降级成实心 | 60.4fps |

**四条结论：**

1. **要优化就减少层数或合并**。工具条的正确形态是一块玻璃包住一排透明按钮，
   而不是每个按钮各一块玻璃——面积一样，代价差两倍。
2. **不要靠调小 `--ui-blur` 省性能**。150 层时把半径压到 4px 仍然只有 50fps，
   固定开销（每层一次 backdrop 读回 + render surface）才是大头。
3. **质感四层一层都不用砍**。`saturate` 与 `brightness` 的成本量不出来。
4. **移动中的玻璃最贵，但不要急着为它降级**。画布手势期间把 `--ui-glass-*` 降级成
   实心能把 27.4fps 拉回 60.4fps——试过，又撤了：玻璃在手势起止的突变**肉眼可见**，
   而同组数据里 48 层平移本来就有 60fps，画布上带玻璃的只有未播放视频节点的播放键，
   正常工程根本到不了拐点。**为未证实的瓶颈付确定的观感代价不划算。** 真遇到了再按
   可见节点数有条件降级，不要无条件常开。列表/网格里隐藏的玻璃不用管，已经免费。

### 两个实现上的坑

1. **`.ui-glass` 必须放在 `@layer components` 里**。写在裸 CSS 中它会排在
   `@tailwind utilities` 之后，其中的 `position: relative` 会盖掉调用方的 `absolute`，
   所有绝对定位的玻璃控件都会跑位。
2. **关闭开关时不能只把 blur 置 0**。那样半透明黑底叠在清晰背景上会看不清内容，
   必须让 tint 同时退化成接近实心的面板色。

## 对比度：引擎求解 + 渲染后像素审计

颜色是否达标取决于**渲染后的实际叠加结果**（玻璃、半透明、压在媒体上的文字），grep 无能为力。两道保障：

1. **令牌层求解**（重要记录 010）：`text2`/`text3` 按目标对比度求解亮度，基准取它实际会压上的最亮表面
   （`selected`/`raised`/`hover`）；对比度档位只拉开表面层级，文字不得因此变暗；强调实底上的字（`on-accent`）与
   主按钮“静息/悬停渐变中点”都按 ≥ 4.5:1 自动取黑或白。`themeEngine.test.ts` 对四个预设 × 三档对比度逐项断言。
2. **渲染后审计**：`npm run check:ui-visual`（正式 Electron 场景）的 `lowContrast` 规则——隐藏全部文字与 lucide 图标截一张
   “只有背景”的图，在每个候选区域网格取样、按 alpha × 祖先 opacity 合成前景后算 WCAG 对比度，取最差 10% 分位
   （压在渐变/图片上的文字不靠平均值蒙混）。门槛：正文与辅助文字 ≥ 4.5:1；大字（≥ 24px，或 ≥ 18.66px 且粗体）与图标 ≥ 3:1；
   禁用控件、`aria-hidden`、被遮挡或裁切到不可见的部分不判。`--theme-preset all` 逐个预设审计，场景中途 `capture()` 的状态也审。
   合理例外登记在 `scripts/ui-visual-contrast-exceptions.json`（`id`、≥ 8 字理由、`text`/`element` 正则，可限 `scene`/`presets`/`minRatio`）。

**三条规则：**

1. **`accent` 不能作文字色**，文字用 `text-accent-text`（`UI_COLOR_ACCENT_TEXT_CLASS`）。`accent` 只用于填充与描边。
2. **字压在强调实底上用 `bg-accent text-on-accent`**（`UI_COLOR_ACCENT_FILL_TEXT_CLASS`），不要写死白字——深海、胶片等预设
   的强调色上应是深色字，由引擎按对比度决定。危险/成功/警示实底同理用 `text-on-danger` 等。
3. **界面色不达标改令牌或改用法，不登记例外**；只有装饰、品牌或用户内容色（素材本身）才登记例外。
   改主题引擎推导规则后跑 `themeEngine.test.ts` 与四预设 `check:ui-visual`。

### 历史：为什么必须按渲染后像素判

旧审计按 DOM 祖先链估背景色：看不到玻璃与半透明叠加，找不到底色时按深色兜底——纸白下会误判，压在媒体上的文字也判不出。
它曾查出导航选中态用 `text-accent`（2.82:1）、旧 `text-faint` 派生比例压太重（4.12:1）、主按钮白字压 `bg-accent`（3.68:1），
三者根因都在令牌层，现已由引擎求解消除。
