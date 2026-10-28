---
name: henji-ui-surface
description: Henji-AI 新建或改造任何界面/页面骨架/面板/弹窗/侧栏/设置分区/节点 UI，或调整按钮层级、分隔线、颜色、图标、毛玻璃、动画、层级时使用。主文件涵盖“石墨”设计系统速览（主题引擎与语义令牌、按钮五档默认静默、选中用中性底、强调色只给主动作与焦点、尺寸档位）、页面骨架的横向条带上限与命令带、表面层级（surface/elevation）铁律、五级容器词汇表、分隔线准入、选项集合静息态与选中态词汇表、必须复用的组件与枚举；颜色/材质、动效、图标、排版令牌、性能分层、静默失效坑、全界面核对规范与操作工具拆在 references/ 按需读。触发场景：用户要求"做一个 XX 面板/页面/弹窗"、"这个界面不好看/太挤/像卡片套卡片"、"顶部堆了好几行/几个条/布局不合理"、"标题栏和工具栏能不能合并"、"这块儿怎么像张卡片"、"帮我美化一下这个界面"、"加一个设置分区"、"统一一下 UI/配色/动画/模糊"、"这个动画太快/太慢/很生硬"、"这个界面卡顿/拖动掉帧"、"切换主题后有些地方没变色"、"为什么有的按钮有边框有的没有"、"这里要不要加分隔线"、"图标不一致"。
---

# Henji-AI 界面表面与层级规范

## 为什么需要这份规范

项目已将控件与表面收口到共享组件。过去出现过卡片套卡片、条带叠条带和默认控件过重；当前默认按钮静默，`UiGroup` 提供只分组不画框的入口。本规范约束骨架、语义与复用，防止这些问题再次出现。

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
| 改完界面做视觉验收、按区域核对全界面、判断旧界面残留、写操作步骤截图；改公共组件或令牌后的风险分级验收；新增或改造停靠面板后的尺寸扫描 | `references/review.md` |

## 四条铁律（先记住这四句）

> **注意力：先定用户第一眼该看哪，再决定每样东西多重。**
> 每个视图的注意力顺序固定为：正在处理的内容 → 这一刻唯一的下一步 → 例外（改过的值、关掉的效果、出错、等你处理的事）。其余元素静息时一律退后：不着强调色、不加框、不显示默认值的重置与暂时用不上的操作。自查：把截图缩小或眯眼看，最先跳出来的必须是第一项（重要记录 018）。

> **纵深：同一层视觉深度，只画一次边框/背景。**
> 进入一个已经有边框或背景的容器后，内部分组**必须**改用留白 / 分隔线 / 更暗的底色，**不得**再叠一层 `border + bg + rounded`。

> **水平：一个视图只画一条命令带。**
> 返回、标题、文件上下文、工具、导出动作全部进这一条；随工具变化的参数用紧贴其下的从属带，且与命令带**共用同一块底色和同一条下边框**。

> **内容：正式界面只展示用户需要据此行动、决策、理解结果或恢复失败的信息。**
> `revision`、schema/协议版本、请求 ID、哈希、缓存/Worker/渲染管线状态、调试计数等内部状态一律进入日志、诊断页或开发模式；不得通过改名、加 tooltip 或补充解释继续留在正式界面。
> 说明文字同理：不加不必要的副标题、描述和口号式文案，让布局、分组、控件与命名本身说明用途。想加一行说明时，先改设计让它不需要解释；常驻说明只留给不看就会选错，或涉及费用、数据丢失、不可逆操作的信息，其余进 tooltip（见下文「信息准入」与「参数说明的受众」）。

参考 Atlassian 的表述：能用边框或留白区分时，就不要用抬升（卡片）来分组。成熟设计系统普遍只保留 4~6 个层级并刻意克制。水平方向同理——桌面编辑器（VS Code、Figma、Photoshop）顶部一律是**一条**命令带加一条可选的上下文带，不会因为壳换了一层就多长一条。

## “石墨”设计系统速览（界面重设计计划，重要记录 001–004、010、011）

设计稿与决策在 `docs/task/界面重设计与主题引擎/`（`设计稿/*.dc.html` 是本地源码副本，`重要记录.md` 是决策）。
核心一句话：**背景只表达“这里是唯一主动作”或“这项被选中”；层次靠明暗不靠描边；强调色只给主动作、焦点、播放头与选中指示。**

| 维度 | 规则 | 细则 |
|---|---|---|
| 颜色 | 三层：**种子**（模式、底色色相/倾向、窗口亮度、层级对比度、强调色）→ 主题引擎推导的**语义令牌**（CSS 变量 + Tailwind 类）→ 组件内部令牌。**界面只引用语义令牌**；预设石墨/深海/胶片/纸白只是种子组合，文字三档按对比度 ≥ 4.5:1 求解 | `references/color-and-material.md` |
| 按钮 | `UiButton` 五档 `primary`/`secondary`/`quiet`（默认）/`danger`/`dangerSolid` + `link` + `media`；`UiIconButton` 默认静默，`on`/`tone`/`shape`/`size`。外观只由枚举决定，调用点 className 只放布局 | 本文「动作层级」 |
| 选中 | 注意力优先（重要记录 019 修订 012）：选中用**中性底 + 主要文字**，靠指示条、勾或强调文字区分；分段 `UiSegmented` / 双段开关是中性抬起底 + 强文字；强调色只给唯一主动作、播放头与时间码、键盘焦点、当前标签与工作区细线（多选标签保留淡强调底）；悬停只用中性抬升，悬停与选中不得同色 | 本文「选中态词汇表」 |
| 尺寸 | 控件高 28/32/36（`size` sm/md/lg）；字号 20/16/14/13/12/11（正文 13）；圆角 6 控件 / 8 输入与菜单 / 12 浮层；间距 2/4/6/8/12/16/20/24/32；动效 120/180/240（查看器 500） | `references/typography-and-tokens.md`、`references/motion.md` |
| 材质 | **按钮扁平**：纯色实底，不用渐变、顶部高光、内描边、投影或按下位移，层次只靠颜色（静息 → 悬停 → 按下逐档加深）；“质感”来自配色、留白与对齐，不来自写实光影（重要记录 016）；**常驻表面的玻璃只压在图片、视频、画布上**（`ui-glass`、`UiPanel variant="glass"`、浮层 `surface="glass"`）；菜单、右键菜单、下拉、弹出面板这类实底浮层（`ui-overlay-surface`）在设置开启毛玻璃时自动换成同一块玻璃、关闭时为 overlay 实底（2026-10-22 用户确认），调用点不用判断 | `references/color-and-material.md` |
| 骨架 | 一个视图一条命令带：`UiToolbar variant="command"`（左端 / `center` / `trailing` / `subordinate`），一个表面一个主动作 | 本文「页面骨架」 |
| 字体 | 拉丁与数字 Geist，时间码与数值 Geist Mono（`UI_TEXT_TIMECODE_CLASS`），中文系统字体 | `references/typography-and-tokens.md` |

这些约束大多已进门禁：`check:colors`（调色板/黑白/rgba/命名色/旧别名/未定义颜色类）、`check:surface:strict`（规则 A–E 与 S1–S5/S7–S10，E = 调用点覆盖组件外观）、`check:icons:strict`（规则 A–D、同行静态 S6）、`check:ui-residue`（任意值类与内联尺寸口径、私有样式、零引用、旧文案）、`check:ui-design`（间距/动效/死令牌）、ESLint 令牌规则；对比度、条带数、折行、截断、选中态差异、浮层裁切由 `check:ui-visual` 在真实 DOM 上判。

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

### 标题栏菜单栏：命令该放哪（2026-10-22 起强制）

窗口最上方是标题栏：左侧应用名后面是**菜单栏**（文件、编辑、工作区自己的菜单、视图、窗口、帮助），中间工作区导航，右侧助手、设置、窗口按钮。
macOS 用同一份菜单模型生成**系统菜单栏**，窗口内不画菜单栏，标题栏左侧留给交通灯。命令放置按频率分三层：
| 层 | 放什么 | 怎么做 |
|---|---|---|
| 菜单栏 | **全部**命令都要能在这里找到（低频的只在这里）：新建、导出、撤销重做、布局预设、工作区特有动作 | 工作区显示时用 `contributeAppMenus(owner, sections)`（`@/core/appMenu/appMenu`）声明，隐藏/卸载时撤回；菜单项执行界面上同一份操作，**禁止在菜单里另写业务逻辑**；不可用写 `disabledReason`，快捷键只做展示 |
| 工作区命令带 | 高频且全局的少数动作：返回、文档名、撤销重做、布局、主交付动作 | 一行，见上文“页面骨架” |
| 面板底栏 | 只属于这个面板的工具 | 见下一节 |
新增功能时：先登记操作，再声明菜单项，最后才考虑是否值得占命令带或面板底栏的位置。不要为了“找得到”把低频命令堆进命令带。

### 停靠面板的工具放底栏右侧（2026-10-24 起强制，取代 10-22 的“工具进标签行”）

