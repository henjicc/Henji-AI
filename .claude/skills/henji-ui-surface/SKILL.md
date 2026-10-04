---
name: henji-ui-surface
description: Henji-AI 新建或改造任何界面/页面骨架/面板/弹窗/侧栏/设置分区/节点 UI，或调整按钮层级、分隔线、颜色、图标、毛玻璃、动画、层级时使用。主文件涵盖“石墨”设计系统速览（主题引擎与语义令牌、按钮五档默认静默、淡强调底选中态、尺寸档位）、页面骨架的横向条带上限与命令带、表面层级（surface/elevation）铁律、五级容器词汇表、分隔线准入、选项集合静息态与选中态词汇表、必须复用的组件与枚举；颜色/材质、动效、图标、排版令牌、性能分层、静默失效坑、全界面核对规范与操作工具拆在 references/ 按需读。触发场景：用户要求"做一个 XX 面板/页面/弹窗"、"这个界面不好看/太挤/像卡片套卡片"、"顶部堆了好几行/几个条/布局不合理"、"标题栏和工具栏能不能合并"、"这块儿怎么像张卡片"、"帮我美化一下这个界面"、"加一个设置分区"、"统一一下 UI/配色/动画/模糊"、"这个动画太快/太慢/很生硬"、"这个界面卡顿/拖动掉帧"、"切换主题后有些地方没变色"、"为什么有的按钮有边框有的没有"、"这里要不要加分隔线"、"图标不一致"。
---

# Henji-AI 界面表面与层级规范

## 为什么需要这份规范

项目的 `Ui*` primitives 已经组件化，但**组件化 ≠ 界面好看**。实测本仓库最常见的三类问题：

1. **卡片套卡片**：`AssistantSidebar`（`bg-panel` + border）里放 `AssistantConversation` 的消息块（又是 `bg-panel` + border）；`Settings/index.tsx`（`bg-panel` 弹窗）→ `SectionCard`（又一层 `bg-panel`）→ 内部行（第三层 `bg-surface-dark`）。三层边框叠在一起，视觉上就是"一张卡里弹一张卡又套一张"。
2. **条带叠条带**：工具箱 → 图片编辑，从窗口顶到画布之间横着切了 4 刀（标题带 / "打开图片"带 / 工具带 / 样式带），分别来自 3 个文件，其中两条同底色的带中间还夹了一条透明带。
3. **该扁平的地方带了壳**：`UiPanel`/`UiIconButton`/`UiOptionButton` 的**默认值自带 border + bg**，每个组件都假设自己是最外层独立卡片。在容器内部使用时，就会多出一层不该有的边框背景。

前两类是**同一个根因在两个方向上的表现**：每一层壳都以为自己是最外层，于是纵向各画一圈边框、横向各加一条头带。第 3 类则是表面 token 把 `border` 和 `bg` 打包绑死（见 `styleTokens.ts` 的 `UI_PANEL_SURFACE_CLASS` / `UI_FIELD_SURFACE_CLASS`），且没有"只分组、不画框"的官方写法。本 skill 提供这几条缺失的规则。

## 参考文档（按需读，不要一次全读）

本文件只放**每次改 UI 都要用**的骨架规则。细分主题拆在 `references/`：

| 什么时候读 | 文件 |
|---|---|
| 调颜色、写 `.css`、加毛玻璃、改对比度、碰主题引擎或语义令牌 | `references/color-and-material.md` |
| 写任何过渡/动画，或用 `setTimeout` 卸载动画组件 | `references/motion.md` |
| 用到任何图标 | `references/icons.md` |
| 定字号/圆角/阴影/层级/间距 | `references/typography-and-tokens.md` |
| 界面卡顿、拖动掉帧、长列表 | `references/performance.md` |
| "我改了但没生效" | `references/pitfalls.md` |
| 改完界面做视觉验收、按区域核对全界面、判断旧界面残留、写操作步骤截图 | `references/review.md` |

## 三条铁律（先记住这三句）

> **纵深：同一层视觉深度，只画一次边框/背景。**
> 进入一个已经有边框或背景的容器后，内部分组**必须**改用留白 / 分隔线 / 更暗的底色，**不得**再叠一层 `border + bg + rounded`。

> **水平：一个视图只画一条命令带。**
> 返回、标题、文件上下文、工具、导出动作全部进这一条；随工具变化的参数用紧贴其下的从属带，且与命令带**共用同一块底色和同一条下边框**。

> **内容：正式界面只展示用户需要据此行动、决策、理解结果或恢复失败的信息。**
> `revision`、schema/协议版本、请求 ID、哈希、缓存/Worker/渲染管线状态、调试计数等内部状态一律进入日志、诊断页或开发模式；不得通过改名、加 tooltip 或补充解释继续留在正式界面。

参考 Atlassian 的表述：能用边框或留白区分时，就不要用抬升（卡片）来分组。成熟设计系统普遍只保留 4~6 个层级并刻意克制。水平方向同理——桌面编辑器（VS Code、Figma、Photoshop）顶部一律是**一条**命令带加一条可选的上下文带，不会因为壳换了一层就多长一条。

## “石墨”设计系统速览（界面重设计计划，重要记录 001–004、010、011）

设计稿与决策在 `docs/task/界面重设计与主题引擎/`（`设计稿/*.dc.html` 是本地源码副本，`重要记录.md` 是决策）。
核心一句话：**背景只表达“这里是唯一主动作”或“这项被选中”；层次靠明暗不靠描边；强调色只给主动作、焦点、播放头与选中指示。**

| 维度 | 规则 | 细则 |
|---|---|---|
| 颜色 | 三层：**种子**（模式、底色色相/倾向、窗口亮度、层级对比度、强调色）→ 主题引擎推导的**语义令牌**（CSS 变量 + Tailwind 类）→ 组件内部令牌。**界面只引用语义令牌**；预设石墨/深海/胶片/纸白只是种子组合，文字三档按对比度 ≥ 4.5:1 求解 | `references/color-and-material.md` |
| 按钮 | `UiButton` 五档 `primary`/`secondary`/`quiet`（默认）/`danger`/`dangerSolid` + `link` + `media`；`UiIconButton` 默认静默，`on`/`tone`/`shape`/`size`。外观只由枚举决定，调用点 className 只放布局 | 本文「动作层级」 |
| 选中 | 一眼可辨：**淡强调底**（`selected-accent`，强调色低透明度）+ 强调文字 / 勾 / 指示条（重要记录 012，修订 003 的中性抬升）；强调色**实底**只给唯一主动作；悬停只用中性抬升，悬停与选中不得同色 | 本文「选中态词汇表」 |
| 尺寸 | 控件高 28/32/36（`size` sm/md/lg）；字号 20/16/14/13/12/11（正文 13）；圆角 6 控件 / 8 输入与菜单 / 12 浮层；间距 4/8/12/16/24/32；动效 120/180/240（查看器 500） | `references/typography-and-tokens.md`、`references/motion.md` |
| 材质 | 主按钮材质（细微渐变、顶部高光、内描边、投影、按下下沉）只在 `primary` / `tone="accent"`；**玻璃只压在图片、视频、画布上**（`ui-glass`、`UiPanel variant="glass"`、浮层 `surface="glass"`），纯色界面上的浮层一律实底 | `references/color-and-material.md` |
| 骨架 | 一个视图一条命令带：`UiToolbar variant="command"`（左端 / `center` / `trailing` / `subordinate`），一个表面一个主动作 | 本文「页面骨架」 |
| 字体 | 拉丁与数字 Geist，时间码与数值 Geist Mono（`UI_TEXT_TIMECODE_CLASS`），中文系统字体 | `references/typography-and-tokens.md` |

