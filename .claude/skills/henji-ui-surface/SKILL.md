---
name: henji-ui-surface
description: Henji-AI 新建或改造任何界面/面板/弹窗/侧栏/设置分区/节点 UI 时使用。给出表面层级（surface/elevation）铁律、UiPanel variant 选择、何时不该加边框背景、逐行参数与控件的排版规范、以及避免整页重绘的状态分层规则。触发场景：用户要求"做一个 XX 面板/页面/弹窗"、"这个界面不好看/太挤/像卡片套卡片"、"帮我美化一下这个界面"、"加一个设置分区"、"这个界面卡顿/拖动掉帧"。
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

ESLint 已硬拦所有 `*-zinc-*`。同一条规则也适用于 `gray-*`、`neutral-*` 等其他固定色板。

⚠️ 另外：`index.html` 写死 `class="dark"` 且从不切换，**`dark:` 变体的基础值是死代码**。
不要写 `text-zinc-600 dark:text-zinc-400` 这种双分支，直接写最终值。

## 毛玻璃只有一档，且只用在一种场景

> **模糊只用在「浮层压在内容不可预测的东西上」——图片、视频、画布。**
> 压在应用自身纯色 UI 上的浮层（通知、菜单、弹窗、任务卡）一律用不透明底色，
> 更清楚，也省掉一次读取背景纹理的合成开销。

档位只有一个：Tailwind 写 `backdrop-blur-ui`，纯 CSS 写 `backdrop-filter: blur(var(--ui-blur))`。
**ESLint 硬拦 Tailwind 自带的 `backdrop-blur-sm/md/lg/xl`。**

收敛之前这里散落 6 个不同数值、跨 Tailwind 与手写 CSS 两套系统，
同一个视觉意图有六种写法，谁也说不清什么时候该加。

统一到单一变量之后，「设置 → 界面 → 毛玻璃效果」关掉时只需把 `--ui-blur` 置 0，
所有地方一起生效，组件不需要各自适配——**开关是收口的副产品，不是收口的替代品**。
如果哪天要调整强度，也只改 `src/index.css` 里那一个值。

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
| `backdrop-blur-sm/md/lg/xl` | `backdrop-blur-ui`；且先确认这个浮层真的压在媒体/画布上 |
| `text-zinc-600 dark:text-zinc-400` 双分支 | 直接写最终值，`dark:` 的基础值是死代码 |
| 给已经带边框的控件外面再包一层框 | 去掉外层框 |
| 为"填充空白"添加卡片、边框、阴影 | 留白 / 调整间距 |
| 同一屏出现 3 层以上叠加边框 | 重新走上面的决策树 |
| 复制其他文件的 `border + bg` class 串当模板 | 先判断目标位置在第几层 |

## 排版细节（避免"挤"和"散"）

- **间距用 4 的倍数**：`gap-2 / gap-3 / gap-4`、`p-3 / p-4`；不要出现 `p-[13px]` 这类随手值。
- **同级元素间距统一**：一个分区内所有行用同一个 `space-y-*`，不要一行 `mt-2` 一行 `mt-3`。
- **控件高度统一**：字段类控件走 `UI_FIELD_CONTROL_HEIGHT_CLASS`（42px）；不要每处自定义高度。
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
- [ ] 有没有 `zinc-*` / `gray-*`？改强调色或换主题预设时它们不会跟着动
- [ ] 同一个 className 里有没有两个类抢同一个 CSS 属性？改成互斥三元
- [ ] 新面板有没有再叠一层自己的底色？表面应该由外壳统一提供
- [ ] 加了模糊吗？只有压在图片/视频/画布上才该加，且只能用 `backdrop-blur-ui`
- [ ] 空/加载/错误三态是否都走了 `UiEmpty/UiLoading/UiError`
- [ ] 字号是否全部来自登记档位（无 `text-[Npx]`）
- [ ] 圆角是否只用了 `rounded-lg/xl/full`，且内层不大于外层
- [ ] 阴影是否只出现在浮层
- [ ] z-index 是否用了语义 token
- [ ] 同级元素间距是否统一（不要一行 `mt-2` 一行 `mt-3`）
- [ ] 高频状态（进度/hover/拖拽）是否放在独立 store 而非大列表 state
- [ ] 列表超过 ~50 项是否考虑了虚拟化

## 完成前必跑

```bash
npm run check:surface && npm run check:colors && npm run lint
```

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