停靠工作区（剪辑、音频编辑、3D 镜头参考、图片编辑）里，每个面板分三区：标签行、内容、底栏（重要记录 018）。
- **标签行只放标签**：面板标签、当前标签旁的面板菜单、面板组最大化。面板工具不进标签行：工具和标签抢同一行时，面板组一窄，标签就被挤进「+N」。
- **面板专属工具放底栏右侧**（视图切换、新建、导入、选区操作等）：底栏 32 高、上边一条 `border-line` 发丝线、静默 `UiIconButton`；底栏左端只放只读计数或状态（如“8 项 · 已选 1”）。放不下时从右往左收进「更多」，不折行、不另起一行。
  - 写法：`UiToolbar variant="footer"` 的 `tools` 传工具描述，不要自己拼按钮放进 `trailing`。`kind: 'action'`（立刻执行或开关：`label` `icon` `onSelect` `disabled` `disabledReason`；偏离默认才着色的开关用 `on`，默认就开着的开关用不着色的 `pressed`）由底栏画成图标按钮（对象特有、图标说不清的整组动作加 `display: 'text'` 画成“图标 + 文字”，外观不为收纳改），收起后是同名同图标的菜单项，禁用原因照旧；`kind: 'menu'`（`menu: () => 菜单项`）底栏里点开弹出菜单，收起后同一份菜单作为“图标 + 名称”下的一节列出；`kind: 'custom'` 是自己画的控件，给 `overflow` 才能收起，不给就永不收起——自带进行中任务或对话框状态的组件（自动字幕、文档按钮）卸载会丢状态，必须不给。
  - 收纳顺序：面板变窄时左端状态先截断到下限（约 64px），再把工具按位置从右往左收（`priority` 越大越晚收）；变宽时按相反顺序放回。面板自己的低频操作传 `more`（加 `moreLabel` 命名），和收起的工具共用同一个“更多”，不要再自己放一个“更多”按钮。底栏不接受 `trailing`（类型上禁止）。
- 面板内容区不再单开工具行；面板专属工具也不塞进工作区命令带。
- 时间线：时间码和吸附、链接等开关放轨道头上方的角落格（轨道头列 × 标尺行），缩放放底栏右侧，不再单占一条工具行。
- 时间线这类“面板内容有名字”的面板，标签直接显示内容名（序列名），不写面板类型名。
- 现有的 `DockHeaderPortal` 标签行插槽属于旧规则，按面板逐个迁到底栏后删除；迁移期间新代码不得再用。

### 文字不折行（2026-10-24 起强制）

标签页、按钮、表头、行标签、参数名、状态词一律单行（`whitespace-nowrap`）。放不下时截断并悬停看全称，或把整项收进溢出；不折成两行，也不靠加宽容器硬塞。只有正文、说明、批注与讨论这类成段文字可以换行。

### 放不下怎么办：面板最小尺寸与三种对策（2026-10-24 起强制，重要记录 020）

裁切和遮挡几乎都出在“面板被挤窄、压矮”或“内容比预想的长”时，组件本身没错。所以布局要**先写清楚放不下时怎么变**，再画默认样子：
- **停靠面板声明最小宽高**：写在工作区面板定义里（`VIDEO_EDIT_PANELS` 这类，类型 `WorkspacePanelDefinition`），停靠布局强制执行，保存过的旧布局按当前定义改写；同一组标签取一致的值，默认布局在 960×640 窗口里同时放得下各面板的最小值。新增面板不声明就是缺陷。
- **放不下只有三种对策**：收进“更多”（`UiOverflowRow`、命令带收纳）、截断后悬停看全（`truncate` + tooltip / 可访问名称）、滚动（`overflow-auto`）。不允许让 `overflow-hidden` 把控件或文字硬裁掉一截，也不允许定位层盖住可点的控件。
- **收起后要能放回**：收纳行收起几项后宽度只剩内容宽度，单看自己测不到窗口又变宽了。行后面还有控件、行自己不能拉宽时（命令带左端的快速添加），给 `UiOverflowRow growIntoParent`，命令带配 `leadingLayout="share"`（左端与中间区按内容起算、平分剩余宽度，中间区内容靠左排）。`UiSegmented` 实际放不下时自动换成同一组选项的下拉，宽度够了换回，调用点不用判断。旁边的兄弟元素只分剩余宽度、可以截断时（底栏状态文字）标 `data-overflow-yield`，收纳行把它超出 `min-width` 的部分也算作可用宽度；停靠面板底栏已内置，调用点不用写。
- **不收起的控件由面板最小宽度兜底**：底栏里永不收起的控件（不给 `overflow` 的 `custom`）和收纳行里的 `pinned` 项，在面板最小宽度下必须放得下“它们 + 更多”；放不下就调大面板定义的最小宽度，不要指望收纳。
- **自绘滚动与有意例外要标出来**：自己实现滚动的区域（如时间线轨道区）标 `data-layout-scroll-region`；确属设计的裁切或覆盖（跑马灯、拖动中的虚影）在最近的容器上写 `data-layout-allow="clip|occlude"` 和 `data-layout-allow-reason="理由"`，没有理由不生效。
- **设计稿写缩放规则**：除了默认尺寸，还要写最小多大、窄了先收什么、矮了先藏什么；没写的设计稿不算完成。
- 判定只有一份实现 `src/core/uiAudit/layoutAudit.ts`：巡检规则 `controlClipped` / `controlOccluded` 与运行时布局守卫共用。开了 `--dev-checks` 或 `--dev-layout-guard` 时问题元素会被描红边并记进日志（`ui.layout_issue.detected`），默认不运行；界面改动收尾前至少开一次。验收方法见 `references/review.md` 第 9 节。

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
| 没有命令带的全屏工作面 | 浮在内容上的玻璃返回按钮：`ui-glass` 容器包一个静默 `UiButton`（画布底随主题，不用 `media` 档，重要记录 011） | 画布内 |

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
| 主 | `primary`（扁平纯色实底，悬停/按下只变色） | `tone="accent"`（圆形，如生成） | **一个表面只允许一个**，这一屏的主动作 |
| 次 | `secondary`（无边框填充 `bg-control`） | —— | 弹窗与表单里的普通动作 |
| 辅 | `quiet`（**默认**，静息无底，悬停出底） | 默认（静默） | 工具栏、命令带、行内、菜单 |
| 危险 | `danger`（静息同 quiet，悬停显红）/ `dangerSolid`（只用于确认弹窗） | `tone="danger"` | 删除、清空、移除 |
| 链接 | `link`（强调文字、悬停下划线、行内高度） | —— | 行内跳转/说明链接，不计入动作层级 |
| 画面上 | `media` | `tone="media"` | 压在图片/视频/画布上的控件（固定媒体叠层令牌） |
| 行内无底 | —— | `tone="bare"` | 压在已有底色的行内，不增加悬停底；仍保留焦点与可访问名称 |
| 窗口控件 | —— | `UiWindowControl action platform` | 只用于无边框窗口标题栏的最小化/最大化/还原/关闭（Windows 36×28 静默、关闭悬停危险实底；macOS 交通灯取状态实底令牌） |

尺寸：`UiButton size` sm/md/lg = 28/32/36（默认 md）；`UiIconButton size` 2xs/xs/sm/md/lg = 20/24/28/32/36（默认 md），
xl 40 只给全屏查看器、画面中央播放键。开关开启用 `UiIconButton on`（不铺底，只把图标染成强调色）；一组里当前的工具或视图用 `on selection="mode"`（中性抬起底 + 主要文字）。默认状态本身（轨道显示、同步锁定）不用 `on` 高亮，偏离默认才着色。
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

### 通用动作用图标，特有的事用文字（2026-10-25 用户确认）

工具条、命令带、底栏里，**图形大家都认得的通用动作只放图标**（`UiIconButton`，`aria-label` 写原名称、`tooltip`
写名称与用法）：复制、下载、删除、重新上传、收进资产库、解组、打开、保存、另存为、录制、预设、优化提示词等。
**保留文字**的只有三类：这一屏唯一的主动作（生成、导出）；这个对象特有、图标说不清的功能（局部重绘、打光、
720° 全景、随手摆）；带状态或数字的按钮（“取消导出 30%”“重试保存”）。对话框底部的确认 / 取消始终用文字。
同一组按“整组”判断，不要一半图标一半文字。

### 动作 ≠ 模式

工具栏里的工具（选择/标注/矩形…）**不是按钮**，是"我现在处于哪个模式"，
点它改变的是"接下来会发生什么"，不是"立刻发生一件事"。
它属于**选中态语言**，不属于动作层级：静息不描边，当前工具用中性抬起底（`UiIconButton on selection="mode"`，重要记录 019），
文字工具用 `UiChipButton selectionRole="navigation"`，开关用 `UiIconButton on`（只染图标），把强调色让给那个唯一的主动作。

同理，参数面板里的"当前值是什么"（形状、比例、档位）是**单选**，
用 `UiOptionButton active`（中性选中底 + 强调文字）——详见「选中态词汇表」。

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