这些约束大多已进门禁：`check:colors`（调色板/黑白/rgba/命名色/旧别名/未定义颜色类）、`check:surface:strict`（规则 A–E，E = 调用点覆盖组件外观）、`check:icons:strict`（规则 A–C）、`check:ui-residue`（任意值类与内联尺寸口径、私有样式、零引用、旧文案）、ESLint 令牌规则；对比度、条带数、折行、截断、选中态差异、浮层裁切由 `check:ui-visual` 在真实 DOM 上判。

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
<UiPanel variant="glass">  {/* 5 玻璃浮层：只压在图片、视频、画布上 */}
<UiPanel variant="inset">  {/* 4 内嵌：仅 bg-window/40 + rounded-lg，无边框无阴影 */}
<UiPanel variant="bare">   {/* 4 纯容器：只有圆角 */}
<UiGroup title="基础设置">  {/* 2 分组：零装饰，标题 + 间距；窄停靠面板用 titleTone="compact" */}
<UiGroup divided>          {/* 3 分隔：上方一条线 */}
```

**方向铁律：内层背景只能比外层更暗，不能更亮。** 比父级亮 = 视觉上"浮起来" = 卡片。
表面令牌由主题引擎按“窗口 ± n 级”推导，深色下逐级变亮：`bg-gap` < `bg-window` < `bg-panel` < `bg-raised` < `bg-hover` < `bg-selected`
（浅色模式按同一规则反向：面板比窗口亮，`raised`/`hover`/`selected` 逐级加深）。`bg-control*` 只给控件本身，`bg-media` 是不随主题的媒体底。
判断“比父级亮”时看的是**层级**而不是像素明暗：在面板里铺 `raised` 就是抬了一级。
在 `bg-panel` 的弹窗里用 `bg-raised` 做分区，就是在造卡片。

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

## 页面骨架：横向条带（做整页/工具页之前先看这节）

上面几节全部在管**纵深**。这一节管**水平**：从窗口顶到内容区之间，横着切了几刀。

组件级审查（每个按钮用没用对 primitive）**发现不了这类问题**——每一条带单独看都合规，丑的是它们摞在一起。所以看整页时的第一个动作是**数条带**，不是看按钮。

### 三类条带与数量上限

| 类 | 名称 | 每视图允许 | 装什么 | 视觉 |
|---|---|---|---|---|
| A | **命令带** | **恰好 1 条** | 返回、标题、文件上下文、主工具组、导出/保存动作 | `UiToolbar variant="command"`：44 高、`bg-panel`、下边一条 `border-gap` 发丝线、`px-2.5`；不要手写 `h-11 border-b bg-*` |
| B | **从属参数带** | 0~1 条，必须紧贴 A 下方 | 只随当前工具变化的参数（颜色、线宽、字号） | `UiToolbar` 的 `subordinate`：**不自带底色、不自带边框**，与 A 共用同一块底色和那条下边框 |
| C | **状态带** | 0~1 条，页面底部 | 只读状态、进度、计数 | 无边框，`text-text3` |

**连续操作条带上限 = 2（A + B）。** 出现第三条就是骨架错了，不是间距问题。

### 决策树：这东西要不要新开一条带？

```
我要往页面顶部加一个东西，它是什么？
├─ 返回 / 标题 / 文件名 / 主动作 / 工具        → 进现有命令带（没有就建**一条**）
├─ 只随当前工具变化的参数                      → 从属带，紧贴命令带，不另画底色与边框
├─ 只读状态、进度、计数                        → 命令带右端 `ml-auto`，或页面底部状态带
└─ "它跟上面那些不是一类，单独放一行吧"        → 停。先问它是不是上面三类之一，
                                                 99% 的情况是，只是懒得往已有带里塞。
```

### 外层壳已有命令带时：注入，不要再嵌一层壳

功能组件被塞进一个已经有命令带的外壳里时，**不能自己再长一条头带**。正确做法是把内容**作为 props 注入外层那一条带**——项目里已经有这个出口，`ImageEditor` 的 `toolbarActions` 就是（复制 / 加入资产库 / 另存为三个按钮就是这么进到工具带右端的）。

```tsx
// ❌ 外壳已经有一条命令带了，功能组件又开一条自己的行
<div className="p-4">
  <div className="flex items-center gap-2">   {/* 第二条带：只为了放一个按钮 */}
    <UiButton>打开图片</UiButton>
    <span>{fileName}</span>
  </div>
  <Editor />
</div>

// ✅ 注入到已有的那条命令带里
<Editor
  toolbarLeading={<><UiButton>打开图片</UiButton><span>{fileName}</span></>}
  toolbarActions={<UiButton variant="primary">另存为…</UiButton>}
/>
```

### 返回入口的三种形态（不要为返回单开一条带）

返回按钮的位置由**这个页面长什么样**决定，不由"哪个文件画的"决定：

| 页面类型 | 返回落点 | 例子 |
|---|---|---|
| 有页面标题的二级页面 | `<UiPageHeader onBack backLabel>`，渲染在标题左侧 | 3D 镜头参考工程列表、图片编辑空态、资产库工作区 |
| 自带命令带的全屏工作面 | 那条命令带的**左端** | 3D 场景编辑器、图片编辑器 |
| 没有命令带的全屏工作面 | 浮在内容上的玻璃返回按钮：`ui-glass` 容器包一个静默 `UiButton`（画布底随主题，不用 `media` 档，重要记录 011） | 画布项目内 |

**禁止为"返回 + 页面名"单画一条 `h-10` 横带。** 它会和应用标题栏叠成"双标题栏"，
而且页面名通常和下面的页面标题重复一遍。

实测踩过：`ToolboxWorkspace` 曾统一画一条「← 工具名」带，于是 3D 镜头参考列表页
纵向出现两遍"3D 镜头参考"；为了让编辑器形态只剩一条带，又加了 `ownsCommandBar`
与 `view !== 'editor'` 两个开关逐个工具关掉。判据换成"页面有没有标题/有没有命令带"
之后，那两个开关连同整条带一起删掉了。

同一批返回入口当时长成四种样子：外层条带图标、工具自绘条带图标、命令带左端图标、
画布上的玻璃文字按钮，以及资产库放在标题**右侧**动作区的文字按钮。用户在应用里
换一个页面就要重新找返回在哪——这是"每处各自决定"的必然结果，不是审美问题。

### 实测：同一个工具箱里，好例子和坏例子并存

| 视图 | 条带数 | 情况 |
|---|---|---|
| 工具箱 → **3D 镜头参考** | **1 条** | ✅ `CameraStageEditor` 的 `h-11` 带里塞下了返回 + 撤销 + 快捷添加 + 视口工具 + 中间路径上下文 + 右端状态/徽标/设置 |
| 工具箱 → **图片编辑** | **4 条** | ❌（已修）`ToolboxWorkspace` 标题带 → `ImageMarkTool` 的"打开图片"裸行 → `ImageEditorShell` 工具带 → 样式带；外层标题带已按上一节删除，返回改进页面标题 |

更值得注意的是：`ToolboxWorkspace` 里曾有个 `showToolHeader` 开关，**专门为 3D 镜头参考关掉外层标题带**，好让它只剩一条。也就是说这个问题早就被撞见过，但当时是给单个工具开特例躲过去的，没有沉淀成规则——于是下一个工具（图片编辑）原样又撞了一次。现在外层标题带整条删除，那个开关也不复存在。

**结论：特例是规则缺失的信号。** 再看到"为某个页面单独关掉某段骨架"的开关时，先问它是不是该反过来变成默认。

### 横向 padding 必须对齐

图片编辑那 4 条带的横向 padding 分别是 `px-2` / `p-4` / `px-3`，于是返回箭头、"打开图片"、工具组的左端落在三个不同位置。**同一视图内所有条带与其下的内容区用同一个横向 padding**，改一处就该一起改。

### 全屏工作面不套卡片

画布、编辑区、预览区这类**铺满剩余空间的工作面**不是卡片——对照「卡片准入条件」四条：不能单独移动、不是并列实体、脱离上下文无意义，一条都不中。

```tsx
// ❌ MarkCanvas 当时：工作面自带卡片外观，外层再给 p-4 空白，于是整个编辑器浮成一张卡
<div className="rounded-xl border border-line bg-gap/85">

