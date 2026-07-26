---
name: henji-ui-surface
description: Henji-AI 新建或改造任何界面/面板/弹窗/侧栏/设置分区/节点 UI，或调整颜色、毛玻璃、动画、层级时使用。涵盖表面层级（surface/elevation）铁律、五级容器词汇表、选项集合静息态、语义色与主题跟随、毛玻璃材质、动效档位、z-index 契约、排版层级、以及避免整页重绘的状态分层规则。触发场景：用户要求"做一个 XX 面板/页面/弹窗"、"这个界面不好看/太挤/像卡片套卡片"、"帮我美化一下这个界面"、"加一个设置分区"、"统一一下 UI/配色/动画/模糊"、"这个动画太快/太慢/很生硬"、"这个界面卡顿/拖动掉帧"、"切换主题后有些地方没变色"。
---

# Henji-AI 界面表面与层级规范

## 为什么需要这份规范

项目的 `Ui*` primitives 已经组件化，但**组件化 ≠ 界面好看**。实测本仓库最常见的两类问题：

1. **卡片套卡片**：`AssistantSidebar`（`bg-panel` + border）里放 `AssistantConversation` 的消息块（又是 `bg-panel` + border）；`Settings/index.tsx`（`bg-panel` 弹窗）→ `SectionCard`（又一层 `bg-panel`）→ 内部行（第三层 `bg-surface-dark`）。三层边框叠在一起，视觉上就是"一张卡里弹一张卡又套一张"。
2. **该扁平的地方带了壳**：`UiPanel`/`UiIconButton`/`UiOptionButton` 的**默认值自带 border + bg**，每个组件都假设自己是最外层独立卡片。在容器内部使用时，就会多出一层不该有的边框背景。

根因不是"忘了用组件"，而是**表面 token 把 `border` 和 `bg` 打包绑死**（见 `styleTokens.ts` 的 `UI_PANEL_SURFACE_CLASS` / `UI_FIELD_SURFACE_CLASS`），且没有"只分组、不画框"的官方写法。本 skill 提供那条缺失的规则。

## 铁律（唯一一条，先记住这个）

> **同一层视觉深度，只画一次边框/背景。**
> 进入一个已经有边框或背景的容器后，内部分组**必须**改用留白 / 分隔线 / 更暗的底色，**不得**再叠一层 `border + bg + rounded`。

参考 Atlassian 的表述：能用边框或留白区分时，就不要用抬升（卡片）来分组。成熟设计系统普遍只保留 4~6 个层级并刻意克制。

## 五级容器词汇表（先背这张表）

写任何界面前，先确定"我在第几级"，然后只用那一级允许的东西。
**从 Region 往下选，能停在哪级就停在哪级——不要一上来就用 Card。**

| 级 | 概念 | 组件 | 边框 | 背景 | 阴影 | 用途 |
|---|---|---|---|---|---|---|
| 1 | **Region** 页面区域 | `<UiRegion>` | ❌ | ❌ | ❌ | 页面主区，只管外边距与最大宽度 |
| 2 | **Group** 分组 | `<UiGroup title=…>` | ❌ | ❌ | ❌ | **普通内容分组的默认选择**：标题 + 间距 |
| 3 | **Divided** 分隔 | `<UiGroup divided>` | 仅一条线 | ❌ | ❌ | 需要明确切分时 |
| 4 | **Surface** 内嵌面 | `<UiPanel variant="inset">` | ❌ | 更暗底 | ❌ | 代码块、只读预览、列表项（父级已是卡片时） |
| 5 | **Card** 卡片 | `<UiPanel>` | ✅ | ✅ | ✅ | **仅**浮层/弹窗/侧栏/画布节点 |

```tsx
<UiPanel>                  {/* 5 卡片：border + bg-panel + shadow-panel + rounded-xl */}
<UiPanel variant="inset">  {/* 4 内嵌：仅 bg-app/40 + rounded-lg，无边框无阴影 */}
<UiPanel variant="bare">   {/* 4 纯容器：只有圆角 */}
<UiGroup title="基础设置">  {/* 2 分组：零装饰，标题 + 间距 */}
<UiGroup divided>          {/* 3 分隔：上方一条线 */}
```

**方向铁律：内层背景只能比外层更暗，不能更亮。** 比父级亮 = 视觉上"浮起来" = 卡片。
本项目 `bg-app`(10) < `bg-panel`(23) < `bg-surface-dark`(38) < `bg-layer`(64)。
在 `bg-panel` 的弹窗里用 `bg-surface-dark` 做分区，就是在造卡片。