`UiOptionButton` 的 `variant="menu"` 就是这条规则的落点：静息态无边框无底色，hover 出中性悬停底，选中态是中性选中底（`selected`）+ 主要文字 + 强调色勾（重要记录 019）。

### 判据（两条都要满足才用 `menu`）

1. **是同质选项的集合**：≥3 个由 `map` 渲染的并列 peer，（二选一分段走 `UiSegmented`，不按 menu 判）。孤立的单个按钮不算 —— 那种情况下框才真的在划定边界。
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
| 导航：正在看哪里 | 中性选中底 + 主要文字 + 强调色方向指示条 | `UiNavButton active`；横向 chip 用 `selectionRole="navigation"`；面板标签用 `selectionAppearance="subtle"`（主要文字 + 底部细线）；应用标题栏的工作区导航用 `selectionAppearance="workspace"`（纯文字 28 高，选中只有文字加亮与底部短指示条、不铺底；`aria-current` 只给当前工作区，同栏里只打开浮层的开关项用 `on`：强调文字、无底无指示条 + `aria-pressed`）；面板标签底线用强调色 |
| 单选：当前值是什么 | 分段用中性抬起底 + 强文字；菜单项、列表行用中性选中底 + 主要文字（菜单带强调色勾）；格子、小样用中性选中底 + 强调文字；不用强调色实底，也不铺淡强调底 | 分段统一 `UiSegmented`；`UiOptionButton active`：菜单 `menu`、网格 `grid`、带小样的格 `tile`、圆形色样 `swatch`（选中为主要文字色外圈一环——强调色外圈压在强调色样上看不清）、封面内容卡 `cover`（强调描边，只画在 `UI_COVER_FRAME_CLASS` 封面框上）；双段开关 `UiSwitch appearance="segmented"` 同此 |
| 多选/标签：集合中哪些已选 | 强调描边 + 淡强调底 + 强调文字 | `UiChipButton active`；多选的选项卡用 `UiOptionButton selection="multiple"`；逐字稿词块 `UiTextToken selected` |
| 布尔：功能是否开启 | 两种外观按所在区域分（重要记录 022，修订 018/019“一律复选框”）：设置页、表单、浮层、画布、生成参数用**滑块开关**（开着轨道铺强调色）；剪辑那类停靠工作区的面板（属性一列一列排）用**复选框外观**（中性框 + 主要文字色勾，不铺强调色）。整行保持静息；“关 / 开”双段不用于布尔 | `UiSwitch checked`：不写 `appearance` 时随区域走，`DockviewHost` 里自动是复选框外观、`UiModal` 里重置回滑块，调用点不判断；“勾选哪几项”这类真正的复选用 `UiCheckbox`；图标开关 `UiIconButton on`（不铺底，强调色图标，写 `aria-pressed`）；标题栏导航里的浮层开关 `UiChipButton on` |

默认态不是第五种选中态：它保持当前表面的中性视觉。不要用整行实底表达“已启用”，
也不要把多选语义画成单选项的样子（或反过来）。下拉当前项 = 中性选中底 + 主要文字 + 强调色勾；菜单宽度按选项内容自适应（含勾槽与竖向滚动条，上限 360 再截断；`Dropdown` 默认 `panelWidthStrategy="options"`，只有菜单必须与触发器等宽时才传 `button`）。

**同一处的交互层级不得同色**：悬停或选中的容器里，行内控件仍须与容器底可区分。字段触发器悬停取 `control-hover`（不是 `hover`）；悬停会换底的行容器里放取值触发器时，行悬停只加强描边（画布节点参数行）。选中项上悬停用 `selected-accent-hover`，不回落中性悬停。

## 状态与反馈统一入口

页面**不要**自己写空/加载/错误块（历史上因此出现同一状态在不同页面长得不一样）：

```tsx
<UiEmpty title="还没有供应商" description="先添加一个吧。" />
<UiLoading message="生成中…"><ProgressBar progress={p} /></UiLoading>
<UiError message={err} onRetry={retry} />            {/* 不传 title 时缺省标题“操作未完成”；有更具体的说法就传 title */}
<UiEmpty size="node" icon={<ImageIcon className="h-7 w-7" />} title="等待结果" />  {/* 画布节点内容区的空占位 */}
```

状态块**不画卡片**——它已经在某个容器里了。失败必须一眼可辨：`UiError` 总有一行危险色标题（任务 5.8），
标题已经是完整说法时传 `title={…} message=""`；不是失败的提示（“请先选择片段”）用 `UiEmpty`，不要借 `UiError`。

按钮悬停说明统一传 `tooltip`，内部复用 `Tooltip` 的 300ms 延迟与主题皮肤，键盘聚焦立即显示。`UiIconButton` 可用 `label` / `aria-label` 命名；无显式名称时回退 tooltip。原生 `title` 不作悬停说明，只允许不可见的无障碍名称场景。`Tooltip asChild` 保留触发器 DOM、布局和 ref。状态组件已登记规则 E；S8 阻断手写 spin/pulse 与按钮原生 title，非纯 busy/loading 的禁用缺少 disabledReason 时告警。

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

## 弹窗宽度按内容选档，不按“看起来大气”

`UiModal size` 的档位由**内容实际需要的宽度**决定：先估算最宽一行（标签 + 值 + 行内按钮），选能放下它的最小档。

| 内容 | 档位 |
|---|---|
| 确认、单个输入、短列表（名称 + 值 + 一两个行内按钮，如快捷键表） | `compact` |
| 多字段表单、两列参数 | `form` |
| 真正的编辑面：代码/文本编辑器、视频裁切、预览 + 参数 | `editor` |
| 设置中心、画布特殊编辑器这类整页工作面 | `settings` / `workspace` |

- 不能为了让一行常驻说明不换行而加宽弹窗——那行说明多半本就不该存在（见上节）。
- 列表很长时靠弹窗内滚动，不靠把弹窗做宽做高。
- 弹窗顶部不放“这个弹窗怎么用”的常驻说明：可操作性由控件本身表达（录入中显示“请按下组合键…”、冲突时显示错误、恢复按钮写明“恢复 PR 默认”）。

### 浮层（PanelTrigger / Dropdown 自定义面板）宽度跟内容走（重要记录 021）

`panelSize` 每一档都是**按内容定宽**（`w-max`），档位只给下限与上限，不随窗口宽度按百分比变：

| 内容 | 档位 | 宽度（下限–上限） |
|---|---|---|
| 菜单、选项列表（按最长一项） | `menu` | 128–360 |
| 参数 / 设置表单、短说明、快捷键表 | `compact` | 288–384 |
| 自带多列内容的浮层：预设列表、生成表单 + 预览 | `wide` | 420–720 |
| 浮层里的完整工作面 | `workspace` | 640–960 |
| 特殊面板（见下节） | `special` | 240–760，高度上限 440 |

上限同时不超过窗口宽减 32。内容是 `w-full` / `minmax(0, 1fr)` 网格这类没有固有宽度的东西时，浮层取下限；需要更宽就给内容
声明宽度（网格按列数 × 单元宽、列表量最长的名字），不要换大档位把一行内容撑开。实测踩过：10 月 13 日把 65 个浮层按内容算好的宽度
换成“窗口宽度的 28% / 48% / 80%”，1200 宽窗口下比例面板只有 336，格子被切出横向滚动条；画布节点模型列表被撑到 577，右边空出三分之一。
巡检 `overlayHorizontalScroll` 与 `overlaySlack` 两条规则拦这两种。

### 特殊面板（参数里点开的那块浮层，重要记录 021）

比例与分辨率、模型选择、音色选择、音色克隆、高级选项、更多参数与参数组、魔搭自定义模型、画布节点的比例与模型都是特殊面板：
`PanelTrigger panelSize="special"` + `UiSpecialPanel`。规则：

- **宽度量里面最宽的内容**，夹在 240–760；网格按上限能放几列就放几列（`useSpecialPanelColumns`），单元宽度固定，正文宽度用 `bodyWidth` 给出。
- **一行从左读到右不超过约 720**：横向空间可以用，但内容多时分左右两栏，每栏一列读完（音色克隆：左素材、右设置）。
- **高度先省**：头部只占一行（搜索与筛选同一行，筛选组多时用紧凑下拉）；常用内容不滚动就能看完（目标 360），最高 440，窗口矮时降到可用高度。
- **同一副骨架**：头部一行、正文唯一滚动区、需要提交时才有底部操作行（左状态或出错原因，右主按钮）；从触发器展开，不盖住触发器那一行（画布节点向下展开）。
- 正文排布四选一：网格、列表、两列表单（标签在左，一项时只有一列）、两栏。布尔参数用开关（`UiSwitch`，浮层里是滑块）。
- 参数组分节多（≥ 2 节且 ≥ 8 个参数）时把分节分到左右两列，每列定宽 320（`paramGroupColumns.ts`），控件不拉成长条。

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
（12/600 次要文字、间距收紧），行用 `UiFormRow density="compact"`（面板由 `UiGroup labelWidth={72 | 96 | 120}` 统一标签列，标签左对齐、12px 间隔、控件填满余宽）（标签 12 次要文字），两者成对使用，不要在调用点改字号。
`UiFormRow` 的 `hint` 只放“不看会选错”的常驻说明，背景知识放 `info`（标签文字本身悬停触发，见下文 tooltip 规则）。