// ✅ 铺满，边界由它和命令带之间的那条下边框表达；放图片/视频的视口用 bg-media（不随主题），其余用 bg-gap
<div className="bg-gap">
```

判据：**这块区域会不会随窗口一起长大？** 会，就不是卡片。要给它一个更暗的底以便和 chrome 区分是可以的，但不要 `rounded` + `border` + 外层留白三件套——那三样凑齐就是卡片。

## 动作层级：视觉重量 = 动作的重要性

上面几节管容器和骨架，这一节管**按钮本身该有多重**。

主流设计系统都是同一个阶梯（Material 的 filled/outlined/text、Apple 的
prominent/bordered/plain、Fluent 的 primary/default/subtle）。本项目（重要记录 003，任务 2.1）：

| 档 | `UiButton variant` | 图标版 `UiIconButton` | 用途 |
|---|---|---|---|
| 主 | `primary`（材质实底：顶部高光、内描边、投影，按下下沉） | `tone="accent"`（圆形，如生成） | **一个表面只允许一个**，这一屏的主动作 |
| 次 | `secondary`（无边框填充 `bg-control`） | —— | 弹窗与表单里的普通动作 |
| 辅 | `quiet`（**默认**，静息无底，悬停出底） | 默认（静默） | 工具栏、命令带、行内、菜单 |
| 危险 | `danger`（静息同 quiet，悬停显红）/ `dangerSolid`（只用于确认弹窗） | `tone="danger"` | 删除、清空、移除 |
| 链接 | `link`（强调文字、悬停下划线、行内高度） | —— | 行内跳转/说明链接，不计入动作层级 |
| 画面上 | `media` | `tone="media"` | 压在图片/视频/画布上的控件（固定媒体叠层令牌） |
| 窗口控件 | —— | `UiWindowControl action platform` | 只用于无边框窗口标题栏的最小化/最大化/还原/关闭（Windows 36×28 静默、关闭悬停危险实底；macOS 交通灯取状态实底令牌） |

尺寸：`UiButton size` sm/md/lg = 28/32/36（默认 md）；`UiIconButton size` xs/sm/md/lg = 20/24/28/32（默认 md），
xl 40 只给全屏查看器、画面中央播放键。开关开启用 `UiIconButton on`（淡强调底 + 强调色图标）。
**外观只由 variant / size / tone / on / shape 决定**，className 只放布局；调用点改底色、边框、文字色、圆角、
阴影、高度或字号会被 `check:surface` 规则 E 拦截（确属非按钮外观的命中区，如拖动柄、时间轴记号，行级
`ui-surface-allow` 写明理由与接手任务）。

**默认静默**：不传 `variant` 就是 `quiet`，不传 `tone` 就是静默图标按钮——这是绝大多数按钮该有的样子。
需要“看得见”的只有三种：唯一主动作（`primary` / `tone="accent"`）、弹窗与表单里的普通动作（`secondary`）、
确认弹窗的破坏性确认（`dangerSolid`）。旧档位 `ghost` / `muted` / `plain` / `glass`、旧参数 `appearance` / `showBorder` /
`hoverVariant` 已删除且不留兼容层（重要记录 011），不要再引入同义档位；确需新形态时给组件加有限枚举并登记到「必须复用」表。

### 两条硬规则

1. **一个表面只有一个主动作。** 出现第二个实底按钮，用户就不知道该点哪个。
2. **同一组、同一层级的动作必须同档。**
   不能因为"这里太挤了"把其中一个降档——那是**拿视觉语言解决布局问题**，
   用户读到的信息会变成"这个按钮没那么重要"，而事实不是。

> 实测踩过：图片编辑命令带右侧的「打开」和「复制 / 加入资产库」同属文件类次级动作，
> 为了给工具组腾 44px 宽度被降成了无边框图标，一眼就看出不对。宽度问题要用缩短文案、
> 图标化**整组**、或接受轻微偏移来解决，不能只降其中一个。

### 动作 ≠ 模式

工具栏里的工具（选择/标注/矩形…）**不是按钮**，是"我现在处于哪个模式"，
点它改变的是"接下来会发生什么"，不是"立刻发生一件事"。
它属于**选中态语言**，不属于动作层级：静息不描边，选中用淡强调底（重要记录 012），
文字工具用 `UiChipButton selectionRole="navigation"`，图标工具与开关用 `UiIconButton on`，把实底强调色让给那个唯一的主动作。

同理，参数面板里的"当前值是什么"（形状、比例、档位）是**单选**，
用 `UiOptionButton active`（淡强调底 + 强调文字）——详见「选中态词汇表」。

## 分隔线：分组的第二手段，不是第一手段

分组有三级，**按顺序往下选，能停在上一级就别用下一级**：

1. **间距**（格式塔邻近律）—— 首选，零视觉成本
2. **分隔线** —— 间距不够用或空间紧张时
3. **容器 / 边框** —— 最后手段（回到「五级容器词汇表」）

### 准入判据（只有一条）

> **两侧的交互语义根本不同，用户不会把它们当成一串连续操作。**

| 场景 | 判定 |
|---|---|
| 工具组 ┃ 撤销/重做/清空 | ✅ **模式** vs **动作**——点工具是改变后续行为，点撤销是立刻发生一件事 |
| 打开 ┃ 复制/加入资产库/另存为 | ❌ 都是动作，只是输入 vs 输出。差异远小于上一行，间距就够 |
| 两组同类按钮，只是"感觉该分开" | ❌ 加大间距 |

### 数量上限

**一条 bar 上最多一条分隔线。** 第二条会把它切成三段，而右端的主动作实底本身
已经是"终点"标志，再加竖线的信息增量接近零。

## 选项集合的静息态：不描边

上面的决策树管容器，这一节管**容器里那一堆并列的可点项**（菜单项、模型网格、分辨率格子、列表行）。

> **边框表达的是"边界"，不是"可点击"。**
> 一屏里几十个选项各自描边时，边框互相抵消、不再传递任何信息，只剩视觉重量。
> 可点击性由 **hover 反馈 + 排布规律**表达，不需要静息态的框。

`UiOptionButton` 的 `variant="menu"` 就是这条规则的落点：静息态无边框无底色，hover 出中性悬停底，选中态是淡强调底（`selected-accent`）+ 主要文字 + 强调色勾。

### 判据（两条都要满足才用 `menu`）

1. **是同质选项的集合**：≥3 个由 `map` 渲染的并列 peer，或语义上明确的二选一分段。孤立的单个按钮不算 —— 那种情况下框才真的在划定边界。
2. **去掉框之后形状还在**。满足任一即可：
   - 已被可见容器圈住（浮层面板、弹窗左栏、下拉列表）——容器已经画过一次边界了
   - 每项自带足以撑出形状的内容（缩略图、图标块、多行文本、比例示意图）
   - 是二维网格 —— 用 `variant="grid"`：静息铺一层 raised 撑格子，**但仍然不描边**（底色已经表达过一次边界，边框是多余的第二次）；不要在调用点手写 `bg-veil-faint`

### 反例：这些**要保留**边框

| 场景 | 为什么 |
|---|---|
| 纯文字 chip 组（筛选 chips、数值 marks、`CompositeRadio`）| 直接落在面板底色上，去框后变成裸文字，点击可供性丢失 |
| 内容入口卡（工具箱、工程列表）| 是内容卡不是选项，走 Card |
| 表单单选 `RadioInput` | 框就是命中区域 |
| 动作按钮（"上传音频"、"选择文件"）| 是按钮不是选项，走 `variant="flat"` |

## 选中态词汇表：先判断语义，再选强度

“选中”不是一种视觉，而是四种不同语义。业务层优先传递 `active` / `checked` 与
`selectionRole`，由 `Ui*` primitive 消费 `styleTokens.ts` 中的状态令牌，不要在调用点
复制蓝底、蓝框或强调文字。

| 语义 | 表达 | 通用落点 |
|---|---|---|
| 导航：正在看哪里 | 淡强调底 + 主要文字（图标强调色）+ 强调色方向指示条 | `UiNavButton active`；横向 chip 用 `selectionRole="navigation"`；面板标签用 `selectionAppearance="subtle"`（主要文字 + 底部细线）；应用标题栏的工作区导航用 `selectionAppearance="workspace"`（纯文字 28 高，底部短指示条；`aria-current` 只给当前工作区，同栏里只打开浮层的开关项用 `on`：淡强调底无指示条 + `aria-pressed`）；面板标签底线用强调色 |
| 单选：当前值是什么 | 淡强调底；分段、格子、小样用强调文字，菜单项标签保持主要文字 + 强调色勾（重要记录 012，不用强调色实底） | `UiOptionButton active`：菜单 `menu`、分段 `segment`（放在 `UI_SEGMENTED_TRACK_CLASS` 轨道里）、网格 `grid`、带小样的格 `tile`、圆形色样 `swatch`（选中为主要文字色外圈一环——强调色外圈压在强调色样上看不清）、封面内容卡 `cover`（强调描边，只画在 `UI_COVER_FRAME_CLASS` 封面框上）；双段开关 `UiSwitch appearance="segmented"` 同此 |
| 多选/标签：集合中哪些已选 | 强调描边 + 淡强调底 + 强调文字 | `UiChipButton active`；多选的选项卡用 `UiOptionButton selection="multiple"`；逐字稿词块 `UiTextToken selected` |
| 布尔：功能是否开启 | 强调色只进入开关轨道、复选框本体或图标本身，整行保持静息 | `UiSwitch checked` / `UiCheckbox checked`；图标开关 `UiIconButton on`（淡强调底 + 强调色图标，写 `aria-pressed`）；标题栏导航里的浮层开关 `UiChipButton on` |

默认态不是第五种选中态：它保持当前表面的中性视觉。不要用整行实底表达“已启用”，
也不要把多选语义画成单选项的样子（或反过来）。下拉当前项 = 淡强调底 + 主要文字 + 强调色勾；菜单宽度按选项内容自适应（含勾槽与竖向滚动条，上限 360 再截断；`Dropdown` 默认 `panelWidthStrategy="options"`，只有菜单必须与触发器等宽时才传 `button`）。

**同一处的交互层级不得同色**：悬停或选中的容器里，行内控件仍须与容器底可区分。字段触发器悬停取 `control-hover`（不是 `hover`）；悬停会换底的行容器里放取值触发器时，行悬停只加强描边（画布节点参数行）。选中项上悬停用 `selected-accent-hover`，不回落中性悬停。

## 状态展示统一走这三个

页面**不要**自己写空/加载/错误块（历史上因此出现同一状态在不同页面长得不一样）：

```tsx
<UiEmpty title="还没有供应商" description="先添加一个吧。" />
<UiLoading message="生成中…"><ProgressBar progress={p} /></UiLoading>
<UiError message={err} onRetry={retry} />            {/* 不传 title 时缺省标题“操作未完成”；有更具体的说法就传 title */}
<UiEmpty size="node" icon={<ImageIcon className="h-7 w-7" />} title="等待结果" />  {/* 画布节点内容区的空占位 */}
```

状态块**不画卡片**——它已经在某个容器里了。失败必须一眼可辨：`UiError` 总有一行危险色标题（任务 5.8），
标题已经是完整说法时传 `title={…} message=""`；不是失败的提示（“请先选择片段”）用 `UiEmpty`，不要借 `UiError`。

## 信息准入：先判断用户价值，再决定是否显示

界面不是运行状态转储，也不是开发文档。新增任何文字、数字、徽标、提示或状态前，必须确认它至少帮助用户完成一件事：

1. 知道下一步能做什么
2. 在结果、成本、时间或数据影响之间做决定
3. 理解当前进度、结果或产物的用户可感知属性
4. 从失败中恢复

全部不命中时直接删除。**“代码里有这个字段”“测试需要观察”“看起来能体现状态”都不是展示理由。** 删除后不影响用户完成任务的信息，不得仅换成更口语的名称继续保留。

禁止在正式界面展示：内部 `revision`、schema/协议/迁移版本、请求/任务/资源 ID、哈希、缓存命中、Worker/GPU/渲染管线、队列与重试代次、调试计数、风险分级，以及用架构术语解释实现的常驻正文。它们进入结构化日志、诊断页、开发模式或自动化测试。

确实影响用户的技术限制必须改写为用户能判断的影响与后果，例如“导出后将失去透明背景”，而不是解释内部降级管线。只有费用、数据丢失、权限、安全、长等待或不可逆操作等高影响信息才默认允许常驻；其余帮助说明仍按 tooltip 规则克制呈现。

已知反例：图片编辑器曾把 `document.revision` 放进命令带并显示为“版本 X”。这个数字只用于撤销、自动保存和淘汰过期渲染，用户不能选择或管理；正确处理是移除，而不是改名成“编辑次数”。

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

窄停靠面板（剪辑效果控件、属性栏）里 16/600 的区块标题和 14/500 的行标签都太重：分组用 `UiGroup titleTone="compact"`
（12/600 次要文字、间距收紧），行用 `UiFormRow density="compact"`（标签 12 次要文字），两者成对使用，不要在调用点改字号。
`UiFormRow` 的 `hint` 只放“不看会选错”的常驻说明，背景知识放 `info`（标签文字本身悬停触发，见下文 tooltip 规则）。

字段（任务 2.2）：`UiInput` / `UiSelect` / `UiFieldTrigger`（`Dropdown`、`PanelTrigger` 的按钮）/ `NumberInput` 都是 raised 无边框表面、聚焦一圈强调色焦点环，高度只由 `size` 决定（sm 28 / md 32 默认 / lg 36）。`NumberInput` 自带数值拖动：在读数或标签上按住左右拖动改值（Shift 精细、Alt 粗调），单击进入编辑，读数不会被步进列裁掉。

字段排布（任务 3.2）：一行参数条（如生成输入区底栏）不要做成“标签在上 + 字段框”的表单。在容器上提供 `UiFieldLayoutContext` = `toolbar`：参数标签移到控件左侧（辅助文字 12），`Dropdown` / `PanelTrigger` 的触发器自动改静默皮肤，参数开关改胶囊；多行文本、单选卡片、上传类等大块控件仍按表单排布。两者打开的浮层内容一律重置回 `form`，不要在调用点逐个传 `appearance` 或手写行内标签。

## 参数说明的受众：`description` 给助手，`tooltip` 给用户

本节只约束模型 / schema 参数的 `ParamDef`、`ParamPresentation` 等参数元数据，
不影响 `UiPageHeader description`、`UiGroup description` 这类明确属于页面内容的组件属性。

| 字段 | 受众与用途 | 界面呈现 |
|---|---|---|
| `description` | 给智能助手、能力反射、语义检索理解“这个参数做什么、影响什么” | **不得直接渲染到正式界面** |
| `tooltip` | 给用户解释不明显的含义、输入限制、操作后果 | 参数名称文本本身在 hover / focus 时触发 tooltip |
| `placeholder` | 展示输入格式或一个可替换的例子 | 只放在输入控件内部，不承担规则说明 |
| 校验 / 状态文案 | 当前值为什么不可用、缺什么前置条件、处理是否失败 | 紧邻控件的短状态；只在状态存在时显示 |

**说明性文本只要是给用户看的，就必须进入 `tooltip`。** 不要为了“让用户一定看到”把它
摊成控件下方的常驻正文；常驻说明会打断参数网格、扩大单个字段的视觉占位，并让一条局部约束
看起来像整个面板的主要内容。

参数存在 tooltip 时，必须由**参数名称文本本身**在 hover / focus 时触发：名称需要可聚焦，保证
鼠标与键盘均可访问，但不得在名称旁增加 Info、问号等额外提示图标。参数没有 tooltip 时保持普通、
不可聚焦的标签，不添加空触发器或伪交互。不要把整个输入框、上传区或参数容器包进 `Tooltip`，
否则移动到控件上会意外弹出，触发范围也会与“名称解释参数”的语义不符。

`description` 与 `tooltip` 可以同时存在，因为受众不同：前者可以写得更偏语义和能力边界，
后者应使用用户能直接理解的短文案。界面层不得在 `tooltip` 缺失时自动回退渲染 `description`。

## 硬性禁止清单

| 禁止 | 正确做法 |
|---|---|
| 业务组件手写 `rounded-xl border border-line bg-panel` | `<UiPanel>` |
| 在 `UiPanel` 内部再放一个 `border + bg` 的 div | `variant="inset"` / `"bare"` / 纯留白 |
| 在按钮调用点用 className 改底色、边框、文字色、圆角、阴影、高度或字号 | 用 `variant`/`size`/`tone`/`on`/`shape`；确需新形态时给组件加有限枚举 |
| 容器内的同质选项集合逐项描边 | `UiOptionButton variant="menu"`，见"选项集合的静息态" |
| 在 `UiOptionButton` 调用点手写 `!border-transparent !bg-transparent hover:!bg-hover` | 用 `variant="menu"`，别再复制这串 |
| 面板/弹窗内部再叠一层自己的底色（`bg-zinc-900/40` 这类） | 表面由外壳统一提供；要切分用分隔线，要下沉用 `inset` |
| 用 className 覆盖 `PanelTrigger` / `Dropdown` 的外壳表面或触发器外观 | 外壳只有 `surface`（`solid` 默认 / 压在画布与媒体上用 `glass`）与 `panelPadding`（none/menu/content）；触发器只有 `size`（sm/md/lg）与 `appearance`；`buttonClassName` 只放宽度等布局（规则 E） |
| 字段、选项、标签、导航在调用点改高度或字号（`h-8 text-xs`） | 用 `size`（sm 28 / md 32 / lg 36）；选项与标签的 `h-full`、`min-h-*` 属于布局，可以写 |
| `zinc-*` / `gray-*` 等固定调色板、`text-white` / `bg-black/40` 等黑白类、rgba 字面量、命名色 | 语义令牌类，见 `references/color-and-material.md`；压在媒体上用 `text-on-media` / `bg-media-control` / `border-media-line`（`check:colors` 拦截，登记不可再增） |
| 旧令牌别名类（`bg-app`、`bg-surface-dark`、`bg-layer`、`bg-bg-dark`、`border-border-dark`、`text-text-dark`/`-muted`/`-soft`/`-faint`、`brand-*`、不带后缀的 `text-danger` 等）与旧 CSS 变量（`--app-rgb`、`--text-muted-rgb`、`--ui-surface-panel` …） | 直接写语义令牌（`bg-window`、`bg-raised`、`bg-hover`、`bg-gap`、`border-line`、`text-text1/2/3`、`accent-text`/`accent`、`text-danger-text`/`bg-danger-solid`）；`check:colors` 规则 legacy 与旧变量规则拦截 |
| 自己拼 `backdrop-blur-* + bg-black/xx + border-white/xx` | `ui-glass`；且先确认这个浮层真的压在媒体/画布上 |
| `text-zinc-600 dark:text-zinc-400` 双分支 | 直接写最终值，`dark:` 的基础值是死代码 |
| 给已经带边框的控件外面再包一层框 | 去掉外层框 |
| 为"填充空白"添加卡片、边框、阴影 | 留白 / 调整间距 |
| 同一屏出现 3 层以上叠加边框 | 重新走上面的决策树 |
| 复制其他文件的 `border + bg` class 串当模板 | 先判断目标位置在第几层 |
| 外层壳已有命令带，内层功能组件再长一条自己的头带 | 把内容作为 props 注入外层那条带（`toolbarActions` 那种出口） |
| 为一个"打开文件 / 新建"按钮单独占一整行 | 塞进命令带左端，文件名跟在按钮后面 |
| 两条同底色条带中间夹一条透明带 | 合并成一条；确实要分就让中间那条也归属同一块底色 |
| 全屏工作面（画布/编辑区/预览区）套 `rounded + border` + 外层留白 | 铺满，边界交给上方那条 `border-b` |
| 同一视图里各条带用不同的横向 padding | 统一到同一个值，与其下内容区对齐 |
| 业务组件手写 inline `<svg>` 画图标 | 用 lucide-react；确属图形则加入 `check-icon-tokens.cjs` 豁免并写明理由 |
| 在调用点自己从 lucide 挑业务概念图标 | 用 `@/core/theme/icons` 的登记常量 |
| 建一个「本目录自己的图标模块」 | 删掉，调用点直接用 lucide；私有图标集＝又一套平行体系 |
| 一个表面出现两个 `variant="primary"` | 只留一个主动作，其余降到 `secondary` 或 `quiet` |
| 破坏性动作用 `primary` 或手写红底 | `danger`（静息静默、悬停显红）；确认弹窗里的最终确认用 `dangerSolid` |
| 选中/当前值用强调色实底（蓝底白字的分段、选项、标签） | 淡强调底（`UiOptionButton active`、`UiChipButton`），强调色实底只给唯一主动作 |
| 给压在纯色界面上的浮层、按钮加玻璃 | 不透明实底；玻璃只给压在图片、视频、画布上的浮层（`surface="glass"` / `UiPanel variant="glass"` / `ui-glass`） |
| 为了省宽度把同组动作里的一个降档 | 缩短文案 / 图标化**整组** / 接受轻微偏移，不要只动一个 |
| 用分隔线分开两组同类动作 | 加大间距；分隔线只用于交互语义根本不同的两侧，一条 bar 最多一条 |
| 把工具/模式切换写成带边框的按钮 | 那是选中态语言：`selectionRole="navigation"`，静息不描边 |
| 把 `revision`、ID、哈希、schema/协议版本、缓存/Worker/渲染状态等内部字段展示在正式界面 | 保留在日志、诊断页、开发模式或测试断言；界面只写用户可行动、可决策、可理解结果或可恢复的信息 |
| 为了显得完整，给控件附加实现说明、专业术语或无行动价值的只读状态 | 删除；确有决策价值时只说明用户可感知的影响与后果 |

## 必须复用 vs 允许新增

**先查表，再动手。已有实现的一律复用，不要另写一份：**

| 需求 | 必须用 | 不要做 |
|---|---|---|
| 弹窗 | `UiModal` | 手写 `fixed inset-0` + `bg-black/…` + 卡片（存量已全部清零，`check:surface` 规则 C 会拦，别再加） |
| 分组 | `UiGroup` | 手写 `border + bg` 的 div |
| 页面标题区 | `UiPageHeader`（标题旁的数量等用 `meta`，与标题基线对齐；页头兼作页面顶带时用 `divider` 画自适应下分隔线） | 手写 h2 + p；把数量塞进标题文字；调用点给页头写 `border-b` |
| 封面内容卡（项目卡、工程卡、资产卡） | `UiOptionButton variant="cover"` + 封面框 `UI_COVER_FRAME_CLASS`；不是按钮的根元素（可拖拽的资产卡）加 `UI_COVER_GROUP_CLASS` 与 `data-selected` | 给整张卡铺底描边，或在调用点手写悬停描边/选中环 |
| 工具页 / 全屏工作面的命令带 | `UiToolbar variant="command"`：左端 children（返回、文件上下文、主工具组）/ `center`（视图切换、随工具变化的参数）/ `trailing`（次要动作 + 唯一主动作）/ 可选 `subordinate` 从属带（共用底色与下边框）；状态写进 `barProps` 的 `data-*` | 每个工具自己画 `h-11 border-b bg-*` 头带；从属带另画底色或边框 |
| 可点的文字记号（逐字稿词块、时间轴字幕块） | `UiTextToken`（`appearance` inline/chip；`current` 播放中、`selected` 已选、`excluded` 已删除、`flagged` 待留意） | 用 `UiButton` 加 className 覆盖底色、圆角、划线 |
| 表单行 | `UiFormRow`（窄停靠面板 `density="compact"`，配 `UiGroup titleTone="compact"`）；行内的 `Ui*` 控件没有自己的名称时自动 `aria-labelledby` 行标签、`aria-describedby` 说明（下拉读作“标签 + 当前值”，任务 5.8） | 手写 label + 间距；调用点改标签字号；给行内控件再手写一遍同样的 `aria-label` |
| 字段 | `UiInput` / `UiSelect` / `UiTextArea` / `NumberInput`（数值拖动：读数或标签上左右拖，Shift 精细、Alt 粗调，单击编辑）；高度只用 `size`；直接落在所在表面上编辑的多行文本用 `UiTextArea frame="none"`；复合字段（表面与焦点环画在外壳上）的内层输入用 `UiInput frame="inner"` | 手写数值拖动、自绘步进器；调用点改高度；调用点给文本框去边框去底（`!bg-transparent !ring-0`） |
| 搜索框 | `UiSearchInput`（前置放大镜、`size`、可选 `onClear` + `clearLabel` 清除按钮；`className` 落在外层只放宽度） | 自己摆一个绝对定位的放大镜再给 `UiInput` 补 `pl-8` |
| 下拉 / 面板触发器 | `Dropdown` / `PanelTrigger`（按钮是 `UiFieldTrigger`：`appearance` field/quiet、`size`；浮层 `surface` solid/glass、`panelPadding`）；一行参数条用 `UiFieldLayoutContext` = `toolbar` | 自己写触发器按钮或浮层外壳；`buttonClassName` 里改外观 |
| 浮层归属（点外关闭、Escape） | `useUiOverlayLayer` + `UiOverlayLayerProvider` + `resolveUiOverlayTarget` / `isTopmostUiOverlay`（`@/components/ui/overlayOwnership`，语义同 Floating UI FloatingTree）：子浮层里的点击不关父层，Escape 只关最上层，模态层（查看器、弹窗）打开期间祖先层不响应点外；不在同一 React 树的浮层根节点写 `data-ui-overlay-detached` | 每个浮层各写一份 portal 选择器白名单或只认自身 refs |
| 右键菜单、按钮弹出的动作菜单、锚定外部元素或指针的浮层 | 动作列表用 `ContextMenu` + `useContextMenu`（`showMenu` 跟随指针，`showMenuAt` 贴按钮右缘；压在画布/媒体上传 `surface="glass"`；菜单项是 `UiOptionButton variant="menu"`，方向键与 Enter 可用，宽度按内容）；需要表单内容的锚定浮层用 `PanelTrigger` 的 `anchor`（元素或矩形）+ `open` / `onOpenChange`，自定义触发器用 children 渲染函数（任务 5.9） | 自己 `createPortal` 画菜单或面板、手算视口夹取、各写一份点外关闭与 Escape、用私有 CSS 画菜单项 |
| 一行放不下就收进“更多” | `UiOverflowRow`（`items` 带 `priority`/`pinned`，`renderOverflow`，`alwaysShowOverflow`；收起项不挂载）；生成底栏由 `ParameterPanel` 在 `toolbar` 排布下接入 | 让参数条 `flex-wrap` 换成两行；收起项留在 DOM 里只隐藏 |
| 分段 / 网格 / 小样 / 色样选择 | `UiOptionButton variant="segment"`（放在 `UI_SEGMENTED_TRACK_CLASS` 里）/ `grid` / `tile` / `swatch`；网格格子要等大时用 `gridCell`（`ratio` 78×92、`tier` 78×42、`tier-detail` 78×52、`preset` 120×52） | 手写 `bg-veil-faint` 格子、强调色实底的分段；用内联 `style={{ height }}` 定格子高度 |
| 开关、复选框、图标开关 | `UiSwitch` / `UiCheckbox` / `UiIconButton on` | 用整行实底或强调色文字表达“已开启” |
| 标签栏、导航 | `UiNavButton`（侧栏）/ `UiChipButton selectionRole="navigation"`（`selectionAppearance` default / `subtle` 面板标签 / `workspace` 标题栏工作区，后者同栏浮层开关用 `on`） | 手写指示条、选中底 |
| 无边框窗口的最小化/最大化/还原/关闭 | `UiWindowControl`（`action`、`platform` windows/mac；主窗口与日志窗口共用） | 用 `UiIconButton` 加覆盖拼交通灯或关闭红底 |
| 通知提示（操作反馈的短暂提示） | `UiToast`（`tone` success/error，状态只进图标颜色；`surface` solid 默认 / 压在画布与媒体上用 `glass`；`placement` window 标题栏下居中 / container 画布内）；全局用 `useNotification().showNotification`，停留与淡出时长用 `motion.ts` 的 `UI_TOAST_DISPLAY_MS` / `UI_TOAST_EXIT_MS`（任务 5.7 把三套实现收敛到这里） | 自己画 `fixed top-*` 浮条、用危险实底或成功实底铺满通知、各写一份显示时长 |
| 悬停说明 | `Tooltip`（300ms、raised 实底）；参数名、设置项标签用 `UiTooltipText`；`placement` 默认 `top`，一列紧挨着的表单行（画布节点参数行名称，经 `ParamLabel tooltipPlacement`）用 `left`，放不下依次退到右侧、上方，避免盖住上一行 | 自己写 title 浮层或 ⓘ 图标；为躲开相邻行另写定位 |
| 音频波形（任何位置：口播剪辑、剪辑时间线与源监视器、画布音频节点、资产卡、音频播放器、生成记录） | `WaveformView`（`@/components/waveform/WaveformView`，`tier` mini/standard、`tone` neutral/clip）+ `useWaveformData` / `useWaveformDataList`（`@/hooks/useWaveformData`，多精度峰值、磁盘缓存，放大到采样点） | 自己解码音频、自写峰值缓存或 Canvas 波形绘制 |
| 剪辑片段的视频缩略帧条 | `useFilmstripFrames` + `src/services/videoFilmstrip/filmstripFrameService.ts`（主进程 `electron/main/services/video/filmstrip.ts` 成批取帧、磁盘缓存） | 逐帧走原生解码或另建缩略图通道 |
| 参数帮助说明 | 参数名称文本本身的 hover / focus tooltip | 加 Info 等额外图标、把 `description` 渲染成控件下方正文，或用 Tooltip 包住整个控件 |
| 空/加载/错误 | `UiEmpty` / `UiLoading` / `UiError`（节点内容区的空占位用 `UiEmpty size="node"`） | 内联手写状态块 |
| 按钮/输入/开关等 | `@/components/ui` 的 `Ui*` | 原生 `<button>/<input>` |
| 提示词编辑 | `PromptEditor` | 自己拼 textarea |
| 文件上传/排序 | `FileUploader` / `useReorderDrag` | 重写拖拽 |
| 音频播放 | `@/components/AudioPlayer` | 再写一个播放器 |
| 长列表 | `react-virtuoso`（已是依赖） | 全量 map 渲染上百项 |

**新增组件的门槛**（Agent 自行判断，不需要等用户确认；四条都要做到）：
1. 在 `@/components/ui` 与本表中确认没有可复用或可扩展的组件
2. 优先扩展现有组件的**枚举变体**（像 `UiPanel variant` / `UiGroup titleTone`）；只有当加变体会让现有组件的参数语义变乱（尺寸体系、状态、交互语义明显不同，如标题栏窗口控件）时，才新建一个职责单一的组件
3. 新组件放在 `@/components/ui`，参数是**有限枚举**，不开放 `className` 覆盖视觉，登记进上面的“必须复用”表，并纳入 `check:surface` 规则 E 的检查范围
4. 选型依据（比较过哪些现有组件/变体、为何新建）写进任务执行记录或提交正文

变体也要克制：新增变体必须是**有限枚举**，不要开放任意 `className` 覆盖视觉。

## Agent 改 UI 的标准流程

```
1. 读需求 → 判断落在哪个工作区/页面
2. 整页体检（先横后纵，别直接进组件）：
   a. 数条带：从窗口顶到内容区横着切了几刀？> 2 条就是骨架问题，先合并再谈别的
   b. 顺着 JSX 往上找外层壳：它是不是已经有一条命令带了？有就注入，不要再嵌
   c. 数边框层数、看有没有全屏工作面被套成卡片
   d. 数实底按钮（应恰好 1 个）、看同组动作是否同档、数分隔线（一条 bar 最多 1 条）
   e. 逐项检查可见信息：它是否帮助行动、决策、理解结果或恢复失败？全部不命中就删除