## 卡片准入条件（四条全中才允许）

1. 有独立交互或独立状态
2. 可被单独移动 / 关闭 / 拖拽
3. 与兄弟元素是并列实体（列表项、画布节点）
4. 脱离页面上下文仍能被理解

**卡片嵌套上限：1 层。** 卡片内部一律用 Group / Surface。

## 决策树：这个容器要不要边框背景？

```
我正在写的这个 div，它的父级链上已经有 border 或 表面 bg 了吗？
├─ 没有（我就是最外层浮层/弹窗/侧栏/画布节点）
│    → <UiPanel>。不要手写 border + bg-panel + rounded。
│
└─ 有（我在某个 panel 内部）
     ├─ 只是想把几个字段归成一组   → <UiGroup title="…">   ← 默认走这条
     ├─ 需要明确切分               → <UiGroup divided>
     ├─ 要让这块"沉下去"（代码块/只读预览/列表项）→ <UiPanel variant="inset">
     └─ 想不出理由，只是"看着空"    → 什么都不加。留白就是设计。
```

**"想不出理由就不加"** 是本规范最重要的执行细节 —— 绝大多数丑陋的套娃，都来自"这里看着空，加个卡片吧"。

## 选项集合的静息态：不描边

上面的决策树管容器，这一节管**容器里那一堆并列的可点项**（菜单项、模型网格、分辨率格子、列表行）。

> **边框表达的是"边界"，不是"可点击"。**
> 一屏里几十个选项各自描边时，边框互相抵消、不再传递任何信息，只剩视觉重量。
> 可点击性由 **hover 反馈 + 排布规律**表达，不需要静息态的框。

`UiOptionButton` 的 `variant="menu"` 就是这条规则的落点：静息态无边框无底色，hover 出 `bg-layer`，选中态才是实底。

### 判据（两条都要满足才用 `menu`）

1. **是同质选项的集合**：≥3 个由 `map` 渲染的并列 peer，或语义上明确的二选一分段。孤立的单个按钮不算 —— 那种情况下框才真的在划定边界。
2. **去掉框之后形状还在**。满足任一即可：
   - 已被可见容器圈住（浮层面板、弹窗左栏、下拉列表）——容器已经画过一次边界了
   - 每项自带足以撑出形状的内容（缩略图、图标块、多行文本、比例示意图）
   - 是二维网格 —— 此时补一层 `bg-veil-faint` 撑格子，**但仍然不描边**（底色已经表达过一次边界，边框是多余的第二次）

### 反例：这些**要保留**边框

| 场景 | 为什么 |
|---|---|
| 纯文字 chip 组（筛选 chips、数值 marks、`CompositeRadio`）| 直接落在面板底色上，去框后变成裸文字，点击可供性丢失 |
| 内容入口卡（工具箱、工程列表）| 是内容卡不是选项，走 Card |
| 表单单选 `RadioInput` | 框就是命中区域 |
| 动作按钮（"上传音频"、"选择文件"）| 是按钮不是选项，走 `variant="flat"` |

## 同属性叠类 = 静默失效（本仓库最常见的隐蔽 bug）

> **两个工具类落在同一个 CSS 属性上时，胜负看 Tailwind 产物里的先后顺序，不看 className 里的顺序。**

`className={"bg-panel/30 " + (dragging ? "bg-surface-dark/55" : "")}` 读起来像"拖拽时换底色"，
实际上谁在生成的 CSS 里靠后谁赢，和你写的顺序无关。这类 bug 不报错、不警告，只是"那个效果一直没出现"。

本项目已经因此踩过三次：

| 现象 | 真相 |
|---|---|
| 筛选 chip 的选中态是"蓝框+灰底"而不是实心蓝 | 变体自带的 `bg-layer` 排在调用方传的 `bg-brand-600` 之后，令牌从未生效 |
| 上传区的拖拽高亮从来没亮过 | 底色 `bg-zinc-900/30` 排在高亮 `bg-zinc-800/55` 之后 |
| `UiOptionButton` 的 `menu` 变体差点盖掉网格底色 | 变体里的 `bg-transparent` 会和调用方的 `bg-veil-faint` 抢 |

**三条做法，按优先级：**

