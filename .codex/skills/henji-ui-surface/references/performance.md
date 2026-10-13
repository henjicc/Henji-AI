# 界面性能：状态分层

（`henji-ui-surface` 的参考文档。界面卡顿、拖动掉帧、长列表时读这份。）

## 性能：不要让界面整页重绘

界面卡顿（拖动窗口掉帧、进度条期间整页发涩）在本项目里几乎总是同一个原因：**高频瞬态状态写进了持有大列表的那个 state**。

**规则：高频/瞬态状态（进度、hover、拖拽坐标、播放位置）必须放独立 store，由最叶子的组件自订阅。**

反例（已修复，勿复制）：`useTaskState.updateProgress` 曾用 `setTasks(prev => prev.map(...))` 写进度 —— 每次进度回调重建整个 tasks 数组 → 工作区根组件重渲染 → 所有 `useMemo`（过滤/排序）重跑 → 与拖拽 `pointermove` 抢主线程 → 拖动掉帧。

正例（照这个写）：

```ts
// 1. 共享工厂；旧字段名的适配参考 canvasGenerationProgressStore.ts
type ProgressState = TransientProgressActions<number> & { values: ReadonlyMap<string, number> }
const progress = createTransientProgressStore<number, ProgressState>({
  initialState: actions => ({ ...actions, values: new Map() }),
  getEntry: (state, id) => state.values.get(id),
  entries: state => state.values,
  patch: values => ({ values }),
  normalize: value => Math.max(0, Math.min(1, value)),
  equals: (a, b) => Math.abs(a - b) < 0.001,
})

// 2. 生产者：用 getState() 写，不进 React state
progress.store.getState().set(id, value)

// 3. 消费者：叶子组件自订阅，只有自己这一条变化时才重渲染
const value = progress.useEntry(id)
```

配套检查项：
- store 的 `set` 里做**相等性短路**（Zustand 值没实质变化就返回原 `state`），避免无意义通知。返回 `{}` 会合并出新根对象，仍会通知订阅者。
- 任务结束/删除时**清理条目**，别让 store 无限增长。
- 瞬态状态**不进持久化、不进历史快照**。
- 列表项用 `React.memo`，比较函数只比真正需要的引用。

## 播放位置：只让显示时钟的叶子订阅

播放时钟统一用 `@/hooks/usePlaybackClock`。AudioNode 与 AudioPlayer 已接入：每个宿主持有独立 vanilla Zustand 时钟；唯一播放 rAF 委托共享调度器并只写时钟，波形叶子按播放位置订阅，时间读数按格式化秒值订阅。父组件、头部、端口和动作不订阅播放帧。暂停、离屏、换源、卸载取消 rAF，暂停 seek 也写同一时钟，来源恢复/归零沿用宿主正式媒体生命周期。

不要把时钟放进全画布或文档 store，不持久化、不入撤销栈。宿主受控播放使用其确认状态，不新建媒体元素或第二个解码器。

## 长列表：统一用 react-virtuoso

超过 50 项，或数据规模来自模型目录、账号、日志且可持续增长的通用列表，必须虚拟化。新接入统一用 `@/components/ui` 的 `UiVirtualList` / `UiVirtualGrid`（基于已安装的 react-virtuoso），不要另造窗口计算器。

- `UiVirtualList` 用 `data/getKey/renderItem`，自动测量可变行高；网格用 `UiVirtualGrid columns={2|3|4|5}`，卡片高度随描述、训练状态或动作变化时由正式 Virtuoso 按行测量。VoiceSelectorPanel 与 ModelSelectorPanel 已接入。
- 库的 `VirtuosoGrid` 只适合等尺寸项；共享网格不作此假设，不让首项高度代表不同高度的其他项。
- 容器提供有限高度和 `min-h-0`，只保留一个滚动所有者；用稳定实体键，搜索/筛选后回到新结果首屏；初始项数不得超过数据条数。
- 项内关联查询先建 `Map`，禁止在每项渲染里重复 `find` 扫描整个关联列表。
- 传 `highlightedIndex`，共享包装通过虚拟器的 `scrollIntoView` 显露目标；网格自动转换成行索引。不能依赖尚未挂载项的 DOM 查询；Enter 根据数据索引选择，已有挂载项可继续走正式点击入口。

`@tanstack/react-virtual` 只保留给需要手动测量、范围控制或滚动补偿的场景（例如时间线）。现存 `useVirtualTaskList.ts` 自定义 `rangeExtractor` 保留播放/焦点卡及相邻项，并手动测量滚动偏移、补偿视口上方尺寸变化，暂属此例外；普通目录列表不照抄它。

## 指针高频事件：按帧合并、结束时提交

`pointermove` / `mousemove` 只记最新样本，一个所有者窗口每帧最多执行一次预览；不要逐事件写全页面或文档 store。每次调度只允许一个待执行 rAF，执行前清空句柄；结束时提交最后样本，取消或卸载时丢弃待执行样本并取消 rAF。

拖拽按下时 `setPointerCapture`，结束/取消时释放，处理 `pointercancel`、`lostpointercapture` 与 Esc。弹出窗口使用元素 `ownerDocument.defaultView` 的 rAF/cancelAnimationFrame，申请与取消必须属于同一窗口。持续播放循环和单次事件合帧是不同生命周期，不机械替换。

调度唯一入口：React 生命周期用 `@/hooks/useRafCallback(callback, ownerWindow)`；effect 内的局部调度用 `@/utils/createRafScheduler(callback, ownerWindow)`。两者返回 `schedule(...最新参数)` / `flush()` / `cancel()` 和 `pending`。回调显式再次 schedule 才形成持续循环；不要把“延后一帧”机械替换成常驻循环。拖拽控件继续复用已有共享原语的手势，不另造第二份控件。

共享 keyed store 工厂为 `@/stores/createTransientProgressStore`，提供 set / clear / clearAll 和 useEntry；相等性、值规范化由领域指定。画布生成、生成任务、镜头渲染三个瞬态 store 已迁移，适配器只保留现有 Record/Map 字段与动作名。

真实样本在设计系统中心页“长列表”分区：1000 条可变行高列表、共享网格、合帧预览与叶子订阅。渲染计数/通知次数/挂载数量测试可证明通知范围，不用回调次数或样本预览冒充真实 Electron 滚动帧率。

## 性能：画布平移先测绘制边界

React Flow 画布在高节点量下卡顿时，先用真实内容连续单向扫掠的 `BENCH_MULT=4 npm run electron:pan-bench` 判断；不要用中心小幅往返的 `electron:canvas-stress` 下性能结论，后者会命中既有绘制瓦片。

- 禁止给画布视口或节点加 `will-change: transform`：非 1 倍缩放下会钉死光栅倍率，使文字发虚。
- 批量元素（列表行、逐字预览等）的静态类不得永久带 `will-change`；需要时只在动画进行中临时加上。
- 禁止给深层节点加 `content-visibility: auto`：本项目 124 节点实测降至 8.4fps。
- 当前采用 `CanvasNodePaintFrame` + 节点根 `contain: paint` / `overflow-clip-margin` 的两级绘制隔离。修改节点 DOM 或出框装饰后，运行 `npm run check:canvas-visual` 检查像素、实际可绘制溢出与 React Flow 几何；不得用 padding / margin 改变 `.react-flow__node` 的测量盒。