3. 定级：这块内容属于 Region / Group / Divided / Surface / Card 的哪一级
4. 查复用表：需要的组件是否已存在 → 存在就复用
5. 先确认参数文案受众：助手语义写 `description` 但不渲染，用户说明写 `tooltip`；再用排版令牌建立标题/正文/元信息层级
6. 只在四条准入条件全中时才用 Card
7. 写代码：颜色用语义类，字号/圆角/阴影/层级用登记令牌
8. 跑自检清单；高影响 UI 再运行真实 Electron 视觉场景并由 Agent 逐张目视截图（判据与操作规范见 `references/review.md`；悬停、菜单打开、逐个模型等交互态与数据变体用 `ui:tour --steps` 截）
9. 完成前按项目规则检查开发环境：未运行就启动，需要重启就只重启当前仓库进程树
```

**第 2 步不能跳。** 审查界面时只做组件级检查（每个按钮用没用对 primitive）会漏掉所有骨架问题——
条带叠条带、工作面套卡片、左边距三个位置，这些单看每一条都合规，丑的是它们摞在一起。
用户说"布局不合理""特别丑"而你只查出了几个 primitive 用错，那基本可以确定第 2 步跳了。

## 页面完成自检清单

- [ ] 交互态（悬停、选中、菜单打开）与数据变体（如逐个模型）截过图，并按 `references/review.md` 第 2 节逐项看过吗？
- [ ] **从窗口顶到内容区横着切了几刀？** > 2 条（命令带 + 从属带）就是骨架错了
- [ ] 每一条新增文字、数字、徽标和状态是否至少服务于行动、决策、理解结果或恢复失败？否则删除
- [ ] 有没有把 `revision`、schema/协议版本、ID、哈希、缓存/Worker/渲染管线状态或调试计数放进正式界面？全部移到日志、诊断页、开发模式或测试断言
- [ ] 有没有用专业术语解释实现，或给本来就能理解的控件添加常驻说明？删除；确有影响时改写为用户可感知的后果
- [ ] 外层壳是不是已经有命令带了？有的话内层不能再长一条，改成注入
- [ ] 有没有为一个按钮单独占的一整行？塞进命令带
- [ ] 返回入口放对形态了吗？有页面标题就进 `UiPageHeader onBack`，别为「← 页面名」单开一条带
- [ ] 各条带与其下内容区的横向 padding 是同一个值吗？
- [ ] 画布/编辑区/预览区被套成卡片了吗？会随窗口长大的区域不是卡片
- [ ] 这个页面有几层边框叠加？> 2 层就回到决策树
- [ ] 有没有"比父级更亮"的背景块？有就该是 `inset` 或 bare
- [ ] 有没有为了填空白而加的卡片/边框/阴影？删掉
- [ ] 容器里并列的可点项，静息态还在逐个描边吗？该是 `UiOptionButton variant="menu"`
- [ ] 这个表面有几个实底按钮？超过一个就不知道该点哪个
- [ ] 同一组里的同级动作是不是同档？有没有为了省宽度把其中一个降档
- [ ] 加分隔线了吗？两侧交互语义真的不同吗？一条 bar 最多一条
- [ ] 有手写 `<svg>` 吗？路径写死的就是图标，改用 lucide；路径算出来的才是图形
- [ ] 用到跨界面的业务概念图标了吗？走 `@/core/theme/icons` 的登记常量，别在调用点自己挑
- [ ] 有没有固定调色板、黑白类、rgba、命名色或旧别名类（`bg-app`、`text-text-muted`…）？换主题预设时它们不会跟着动，一律改语义令牌
- [ ] 用 `accent` 当文字色了吗？文字用 `text-accent-text`（`UI_COLOR_ACCENT_TEXT_CLASS`）；字压在强调实底上用 `bg-accent text-on-accent`（`UI_COLOR_ACCENT_FILL_TEXT_CLASS`，黑白由引擎按对比度决定）
- [ ] 选中/当前值是不是淡强调底且与悬停可辨？强调色实底只属于唯一主动作；悬停/选中的容器里行内控件仍可辨
- [ ] 至少在“石墨”“纸白”两个预设下看过吗？浅色模式下白纱（`veil`）、黑白类、媒体叠层令牌放错位置最容易露馅
- [ ] 破坏性动作（删除/清空）是不是 `variant="primary"`？那会抢走主动作的视觉权重，应该用 `danger`（静息中性、hover 才出危险色），确认弹窗里用 `dangerSolid`
- [ ] 改了 `.css` 文件吗？里面不能有 `#hex` 与 `rgba(数字…)`，只能 `rgb(var(--xxx-rgb) / a)`
- [ ] 新加的全局样式/变量放对文件了吗？懒加载的样式表里不能放全局主题变量
- [ ] 同一个 className 里有没有两个类抢同一个 CSS 属性？改成互斥三元
- [ ] 新面板有没有再叠一层自己的底色？表面应该由外壳统一提供
- [ ] 加了模糊吗？只有压在图片/视频/画布上才该加，且只能用 `ui-glass` / `ui-glass-scrim` / `UiPanel variant="glass"` / 浮层 `surface="glass"`
- [ ] 动效时长是否落在 120/180/240/500 四档？（缓动已是全局默认，不用每处写）
- [ ] 有 `setTimeout` 卸载动画组件吗？那个数字必须和 className 里的 `duration-*` 同档
- [ ] 过渡的是 `opacity`/`transform` 吗？别过渡宽高间距，也别用裸 `transition`
- [ ] 空/加载/错误三态是否都走了 `UiEmpty/UiLoading/UiError`
- [ ] 模型 / schema 参数的 `description` 是否没有进入正式界面？给用户看的说明是否全部进入参数名称的 `tooltip`？
- [ ] 有 tooltip 时参数名称是否可 hover / focus，且没有额外 Info 图标？无 tooltip 时是否仍是普通标签？
- [ ] 参数 tooltip 是否只由参数名称触发，而不是包住整个控件或上传区？
- [ ] 字号是否全部来自登记档位（无 `text-[Npx]`）
- [ ] 圆角是否只用了圆角令牌（`rounded-control/field/overlay`，或同一组变量的 `rounded-md/lg/xl`）与 `rounded-full`，且内层不大于外层
- [ ] 阴影是否只出现在浮层
- [ ] z-index 是否用了语义 token
- [ ] 同级元素间距是否统一（不要一行 `mt-2` 一行 `mt-3`）
- [ ] 高频状态（进度/hover/拖拽）是否放在独立 store 而非大列表 state
- [ ] 列表超过 ~50 项是否考虑了虚拟化
- [ ] 只有改动共享页面骨架、设计令牌或全局界面机制时才按 `docs/rules/testing.md` 运行相关 `ui:tour -- --only ...`；局部界面改动不默认跑全量场景