1. **写成互斥三元**：`dragging ? 'bg-surface-dark/55' : 'bg-panel/30'` —— 任何时刻只有一个类，根本不存在打架。
2. **变体里不写"默认值等于浏览器默认"的类**（如 button 的 `bg-transparent`，preflight 已经保证），给调用方留出覆盖空间。
3. **确实要叠**：先用 `npx tailwindcss -i src/index.css -o /tmp/x.css` 生成 CSS，`grep -n` 两个类看谁在后面；或者直接上 `!` 强制。

排查命令：

```bash
npx tailwindcss -i src/index.css -o /tmp/x.css && grep -n "^\.bg-panel {\|^\.bg-surface-dark {" /tmp/x.css
```

同理，**透明度修饰符只能用 Tailwind 刻度值**（步进 5：`/25` `/35` `/45` 都行，`/42` `/72` 不生成任何 CSS）。

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

## 动效：三档时长，一种缓动

收敛前实测：**8 种时长**（200/150/300/250/220/100/75/500）、两种缓动混用、
42 处裸 `transition`，且 JS 计时常量与 CSS 时长对不上。

档位定义在 `src/components/ui/motion.ts`：

| 档 | 值 | 用途 |
|---|---|---|
| `fast` | 150ms | hover、颜色、开关、小控件 |
| `base` | 200ms | 弹窗、浮层、下拉、面板开合 —— **默认档** |
| `slow` | 300ms | 大面积位移、通知 Toast、悬浮面板折叠、缩略图扇形展开 |
| `viewer` | 500ms | 全屏媒体查看器的沉浸式淡入淡出 |

位移/覆盖面积越大，时长就该越长——`viewer` 不是随手加的档，是 7 处查看器实际在用的聚类。

**缓动不需要每处写。** `tailwind.config.js` 已把 `transitionTimingFunction.DEFAULT`
改成 `ease-out` 的值，所有 `transition-*` 工具类自动拿到正确缓动。
（Tailwind 原本的默认是 `ease-in-out`，起步和收尾都慢，小尺度 UI 上显得拖沓。）
需要别的缓动时才显式写 `ease-linear` / `ease-in`。

唯一登记的例外缓动是 `UI_EASE_STACK`（缩略图扇形展开的弹性感），和具名阴影同一个逻辑：
有具体功能语义才登记。**不要为了"想要点不一样"再发明缓动。**

### JS 计时必须和 CSS 时长同档

组件常见写法是"先播淡出、再用 `setTimeout` 卸载"。两个数字对不上就会把过渡截断：

```tsx
// ❌ 卸载比过渡早 20ms，淡出收尾被硬切（不报错，只是"关起来有点生硬"）
useDialogTransition(isOpen, 180)          // JS
className="transition-opacity duration-200"  // CSS

// ✅ 两边同档
useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS)  // = UI_DURATION.base
className={`transition-opacity ${UI_DURATION_CLASS.base} ${UI_EASE_CLASS}`}
```

⚠️ 不能写 `` `duration-${UI_DURATION.base}` `` —— Tailwind 扫不到运行时拼接的类名，
不会生成任何 CSS。两边都写字面量，`motion.test.ts` 负责保证它们不漂移。

### 过渡什么、不过渡什么

| 结论 | 说明 |
|---|---|
| ✅ `opacity` / `transform` | 只走合成器，不触发布局与绘制 |
| ✅ `transition-colors` | 颜色变化，代价可接受 |
| ❌ 裸 `transition` | 它会把 `backdrop-filter` 也纳入过渡——每帧重算模糊，是最贵的一种 |
| ❌ `transition-all` | 已归零，别再引入 |
| ❌ 布局属性（`width`/`height`/`padding`/`margin`/`top`/`left`） | 过渡期间每帧重排。要位移用 `transform: translate`，要伸缩优先 `scale` |

确需过渡多个属性时**显式列举**：`transition-[opacity,transform]`。

### 内联 `style={{ transition }}` 走 `uiTransition()`

内联过渡绕过 Tailwind 类，也就绕过了档位约束——收敛前这里散落 9 种时长与 5 种缓动。
时长来自运行时数据（如进度学习给出的时长）或属性没有对应 Tailwind 类时，用这个出口：

```tsx
import { uiTransition, UI_DURATION } from '@/components/ui/motion'

style={{ transition: uiTransition(['opacity', 'transform'], UI_DURATION.slow) }}
// 带延迟：uiTransition(['opacity'], UI_DURATION.slow, UI_DURATION.fast)
```