字段（任务 2.2）：`UiInput` / `UiSelect` / `UiFieldTrigger`（`Dropdown`、`PanelTrigger` 的按钮）/ `NumberInput` 都是 raised 无边框表面、聚焦一圈强调色焦点环，高度只由 `size` 决定（sm 28 / md 32 默认 / lg 36）。`NumberInput` 自带数值拖动：在读数或标签上按住左右拖动改值（Shift 精细、Alt 粗调），单击进入编辑，读数不会被步进列裁掉。

字段排布（任务 3.2）：一行参数条（如生成输入区底栏）不要做成“标签在上 + 字段框”的表单。在容器上提供 `UiFieldLayoutContext` = `toolbar`：参数标签移到控件左侧（辅助文字 12），`Dropdown` / `PanelTrigger` 的触发器自动改静默皮肤，参数开关改胶囊；多行文本、单选卡片、上传类等大块控件仍按表单排布。两者打开的浮层内容一律重置回 `form`，不要在调用点逐个传 `appearance` 或手写行内标签。

## 设置页：新增或调整一项设置时

设置项按**用户要做的事**归类，不按程序模块归类。大类与分区的唯一清单是
`src/core/types/settingsDeclaration.ts` 的 `SETTINGS_DECLARATION`（`SETTINGS_TAB_SECTIONS` 从它派生）：

| 大类 | 放什么 |
|---|---|
| 通用 | 语言与启动、查看与快捷键、外观、关于与更新 |
| 供应商与模型 | 密钥、模型开关、模型改名（单独成页的两栏控制台） |
| 工作区 | 按应用顶部页面分：生成 / 画布 / 剪辑 / 资产库 |
| 文件与下载 | 数据目录、上传（含大文件与托管服务）、下载 |
| 智能助手 | 助手模型、用户指令、外部智能体连接 |
| 助手技能 | 技能列表（单独成页） |

新增设置先问"用户会在哪个页面遇到这件事"，放进对应分区；同一件事不得拆在两个大类。
新增分区只在 `SETTINGS_DECLARATION` 所属大类添加一条：分区 ID、Surface ID、组件键、搜索标签/关键词与观察敏感度；标题默认引用 `navSections.<id>`。导航、Tab 内容次序、两份 Surface 目录和搜索索引自动派生，不在消费方重复登记。`surfaceOrder` / `schemaOrder` 保留已发布的两个目录顺序；搜索行顺序同样在声明中维护。
中文、英文翻译和实际组件是独立内容：新增组件只在 `settingsSectionComponents.tsx` 绑定实现；复用已有组件时无需改 Tab。助手属性用 `settingsTarget(sectionId)` 取得导航目标，禁止再复制大类。新增设置行的搜索文案放进所属分区的 `search`。

页内写法统一：

- 单选：≤5 项且每项 ≤4 个汉字（英文 ≤12 字符） → `UiSegmented`（`SettingsSegmented` 只是它的重导出）；否则下拉。不要同一页两种写法表达同类选择。
- 从属项：用 `SettingsDependentRows`，主开关关闭时收起、打开时缩进；不要只加 `opacity-50` 变灰占位。
- 时长不让用户填毫秒：用带"秒"单位的滑块或"快 / 中 / 慢"。
- 行布局默认 `UiFormRow inline`（标签左、控件右）；只有路径、长输入框、列表才占整行。
- 分区内的小分组只用 `UiGroup titleTone="overline"` 一种样式。
- 不放只读状态或"跳到设置里另一处"的按钮；不显示无可操作内容的行（如没有已忽略版本时的"清除"）。

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

## 界面语法：照着做就不会错（2026-10-12 起强制）

前面几节讲“为什么”，这一节是**执行者逐条照做的语法**。目标是让对审美没把握的执行者
只要照抄这里的结构就交得出合格界面。每条都来自真实返工：

| 返工现场 | 违反的语法 |
|---|---|
| 生成历史记录挤成一团，分不清哪条是哪条 | 记录列表 |
| 超级关键帧面板：“使用标注”标签和空下拉、“相对参照”挤在一行错位；两个下拉不知道是什么 | 面板表单行 |
| “分时摆放 / 录制轨迹”是两个零散按钮，项目里 43 处各写各的 | 分段选择 |
| 字幕画成标尺上的 12px 窄条，挡住时间码 | 新元素复用同类结构 |
| 钉住按钮在不能用时整排灰着摆在那里 | 不可用就不出现 |

### 1. 面板表单行（浮层面板、停靠面板、设置分区一律适用）

- 面板里**每一个**下拉、数值、滑杆、开关、分段选择都放进 `UiFormRow`，标签在左、控件在右；
  同一个面板只用一种标签列宽（`labelWidth` 有限枚举），所有控件左缘对齐。
- 禁止：裸 `Dropdown` / `NumberInput` / `UiRangeInput` / `UiSegmented` 直接堆在 `UiGroup` 里；
  禁止用 `Dropdown label=` 的行内标签在一行里塞两组“标签+控件”。
- 按钮行（开始、钉住、应用）与控件列左缘对齐，宽度占满控件列或按内容；不从标签列起头。
- 下拉没有可选项时显示占位（“不使用”“暂无标注”）并禁用；有选项但尚未选择时显示“未选择”类占位。任何时候都不出现空白下拉。
- **标签列宽按本面板最长标签取档**（`labelWidth` 枚举里取能放下最长标签的最小档），不让长标签溢出把行挤歪；
  控件一律占满控件列（下拉、数值框不按内容收缩）。
- 一个面板里可以有“成对数值网格”（X/Y、宽/高，标签在上），但它和单控件行的**标签左缘必须对齐**、
  控件右缘必须对齐；同一面板不允许出现第三种排法。
  返工现场：图片编辑属性面板“变换”是网格、“路径与组合”是 72px 行，“路径组合方式”溢出、下拉不占满、左缘不齐。
- `UiGroup labelWidth={72 | 96 | 120}` 统一提供面板列宽；内部与嵌套分组中的 `UiFormRow` 默认标签在左，普通表单上下文保持标签在上（记录 010）。成对网格或多行正文显式 `labelColumn="auto"`。面板行内的下拉、数值和分段由共享上下文填满控件列。尾部锁定等动作走 `trailing`；同组无动作的行传 `null` 保留 28px 尾槽，不手写栅格和 !important。

```tsx
<UiGroup title="示范" titleTone="compact" labelWidth={96} divided>
  <UiFormRow label="方式" density="compact"><UiSegmented … /></UiFormRow>
  <UiFormRow label="属性" density="compact"><Dropdown … /></UiFormRow>
</UiGroup>
```

- 参数面板内的样张预览使用有限高度预算（剪辑风格样张图片采用 `h-28`）；宽面板可紧凑并排，增加宽度不得让样张同比长高、把参数和动作推走。预算只约束显示几何，不限制产品素材或样例数量。

### 1b. 弹出面板（多步骤工具浮层，2026-10-22 起强制）

返工现场：超级关键帧弹出面板把“参照、示范、整理、钉住、候选、应用”所有阶段一次摊开，长到要滚动；压在黑色画面上的玻璃成了一块黑，
空标签行里放无底色整行按钮像悬空文字，滑杆读数挂在右上角、两端说明掉到下一行。规则：
- **按任务阶段只显示当前一步**：还没开始时只给设置与开始按钮；进行中只给状态与暂停/结束；有结果后把“选哪个结果”放最上面。
- **次要设置收进折叠区**（`UiDisclosurePanel`），有生效内容时默认展开；不要把低频选项摊在主流程里。
- **底部固定动作区**：一条分隔线下面右对齐“次要动作（quiet）+ 唯一主动作（primary）”；加载中把动作区换成进度与取消。
- 标签列取能放下最长标签的最小档（短标签一律 72）；**数值与滑杆同一行**（“端点说明 · 滑杆 · 端点说明 · 读数”）。
- 动作按钮用 `secondary` 占满控件列或按内容排开，**禁止空标签行里放 quiet 整行按钮**（看起来是悬空文字）。
- 候选、版本这类单选列表用 `UiOptionButton variant="menu"` 加统一的勾槽，各项文字左缘对齐，不给个别项单独加图标。
- 表面：普通界面上的弹出面板用默认实底档（开启毛玻璃时自动换成**浮层玻璃** `--ui-glass-overlay-tint`，比面板高一级）；
  `surface="glass"` 只给压在画面上的小工具条与菜单，表单型面板不用。贴在画面上的玻璃条（视频控制条）才用黑纱 `--ui-glass-tint`。

### 2. 分段选择（2~5 个短选项的单选）