## 完成前按风险选择

```bash
npm run check:surface
npm run check:colors
npm run check:icons
```

只运行与本次改动直接相关的专项检查；验证级别和是否追加 lint、类型检查、构建由 `docs/rules/testing.md` 决定。
改了本 skill（`.claude/skills` 与 `.codex/skills` 任一侧）必须同步另一侧，并跑 `npm run check:skill-sync`（CI 门禁）。

改了动效档位或 `motion.ts` 再补一条（它保证 ms 数值与 `duration-*` 类不漂移）：

```bash
npx vitest run src/components/ui/motion.test.ts
```

只有共享页面骨架、设计令牌、浮层/滚动/溢出机制等高影响界面改动，才先构建并按场景缩小范围运行截图巡检与规则审计：

```bash
npm run ui:tour -- --only <受影响场景> --size <受影响尺寸>
npm run check:ui-visual -- --only <受影响场景>
# 改了令牌、主题引擎或跨主题外观时按预设运行（可重复或逗号分隔，all = 石墨/深海/胶片/纸白）
npm run ui:tour -- --theme-preset graphite,paper --only <受影响场景>
npm run check:ui-visual -- --theme-preset all --only <受影响场景>
```

多个预设时每个预设单独启动一次应用，结果分到 `<输出目录>/<预设>/`。`check:ui-visual` 的对比度规则按**渲染后像素**判定
（隐藏文字与图标截一张只有背景的图，在每个文字/图标区域取样合成前景，取最差 10% 分位）：正文与辅助文字 ≥ 4.5:1，
大字与图标 ≥ 3:1；禁用控件、`aria-hidden`、被遮挡的部分不判；场景中途 `capture()` 的菜单、悬停、浮窗状态也审对比度。
确属装饰、品牌或用户内容色的例外登记在 `scripts/ui-visual-contrast-exceptions.json`（必须写理由，可限定场景/预设/下限）；
**界面色不达标改令牌，不登记例外。**