**绝不要传 `['all']`** —— 那会把 `background-color`、`backdrop-filter` 一起拖进过渡。

### 无法用 transform 替代的布局过渡（已登记，不要"顺手优化"）

这几处过渡的是布局属性，但**改不动**——容器宽度会驱动兄弟元素布局，transform 不参与布局：

| 位置 | 属性 | 为什么改不了 |
|---|---|---|
| `StackedMediaUploader` / `TaskInputPreview` / `AssetLibrarySurface` | `width` | 容器宽度变化要带动兄弟重排，这正是需要的效果 |
| `TabContainer` | `padding` | 助手停靠的 inset，工作区必须真的收缩；resize 期间已用 `--assistant-layout-transition-duration: 0ms` 关掉过渡 |
| `LlmSettingsSection` | `grid-template-rows` | `0fr → 1fr` 是 auto-height 动画的推荐做法，替代方案（max-height / JS 测高）更差 |
| `FloatingInputPanel` | `max-height` | 同上，折叠展开的高度动画 |
| `TaskInputPreview` | `margin` | 缩略图堆叠的重叠间距，margin 影响兄弟位置 |

**已经改掉的**：`FloatingInputPanel` 的 `top` 与 `StackedMediaUploader` 的 `left`/`top`
都已合并进 `transform`（绝对定位元素的位移没有理由走布局属性）。
合并时注意 **`translate` 必须写在 `rotate`/`scale` 之前**，否则旋转缩放会一起作用到位移量上。

## 用排版建立层级，而不是用框

项目此前 72% 的字号决策都落在 `text-xs` 及更小，层级塌缩成"全是小字"，于是只能靠边框背景区分内容。
**先用这五档排版令牌（`styleTokens.ts`）表达层级，再考虑容器：**

| 令牌 | 用途 |
|---|---|
| `UI_TEXT_TITLE_CLASS` | 页面/弹窗主标题 |
| `UI_TEXT_SECTION_CLASS` | 分区标题 |
| `UI_TEXT_BODY_CLASS` | 正文 |
| `UI_TEXT_LABEL_CLASS` | 字段标签 |
| `UI_TEXT_META_CLASS` | 辅助说明、元信息 |

### 登记制视觉数值（以下全部由 ESLint 硬性拦截，写了会报错）

| 维度 | 允许的写法 | 禁止 |
|---|---|---|
| 颜色 | 语义色：底面 `bg-app/panel/surface-dark/layer`；文字四档 `text-text-dark > text-text-soft > text-text-muted > text-text-faint`；边框 `border-border-dark`；媒体与玻璃质感边框用 `veil` 档位 | 一切 `*-zinc-*` 等固定调色板 |
| 动效 | 时长 `duration-150/200/300/500`（对应 `UI_DURATION` 四档）；缓动走全局默认；过渡属性显式列举；内联过渡走 `uiTransition()` | 裸 `transition`、`transition-all`、`transition: all`、未登记时长、自造缓动 |
| 字号 | `text-4xs`(9) `text-3xs`(10) `text-2xs`(11) `text-13` `text-14` `text-15` / `text-xs` `text-sm` `text-base`+ | `text-[Npx]` |
| 圆角 | `rounded-lg`(控件/内嵌) `rounded-xl`(浮层) `rounded-2xl` `rounded-3xl` `rounded-full` `rounded-hairline`；画布节点 `rounded-[var(--node-radius)]` | 其他 `rounded-[...]` |
| 阴影 | `shadow-panel`(仅浮层) / `shadow-node-selected` `shadow-node-error` `shadow-thumb` `shadow-thumb-sm`(具名特效) | `shadow-[...]` |
| 白色半透明 | `veil` 六档：`bg-veil-faint` `border-veil-subtle` `border-veil-soft` `border-veil` `border-veil-strong` `from-veil-bright` | `border-[rgba(...)]` 等 rgba 字面量 |
| 层级 | `z-raised` `z-sticky` `z-dropdown` `z-panel` `z-modal` `z-viewer` `z-toast` `z-tooltip` `z-drag` `z-titlebar` | `z-[9999]` 等任意值 |

**内层圆角不得大于外层。阴影只有浮层能用，内容区一律无阴影。**

必须内联 `style={{ zIndex }}` 时（如每帧改 transform 的拖拽层）用 `Z_LAYERS`（`src/core/theme/zLayers.ts`），它与 Tailwind 配置互为镜像，改一侧要同步另一侧。


