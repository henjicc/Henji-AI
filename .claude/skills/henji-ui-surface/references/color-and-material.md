# 颜色、主题与材质

（`henji-ui-surface` 的参考文档。调颜色、写 CSS、加毛玻璃、改对比度时读这份。）

## 颜色必须跟随主题

设置 → 界面 → 主题外观里，用户可以整体替换 9 个语义色（`bg/surface/border/text/textMuted/app/canvas/panel/layer`），
强调色还会派生出 `brand-300/500/600/700`。**任何 `zinc-*` 这类固定调色板都不会跟着动**——
用户切到「石墨灰阶」后，硬编码的地方会原地不动，和周围脱节。

四档文字色里，中间两档 `text-soft` / `text-faint` 由 `runtimeTheme.applyTextScale` 从
`text` / `textMuted` 派生，所以整条梯度都跟随主题。对照表：

| 别再写 | 改用 |
|---|---|
| `bg-zinc-950 / 900 / 800 / 700` | `bg-app / bg-panel / bg-surface-dark / bg-layer` |
| `text-zinc-100/200` `300` `400` `500/600` | `text-text-dark` `text-text-soft` `text-text-muted` `text-text-faint` |
| `border-zinc-700/600` | `border-border-dark` |
| 叠在图片/视频/画布上的边框与底色 | `veil` 六档（它刻意是白色半透明，与主题无关是有意的） |

ESLint 已硬拦 `zinc / gray / neutral / slate / stone` 五个中性色板。
`red / green / yellow / blue / orange / purple` 等是语义色与分类色，**不在禁止范围内**。

### 纯 CSS 文件同样受约束

`.css` 里不能写 `#hex` 也不能写 `rgba(数字…)`，只能写 `rgb(var(--xxx-rgb) / a)`。
`npm run check:colors` 现在会扫 `.ts/.tsx/.css` 三种；只有
`src/index.css` 与 `src/core/theme/colorTokens.ts` 两个「令牌定义处」豁免。

扩展这条检查时当场抓出 70 处存量硬编码，包括**三种互不相同的蓝**
（`#3b82f6` 才是应用强调色，`#007eff` 用在视频控件与分辨率面板，`#1890ff` 用在上传组件）
和一整套亮色主题回退值（`--color-*` 变量从未定义，实际回退到 `#ffffff`/`#18181b`）。

### 全局主题变量不能放懒加载的样式表里

`data-theme-tone` / `data-ui-radius` 的取值规则曾写在
`src/features/canvas/storyboard.css`——那个文件由 `CanvasWorkspace.tsx` 懒加载，
结果「设置 → 界面 → 圆角尺寸 / 色调」在用户没打开过画布之前完全不生效。
**全局主题变量只能放 `src/index.css`**（它在 `main.tsx` 里全局引入）。

⚠️ 另外：`index.html` 写死 `class="dark"` 且从不切换，**`dark:` 变体的基础值是死代码**。
不要写 `text-zinc-600 dark:text-zinc-400` 这种双分支，直接写最终值。

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

### 两个实现上的坑

1. **`.ui-glass` 必须放在 `@layer components` 里**。写在裸 CSS 中它会排在
   `@tailwind utilities` 之后，其中的 `position: relative` 会盖掉调用方的 `absolute`，
   所有绝对定位的玻璃控件都会跑位。
2. **关闭开关时不能只把 blur 置 0**。那样半透明黑底叠在清晰背景上会看不清内容，
   必须让 tint 同时退化成接近实心的面板色。

## 对比度：静态检查查不到，必须实测

颜色是否达标取决于**渲染后的实际叠加结果**，grep 无能为力。
`npm run check:ui-visual` 会用 Playwright Electron API 启动隔离的真实 Electron，
在六类界面、1440×900 / 960×640 两档尺寸上检查十一项：表面叠层、文字对比度、
内层圆角、非浮层阴影、CSS 隐藏定位、助手插入量逃逸、横向溢出、嵌套滚动、
文本硬裁、过小命中区、页面标题字号一致性。任一命中都会返回非零退出码。

首次跑出来 7 处对比度不达标，根因都在令牌层，不在调用点：

| 现象 | 实测 | 根因 |
|---|---|---|
| 导航/标签/chip 的选中态文字 | **2.82:1** | 用了 `text-accent`。accent 是**填充色**，作文字色太深 |
| 提示文字、空态文字 | **4.12:1** | `text-faint` 的派生比例（0.30）压太重 |
| 主按钮的白字 | **3.68:1** | 白字压在 `bg-accent` 上先天不达标 |

**结论沉淀成三条规则：**

1. **`accent` 不能作文字色**，要用 `UI_COLOR_ACCENT_TEXT_CLASS`（`text-brand-300`，7.46:1）。
   `accent` 只用于填充与描边。
2. **承载白字的实心强调底用 `UI_COLOR_ACCENT_FILL_TEXT_CLASS`**（`bg-brand-500`，4.85:1），
   不要用 `bg-accent`（3.68:1）。无文字的纯色块填充仍用 `bg-accent`。
3. **改任何颜色令牌的派生比例后跑一次 `check:ui-visual`**。
   `text-soft`/`text-faint`/`brand-*` 都是算出来的，改比例就是改对比度。

### 顺带查出的一致性问题

`index.css` 里 `brand-500/600/700` 的**静态默认值和 `applyAccentScale` 的派生结果不一致**
（静态 `brand-500` 是 `76 136 255`，派生是 `50 111 209`）。首帧用静态值、脚本跑完换派生值，
启动时会闪一次色，而且等于有两套真值。**静态默认值必须等于用默认强调色算出的结果。**
