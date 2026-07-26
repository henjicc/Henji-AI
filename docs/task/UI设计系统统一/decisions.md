# 执行期决策记录

本文件记录**执行过程中产生的、影响单个或少数任务的技术决策**。

会影响整个计划或多个任务方向的重大决定放 `重要记录.md`，不要写在这里。两边不要重复。

已在 `重要记录.md` 中确定的六条（001~006）是本阶段执行的前提，执行时如与实际情况冲突，先更新 `重要记录.md` 再动手。

---

### D-001 画布节点选中描边改为跟随用户强调色

- 日期：2026-07-25（任务 1.1）
- 背景：11 个节点文件都写 `shadow-[0_0_0_1px_rgba(59,130,246,0.32)]`，其中 `rgb(59,130,246)` 是**默认**强调色的硬编码值。而紧邻的 `border-accent` 走 `--accent-rgb`，会跟随用户在设置里改的 `accentColor`。两者不一致 → 用户改强调色后，节点边框变色但描边仍是蓝色。
- 决定：具名阴影 `shadow-node-selected` 定义为 `0 0 0 1px rgb(var(--accent-rgb) / 0.32)`，跟随主题。
- 理由：这是缺陷修复而非风格改动——同一个视觉元素的两个部分本就该同色。
- 影响范围：11 个画布节点文件。默认强调色下**外观完全不变**；只有改过 `accentColor` 的用户会看到描边跟着变（即预期行为）。

### D-002 修复 6 种静默失效的透明度类

- 日期：2026-07-25（任务 1.1）
- 背景：在验证 `border-white/42` 能否生成 CSS 时发现它**根本不生成**。实测确认（Tailwind 3.4.18）：透明度修饰符的裸数字只在 Tailwind 刻度内（0/5/10/…/100，步进 5）才生成，非刻度值既不报错也不产出 CSS。全库扫出 6 种非刻度值、共 8 处：`/28 /42 /46 /72 /82 /92`。
  受影响的包括提示词优化预览的遮罩底色（`bg-app/72`，本应半透明遮住编辑器）和上传缩略图边框（`border-white/42`）。
- 决定：全部改为最近的有效刻度值（`72→70`、`42→40`、`46→45`、`28→30`、`82→80`、`92→90`），偏离作者意图 ≤2%。并把这条坑写进 skill 与 `CLAUDE.md`。
- 理由：这些类此前等于没写，属既有缺陷。修复后这些元素的背景/边框会**首次真正显示出来**，是可见变化，但方向是恢复设计意图。
- 影响范围：`InputArea`（提示词优化遮罩）、`ModelSelectorPanel`、`StackedMediaUploader`、`styleTokens`（上传卡边框）。**需用户在真实窗口确认观感**，已列入 `test-report.md`。

### D-003 圆角三档收敛暂不执行 285 处存量替换

- 日期：2026-07-25（任务 1.1）
- 背景：`01-实施方案.md` 提出圆角收敛为 `rounded-lg/xl/full` 三档。但存量 `rounded`(105) + `rounded-md`(80) + `rounded-lg`(100) 共约 285 处，全部归到 `rounded-lg` 意味着 4px/6px→8px 的可见变化，且改动面极大。
- 决定：本阶段只做两件事——（1）把**任意值**圆角收进登记档位（已完成）；（2）用 ESLint 禁止**新增**内联圆角。285 处标准类之间的收敛**不在本阶段执行**，留待用户看过实际效果后单独决策。
- 理由：任意值是"无法约束"的问题，必须解决；标准类之间的档位收敛是"风格统一度"问题，收益不足以支撑 285 处可见变化的风险，且一旦用户不满意回退成本高。
- 影响范围：`01-实施方案.md` 与 1.1 验收标准中"圆角只出现三种写法"一条实际未达成，改为"任意值圆角归零 + 禁止新增"。需要时可另开任务。

### D-006 画布节点**不**预先标注 ui-surface-allow（推翻 2.5 的原定做法）

- 日期：2026-07-25（任务 2.5）
- 背景：2.5 原计划给约 13 个画布节点文件的根表面加 `ui-surface-allow` 注释，理由是"节点是合法卡片，为让规则能安全转 strict 需主动标注"。
- 实际核查：`check-surface-tokens.cjs` 的规则 B 是「同文件出现 **>1** 处**未豁免**的卡片表面才报」，且豁免行在计数**之前**就被排除（脚本 224 行 `continue` 早于 227 行 `push`）。
- 决定：**不标注**。画布节点当前每个文件只有 1 处根表面，本来就不会被报。
- 理由：预先标注会产生反效果——若某个节点文件将来真的多出一层嵌套卡片，未豁免计数为 1，规则 B 反而**不会报**，正好把我们想抓的信号屏蔽掉。现有语义已经是对的：1 处表面 = 组件自己的根，合法；2 处以上 = 报出来交人判断。
- 同理不标注：`FloatingInputPanel`、`ImageMarkTool`（各只有 1 处表面）。
- 影响任务：2.5 的「豁免标注」一节作废；2.5 实际只剩日志面板两处表面改造。真正需要豁免标记的是 2.3 的三个全屏媒体查看器（规则 C 是按文件报，与计数无关）。