画布内部（ReactFlow 节点 / minimap / Alt 拖拽副本）有自己独立的局部 z 刻度，见 `src/features/canvas/canvasUtils.ts`，不要和全局档位混用。

## 状态展示统一走这三个

页面**不要**自己写空/加载/错误块（历史上因此出现同一状态在不同页面长得不一样）：

```tsx
<UiEmpty title="还没有供应商" description="先添加一个吧。" />
<UiLoading message="生成中…"><ProgressBar progress={p} /></UiLoading>
<UiError message={err} onRetry={retry} />
```

状态块**不画卡片**——它已经在某个容器里了。

## 布局与表单

```tsx
<UiRegion maxWidthClassName="max-w-3xl">
  <UiPageHeader title="生成历史" description="共 128 条" actions={<UiButton>清空</UiButton>} />
  <UiGroup title="基础设置">
    <UiFormRow label="语言" hint="影响界面与模型提示词">
      <Dropdown … />
    </UiFormRow>
    <UiFormRow label="启用快速下载" inline>
      <UiSwitch … />
    </UiFormRow>
  </UiGroup>
</UiRegion>
```

分区之间的间距用 `UI_SECTION_STACK_CLASS`，不要每处自己定 `space-y-*`。

## 硬性禁止清单

| 禁止 | 正确做法 |
|---|---|
| 业务组件手写 `rounded-xl border border-border-dark bg-panel` | `<UiPanel>` |
| 在 `UiPanel` 内部再放一个 `border + bg` 的 div | `variant="inset"` / `"bare"` / 纯留白 |
| 用 `UiIconButton` 默认态（自带边框）做工具栏密集图标 | `showBorder={false}` 或 `appearance="hover-only"` |
| 容器内的同质选项集合逐项描边 | `UiOptionButton variant="menu"`，见"选项集合的静息态" |
| 在 `UiOptionButton` 调用点手写 `!border-transparent !bg-transparent hover:!bg-layer` | 用 `variant="menu"`，别再复制这串 |
| 面板/弹窗内部再叠一层自己的底色（`bg-zinc-900/40` 这类） | 表面由外壳统一提供；要切分用分隔线，要下沉用 `inset` |
| 用 `panelClassName` 覆盖 `PanelTrigger` / `Dropdown` 的外壳表面 | 不传即可；同级浮层长得不一样多半就是这么来的 |
| `zinc-*` / `gray-*` 等固定调色板 | 语义色，见「颜色必须跟随主题」 |
| 自己拼 `backdrop-blur-* + bg-black/xx + border-white/xx` | `ui-glass`；且先确认这个浮层真的压在媒体/画布上 |
| `text-zinc-600 dark:text-zinc-400` 双分支 | 直接写最终值，`dark:` 的基础值是死代码 |
| 给已经带边框的控件外面再包一层框 | 去掉外层框 |
| 为"填充空白"添加卡片、边框、阴影 | 留白 / 调整间距 |
| 同一屏出现 3 层以上叠加边框 | 重新走上面的决策树 |
| 复制其他文件的 `border + bg` class 串当模板 | 先判断目标位置在第几层 |

## 排版细节（避免"挤"和"散"）

- **间距用 4 的倍数**：`gap-2 / gap-3 / gap-4`、`p-3 / p-4`；不要出现 `p-[13px]` 这类随手值。
- **同级元素间距统一**：一个分区内所有行用同一个 `space-y-*`，不要一行 `mt-2` 一行 `mt-3`。
- **控件高度统一**：两档具名令牌 —— `UI_FIELD_CONTROL_HEIGHT_CLASS`（42px，独立表单字段）与 `UI_FIELD_CONTROL_HEIGHT_SM_CLASS`（38px，参数面板/逐行控件/面板触发器）。两个值都不是 Tailwind 刻度，所以不要每处手写 `h-[38px]` / `h-[42px]`。
- **文字层级只用三档**：主文本 `text-text-dark`、次要 `text-text-muted`、强调 `text-accent`。不要引入第四种灰。
- **圆角跟随层级**：L1 用 `rounded-xl`，L2/L3 用 `rounded-lg`。内层圆角不得大于外层。
- **颜色只用语义类**：`bg-app` / `bg-panel` / `bg-surface-dark` / `bg-layer` / `text-text-muted` / `border-border-dark`。禁止十六进制（`npm run check:colors` 会拦）。

