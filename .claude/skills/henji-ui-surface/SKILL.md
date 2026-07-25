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

## 本项目的四层表面模型

写任何界面前，先确定"我在第几层"，然后只用那一层允许的东西：

| 层 | 名称 | 用什么 | 能否画边框/背景 |
|---|---|---|---|
| L0 | 应用底板 | `bg-app` | 只有底色，无边框 |
| L1 | 浮层/面板/弹窗/侧栏 | `<UiPanel>`（默认 variant） | ✅ **唯一允许画完整卡片的一层**（border + bg + shadow） |
| L2 | 面板内分区 | `<UiPanel variant="inset">` 或 `variant="bare"` | ❌ 不画边框、不画阴影；`inset` 只用更暗底色，`bare` 只靠留白 |
| L3 | 控件/字段 | `UiInput` / `UiButton` / `UiOptionButton` 等 primitives | ✅ 控件自己的边框是合理的（这是可点击/可输入的语义），但**容器不要再给它套框** |

`UiPanel` 的三个 variant（`src/components/ui/primitives.tsx`）：

```tsx
<UiPanel>                      {/* L1：完整浮层表面 = border + bg-panel + shadow-2xl */}
<UiPanel variant="inset">      {/* L2：内嵌分区 = 仅 bg-app/40，无边框无阴影 */}
<UiPanel variant="bare">       {/* L2：纯分组 = 只有圆角，靠留白区分 */}
```

## 决策树：这个容器要不要边框背景？

```
我正在写的这个 div，它的父级链上已经有 border 或 表面 bg 了吗？
├─ 没有（我就是最外层浮层/弹窗/侧栏）
│    → <UiPanel>，完事。不要手写 border + bg-panel + rounded。
│
└─ 有（我在某个 panel 内部）
     ├─ 需要让这块区域"看起来沉下去"（如代码块、只读预览、日志块）
     │    → <UiPanel variant="inset">
     ├─ 只是想把几个字段归成一组
     │    → <UiPanel variant="bare"> 或直接 `space-y-*` / `<div className="space-y-3">`
     ├─ 需要明确的分隔感
     │    → 用分隔线：`border-t border-border-dark/60 pt-3`（只有一条线，不是一个框）
     └─ 想不出理由，只是"看着空"
          → 什么都不加。留白就是设计。
```

**"想不出理由就不加"** 是本规范最重要的执行细节 —— 绝大多数丑陋的套娃，都来自"这里看着空，加个卡片吧"。

## 硬性禁止清单

| 禁止 | 正确做法 |
|---|---|
| 业务组件手写 `rounded-xl border border-border-dark bg-panel` | `<UiPanel>` |
| 在 `UiPanel` 内部再放一个 `border + bg` 的 div | `variant="inset"` / `"bare"` / 纯留白 |
| 用 `UiIconButton` 默认态（自带边框）做工具栏密集图标 | `showBorder={false}` 或 `appearance="hover-only"` |
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

## 完成前必跑

```bash
npm run check:surface
npm run check:colors
npm run lint
```

`check:surface` 默认只告警不阻断（存量渐进治理）。**要求：不得新增违规**。改完后跑一次，确认输出里没有你新写的文件。确实需要独立卡片表面的例外（如画布节点外壳），在该行上方加注释 `ui-surface-allow` 豁免，并写明理由。

想卡死新增违规时用 `npm run check:surface:strict`（违规 exit 1）。

## 相关规范

- 组件复用与原生标签落点、颜色令牌三处入口：见 [CLAUDE.md](../../../CLAUDE.md) 的「UI Primitive 单点落地」与「关键约束」
- 画布节点的行组件拼装：见 skill `canvas-node-builder`
- 提示词编辑器、文件上传控件：必须复用 `PromptEditor` / `FileUploader`，不要重写