### D-007 长列表用 content-visibility 而非虚拟化

- 日期：2026-07-25（任务 3.1）
- 背景：历史上限 500 条、每条含图/视频，确实需要处理；`react-virtuoso` 也已是依赖。
- 实际核查：`TaskList` **自身不是滚动容器**，滚动发生在其父级（`GenerationWorkspace` 的 `listContainerRef`），而 `useBottomPanel` 会在底部面板展开/收起时动态改这个容器的 `paddingBottom`，并对 `scrollTop` 做补偿；另有 `useScrollBehavior`、`useAutoScrollOnResize`、以及依赖 `tasks.length` 的自动滚底 effect。Virtuoso 需要接管滚动，会与这四处逻辑直接冲突。
- 决定：改用 `content-visibility: auto` + `contain-intrinsic-size: auto 420px`。
- 理由：能拿到"跳过视口外元素布局与绘制"这个主要收益，同时元素留在 DOM 里——`data-generation-task-id` 定位、原生拖拽、右键菜单、Ctrl+F 全部照常，且完全不碰滚动逻辑。代价只是滚动条长度在首次滚过前是估算值。
- 影响任务：3.1 验收标准中"接入 Virtuoso"一条改为"接入 content-visibility"。若用户实测 500 条仍卡，再考虑用 Virtuoso 的 `customScrollParent` 模式重做。

### D-008 放弃 3.2 的 contain:layout 方案，且 3.1 已覆盖其主要成本

- 日期：2026-07-25（任务 3.2）
- 背景：3.2 原计划的首选手段是给工作区容器加 `contain: layout`，把 resize 时的重排限制在容器内。
- 实际核查：工作区子树内有 9 个文件使用 `position: fixed`（`FloatingInputPanel`、`NotificationToast`、画布的节点参数气泡/下载菜单/导出设置/来图选择器、`ModelPickerList`、资产库浮层与资产卡菜单）。`contain: layout` 会让容器成为这些元素的**包含块**，它们的视口定位会全部失效。
- 决定：**不采用** `contain: layout`。
- 补充结论：3.1 的 `content-visibility` 已经直接作用于 3.2 的根因——docked resize 每帧改 `paddingLeft/Right` 导致工作区重排，成本主要来自数百张任务卡；视口外卡片跳过布局后，这部分成本大幅下降。
- 剩余手段（resize 期间降级渲染、改 inset 实现方式）都涉及可见的视觉取舍或较高风险，按 3.2 任务文件"不允许无测量直接优化"的要求，**留待用户实测后再决定是否还需要**。
- 影响任务：3.2 状态为「已分析，待用户测量」，不是「已完成」。

### D-004 z-index 档位由实际需求反推，扩到 11 档

- 日期：2026-07-25（任务 1.2）
- 背景：原计划的 8 档（base/raised/sticky/dropdown/panel/modal/toast/drag）不足以表达真实层序：媒体查看器必须盖住弹窗、tooltip 必须盖住通知、无边框标题栏必须盖住一切。
- 决定：扩为 11 档，在 modal 之上补 `viewer` / `toast` / `tooltip` / `drag` / `titlebar`。
- 理由：档位数应服从真实层序需求，而不是为了"看起来精简"把现实压进去——后者会逼出下一轮 `z-[9999]`。
- 影响范围：`tailwind.config.js`、`src/core/theme/zLayers.ts`、skill、`CLAUDE.md`。

### D-005 局部 z 刻度不纳入全局层级契约

- 日期：2026-07-25（任务 1.2）
- 背景：画布内部（ReactFlow 节点、minimap `zIndex: 10000`、Alt 拖拽副本 `2000`）与部分组件内部（缩略图堆叠顺序、媒体行拖拽）使用与全局浮层不可比较的数值区间。
- 决定：明确区分两套体系。画布内部保留自己的局部刻度（魔数提为具名常量，如 `CANVAS_MINIMAP_Z_INDEX`），不套用全局档位；组件内部的小数值局部层叠不必登记。全局契约只管"整块浮层之间"的先后。
- 理由：ReactFlow 自己管理节点 z-index，强行统一会破坏画布内部层叠；而画布整体作为一个元素参与全局层级已经足够。
- 影响范围：1.2 验收标准中"`src/` 下 z-index 只出现语义类"一条按此理解——指全局浮层，不含局部层叠与负 z 的隐藏测量元素。

### D-009 选项集合静息态不描边，但要有判据