## 性能：不要让界面整页重绘

界面卡顿（拖动窗口掉帧、进度条期间整页发涩）在本项目里几乎总是同一个原因：**高频瞬态状态写进了持有大列表的那个 state**。

**规则：高频/瞬态状态（进度、hover、拖拽坐标、播放位置）必须放独立 store，由最叶子的组件自订阅。**

反例（已修复，勿复制）：`useTaskState.updateProgress` 曾用 `setTasks(prev => prev.map(...))` 写进度 —— 每次进度回调重建整个 tasks 数组 → 工作区根组件重渲染 → 所有 `useMemo`（过滤/排序）重跑 → 与拖拽 `pointermove` 抢主线程 → 拖动掉帧。

正例（照这个写）：

```ts
// 1. 独立瞬态 store（参考 src/stores/generationTaskProgressStore.ts
//    和 src/stores/canvasGenerationProgressStore.ts）
export const useXxxProgressStore = create<...>((set) => ({ progress: {}, setProgress: ... }))

// 2. 生产者：用 getState() 写，不进 React state
useXxxProgressStore.getState().setProgress(id, value)

// 3. 消费者：叶子组件自订阅，只有自己这一条变化时才重渲染
const progress = useXxxProgressStore((state) => state.progress[id])
```

配套检查项：
- store 的 `set` 里做**相等性短路**（值没实质变化就返回 `{}`），避免无意义通知。
- 任务结束/删除时**清理条目**，别让 store 无限增长。
- 瞬态状态**不进持久化、不进历史快照**。
- 列表项用 `React.memo`，比较函数只比真正需要的引用。

## 必须复用 vs 允许新增

**先查表，再动手。已有实现的一律复用，不要另写一份：**

| 需求 | 必须用 | 不要做 |
|---|---|---|
| 弹窗 | `UiModal` | 手写 `fixed inset-0` + `bg-black/…` + 卡片（存量已全部清零，`check:surface` 规则 C 会拦，别再加） |
| 分组 | `UiGroup` | 手写 `border + bg` 的 div |
| 页面标题区 | `UiPageHeader` | 手写 h2 + p |
| 表单行 | `UiFormRow` | 手写 label + 间距 |
| 空/加载/错误 | `UiEmpty` / `UiLoading` / `UiError` | 内联手写状态块 |
| 按钮/输入/开关等 | `@/components/ui` 的 `Ui*` | 原生 `<button>/<input>` |
| 提示词编辑 | `PromptEditor` | 自己拼 textarea |
| 文件上传/排序 | `FileUploader` / `useReorderDrag` | 重写拖拽 |
| 音频播放 | `@/components/AudioPlayer` | 再写一个播放器 |
| 长列表 | `react-virtuoso`（已是依赖） | 全量 map 渲染上百项 |

**新增组件的门槛**（三条全满足才允许）：
1. 在 `@/components/ui` 与本表中确认没有可复用或可扩展的组件
2. 优先改成扩展现有组件的**枚举变体**（像 `UiPanel variant` / `UiGroup titleTone`），而不是新开一个组件
3. 动手前先向用户说明原因和替代方案，等确认

变体也要克制：新增变体必须是**有限枚举**，不要开放任意 `className` 覆盖视觉。

## Agent 改 UI 的标准流程

```
1. 读需求 → 判断落在哪个工作区/页面
2. 定级：这块内容属于 Region / Group / Divided / Surface / Card 的哪一级
3. 查上表：需要的组件是否已存在 → 存在就复用
4. 用排版令牌建立层级（标题/正文/元信息），先不加任何容器装饰
5. 只在四条准入条件全中时才用 Card
6. 写代码：颜色用语义类，字号/圆角/阴影/层级用登记令牌
7. 跑自检清单
8. 告知用户是否需要重启 electron:dev，并写清需要手动验证的交互点
```

## 页面完成自检清单