- 一律 `UiSegmented`（一个整体容器、选项等宽）。**选中项用中性抬起底 + 强文字，不用强调色实底**：
  分段是“当前值”，一页常有多个，强调色实底只留给唯一主动作（记录 017，依据缺陷修复记录 014 修订 012）。禁止把几个
  `UiOptionButton variant="segment"` 并排放在 `flex` 里冒充分段控件。
- 超过 5 项，或单项超过 4 个汉字（英文超过 12 字符） → 用 `Dropdown`（全应用统一口径，设置页不例外）。
- 窄面板里各段实际放不下时，`UiSegmented` 自己换成下拉（文字不会挤出分段、叠到旁边一段上）；不要为窄宽度在调用点另写一份下拉。
- 设置页的 `SettingsSegmented` 是同一语义，必须合并为同一个实现，不得两套并存。

### 3. 记录列表（历史、任务、批注、版本等同质记录）

- 一律复用 `UiRecordList` / `UiRecordItem`；虚拟列表的 itemContent 可以直接返回 `UiRecordItem`，不另画列表边界。
- `density="page"` 每侧 20px、`panel` 每侧 12px、`compact` 每侧 4px；compact 只用于图片历史等高密度单行记录。不是“上下合计 20px”。块内统一 8px，页面相邻记录累计 40px。
- 插槽顺序为 `title`（14/500）→ `meta`（UI_TEXT_META_CLASS，数组自动以 ` · ` 分隔）→ children → status → actions。已存在完整领域记录组件或表格列的，放入 children，不拆业务状态。
- 分隔线统一 UI_DIVIDER_CLASS，由 item 根据完整列表 `index > 0` 画上边线，首条上方、末条下方不画；禁止 first: 判断虚拟窗口首项。测量 ref 指向含留白与边界的根节点。

### 4. 新元素先找同类结构，复用它

新增一种界面元素前，先问“它和现有哪种东西是同一类”，然后**完全复用那一类的结构与交互**：

| 新东西 | 同类 | 必须复用 |
|---|---|---|
| 字幕、标记区间 | 时间线轨道里的片段 | 轨道行（轨道头 + 内容区）、片段块外观、选中/拖动/修剪/锁定 |
| 画面里的字幕 | 画面里的文字片段 | 同一套命中、选中框、双击就地编辑 |
| 新的设置项 | 设置分区里的行 | `UiFormRow inline` + 设置搜索登记 |
| 新的浮层参数面板 | 现有参数面板 | 面板表单行 + 底部动作带 |

禁止为了“快”把新元素塞进别的元素的空隙（标尺、标题栏、命令带边缘）。

复用同类结构还包括**位置与列对齐**：新轨道和同类轨道连成一组排布（不隔着空白区），
头部按钮落在同类按钮的同一列上（同名按钮同列、缺的列留空），外观复用同一组件与 props。
返工现场：C1 字幕轨道第一版钉在标尺下、与 V1 隔着空白，按钮顺序“眼睛、锁”且与 V1 不对齐。

### 5. 不可用就不出现，出现就说明为什么

- 与当前模式无关的控件**隐藏**（如“速度”只在“录制轨迹”时出现），不要整排灰着。
- 暂时不可用但用户会找的唯一入口可以禁用，同时用 `disabledReason` 写清前置条件（“先示范一次运动”）。
- 一个区块里全部控件都不可用时，整块不显示。

### 6. 交付证据：按风险选择