- 日期：2026-07-26（收尾任务）
- 背景：用户对着截图提出"鼠标没停留、也不是选中项时是不是不该有边框背景"。这是对项目早期一个有意设计的反问——当初把这些当"按钮"，所以逐项给了边框。
- 认定的根因：**边框表达的是"边界"，不是"可点击"**。一屏里几十个选项各自描边时，边框互相抵消、不再传递任何信息，只剩视觉重量；可点击性由 hover 反馈 + 排布规律已经表达充分。
- 决定：新增 `UiOptionButton` 的 `menu` 变体（静息无边框无底色，hover 出 `bg-layer`，选中态实底），并按下面的判据推广。**不改默认变体**——那会一次波及 30 个调用点，用户无从判断哪里变了。

#### 判据（两条都满足才用 `menu`）

1. **是同质选项的集合**：≥3 个由 `map` 渲染的并列 peer，或语义明确的二选一分段。孤立单个按钮不算。
2. **去掉框之后形状还在**，满足任一即可：
   - 已被可见容器圈住（浮层面板、弹窗左栏、下拉列表）——容器已经画过一次边界
   - 每项自带足以撑出形状的内容（缩略图、图标块、多行文本、比例示意图）
   - 是二维网格 → 补一层 `bg-veil-faint` 撑格子，**但仍不描边**

#### 刻意保留边框的 12 个调用点及理由

| 位置 | 理由 |
|---|---|
| `NumberInput` marks、`CompositeRadio`、`VoiceSelectorPanel` 筛选 chips、`CharacterPoseSection` 体型、`EasingCurveEditor` 缓动预设、`PlaybackControls` 秒/帧 | 纯文字 chip，直接落在面板底色上，去框后变裸文字，点击可供性丢失（不满足判据 2） |
| `ToolboxWorkspace` 工具卡、`CameraStageProjectList` 工程卡 | 是内容入口卡不是选项，走 Card |
| `CameraStageProjectList` 创建模式二选一、`ModelscopeCustomModelManager` 类型二选一 | 带长描述的大块二选一，框即命中区域 |
| `RadioInput` | 表单单选，框即命中区域 |
| `BasicInputComponents` 文件按钮、`AudioPreviewCard` 上传按钮 | 是动作按钮不是选项，`variant="flat"` 合适 |

#### 未改但效果已一致的三处

`UiDatePicker` 日期格、`NodeActionToolbar` 工具栏、`AssistantTraceList` 追踪行
用的是 `UiButton variant="ghost"` + 手写 `!border-transparent !bg-transparent`，
**视觉结果已经是正确的静息态**，只是没走变体。转成 `UiOptionButton` 会改变它们的选中态配色
（各自有定制），收益是 DRY 而非观感，风险大于收益，故保留并在此登记。

#### 顺带修掉的不一致

- 画布模型选择器与生成页模型选择器的选中态此前一个是 `bg-accent`、一个是 `bg-brand-600`，现统一走 `UI_OPTION_ITEM_ACTIVE_CLASS`
- 比例/分辨率一族 8 处手写的 `!bg-accent !border-accent !text-white` 一并收敛到同一令牌
- 已确认 `--brand-*` 全部由 `runtimeTheme.ts` 从 accent 派生，改强调色时会跟随，不存在 D-00x 里那类"设置不生效"的问题

#### 一个静默失效的坑（已在 skill 登记）

`menu` 变体的静息态**刻意不写 `bg-transparent`**：button 的透明背景由 preflight 保证，
写出来反而会和调用方补的 `bg-veil-faint` 在同一 CSS 属性上打架，
胜负取决于 Tailwind 产物顺序而非 className 顺序。已用生成的 CSS 复验：
`.bg-veil-faint`(3840) 在 `.bg-transparent`(3836) 之后、`.hover\:bg-layer:hover`(6736) 在两者之后且特异性更高，
去掉 `bg-transparent` 后行为确定。

### D-010 模型选择面板的配色与比例/分辨率面板对齐

- 日期：2026-07-26（收尾任务，用户看过 D-009 效果后提出）
- 用户反馈：比例/分辨率面板的格子边界"很不错"，但模型选择面板"颜色好像不一样"，且"筛选按钮的选中态和下面不一样"。
- 查证到**三层叠加**导致两个同级浮层长得不一样：

| 层 | 模型面板 | 比例/分辨率面板 |
|---|---|---|
| `PanelTrigger` 外壳 | `panelClassName` 覆盖成 `bg-surface-dark`（比默认亮一档） | 不传，用默认 `bg-panel` |
| 面板根 | 额外叠 `bg-zinc-900/40` | 无 |
| 筛选区 | 再叠 `bg-zinc-900/45` | 无 |

- 决定：把三层全部去掉，模型面板直接用默认外壳表面。`panelClassName` 里的 `border-border-dark` 与 `shadow-panel` 本来就在 `UI_PANEL_SURFACE_CLASS` 里，整个 prop 是冗余的。