用户要求“真实运行环境”的视觉审查时，使用 `npm run test:reality -- --suite ui|ui-audit --profile real --only ...` 的正式 Electron 场景；默认只读，不传 `--allow-writes`。禁止用浏览器、ego-browser、Chrome、裸 Vite 或 temporary profile 代替。场景断言通过后，Agent 仍必须打开实际截图，检查对齐、裁切、层级、颜色、文案和面板开合状态；DOM 通过不等于视觉通过。巡检结束后退出巡检实例，并恢复或重启当前仓库的 `electron:dev`。

局部样式、文案或叶子组件改动只运行直接相关的静态检查和精确测试，不追加完整 `ui:tour`。`ui:tour` 产出 `.ui-tour/index.md` 与截图，专门让人检查对齐、留白、视觉权重、hover /
聚焦 / 下拉 / 右键状态；`check:ui-visual` 只输出规则结论与 `.ui-audit/audit.json`，
不做像素差异。两者共用场景配置但职责分离，截图差异不作为 CI 门禁。

### 条带数量已进自动检查（5.8）

「页面骨架：横向条带」那节的规则曾经全靠人看（4 条带的图片编辑页在 `check:surface` 与 `check:ui-visual` 下都是全绿）。
5.8 起 `check:ui-visual` 的 `stackedBands` 在真实 DOM 里数条带：不在滚动区里、几乎占满父容器宽、自己画了分隔线或底色
（或是命令带 / 从属带 / 工具条 / 页头）的 24–64 高块上下相接超过 2 条即命中；同批还有工具条折行、短文案截断、
选中态与静息态差异不足、浮层被裁切四条，判据与断牙样例见 [references/review.md](references/review.md) 第 7 节。
新工具页仍统一用 `UiToolbar variant="command"`，从源头避免条带问题；规则只在场景覆盖到的界面上生效，没有场景的新页面照样要人工数一遍。