- [ ] 这个页面有几层边框叠加？> 2 层就回到决策树
- [ ] 有没有"比父级更亮"的背景块？有就该是 `inset` 或 bare
- [ ] 有没有为了填空白而加的卡片/边框/阴影？删掉
- [ ] 容器里并列的可点项，静息态还在逐个描边吗？该是 `UiOptionButton variant="menu"`
- [ ] 有没有 `zinc-*` / `gray-*` / `slate-*`？改强调色或换主题预设时它们不会跟着动
- [ ] 用 `accent` 当文字色了吗？改用 `text-brand-300`；白字要压实心蓝的话底色用 `bg-brand-500`
- [ ] 破坏性动作（删除/清空）是不是 `variant="primary"`？那会抢走主动作的视觉权重，应该静息中性、hover 才出危险色
- [ ] 改了 `.css` 文件吗？里面不能有 `#hex` 与 `rgba(数字…)`，只能 `rgb(var(--xxx-rgb) / a)`
- [ ] 新加的全局样式/变量放对文件了吗？懒加载的样式表里不能放全局主题变量
- [ ] 同一个 className 里有没有两个类抢同一个 CSS 属性？改成互斥三元
- [ ] 新面板有没有再叠一层自己的底色？表面应该由外壳统一提供
- [ ] 加了模糊吗？只有压在图片/视频/画布上才该加，且只能用 `ui-glass` / `ui-glass-scrim`
- [ ] 动效时长是否落在 150/200/300/500 四档？（缓动已是全局默认，不用每处写）
- [ ] 有 `setTimeout` 卸载动画组件吗？那个数字必须和 className 里的 `duration-*` 同档
- [ ] 过渡的是 `opacity`/`transform` 吗？别过渡宽高间距，也别用裸 `transition`
- [ ] 空/加载/错误三态是否都走了 `UiEmpty/UiLoading/UiError`
- [ ] 字号是否全部来自登记档位（无 `text-[Npx]`）
- [ ] 圆角是否只用了 `rounded-lg/xl/full`，且内层不大于外层
- [ ] 阴影是否只出现在浮层
- [ ] z-index 是否用了语义 token
- [ ] 同级元素间距是否统一（不要一行 `mt-2` 一行 `mt-3`）
- [ ] 高频状态（进度/hover/拖拽）是否放在独立 store 而非大列表 state
- [ ] 列表超过 ~50 项是否考虑了虚拟化

## 对比度：静态检查查不到，必须实测

颜色是否达标取决于**渲染后的实际叠加结果**，grep 无能为力。
`npm run check:ui-visual` 会启动真实 Electron（复用 `electron:smoke` 的 CDP 链路），
在渲染后的 DOM 上算四项：表面叠层数 / 文字对比度 / 内层圆角 / 非浮层阴影。

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

## 完成前必跑

```bash
npm run check:surface && npm run check:colors && npm run lint
```

改了动效档位或 `motion.ts` 再补一条（它保证 ms 数值与 `duration-*` 类不漂移）：

```bash
npx vitest run src/components/ui/motion.test.ts
```

**改了颜色令牌、或想确认真实渲染效果**，跑视觉审计（需要先 `npm run electron:build`）：

```bash
npm run check:ui-visual
```

它会截图并逐屏输出四项指标，全 0 才算干净。想要截图请看脚本里的 `page.screenshot` 用法——
观感问题（对齐、空格子、视觉权重错位）光看代码看不出来，得看图。

`check:surface` 报三类问题：

- `[A]` 手写面板表面 → 改用 `<UiPanel>`
- `[B]` 同文件多处卡片表面 → 疑似卡片套卡片，内层降级
- `[C]` 手写弹窗（`fixed inset-0` + 黑色遮罩但没用 `UiModal`/`AlertDialog`）→ 改用 `UiModal`

存量已全部清零，`check:surface:strict` 已接入 `build` / `electron:build` 与 CI，**违规会直接让构建失败**。改完必须跑一次确认通过。

确需例外时在该行上方加注释 `ui-surface-allow` 并写明理由；只允许行级豁免，禁止文件级 `ui-surface-allow-file`（否则该文件将来真正的套娃也会被放行）。

已确认的例外类别：全屏沉浸式媒体查看器（`mediaViewer/` 三个 Modal）不套用 `UiModal`——`UiModal` 是居中卡片语义，与铺满视口的查看器不匹配。

`npm run check:surface`（告警式）可用于本地快速查看，构建链路走的是 `--strict`。

## 相关规范

- 组件复用与原生标签落点、颜色令牌三处入口：见 [CLAUDE.md](../../../CLAUDE.md) 的「UI Primitive 单点落地」与「关键约束」
- 画布节点的行组件拼装：见 skill `canvas-node-builder`
- 提示词编辑器、文件上传控件：必须复用 `PromptEditor` / `FileUploader`，不要重写