#### 顺带发现：`UI_CHIP_ACTIVE_STRONG_CLASS` 从未生效

筛选 chip 的选中态之所以是"蓝框 + 灰底"而不是预期的实心蓝，是因为
`UiChipButton` 变体自带的 `bg-layer` 在 Tailwind 产物里排在 `bg-brand-600` **之后**
（`.bg-brand-600` 3614 行 / `.bg-layer` 3679 行），调用方传的 `UI_CHIP_ACTIVE_STRONG_CLASS`
永远输。这是 D-009 里记的那个坑的又一个实例，且这次它已经静默存在了很久。

- 决定：筛选 chip 改用 `UiOptionButton`（它们本来就是"筛选选项"而不是工具栏开关），
  静息保留描边（符合 D-009 判据：纯文字 chip 去框会变裸文字），
  选中态自然走 `UI_OPTION_ITEM_ACTIVE_CLASS`，与模型网格、比例/分辨率格子同一个蓝。
- `UI_CHIP_ACTIVE_STRONG_CLASS` 删除（0 消费者，且从未真正工作过），在原位留注释说明为什么不要再加回来。

#### 一并收敛的手写颜色

`ModelSelectorPanel` 的 zinc 硬编码从 13 处降到 3 处（剩下的是与比例面板一致的 `text-zinc-400` 标签）：
搜索框覆盖、清空按钮、分隔线、收藏星标全部改走令牌或 `appearance="hover-only"`。

### D-011 固定调色板全量收敛为语义色

- 日期：2026-07-26（收尾续，用户要求"其他地方也统一按这个风格"）
- 关键依据不是美观，是**正确性**：设置 → 界面 → 主题外观允许用户整体替换 9 个语义色。
  预设「石墨灰阶」把 `textMuted` 改成 `#D4D4D4`（亮灰）、`panel` 改成 `#262626`，
  但 292 处 `zinc-*` 硬编码原地不动 —— 切主题后必然和周围脱节。
  这与此前修掉的"节点选中描边不跟随强调色"是同一类缺陷，只是面更大。

#### 补了两档文字色

界面实际需要四档文字（标题/次要正文/说明/占位），但主题方案只暴露 `text` 与 `textMuted` 两档，
中间两档一直是 `text-zinc-300` / `text-zinc-500` 硬编码。

决定：**不扩大用户可见的主题设置**（那会牵动设置 UI、预设、导入导出、迁移），
改为在 `runtimeTheme.applyTextScale` 里从 `text`/`textMuted` 派生：

- `--text-soft-rgb` = mix(text → textMuted, 0.45)
- `--text-faint-rgb` = mix(textMuted → black, 0.30)

在三个预设下都验证过单调性（默认 214/114、石墨灰阶 236/148、深黑灰阶 189/80）。

#### 映射表

| 原 | 新 | 差值 |
|---|---|---|
| `bg-zinc-950/900/800/700/600` | `bg-app / panel / surface-dark / layer / layer` | 前四档几乎像素等价（如 zinc-800 `#27272a` vs surface `#262626`） |
| `text-zinc-100/200` → `300` → `400` → `500/600` | `text-text-dark / soft / muted / faint` | 400→muted 几乎等价 |
| `border-zinc-700/600` | `border-border-dark` | `#3f3f46` vs `#404040`，等价 |
| 叠在图片/视频上的 `border-zinc-500/*` | `border-veil-soft` / `border-veil` | veil 刻意与主题无关（媒体 chrome） |

292 处 → 0。另删掉 15 处 `dark:` 双分支（`index.html` 写死 `class="dark"` 且从不切换，基础值是死代码）。

#### 被这次清理暴露出来的存量问题

1. **表面检查此前被硬编码挡住**：`check:surface` 只认 `bg-panel/surface-dark/app/layer`，
   写成 `bg-zinc-800/30` 就绕过了。zinc 清零后当场报出 9 处存量违规（`TestModePanel` 6 处套卡片、
   `TaskInputPreview` 2 处、`DragDropContext` 1 处），已全部修掉。
2. **`StackedMediaUploader` 的拖拽高亮从来没亮过**：底色 `bg-zinc-900/30` 与高亮 `bg-zinc-800/55`
   抢同一属性，而 zinc-900 在产物里排在 zinc-800 之后，底色永远赢。已改为互斥三元。
   这是同属性叠类坑的第三个实例（前两个见 D-009、D-010）。
3. `src/components/MediaGenerator/components/ResolutionPanel.tsx` 零引用死文件，已删除。

#### 门禁

新增 ESLint `no-restricted-syntax` 两条（`Literal` + `TemplateElement`）拦截 `*-zinc-*`，
已用探针文件反向验证确实触发、且合规写法正确放行。