代码残留同样进了门禁：`npm run check:ui-residue`（任意值类、内联尺寸与颜色、调用点覆盖、豁免理由、私有样式、零引用、旧文案），
口径与登记方式见 references/review.md 第 3 节。

`check:surface` 报五类问题：

- `[A]` 手写面板表面 → 改用 `<UiPanel>`
- `[B]` 同文件多处卡片表面 → 疑似卡片套卡片，内层降级
- `[C]` 手写弹窗（`fixed inset-0` + 黑色遮罩但没用 `UiModal`/`AlertDialog`）→ 改用 `UiModal`
- `[D]` `.css` 里手写毛玻璃（`backdrop-filter`）→ 元素上加 `ui-glass`
- `[E]` 按钮、选项、标签、导航、字段触发器的调用点用 className 覆盖外观（底色/边框/文字色/圆角/阴影/高度/字号）→ 用组件枚举

存量已全部清零，`check:surface:strict` 已接入 `build` / `electron:build` 与 CI，**违规会直接让构建失败**。改完必须跑一次确认通过。

确需例外时在该行上方加注释 `ui-surface-allow` 并写明理由与接手任务；只允许行级豁免，文件级 `ui-surface-allow-file` 出现即报违规（否则该文件将来真正的套娃也会被放行）。

已确认的例外类别：全屏沉浸式媒体查看器（`mediaViewer/` 三个 Modal）不套用 `UiModal`——`UiModal` 是居中卡片语义，与铺满视口的查看器不匹配。

`npm run check:surface`（告警式）可用于本地快速查看，构建链路走的是 `--strict`。

## 相关规范

- 组件复用与原生标签落点、颜色令牌三处入口：见 [docs/rules/frontend-ui.md](../../../docs/rules/frontend-ui.md) 与 [docs/rules/architecture.md](../../../docs/rules/architecture.md)
- 画布节点的行组件拼装：见 skill `canvas-node-builder`
- 提示词编辑器、文件上传控件：必须复用 `PromptEditor` / `FileUploader`，不要重写