- 以 `docs/rules/testing.md` 的 L0–L3 为准。局部样式、文案、事件或无视觉影响的属性，跑专项静态检查与精确测试。
- 共享布局、浮层、滚动、溢出或跨主题外观无法由精确测试证明时，才升级真实 Electron 样张页或受影响宿主；矩阵随实际风险选择。
- 本次运行过截图时，必须逐张目视，记录受影响状态与实际证据。一次 `ui:tour --audit` 已产出截图、DOM、像素对比度，不叠加同矩阵 `check:ui-visual`。
- 独占窗口验证受限时写明步骤并标待验证，禁止借用旧图或 DOM 测试冒充视觉通过。

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
| 选中/当前值用强调色实底（蓝底白字的分段、选项、标签） | 分段用中性抬起底 + 强文字（`UiSegmented`）；其他单选用中性选中底（`UiOptionButton active`），多选标签用淡强调底（`UiChipButton`）；强调色实底只给唯一主动作 |
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
| 按钮加载与不可用原因 | `UiButton` / `UiIconButton` 的 `loading` 保留静息内容占位、名称和尺寸并阻止重复操作；按钮类的 `disabledReason` 在禁用时通过统一 Tooltip 解释前置条件，保留键盘焦点并阻断操作 | 用进行中文案替换静息文案；手写转圈；包 span + title |
| 行内加载与骨架 | `UiSpinner`（size 沿用图标按钮阶梯，tone default/accent，继承色默认）/ `UiSkeleton`（shape line/block/square）；active 仅供样张重放，减少动效走共享底座 | 业务手写 animate-spin/animate-pulse；把 StateSize 留白密度当控件高度 |
| 字段与行内反馈 | `UiFormRow error` 自动关联行内控件 aria-invalid/aria-describedby；独立字段用 `UiFieldMessage`（tone error/hint，调用方关联 id）；操作状态用 `UiInlineStatus`（tone error/warning/success，可 truncate + tooltip） | 内联手写危险色错误文字与零散 alert |
| 弹窗 | `UiModal`（正式业务默认 `scope="viewport"`，接管焦点与模态；设计系统常驻缩略样本用 `scope="container"`，不接管焦点） | 手写 `fixed inset-0` + `bg-black/…` + 卡片（存量已全部清零，`check:surface` 规则 C 会拦，别再加）；用容器预览替代正式模态 |
| 分组 | `UiGroup`（相邻组统一 32px 留白；面板内跨包装层分组用 `gap="section"`，复用 `UI_SECTION_STACK_CLASS`） | 手写 `border + bg` 的 div |
| 页面标题区 | `UiPageHeader`（标题旁的数量等用 `meta`，与标题基线对齐；页头兼作页面顶带时用 `divider` 画自适应下分隔线） | 手写 h2 + p；把数量塞进标题文字；调用点给页头写 `border-b` |
| 封面内容卡（项目卡、工程卡、资产卡） | `UiOptionButton variant="cover"` + 封面框 `UI_COVER_FRAME_CLASS`；不是按钮的根元素（可拖拽的资产卡）加 `UI_COVER_GROUP_CLASS` 与 `data-selected` | 给整张卡铺底描边，或在调用点手写悬停描边/选中环 |
| 工具页 / 全屏工作面的命令带 | `UiToolbar variant="command"`：左端 children（返回、文件上下文、主工具组）/ `center`（视图切换、随工具变化的参数）/ `trailing`（次要动作 + 唯一主动作）/ 可选 `subordinate` 从属带（共用底色与下边框）；状态写进 `barProps` 的 `data-*` | 每个工具自己画 `h-11 border-b bg-*` 头带；从属带另画底色或边框 |
| 可点的文字记号（逐字稿词块、时间轴字幕块） | `UiTextToken`（`appearance` inline/chip；`current` 播放中、`selected` 已选、`excluded` 已删除、`flagged` 待留意） | 用 `UiButton` 加 className 覆盖底色、圆角、划线 |
| 同组同档内容动作 | `UiActionGroup tier="secondary" / "quiet" size="sm" / "md" / "lg"`；组内 UiButton 继承档位和尺寸 | 子按钮逐个写 variant/size；S7 阻断，开发态冲突告警 |
| 同质记录列表 | `UiRecordList` / `UiRecordItem`（density page/panel/compact；全局 index 决定分隔；支持测量 ref） | 手写 py-5 + border-t、divide-y 或 first: 边界；规则 E / S4 已接入 |
| 全屏媒体查看器 | `useUiViewerShell(open, onClose, options)` + `UiViewerShell viewer={viewer}`；surface media/canvas、inset window/content、presentation fill/centered、controls 插槽 | 复制淡入淡出、inert、滚动锁、Escape 与 overlay ownership；业务不再加查看器壳豁免 |
| 属性面板（效果控件这类竖向属性列表：每行 箭头 / 秒表 / 名称 / 右对齐数值，重要记录 019） | 宿主提供 `UiFieldLayoutContext` = `property` 与 `UiPropertyMenuContext`（面板级右键菜单，`useContextMenu().showMenu`）；行就是 `UiFormRow`（`leading` 秒表列、`labelTrailing` 悬停出现的关键帧导航、`wide` 曲线/色轮等整行控件；重置放右键菜单，没有宿主菜单时才退回 `trailing`）；数值后的单位用 `UiPropertyUnit`（行末挂进 16px 单位道，成对数值中间的传 `hanging={false}`）；行外内容用 `UI_PROPERTY_INSET_CLASS` 对齐名称列，默认藏起、悬停或聚焦本行才出现的用 `UI_PROPERTY_REVEAL_CLASS`；`ParamList` / `ParamField` 在这个排布下自动变成同一套行；分组的可折叠小标题用 `PropertyHeading`（`@/components/ui/params/ParamList`，与参数行同一套四列、箭头落在秒表列；基本声音等非参数分组同样用它） | 行尾再放一列重置按钮；调用点自排四列网格、手写单位占位或数字右对齐 |
| 表单行 | `UiFormRow`（窄停靠面板 `density="compact"`，配 `UiGroup titleTone="compact"`）；行内的 `Ui*` 控件没有自己的名称时自动 `aria-labelledby` 行标签、`aria-describedby` 说明（下拉读作“标签 + 当前值”，任务 5.8） | 手写 label + 间距；调用点改标签字号；给行内控件再手写一遍同样的 `aria-label` |
| 字段 | `UiInput` / `UiSelect` / `UiTextArea` / `NumberInput`（数值拖动：读数或标签上左右拖，Shift 精细、Alt 粗调，单击编辑）；高度只用 `size`；直接落在所在表面上编辑的多行文本用 `UiTextArea frame="none"`；复合字段（表面与焦点环画在外壳上）的内层输入用 `UiInput frame="inner"` | 手写数值拖动、自绘步进器；调用点改高度；调用点给文本框去边框去底（`!bg-transparent !ring-0`） |
| 颜色输入、多行字段外壳、数值步进列 | `UiColorInput` / `UiTextArea` / `UiNumberStepper`（步进列组合到数值字段中） | 重写颜色输入、叠第二层字段框、把步进列当独立数值框 |
| 日期选择 | `UiDatePicker` | 裸输入重做日期字段与选择面板 |
| 折叠内容与长用户文本 | `UiDisclosurePanel`（正式开合过渡）/ `UiMarqueeText`（受控长文本） | 自写折叠时长；用跑马灯隐藏短操作标签 |
| 任务历史筛选 | `UiTaskHistoryFilterBar` | 另造同义字段与标签组合 |
| 渲染错误兜底、全局确认 | `UiErrorBoundary`（保留正式日志域）/ `GlobalAlertDialog`（App 根宿主，调用 `alertDialogStore`） | 吞掉渲染错误；在业务页重复挂载全局确认宿主 |
| 搜索框 | `UiSearchInput`（前置放大镜、`size`、可选 `onClear` + `clearLabel` 清除按钮；`className` 落在外层只放宽度） | 自己摆一个绝对定位的放大镜再给 `UiInput` 补 `pl-8` |
| 下拉 / 面板触发器 | `Dropdown` / `PanelTrigger`（按钮是 `UiFieldTrigger`：`appearance` field/quiet、`size`；浮层 `surface` solid/glass、`panelPadding`、`panelSize` menu/compact/wide/workspace/special）；一行参数条用 `UiFieldLayoutContext` = `toolbar` | 自己写触发器按钮或浮层外壳；`buttonClassName` 里改外观 |
| 特殊面板（参数里点开的那块浮层：比例与分辨率、模型、音色、音色克隆、高级选项、魔搭自定义模型、画布节点的比例与模型） | `UiSpecialPanel`（`header` 一行搜索与筛选、`aside` 左栏、正文唯一滚动区、`status` / `action` 底部操作行、`bodyWidth`、`height` fit/fill）配 `PanelTrigger panelSize="special"`：宽度量最宽的内容、夹在 240–760，高度上限 440；网格列数用 `useSpecialPanelColumns` 与 `specialPanelGridWidth`（重要记录 021） | 浮层里自己拼头部、滚动区与底栏；按窗口百分比定宽；一行内容撑成半屏宽 |
| 浮层归属（点外关闭、Escape） | `useUiOverlayLayer` + `UiOverlayLayerProvider` + `resolveUiOverlayTarget` / `isTopmostUiOverlay`（`@/components/ui/overlayOwnership`，语义同 Floating UI FloatingTree）：子浮层里的点击不关父层，Escape 只关最上层，模态层（查看器、弹窗）打开期间祖先层不响应点外；不在同一 React 树的浮层根节点写 `data-ui-overlay-detached` | 每个浮层各写一份 portal 选择器白名单或只认自身 refs |
| 右键菜单、按钮弹出的动作菜单、锚定外部元素或指针的浮层 | 动作列表用 `ContextMenu` + `useContextMenu`（`showMenu` 跟随指针，`showMenuAt` 贴按钮右缘；压在画布/媒体上传 `surface="glass"`；菜单项是 `UiOptionButton variant="menu"`，方向键与 Enter 可用，宽度按内容）；需要表单内容的锚定浮层用 `PanelTrigger` 的 `anchor`（元素或矩形）+ `open` / `onOpenChange`，自定义触发器用 children 渲染函数（任务 5.9） | 自己 `createPortal` 画菜单或面板、手算视口夹取、各写一份点外关闭与 Escape、用私有 CSS 画菜单项 |
| 一行放不下就收进“更多” | `UiOverflowRow`（`items` 带 `priority`/`pinned`，`renderOverflow`，`alwaysShowOverflow`，`growIntoParent` 借父级空余宽度；收起项不挂载）；生成底栏由 `ParameterPanel` 在 `toolbar` 排布下接入；停靠面板底栏用 `UiToolbar variant="footer" tools`（内部就是它） | 让参数条 `flex-wrap` 换成两行；收起项留在 DOM 里只隐藏 |
| 统一分段单选（设置页 `SettingsSegmented` 仅重导出同一实现） | `UiSegmented ariaLabel options value onChange size="sm" / "md" / "lg" fullWidth disabled onPreview`；选项支持 `disabled/title/ariaLabel`；内部复用唯一内嵌 `UiOptionButton variant="segment"`，等宽分段、radiogroup/radio、单一 Tab 停靠点、左右方向键循环切换；中性抬起底 `bg-segment-selected` 与强文字选中态由 primitive 维护；≤5 项且每项 ≤4 个汉字（英文 ≤12 字符）；含汉字的混合标签按四个 Unicode 字符计，否则转完整下拉 | 调用点手写并排选项与轨道间距；新增分段优先复用统一容器 |
| 内容格适配 | `UiOptionButton variant="card"`（现有内容选项格，静息 raised、选中中性选中底）；新二维选项优先 `grid` | 把 card 当成面板外壳或新增卡片套卡片 |
| 分段 / 网格 / 小样 / 色样选择 | `UiSegmented` / `UiOptionButton variant="grid"` / `tile` / `swatch`；网格格子要等大时用 `gridCell`（`ratio` 78×92、`tier` 78×42、`tier-detail` 78×52、`preset` 120×52） | 手写 `bg-veil-faint` 格子、强调色实底的分段；用内联 `style={{ height }}` 定格子高度 |
| 工具栏只读数值 | `UiReadout size="sm" / "md" / "lg" tone="default" / "media"`；外框与同行控件等高，等宽数字 | 自写 h-7/h-8 读数仿控件 |
| 开关、复选框、图标开关 | `UiSwitch`（外观随区域：`UiBooleanAppearanceContext`，`DockviewHost` 提供复选框外观、`UiModal` 重置回滑块）/ `UiCheckbox` / `UiIconButton on` | 用整行实底或强调色文字表达“已开启”；调用点按页面自己判断画滑块还是方框 |
| 带标签字段 | `UiFormRow inline` + `UiSwitch` / `UiInput`；多行表单不传 inline | 重新创建 Toggle / TextInput 平行包装 |
| 标签栏、导航 | `UiNavButton`（侧栏）/ `UiChipButton selectionRole="navigation"`（`selectionAppearance` default / `subtle` 面板标签 / `workspace` 标题栏工作区，后者同栏浮层开关用 `on`） | 手写指示条、选中底 |
| 无边框窗口的最小化/最大化/还原/关闭 | `UiWindowControl`（`action`、`platform` windows/mac；主窗口与日志窗口共用） | 用 `UiIconButton` 加覆盖拼交通灯或关闭红底 |
| 通知提示（操作反馈的短暂提示） | `UiToast`（`tone` success/error/warning，状态只进图标颜色；可选 `action` 复用 quiet 按钮提供可访问恢复动作；`surface` solid 默认 / 压在画布与媒体上用 `glass`；`placement` window 标题栏下居中 / container 画布内）；全局用 `useNotification().showNotification`，停留与淡出时长用 `motion.ts` 的 `UI_TOAST_DISPLAY_MS` / `UI_TOAST_EXIT_MS`（任务 5.7 把三套实现收敛到这里） | 自己画 `fixed top-*` 浮条、用危险实底或成功实底铺满通知、各写一份显示时长 |
| 弹窗/浮层/查看器/提示/缩略图进出场 | `useDialogTransition(open, durationMs, appear, { onExited, exitRef, enterKey })`；默认 base 档，结束事件挂根元素或 exitRef（CSS animation 用 onAnimationEnd、transition 用 onTransitionEnd），减少动效时直接显示/卸载 | 各入口手写 shouldRender/visible 的 rAF 与退出计时器；时长不匹配 CSS 档位 |
| 临时通知生命周期 | `useTimedToast<T>()`（与 useDialogTransition 同文件）+ 正式 `UiToast`；停留 `UI_TOAST_DISPLAY_MS`、退出 `UI_TOAST_EXIT_MS` | 全局/生成页各写通知计时、进入延迟与卸载分支 |
| 循环进行中反馈 | `UI_LOOP_MS.spin/pulse/executing` 及对应根变量，正式样本在设计系统中心 | 把循环周期当成进出场档；业务写裸秒数或永久合成层 |
| 悬停说明 | `Tooltip`（300ms、raised 实底，唯一浮层实现是 `TooltipContent`，中心页用 visible + anchorRef 常驻）；参数名、设置项标签用 `UiTooltipText`；`placement` 默认 `top`，一列紧挨着的表单行（画布节点参数行名称，经 `ParamLabel tooltipPlacement`）用 `left`，放不下依次退到右侧、上方，避免盖住上一行 | 自己写 title 浮层或 ⓘ 图标；为躲开相邻行另写定位 |
| 音频波形（任何位置：口播剪辑、剪辑时间线与源监视器、画布音频节点、资产卡、音频播放器、生成记录） | `WaveformView`（`@/components/waveform/WaveformView`，`tier` mini/standard、`tone` neutral/clip）+ `useWaveformData` / `useWaveformDataList`（`@/hooks/useWaveformData`，多精度峰值、磁盘缓存，放大到采样点） | 自己解码音频、自写峰值缓存或 Canvas 波形绘制 |
| 剪辑片段的视频缩略帧条 | `useFilmstripFrames` + `src/services/videoFilmstrip/filmstripFrameService.ts`（主进程 `electron/main/services/video/filmstrip.ts` 成批取帧、磁盘缓存） | 逐帧走原生解码或另建缩略图通道 |
| 参数帮助说明 | 参数名称文本本身的 hover / focus tooltip | 加 Info 等额外图标、把 `description` 渲染成控件下方正文，或用 Tooltip 包住整个控件 |
| 空/加载/错误 | `UiEmpty` / `UiLoading` / `UiError`（节点内容区的空占位用 `UiEmpty size="node"`） | 内联手写状态块 |
| 按钮/输入/开关等 | `@/components/ui` 的 `Ui*` | 原生 `<button>/<input>` |
| 提示词编辑 | `PromptEditor` | 自己拼 textarea |
| 提示词只读展示 | `PromptDocumentStatic`（与 `PromptEditor` 共用文档语义） | 另造提示词文档格式或手写文本解析 |
| 文件上传/排序 | `FileUploader` / `useReorderDrag` | 重写拖拽 |
| 叠放媒体上传 | `StackedMediaUploader`（复用 `FileUploader` 与拖拽排序） | 另写媒体上传或排序链路 |
| 费用估算 | `PriceEstimate`（已注册模型计价，遵循用户币种与费用显示偏好） | 固定价格、触发真实生成来展示价格 |
| 文字与矢量外观编辑 | `@/components/typography/TypographyPanel`（领域组合面板，共用字体、排版、填充、描边、阴影；author-text 用于绑定图层的文字样式参数，开放字体/字号/字重/字距/行距/填充/多层描边；宿主提供布局与预设 footer） | 图片、字幕、标题、代码文字另写同义参数与外观面板 |
| 字体选择与样式预览 | `UiFontPicker`（本机/导入字体、中英文搜索、分类与虚拟列表、真实样式、收藏/最近/工程字体；`onPreview(null)` 恢复，`onSelect` 提交） | 手动输入字体名、三种通用族固定下拉、另造字体弹层 |
| 音频播放 | `@/components/AudioPlayer` | 再写一个播放器 |
| 全能调色曲线 / 色轮 | `UiCurveEditor` / `UiGradeWheel`（`@/components/ui`，受控值与开始/结束/取消手势；曲线可传领域采样器保留样条显示；色相区间用 `UiRangeSlider wrap`） | 自写曲线、色轮或区间控件 |
| 参数面板（效果/调整/代码参数，按分组、更多折叠、条件显示渲染字段） | `ParamList` / `ParamField`（`@/components/ui/params`，中立字段描述 + 手势适配器；textStyle 复用文字面板，table 用记录列表承载逐项字段；剪辑效果、代码参数与图片调整层共用） | 每个面板自写参数行、各自处理拖动撤销 |
| 长列表 / 网格 | `UiVirtualList` / `UiVirtualGrid`（`@/components/ui`，基于 react-virtuoso；有限高度、单滚动容器、稳定键、空态和高亮 scrollIntoView；可变高度卡片按行测量） | 全量 map 渲染上百项；普通目录另用 tanstack，自写窗口计算 |
| 指针事件合帧 / 延后一次测量 | `useRafCallback`（`@/hooks/useRafCallback`）/ `createRafScheduler`（`@/utils/createRafScheduler`；最新样本、cancel、flush，传 ownerWindow） | 各自管理 rAF id；结束/卸载后还有待执行帧 |
| 音频播放位置 | `usePlaybackClock`（`@/hooks/usePlaybackClock`；单个播放循环，波形与秒读数叶子订阅，AudioPlayer / AudioNode 已接入） | 播放帧 setState 重渲染整个播放器或节点 |
| 瞬态 keyed 进度 | `createTransientProgressStore`（`@/stores/createTransientProgressStore`；set / clear / clearAll / useEntry，自定义 normalize / equals；Record/Map 适配只保留字段与动作名） | 拷贝三套相等短路和清理逻辑；瞬态进度入文档或撤销 |
| 丰富参数原件（角度、二维点、区间、渐变、专业色轮、线性曲线、缓动、种子） | `UiAngleDial` / `UiPointPad` / `UiRangeSlider` / `UiGradientEditor` / `UiGradeWheel` / `UiCurveEditor` / `UiEasingEditor` / `UiSeedInput`（`@/components/ui`；受控 `value/onChange`、`defaultValue`、`disabled`、`size` sm/md/lg；共享 `GestureProps` 开始/结束/取消，读数复用 `NumberInput`；色相/通道/轨道只用登记令牌；缓动预设由调用方提供） | 业务组件自写参数拖动、数值读数、曲线或色轮；新增重复分段控件（分段复用 `UiSegmented`）；另写一套曲线或色轮（旧调色曲线与旧色轮已于 2026-10-25 删除，曲线一律 `UiCurveEditor`、色轮一律 `UiGradeWheel`） |
| 间距、条带与面板尺寸 | `UI_SPACING_SCALE`、`UI_INLINE_GAP_CLASS` / `UiToolbar.gap`、`UI_STACK_CLASS`；条带 `UI_BAND_HEIGHT_CLASS` / `UI_BAND_MIN_HEIGHT_CLASS`；面板 `UI_PANEL_WIDTH` / `UI_PANEL_BODY_HEIGHT_CLASS` | 越档 padding/gap；业务数值 panelWidth/panelHeight |
| 多行与弹窗正文尺寸 | `UiTextArea` / `PromptEditor` 的 `height` short/medium/tall；`UiModal.contentPadding` default/none/spacious 与 `contentScroll` auto/none | 用 className 取消默认留白；给文本自造最小高度 |
| 表面与区域 | `UiPanel variant` / `UiRegion` | 重写卡片外壳、给内部分组套面板 |
| 原生范围字段 | `UiRangeInput`（共享范围输入原语） | 业务手写 range input |
| 确认弹窗 | `AlertDialog`（全局入口由 `GlobalAlertDialog` 承载） | 手写确认遮罩与生命周期 |

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
9. 仅命中 AGENTS.md 完成标准的环境维护条件时，检查并维护当前仓库开发实例
```

**第 2 步不能跳。** 审查界面时只做组件级检查（每个按钮用没用对 primitive）会漏掉所有骨架问题——
条带叠条带、工作面套卡片、左边距三个位置，这些单看每一条都合规，丑的是它们摞在一起。
用户说"布局不合理""特别丑"而你只查出了几个 primitive 用错，那基本可以确定第 2 步跳了。

## 页面完成自检清单

- [ ] 按 testing.md 确定证据级别；若本次截了交互态或数据变体，是否按 `references/review.md` 第 2 节逐项看过吗？
- [ ] **从窗口顶到内容区横着切了几刀？** > 2 条（命令带 + 从属带）就是骨架错了
- [ ] 每一条新增文字、数字、徽标和状态是否至少服务于行动、决策、理解结果或恢复失败？否则删除
- [ ] 系统通知、成功提示与失败兜底是否进入 i18n，并在英文界面检查过？统一 Toast 保留消息键直到显示，不能把固定中文传到通知入口
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
- [ ] 用 `accent` 当文字色了吗？文字用 `text-accent-text`（`UI_COLOR_ACCENT_TEXT_CLASS`）；字压在强调实底上用 `bg-accent text-on-accent`（黑白由引擎按对比度决定）
- [ ] 分段是否中性抬起底 + 强文字，其他选中/当前值是否中性选中底（多选标签淡强调底）且与悬停可辨？强调色实底只属于唯一主动作；悬停/选中的容器里行内控件仍可辨
- [ ] 本次涉及跨主题外观且升级截图时，至少看过“石墨”“纸白”吗？浅色模式下黑白类、媒体叠层令牌放错位置最容易露馅
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

公共组件先跑精确测试；主题求解变化才选相关主题测试（包括 `themeCombination.test.ts`）。只有公共布局、滚动、溢出或跨主题外观风险无法由精确测试证明时，升级 `references/review.md` 第 8 节的真实样张页或受影响宿主。升级后只运行一次 `ui:tour --steps scripts/ui-review/ui-gallery.json --matrix review --audit --no-screenshots`（只落盘有问题的截图；需要目视时去掉该参数，每轮抽看约 10 张以内）；矩阵仅在令牌/主题或明确布局矩阵风险时使用，其他情况选一个故障尺寸与受影响预设。

设计系统中心复用开发页 `dev.ui_gallery`，令牌、组件、模式与规范通过目录与搜索进入；正式构建裁掉入口，助手/MCP 不暴露。新增共享组件同时补真实样本与本复用表，覆盖由 `uiGalleryCoverage.test.ts` 保护。Windows 像素基线只在本机按 testing.md 的固定流程运行，不作为 CI 门禁。

真实 Electron 验证使用正式场景；本次产生的截图必须逐张目视。`check:ui-visual` 与 `ui:tour --audit` 共用审计循环并产出截图；同矩阵二选一。禁用控件、aria-hidden 和不可见区域不判；正文 ≥4.5:1，大字、图标与交互图形 ≥3:1。范围填充、边界、手柄分开测量各自邻接背景，现有通用候选收集仅覆盖文字/图标，图形须由对应场景像素断言。合理内容色例外按 review 第7节登记，界面色不达标修令牌。

开发实例维护只在 AGENTS.md 完成标准的触发条件成立时执行；规则、文档与无需真实窗口的局部逻辑任务不启动或重启环境。

### 条带数量已进自动检查（5.8）

「页面骨架：横向条带」那节的规则曾经全靠人看（4 条带的图片编辑页在 `check:surface` 与 `check:ui-visual` 下都是全绿）。
5.8 起 `check:ui-visual` 的 `stackedBands` 在真实 DOM 里数条带：不在滚动区里、几乎占满父容器宽、自己画了分隔线或底色
（或是命令带 / 从属带 / 工具条 / 页头）的 24–64 高块上下相接超过 2 条即命中；同批还有工具条折行、短文案截断、
选中态与静息态差异不足、浮层被裁切四条，判据与断牙样例见 [references/review.md](references/review.md) 第 7 节。
新工具页仍统一用 `UiToolbar variant="command"`，从源头避免条带问题；规则只在场景覆盖到的界面上生效，没有场景的新页面照样要人工数一遍。

代码残留同样进了门禁：`npm run check:ui-residue`（任意值类、内联尺寸与颜色、调用点覆盖、豁免理由、私有样式、零引用、旧文案），
口径与登记方式见 references/review.md 第 3 节。

`check:surface` 默认严格，检查 A–E 与以下 S 规则；仅 S8 的禁用原因与手写 alert 建议为 warning。`--report` 只用于查看诊断，不冒充门禁通过。

A–E：

- `[A]` 手写面板表面 → 改用 `<UiPanel>`
- `[B]` 同文件多处卡片表面 → 疑似卡片套卡片，内层降级
- `[C]` 手写弹窗（`fixed inset-0` + 黑色遮罩但没用 `UiModal`/`AlertDialog`）→ 改用 `UiModal`
- `[D]` `.css` 里手写毛玻璃（`backdrop-filter`）→ 元素上加 `ui-glass`
- `[E]` 按钮、选项、标签、导航、字段触发器的调用点用 className 覆盖外观（底色/边框/文字色/圆角/阴影/高度/字号）→ 用组件枚举

存量已全部清零，`check:surface:strict` 已接入 `build` / `electron:build` 与 CI，**违规会直接让构建失败**。改完必须跑一次确认通过。

### 静态语法 S 规则表

| 编号 | 判据 | 对应语法 | 级别 / 门禁 / 豁免 |
|---|---|---|---|
| S1 | 独立/手拼 segment；静态超过五项或字面量标签超四个汉字（英文十二字符） | G2 | error / surface；动态标签走组件回落与溢出告警 |
| S2 | 非工具条 UiGroup 直接放无 UiFormRow 的参数控件 | G1 | error / surface |
| S3 | 同一 flex 行两个带内联 label 的 Dropdown | G1 | error / surface |
| S4 | map 标题+元信息记录缺分隔；认 UiRecordItem、border-t/b、divide-y、UI_DIVIDER_CLASS；选项不混算 | G3 | error / surface |
| S5 | 同一拥有 labelWidth 的组内列档不一致；auto/独立组不混算 | G1 | error / surface；动态值交 DOM |
| S6 | 可确定的单行直接兄弟 size 不一致 | G4 / 尺寸 | error / icons；包装/动态交 DOM |
| S7 | UiActionGroup 子按钮逐项覆盖 variant/size | 动作层级 | error / surface |
| S8 | 原生 title、手写 animate-spin/pulse；禁用缺原因、手写 alert | G5 / 状态 | 前两项 error，后两项 warning / surface |
| S9 | 同一静态表面可共存主动作 >1，互斥分支取最大，嵌套表面另计 | 动作层级 | error / surface；动态值交 DOM |
| S10 | PanelTrigger、带 renderPanel 的 Dropdown 没写 panelPadding（特殊面板与展开属性除外） | 浮层内边距 | error / surface；表单与说明 content、菜单列表 menu、内容自带内边距或要贴边写 none |

surface 规则行内或上一行真实注释可写 `ui-surface-allow: S1 具体理由与接手任务`（替换为对应编号）；不得文件级放行。S6 只按 icons 的已登记边界判，尺寸 D 不接受注释豁免。G6 是证据选择，没有静态规则能证明目视完成；实际覆盖见 frontend-ui.md 表。

确需例外时在该行上方加注释 `ui-surface-allow` 并写明理由与接手任务；只允许行级豁免，文件级 `ui-surface-allow-file` 出现即报违规（否则该文件将来真正的套娃也会被放行）。

全屏沉浸式媒体查看器统一用 `UiViewerShell`，不套用居中卡片语义的 `UiModal`。生命周期 hook 在宿主同层调用，淡出后只卸载壳内容，保留视频音量等宿主会话偏好；减少动效沿 useDialogTransition。scope="container" 只用于中心页静态预览，不接管模态、键盘与滚动。

`npm run check:surface:report` 是告警视图；`check:surface` 与 `check:surface:strict` 都是严格门禁，已接入 CI。

## 相关规范

- 组件复用与原生标签落点、颜色令牌三处入口：见 [docs/rules/frontend-ui.md](../../../docs/rules/frontend-ui.md) 与 [docs/rules/architecture.md](../../../docs/rules/architecture.md)
- 画布节点的行组件拼装：见 skill `canvas-node-builder`
- 提示词编辑器、文件上传控件：必须复用 `PromptEditor` / `FileUploader`，不要重写

### 间距与尺寸复用补充（4.3）

纵横间距统一 `UI_SPACING_SCALE` 九档。工具条用 `UiToolbar.gap`，堆叠用 `UI_STACK_CLASS`；条带用 `UI_BAND_HEIGHT_CLASS`、`UI_BAND_MIN_HEIGHT_CLASS`、`UI_BAND_PADDING_CLASS`，表单行最小高度用 `UI_FORM_ROW_MIN_HEIGHT_CLASS`。PanelTrigger/Dropdown 用 `panelSize` 四档，正文高度用 `UI_PANEL_BODY_HEIGHT_CLASS`；可拖动侧栏共用 core/theme/panelSizes 的 `UI_PANEL_WIDTH`。UiTextArea/PromptEditor 用 `height` 三档。UiModal 用 `contentPadding` 与 `contentScroll`，不能靠 contentClassName 替换默认留白。完整像素、用途和迁移规则见 references/typography-and-tokens.md；新档必须同时补设计系统中心页真实样本与枚举覆盖。

### 5.2 自动语法与预算

S1–S5/S7–S10 的判据与正反例见 `references/review.md` 第 7 节；S6 仍由 `check:icons:strict` 负责。UiModal、UiToolbar 与工作区根在开发态按最近表面计算可见主动作，超过一个告警并标 `data-primary-overflow`，不静默改动业务动作。动态/互斥分支最终由 DOM 的 multiplePrimary 检查。

`smallTargets` 保持普通命中区 24px；唯一新增紧凑例外为正式 `UiIconButton size="2xs"`（20px），用于密集附属操作，需有 tooltip/可访问名称。只认 button.ui-btn + data-tone + data-size=2xs，低于 20px 仍报错；xs 已为 24px，不豁免。原生步进箭头、行内文本及画布缩放的既有边界不变。
