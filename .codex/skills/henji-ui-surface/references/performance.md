# 界面性能：状态分层

（`henji-ui-surface` 的参考文档。界面卡顿、拖动掉帧、长列表时读这份。）

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
- store 的 `set` 里做**相等性短路**（Zustand 值没实质变化就返回原 `state`），避免无意义通知。返回 `{}` 会合并出新根对象，仍会通知订阅者。
- 任务结束/删除时**清理条目**，别让 store 无限增长。
- 瞬态状态**不进持久化、不进历史快照**。
- 列表项用 `React.memo`，比较函数只比真正需要的引用。

## 播放位置：只让显示时钟的叶子订阅

`AudioNode.tsx` 的局部正例：每个节点持有独立的 vanilla Zustand 时钟；唯一播放 rAF 只写时钟，`AudioPlaybackWaveform` 与 `AudioPlaybackReadout` 用 `useStore` 选择播放位置。节点头部、端口和动作不订阅时钟。暂停、换源、卸载取消 rAF，暂停 seek 也写同一时钟，换源归零。

不要把时钟放进全画布或文档 store，不持久化、不入撤销栈。通用播放器的时钟抽取尚未完成，不把它作为已经满足叶子订阅的例子。

## 长列表：统一用 react-virtuoso

超过 50 项，或数据规模来自模型目录、账号、日志且可持续增长的通用列表，必须虚拟化。使用已安装的 `react-virtuoso`，不要另造窗口计算器。

- `Virtuoso` 自动测量可变行高；二维卡片高度随描述、训练状态或动作变化时，先按列数分行，再虚拟化行。`VoiceSelectorPanel.tsx` 是此场景的局部正例。
- `VirtuosoGrid` 用于等尺寸项；不能让首项高度代表不同高度的其他项。
- 容器提供有限高度和 `min-h-0`，只保留一个滚动所有者；用稳定实体键，搜索/筛选后回到新结果首屏；初始项数不得超过数据条数。
- 项内关联查询先建 `Map`，禁止在每项渲染里重复 `find` 扫描整个关联列表。
- 键盘高亮改变时通过虚拟器的 `scrollIntoView` 显露目标；不能依赖尚未挂载项的 DOM 查询。

`@tanstack/react-virtual` 只保留给需要手动测量、范围控制或滚动补偿的场景（例如时间线）。现存 `useVirtualTaskList.ts` 自定义 `rangeExtractor` 保留播放/焦点卡及相邻项，并手动测量滚动偏移、补偿视口上方尺寸变化，暂属此例外；普通目录列表不照抄它。共享 `UiVirtualList` / `UiVirtualGrid` 尚未落地，不引用不存在的入口。

## 指针高频事件：按帧合并、结束时提交

`pointermove` / `mousemove` 只记最新样本，一个所有者窗口每帧最多执行一次预览；不要逐事件写全页面或文档 store。每次调度只允许一个待执行 rAF，执行前清空句柄；结束时提交最后样本，取消或卸载时丢弃待执行样本并取消 rAF。

拖拽按下时 `setPointerCapture`，结束/取消时释放，处理 `pointercancel`、`lostpointercapture` 与 Esc。弹出窗口使用元素 `ownerDocument.defaultView` 的 rAF/cancelAnimationFrame，申请与取消必须属于同一窗口。持续播放循环和单次事件合帧是不同生命周期，不机械替换。

共享 `useRafCallback` / `createRafScheduler`、`usePointerDrag` 和瞬态 keyed store 工厂尚未落地；新增前先完成共享入口与调用方迁移、卸载/取消/同值写入/按键订阅测试，再登记复用表。禁止仅改文档就声称已经有唯一实现。

## 性能：画布平移先测绘制边界

React Flow 画布在高节点量下卡顿时，先用真实内容连续单向扫掠的 `BENCH_MULT=4 npm run electron:pan-bench` 判断；不要用中心小幅往返的 `electron:canvas-stress` 下性能结论，后者会命中既有绘制瓦片。

- 禁止给画布视口或节点加 `will-change: transform`：非 1 倍缩放下会钉死光栅倍率，使文字发虚。
- 禁止给深层节点加 `content-visibility: auto`：本项目 124 节点实测降至 8.4fps。
- 当前采用 `CanvasNodePaintFrame` + 节点根 `contain: paint` / `overflow-clip-margin` 的两级绘制隔离。修改节点 DOM 或出框装饰后，运行 `npm run check:canvas-visual` 检查像素、实际可绘制溢出与 React Flow 几何；不得用 padding / margin 改变 `.react-flow__node` 的测量盒。
