# 日志调试中心 - 交接说明（写给下一个执行者）

## 3.1 → 3.2 交接

### 已交付

- `scripts/query-logs.cjs` 是唯一的 AI/命令行日志查询入口，`npm run logs:query -- --help` 提供完整参数说明。默认路径是 `%LOCALAPPDATA%\com.henji.ai\Henji-AI\logs\henji-YYYY-MM-DD.log`，可用 `--dir` 覆盖。
- 查询示例：`npm run logs:query -- --chain <requestId>` 取完整 LLM 请求/响应链路；需要机器消费时加 `--json`。普通筛选可组合 `--date`、`--domain`、`--level`、`--event`、`--grep`、`--source`、`--tail`。
- `CLAUDE.md` 的“日志系统”小节是新 AI 会话的固定发现入口，已明确调试优先查日志文件而非要求用户粘贴控制台。

### 3.2 注意事项

- 日志接入规范应引用上述脚本和 JSONL schema，不新增 MCP server、额外数据库或第二条读取通道（重要记录 003）。
- 新日志字段/事件继续遵守 `MainLogEvent` schema 与敏感信息脱敏约束；如调整落盘路径或文件名，必须同步更新 writer、脚本与 `CLAUDE.md`。
- 本阶段未改 Electron 主进程/渲染代码；无需重启。真实 LLM 链路和冷启动 AI 验证仍由用户执行，步骤见 `test-report.md`。

面向任务：3.1 日志查询脚本与AI访问约定（第二阶段-日志窗口 2.1/2.2/2.3 均已完成，第二阶段全部交付）

## 2.3 留下了什么（3.1 最需要看这部分）

### 主控复核后的分页与容错语义（3.1 不应误改）

- `LogQueryParams` 除 `beforeTimestamp` 外新增 `beforeLine?: number`，`LogQueryResult` 新增 `nextBeforeLine?: number`。日志窗口的连续翻页使用行号游标：下一页只读取当前页最旧事件所在行之前的数据，避免同一毫秒多条事件共用 timestamp 时发生漏项；`beforeTimestamp` 保留为独立的 ISO 时间边界过滤。
- `beforeLine` 只能用于同一日期、同一过滤条件下的连续查询；IPC 仅接受非负整数，`limit` 仅接受有限 number。3.1 独立脚本若要实现分页，应保持“不重不漏”的稳定游标语义，不必复制 GUI 的行号字段。
- `queryLogEvents` 会把 JSON 语法错误、以及可解析但不符合 `MainLogEvent` 必填字段/枚举约束的行一并计入 `corruptedLines` 后跳过；其余合法行继续返回，不允许一条异常数据中断整天查询。

### `query.ts` 的位置与两个导出函数

- 位置：`electron/main/services/logging/query.ts`（233 行），经 `electron/main/services/logging/index.ts` 统一导出。
- `listLogDates(): Promise<string[]>`：扫描 `getLogDir()`（`writer.ts` 导出，`%LOCALAPPDATA%\com.henji.ai\Henji-AI\logs\`），用正则 `^henji-(\d{4}-\d{2}-\d{2})\.log$` 识别日志文件，提取日期部分，**按日期字符串降序**（`b.localeCompare(a)`，最新的在前）返回。目录不存在时返回空数组（不抛错）。
- `queryLogEvents(params: LogQueryParams): Promise<LogQueryResult>`：按日期流式查询，**3.1 的 Node 查询脚本如果要复用同一套"读文件过滤语义"，应该按下面的字段含义与规则对齐**（不需要复用这份 TS 代码本身——3.1 大概率是独立的 Node 脚本，跑在项目脚本环境而非 Electron 主进程里，但过滤逻辑的行为应该和这里保持一致，否则用户会遇到"日志窗口历史模式查到的结果"和"AI 用查询脚本查到的结果"对不上的困惑）。

### `LogQueryParams` 字段形状与过滤规则（3.1 对齐的核心）

```ts
export interface LogQueryParams {
  date: string              // 必填，格式 YYYY-MM-DD，对应 henji-YYYY-MM-DD.log 文件；格式不对直接抛错
  level?: MainLogLevel      // 精确匹配，'trace' | 'debug' | 'info' | 'warn' | 'error'；不传 = 不过滤
  source?: MainLogSource    // 精确匹配，'frontend' | 'backend'；不传 = 不过滤
  domainPrefix?: string     // 前缀匹配：event.domain.startsWith(domainPrefix)；传完整 domain 字符串等价于精确匹配
  requestId?: string        // 精确匹配（区分大小写，requestId 本身是 UUID 一类的标识符，不需要模糊）
  keyword?: string          // 大小写不敏感的子串匹配，见下方"关键词匹配字段清单"
  beforeTimestamp?: string  // 分页游标：只保留 event.timestamp < beforeTimestamp 的事件（字符串比较，依赖 ISO 8601 timestamp 天然可比）
  limit?: number            // 单页最大返回条数，默认 200，上限 2000（Math.min(Math.max(limit, 1), 2000)，越界值会被夹紧而不是报错）
}
```

**关键词匹配字段清单**（`matchesKeyword` 内部逻辑，`query.ts` 与前端 `eventDisplay.ts` 的 `matchesKeyword` 各自独立实现但字段清单完全一致，3.1 若要在脚本里做等价的关键词过滤应该覆盖同一组字段）：`domain`、`event`、`message`、`requestId`、`taskId`、`modelId`、`providerId`、`context`（非字符串值先 `JSON.stringify` 再参与匹配，`JSON.stringify` 失败时该字段视为空字符串参与匹配，不中断整体匹配）、`error`（同上）。全部转小写后判断 `keyword.toLowerCase()` 是否是某个字段的子串，命中任意一个字段即算匹配。

### `LogQueryResult` 字段形状

```ts
export interface LogQueryResult {
  events: MainLogEvent[]   // 命中事件，按 timestamp 降序排列（最新在前）
  hasMore: boolean          // true 表示还有更早的匹配事件未返回（用于"加载更早"分页判断）
  corruptedLines: number    // 本次查询中 JSON.parse 失败被跳过的行数
}
```

### 分页语义：游标（`beforeTimestamp`）+ 滚动缓冲区，不是数值 `offset`

- `query.ts` 单次流式遍历目标文件（不整文件进内存），对每一行：`JSON.parse` 失败则 `corruptedLines++` 并跳过（继续下一行，不中断查询）；解析成功后应用 `matchesFilters`（level/source/domainPrefix/requestId/beforeTimestamp/keyword 全部满足才算命中）；命中后 push 进一个大小为 `limit` 的数组，超出 `limit` 时 `shift()` 掉最旧的一条（数组元素随文件读取顺序天然按时间升序排列，`shift()` 淘汰的正是当前已见范围内最旧的一条）。
- 遍历结束后，这个数组就是"`beforeTimestamp` 之前最近 `limit` 条匹配事件"（升序），反转一次得到降序输出；`hasMore = totalMatched > limit`（`totalMatched` 是一个独立计数器，每次命中过滤条件就 +1，不受滚动缓冲区淘汰影响）。
- "加载更早"翻页：调用方把上一页最后一条（最旧一条）事件的 `timestamp` 作为下一次查询的 `beforeTimestamp` 传入。
- **3.1 若要写一个独立 Node 脚本做等价查询，不强制照抄这个"滚动缓冲区"实现**（比如脚本场景下如果读入内存开销可接受，完全可以用更简单的"读全部匹配行再 slice"），但如果 3.1 也想支持分页/条数限制，语义上应该保持"游标 + 最近 N 条"这个心智模型一致，避免用户在 GUI 历史模式和脚本两条路径之间来回切换时对"分页"的理解产生偏差。

### `listLogDates`/`queryLogEvents` 对应的 IPC 通道与渲染层调用方式（3.1 大概率不需要，仅供参考）

- IPC：`logging:listDates`（无入参）、`logging:query`（入参 `LogQueryParams`，主进程侧在 `electron/main/ipc/logging.ts` 的 `parseLogQueryPayload` 做了完整的运行时类型校验，非法 `date` 格式/非法 `level`/`source` 枚举值会直接被拒绝抛错，不会静默吞掉）。
- 渲染层封装：`src/commands/logging.ts` 的 `listLogDates()`/`queryLogEvents(params)`，桌面运行时之外静默返回空结果（不抛错）。
- 3.1 的查询脚本预期是独立 Node 脚本（不经过 Electron IPC，直接用 Node `fs`/`readline` 读取日志目录），这条 IPC 链路只是"GUI 历史模式怎么复用同一个 `query.ts`"的实现细节，不是 3.1 需要复用的部分——3.1 应该关注的是上面"`LogQueryParams` 字段形状与过滤规则"这一节的**语义**，而不是这条 IPC 通道本身。

### 日志文件路径与命名规则（3.1 脚本需要自己定位文件，规则与 `writer.ts`/`query.ts` 完全一致）

- 目录：`getLogDir()`（`writer.ts`）= Windows 下 `%LOCALAPPDATA%\com.henji.ai\Henji-AI\logs\`（其他平台走 `app.getPath('appData')`，但项目当前主要面向 Windows）。
- 文件名：`henji-YYYY-MM-DD.log`（`MAIN_LOG_FILE_PREFIX = 'henji-'`，`types.ts` 导出，`writer.ts`/`retention.ts`/`query.ts` 三处共用同一个常量，3.1 的独立脚本无法直接 import 这个 TS 常量，需要在脚本里硬编码同样的前缀字符串 `'henji-'` 和后缀 `.log`，或者从 `electron/main/services/logging/types.ts` 源文件读取——如果 3.1 决定脚本运行在纯 Node 环境不经过 TS 编译，建议在脚本注释里注明"前缀/后缀规则需要与 `types.ts` 的 `MAIN_LOG_FILE_PREFIX` 保持同步"，避免未来改文件命名规则时脚本悄悄失效）。
- 每行一个 JSON（`MainLogEvent` 结构：`timestamp`/`level`/`domain`/`event`/`message`/`requestId?`/`taskId?`/`modelId?`/`providerId?`/`context?`/`error?`/`source`/`truncatedByLimit?`），无缩进无包裹（JSONL 标准格式，`writer.ts` 用 `JSON.stringify(event)` 逐行拼接 `\n` 分隔）。

### 敏感字段脱敏已在写入时完成，3.1 脚本不需要重复处理

- `sanitize.ts` 的 `isSensitiveKey`/`sanitizeJsonValue` 在事件**写入文件之前**已经执行过（`push.ts` 的 `appendLogEvents` 调用链路），日志文件里的 `api_key`/`authorization`/`token`/`secret`/`password` 等字段已经是 `'***'`，3.1 的查询脚本直接读文件拿到的就是已脱敏的内容，不需要在脚本层再做一遍脱敏。

## 2.2 留下了什么（2.3 最需要看这部分）

### 文件结构增量（在 2.1 基础上新增/修改）

```
src/features/logs/
├── copyFormats.ts                      新增：事件/链路 → Markdown/JSON 格式化 + 剪贴板写入
├── logStore.ts                          新增导出 selectEventsByRequestId(events, requestId)
├── LogsPanel.tsx                        新增 errorOnly/chainRequestId 状态，接线 RequestChainView
└── components/
    ├── JsonTree.tsx                    新增：轻量 JSON 折叠树（自实现，无第三方依赖）
    ├── RequestChainView.tsx            新增：请求链路时间线（UiModal 承载）
    ├── LogEventDetail.tsx              修改：JSON 展示换成 JsonTree + 复制按钮 + 查看链路入口
    └── LogFilterToolbar.tsx            修改：新增"只看错误"开关 + requestId 链路查询输入框
```

### `copyFormats.ts` 的函数签名（2.3 如果要做"历史日志"的复制/导出，可直接复用）

```ts
export function eventToMarkdown(event: DisplayLogEvent): string
export function eventToJson(event: DisplayLogEvent): string
export function chainToMarkdown(events: DisplayLogEvent[]): string   // 内部会按 timestamp 升序排序，调用方不需要预先排序
export function chainToJson(events: DisplayLogEvent[]): string        // 同上
export async function copyTextToClipboard(text: string): Promise<void>  // navigator.clipboard.writeText 封装
```

这四个格式化函数只依赖 `DisplayLogEvent`（`eventDisplay.ts` 的类型），不关心事件来自实时推送还是历史文件读取——**2.3 如果历史日志读回来的数据也能整形成 `DisplayLogEvent` 形状，这几个函数可以直接复用，不需要为历史日志再写一套复制/导出逻辑**。

### `JsonTree.tsx` 的 Props（2.3 如果历史日志详情面板要展示 JSON，直接复用这个组件，不要重新实现）

```ts
interface JsonTreeProps {
  value: DynamicValue        // 任意 JSON 兼容值，通常传整个 event 对象
  label?: string              // 根节点标签，省略则不显示
  defaultExpandDepth?: number // 默认展开的层级深度，默认 1
}
```

无状态依赖外部 store，纯展示组件，接受任意 `DynamicValue`。历史日志详情面板（如果 2.3 要做）直接 `<JsonTree value={historyEvent} />` 即可。

### `selectEventsByRequestId` 的签名与 2.1 handoff 建议不同（执行时调整，决策见 `decisions.md`）

```ts
export function selectEventsByRequestId(events: DisplayLogEvent[], requestId: string): DisplayLogEvent[]
```

接收调用方已持有的 `events` 数组（不是内部读取 `logWindowStore.getSnapshot()`），这样 `LogsPanel.tsx` 能用 `useMemo` 包一层让链路视图随新事件到达自动刷新。**这个选择器目前只对内存缓冲里的事件生效**（`useLogWindowStore()` 拿到的 `events`，上限 5000 条，应用/窗口重启后清空）——如果 2.3 做历史日志回读后想要"链路查询覆盖历史文件里的事件"，这个函数需要扩展或旁边加一个新的历史版本，当前实现没有考虑跨会话/跨文件的场景。

### `RequestChainView.tsx` 的 Props（2.3 大概率不需要直接复用，但如果要做"历史日志的链路视图"可参考同款结构）

```ts
interface RequestChainViewProps {
  isOpen: boolean
  onClose: () => void
  requestId: string
  events: DisplayLogEvent[]  // 调用方必须已经按时间升序排好序（selectEventsByRequestId 的输出）
}
```

用 `UiModal` 承载（`src/components/ui/primitives.tsx` 现成组件），不是常驻布局的一部分。如果 2.3 要在历史日志页面也提供"查看完整链路"，可以直接复用这个组件（只要喂给它符合 `DisplayLogEvent` 形状、已排序的事件数组即可）。

### 剪贴板能力的最终落点：`navigator.clipboard.writeText`，preload 未新增方法

`electron/preload/api.d.ts` 的 `HenjiClipboardApi` **仍然**只有 `readClipboardFiles`/`readText`/`writeImageFromPath`/`writeImageFromSource`，2.2 没有新增 `writeText` 方法。复制到剪贴板的能力封装在 `src/features/logs/copyFormats.ts` 的 `copyTextToClipboard(text)`，直接调用 `navigator.clipboard.writeText(text)`。**如果 2.3 或其他后续任务也需要"复制文本到剪贴板"的能力，直接复用这个函数（`import { copyTextToClipboard } from '@/features/logs/copyFormats'`），不要在别处重新写一遍 `navigator.clipboard.writeText` 调用**——除非 2.3 的场景不在 `src/features/logs/` 目录下，那种情况下再考虑是否要把这个函数挪到更通用的位置（比如 `src/utils/`），或者按 CLAUDE.md 约定给 `HenjiClipboardApi` 补一个正式的 `writeText` PAL 方法。

### 错误可见性与"只看错误"开关现状

`LogsPanel.tsx` 的 `errorOnly` 是一个独立于 `levelFilter` 的布尔状态（不是把 `levelFilter` 强制设为 `'error'`），两者在 `filteredEvents` 的 `useMemo` 里是"与"关系（`.filter((event) => !errorOnly || event.level === 'error')` 追加在 `levelFilter` 过滤之后）。如果 2.3 的历史日志页面也想要"只看错误"，可以复用同样的独立布尔 + 追加 filter 的模式，不需要和 `levelFilter` 耦合。

### JSON 折叠树没有做的事（如果 2.3 需要，自行判断是否要扩展）

- 没有"全部展开/全部折叠"的一键按钮，只能逐层点击。
- 没有搜索/高亮匹配字段的能力。
- 长字符串阈值（200 字符）和默认展开深度（1 层）是写死的常量（`JsonTree.tsx` 顶部 `LONG_STRING_THRESHOLD`/`DEFAULT_EXPAND_DEPTH`），没有做成可配置 prop（`defaultExpandDepth` 是唯一暴露的可选 prop）。
- 这些都是"够用但不完整"的取舍，2.2 任务范围内没有要求这些能力，如果后续任务或用户反馈需要，再单独扩展。

## 2.1 留下了什么

### 文件结构

```
src/features/logs/
├── LogsShell.tsx              窗口壳：自定义标题栏 + useApplyRuntimeTheme() + 渲染 LogsPanel
├── LogsPanel.tsx               页面编排：过滤状态 + useLogWindowStore + 列表/详情两栏布局
├── logStore.ts                 数据源：订阅 henji://log-event，容量上限 5000，暂停/恢复/清空
├── eventDisplay.ts              事件美化字典 + DisplayLogEvent 类型 + 工具函数
└── components/
    ├── LogFilterToolbar.tsx    来源/级别/domain/关键词过滤 + 暂停恢复 + 清空 + 完整捕获开关
    ├── LogEventList.tsx        列表，增量渲染（初始 200 条 + 加载更早）
    ├── LogEventRow.tsx         单条日志行
    └── LogEventDetail.tsx      详情面板（简单 JSON 展示，无折叠）
```

主进程新增 `electron/main/windows/log-window.ts`（单例窗口管理，`openLogWindow()`/`closeLogWindow()`），IPC 新增 `logging:openWindow`/`logging:getCaptureConfig`（`electron/main/ipc/logging.ts`）。渲染层入口分流在 `src/main.tsx`（`?view=logs` 查询参数），快捷键 `Ctrl+Shift+L` 在 `src/hooks/useLogWindowShortcut.ts`（挂载于 `src/App.tsx`，只在主窗口生效）。

### `DisplayLogEvent` 数据形状（2.2 直接复用，不要重新定义）

`src/features/logs/eventDisplay.ts` 导出：

```ts
export interface DisplayLogEvent extends LogEventPushDto {
  id: string  // logStore.ts 挂载时补的渲染层本地 id，仅用于 React key/选中态，不是稳定 ID
}
```

`LogEventPushDto`（`src/platform/contracts/logging.ts`，经 `src/commands/logging.ts` 重导出）字段：`timestamp`/`level`/`domain`/`event`/`message`/`requestId?`/`taskId?`/`modelId?`/`providerId?`/`context?`/`error?`/`source: 'frontend' | 'backend'`/`truncatedByLimit?: boolean`。这是主进程 `MainLogEvent`（`electron/main/services/logging/types.ts`）的渲染层镜像，本任务已经把 `truncatedByLimit` 字段补齐到 preload/platform/commands 三层（此前只存在于主进程类型里，是个遗漏，2.1 一并修复）。

### 数据源：`logStore.ts` 现状，2.2 大概率要扩展

- `logWindowStore`（`LogWindowStore` 类单例）内部维护 `events: DisplayLogEvent[]`（有上限 5000，超出从最旧开始丢弃）、暂停时的 `pausedBuffer`。**没有任何按 `requestId` 分组/索引的能力**——2.2 任务文件实施步骤第 3 条要求"建链路聚合逻辑（`logStore` 中按 requestId 选择器）"，这是全新工作，需要在 `logStore.ts` 里新增一个选择器函数（例如 `selectEventsByRequestId(requestId: string): DisplayLogEvent[]`，遍历 `logWindowStore.getSnapshot()` 按 `requestId` 过滤 + 按 `timestamp` 排序），不需要改变现有存储结构（`events` 数组本身已经包含 `requestId` 字段，直接过滤即可，不需要额外建索引 Map——除非 2.2 实测发现性能问题，届时再优化）。
- `useLogWindowStore()` hook 返回 `{ events, paused, pausedCount, setPaused, clear }`，2.2 如果要加"链路聚合"大概率需要新增一个 `useRequestChain(requestId: string)` 之类的独立 hook 或者在 `LogsPanel.tsx` 里用 `useMemo` 从现有 `events` 派生（不需要改动 `logWindowStore` 类本身的订阅机制）。

### 过滤器状态怎么管理

全部过滤状态在 `LogsPanel.tsx` 用 `useState` 管理（`sourceFilter`/`levelFilter`/`domainFilter`/`keyword`），**没有用 Zustand/Context**——一个简单页面级 `useState` 管理即可，没有必要为过滤状态单独建 store。`filteredEvents` 用 `useMemo` 派生（依赖 `events`/四个过滤条件），已经按时间倒序（最新在前）。2.2 加"只看错误"开关（任务文件实施方案第 3 条）可以直接在 `LogsPanel.tsx` 加一个 `errorOnly` 布尔 `useState`，在 `filteredEvents` 的 `useMemo` 里追加一个 `.filter((event) => !errorOnly || event.level === 'error')`，对应 UI 加在 `LogFilterToolbar.tsx`（作为 props 传入，同款模式）。

### 日志行组件在哪、点击后现状

`components/LogEventRow.tsx` 是单条日志行（`UiButton` 包裹），点击调用 `onSelect(event.id)` 只是把 `selectedId` 传给 `LogsPanel.tsx`，由 `LogEventDetail.tsx` 展示。**没有独立的"打开详情面板"交互**——现在的"详情"就是右侧固定的一栏，始终跟随 `selectedId` 变化。2.2 任务文件说的"点击日志行在页面侧栏（或行内展开区）展示完整事件"这个能力**已经存在**（右侧栏），2.2 主要是给这个详情面板换成折叠 JSON 树（`JsonTree.tsx`）+ 加"查看完整链路"入口按钮，不需要重新设计交互骨架。

### `requestId` 目前有没有被用来做任何分组

**没有**。当前列表是纯时间线（倒序平铺），`requestId` 只作为普通字段展示在 `LogEventRow.tsx`（`compactId(event.requestId)`）和详情面板里，完全没有做任何聚合/分组/关联展示。2.2 的链路视图是全新能力，从零开始建。

### JSON 展示现状（2.2 要替换的部分）

`LogEventDetail.tsx` 目前用 `<pre>{JSON.stringify(event, null, 2)}</pre>` 展示整个事件对象，`truncatedByLimit` 命中时额外插入一条黄色提示条（复用 `t('logsWindow.detail.truncatedNotice', { bytes })`）。2.2 建 `JsonTree.tsx` 时，这条 `truncatedByLimit` 特殊展示逻辑建议保留（不要在做 JSON 折叠树重构时不小心把这个分支删掉），可以把它作为 `JsonTree` 渲染之前的一个前置提示条独立保留，或者把 `truncatedByLimit` 判断逻辑一起下沉到 `JsonTree` 内部（自行判断，两种做法都合理）。

### i18n 命名空间

新增了顶层 `logsWindow` 命名空间（`src/i18n/locales/{zh-CN,en-US}/ui.json`），已有 `logsWindow.toolbar.*`/`logsWindow.list.*`/`logsWindow.detail.*` 三个子命名空间。2.2 新增文案（JSON 折叠树、链路视图、复制按钮、"只看错误"开关）建议延续这个命名空间，加 `logsWindow.detail.jsonTree.*`/`logsWindow.chain.*`/`logsWindow.copy.*` 之类的新子节点，不要另起新的顶层命名空间。

### 复制能力去哪找

`electron/preload/api.d.ts` 的 `HenjiClipboardApi`（`src/platform` 下对应 `clipboard` 域）目前只有 `readClipboardFiles`/`readText`/`writeImageFromPath`/`writeImageFromSource`，**没有"写文本到剪贴板"的方法**。2.2 任务文件已经提示"渲染层也可用 `navigator.clipboard` 兜底"——`navigator.clipboard.writeText()` 在 Electron 渲染进程里可以直接用（不需要走 preload），2.2 大概率会直接用这个而不是新增 IPC，但如果要更贴近项目"渲染层运行时代码统一经 PAL 访问桌面能力"的架构约束，也可以考虑给 `HenjiClipboardApi` 新增 `writeText`——这个取舍留给 2.2 执行时判断（如果 `navigator.clipboard.writeText` 在打包后的 Electron 环境实测有权限问题再切到 PAL 方案）。

## 1.3 留下了什么（2.2 可跳过，仅供背景参考）

### 捕获模式开关现在放在哪

- UI：`src/components/TestModePanel.tsx`"测试选项"标签页，"参数流转追踪"行下面新增了一行"日志完整捕获"（`UiCheckbox`），状态来自 `useSettingsStore((s) => s.logCaptureMode)`。
- **2.1 需要做的事**：任务文件 1.3 的实施方案第 5 条已经写明"2.1 日志窗口就绪后移到窗口工具栏"——把这个开关从 `TestModePanel.tsx` 搬到新的独立日志窗口工具栏，UI 交互（`UiCheckbox`/`UiButton` 均可）与状态读写方式（`useSettingsStore` 的 `logCaptureMode`/`setLogCaptureMode`）不需要改，只是换个挂载位置。等这个开关搬走后，`TestModePanel.tsx` 里对应的那一行连同 i18n key（`testMode.options.logCaptureMode.*`）应该跟着删掉，不要留一份重复 UI。

### 状态与同步链路（不用改，直接复用）

- 状态源：`src/stores/settingsStore.ts` 的 `logCaptureMode: 'standard' | 'full'`（默认 `'standard'`），**有意不持久化**——`persist` 配置加了自定义 `partialize` 显式排除这个字段，应用重启会回落 `standard`，不会因为用户忘记关闭而长期处于"完整捕获"状态。
- 同步链路（五层都已打通，2.1 不需要重新接）：`settingsStore.setLogCaptureMode(mode)` → `src/commands/logging.ts` 的 `setLogCaptureMode(mode)` → `src/platform/contracts/logging.ts`/`src/platform/adapters/electron/logging.ts` 的 `LoggingPlatform.setCaptureConfig` → preload `window.henjiNative.logging.setCaptureConfig(mode)` → IPC 通道 `logging:setCaptureConfig`（`electron/main/ipc/logging.ts`，payload `{ mode: 'standard' | 'full' }`，非法值直接拒绝不会崩主进程）→ 主进程 `electron/main/services/logging/capture-config.ts` 的 `setLogCaptureMode(mode)`，写入模块级内存变量。
- **只有 `setCaptureConfig`，没有 `getCaptureConfig`**：任务文件只要求一个 IPC 通道，所以主进程当前状态无法从渲染层反查。已知边界情况：如果渲染层在不重启应用的情况下发生"整页刷新"（不是 Vite HMR 的模块热替换，而是真正的 `location.reload()`/`Ctrl+R`），`settingsStore` 会重新初始化为默认值 `standard`，但主进程内存里的值可能还停留在用户上次设置的 `full`，两边会短暂不一致，直到用户再次手动切换开关。如果 2.1 要做得更严谨，可以考虑补一个 `logging:getCaptureConfig` IPC 让渲染层挂载时同步读取，但这不是 1.3 范围内做的事，只是留意这个已知边界。

### `sanitizeJsonValue` 新签名（其实没变签名，行为变了）

- 位置不变：`electron/main/services/logging/sanitize.ts`，经 `logging/index.ts` 统一导出。
- **签名没变**：仍然是 `sanitizeJsonValue(value: JsonValue, depth = 0): JsonValue`，调用方（`ai-runtime/trace.ts`、`ai-runtime/runtime.ts`、`llm/runtime.ts`）零改动。函数内部现在会调用 `getLogCaptureMode()`（来自同目录 `capture-config.ts`）读取当前捕获模式，按模式分档处理，不需要调用方传参。
- 行为分档（`standard` 是默认值，行为与 1.2 完全一致）：
  - 脱敏（`isSensitiveKey`，命中 `api_key`/`apikey`/`authorization`/`token`/`secret`/`password`）在**任何模式下都强制生效**，不受这次改动影响，这条依然是最高优先级、不可协商的约束。
  - `standard` 模式：长字符串（>1200+240 字符）、深度（>12 层）、base64/图片/音频/视频 data URI 全部按固定阈值截断，与 1.2 行为完全一致。
  - `full` 模式：跳过长字符串截断与深度截断；`data:image/*` 前缀的字符串原文完整保留；`data:audio/*`/`data:video/*`/其他无法识别的 `data:` 类型、以及不带 `data:` 前缀但形似 base64（≥512 字符）的长字符串，**两种模式下都强制走"头尾摘要 + 长度标注"**，不受 `full` 模式影响。

### 单条事件保险丝的行为

- 常量 `MAIN_LOG_EVENT_MAX_BYTES = 2 * 1024 * 1024`（2MB），定义在 `sanitize.ts`，经 `logging/index.ts` 导出。
- 函数 `applyEventSizeFuse(event: MainLogEvent): MainLogEvent`：对整条事件 `JSON.stringify` 后按字节数（`Buffer.byteLength(..., 'utf8')`）判断，超过 2MB 时把 `context` 替换成 `{ truncatedByLimit: true, originalBytes: N }`、把 `error` 清空，并在事件顶层加 `truncatedByLimit: true`，其余字段（`timestamp`/`level`/`domain`/`event`/`message`/`requestId` 等）保持不动。
- 调用点：`electron/main/services/logging/push.ts` 的 `appendLogEvents()`——这是前端桥接事件与主进程自身事件的唯一汇合点，`.map(applyEventSizeFuse)` 一次调用同时覆盖两条来源，写盘（`writeLogEventsToFile`）和推送渲染层（`pushLogEvents`）拿到的都是保险丝处理后的版本。
- **2.1 渲染日志窗口时要处理 `truncatedByLimit: true` 的展示**：这类事件的 `context` 字段不再是原始业务数据，而是 `{ truncatedByLimit: true, originalBytes: N }` 这种固定结构，UI 上应该给出明显提示（比如"该事件因体积超限已被截断，原始大小 N 字节"），不要按正常 `context` 的渲染逻辑去解析它。

### 1.3 没有动、2.1 可能要关心的事

- `src/utils/testMode.ts` 的 `recordApiTrace()`/`api.trace` 通道依然独立于统一开关之外（1.2、1.3 都做出了同样的决策：保持独立），2.1 如果要做"日志窗口只看统一事件流"，需要自己决定要不要展示这条 opt-in 通道的事件。
- 预览通道（`henji://runtime-request-preview` / `henji://llm-runtime-request-preview`）与 `logPreviewOnly()` 仍然保留（见下方 1.2 遗留说明），2.1 把 `UnifiedLogViewer`/`TestModePanel` 按计划删除后，这两条通道和 `logPreviewOnly` 的调用点才应该一起清理——1.3 同样没有动它们。

## 1.2 留下了什么

LLM 与 AI 生成两条主链路现在都由**主进程直接落盘**请求/响应/失败事件，不再依赖"渲染层转发再桥接"。

### 事件一览（都在 `henji-YYYY-MM-DD.log`，`source: 'backend'`）

| domain | event | 触发点 | 内容 |
|---|---|---|---|
| `llm-runtime` | `llm_runtime.chat_stream.request_json` | 发起 HTTP 请求前 | `context.requestBody`（sanitize 后的 OpenAI 兼容 payload） |
| `llm-runtime` | `llm_runtime.chat_stream.response_json` | SSE 流结束后 | `context.output`/`context.reasoningOutput`（sanitize 后）+ `elapsedMs`/`inputChars`/`outputChars` |
| `llm-runtime` | `llm_runtime.chat_stream.failed` | catch 分支 | `error`（结构化 name/message/stack）+ `context.normalizedMessage` |
| `ai-runtime` | `generation.runtime.request_json` | `generate()`/`continuePolling()` 调用 provider 前 | `context.requestBody`（sanitize 后） |
| `ai-runtime` | `generation.runtime.response_json` | trace 构建后 | `context.responseBody`（复用 `buildGenerateTrace`/`buildContinuePollingTrace` 里已经 sanitize 过的 `trace.responseBody`，不重复 sanitize） |
| `ai-runtime` | `ai_runtime.generate.failed` | `generate()` catch 分支（1.1 已有） | — |

前端侧仍保留、但语义收窄的事件：

- `commands.llmRuntime` 的 `llm_runtime.chat_stream.invoke_failed`：只在 IPC 调用本身 reject 时记录，代表"前端视角确认调用失败"，不再与后端 `chat_stream.failed` 撞名重复。

### `sanitizeJsonValue` / `isSensitiveKey` 现在在哪、怎么用

```ts
import { sanitizeJsonValue, isSensitiveKey } from '../logging' // 相对路径按你的文件位置调整

const safeBody = sanitizeJsonValue(rawJsonValue) // depth 参数可选，默认 0，一般不用传
```

- 位置：`electron/main/services/logging/sanitize.ts`，经 `electron/main/services/logging/index.ts` 统一导出。
- `ai-runtime/trace.ts` 现在只剩 `buildGenerateTrace`/`buildContinuePollingTrace` 两个函数（43 行），内部调用 `sanitizeJsonValue`，不再自己实现脱敏逻辑。
- **当前脱敏/截断规则是硬编码的**，没有任何开关：
  - 命中 `isSensitiveKey`（key 包含 `api_key`/`apikey`/`authorization`/`token`/`secret`/`password`，大小写不敏感）的字段直接替换成 `'***'`，**这条不可协商，1.3 只能在此基础上扩展，不能放松**。
  - `data:` 开头的字符串（base64 图片/视频/音频）按 `DATA_URI_HEAD_LEN=96` / `TAIL_LEN=32` 截断，中间显示 `...(len=N, data-uri)...`。
  - 长度 ≥512 且形似 base64 的字符串按 `BASE64_HEAD_LEN=160` / `TAIL_LEN=48` 截断。
  - 普通长字符串（含 LLM 的长文本回复）超过 `LONG_STRING_HEAD_LEN=1200 + LONG_STRING_TAIL_LEN=240` 才截断。
- **00-任务总览"重要记录"里已经定了 1.3 的方向**："完整捕获模式保留图片 base64 原文，音频/视频仍摘要"——这意味着 1.3 大概率要给 `sanitizeJsonValue` 加一个可配置的"捕获模式"参数（至少区分"截断"与"完整"两档，且区分数据类型），而不是全局一刀切开关。当前实现里 `MAX_DEPTH`/`*_HEAD_LEN`/`*_TAIL_LEN` 都是模块顶层 `const`，1.3 改造时这些常量大概率要变成可传入参数或从配置读取。

### `logPreviewOnly` 是什么、为什么存在

- 位置：`src/core/logging/logger.ts`，经 `src/core/logging/index.ts` 导出。
- 签名：`logPreviewOnly(domain: string, message: string, meta?: LogCallMeta): void`。
- 作用：写渲染层内存 store（`subscribeLogEvents` 能读到）+ 打印控制台，但**不**调用 `enqueueFrontendLogForBridge`，即不会把这条日志再桥接回主进程落盘一次。
- 使用点（都是"主进程已经权威落盘过同一份数据，渲染层只需要本地展示"的场景）：
  1. `initLoggerConfig()` 里对 `henji://runtime-request-preview` / `henji://llm-runtime-request-preview` 两个预览通道的处理。
  2. `GenerationService.ts` 的 `recordRuntimeTrace()`（记 `generation.runtime.response_json`）。
- **这两条预览通道本身没有删**（`henji://runtime-request-preview` in `ai-runtime/runtime.ts` 的 `emitPreview()`，`henji://llm-runtime-request-preview` in `llm/runtime.ts`），preload/platform/commands 五层都还在。原因：`UnifiedLogViewer`（挂在 `TestModePanel` 里）目前只读渲染层内存 store，`henji://log-event` 实时推送还没有任何代码把它塞进这个 store（那是 2.1 的活），直接删预览通道会让测试模式面板瞬间失去实时展示能力。**1.3 大概率不用管这个**，但如果 1.3 也要动 `logger.ts`/`GenerationService.ts`，记得这段历史，不要误删 `logPreviewOnly` 或预览通道。等 2.1 把独立日志窗口做出来、`UnifiedLogViewer`/`TestModePanel` 按计划删除后，预览通道和 `logPreviewOnly` 的调用点才应该一起清理。

## "尚未接开关"的问题已在 1.3 解决

上一版 handoff 在这里列过"1.3 的活"清单，现已全部完成，不再重复列出（详见本文件最上方"1.3 留下了什么"一节）。仍然独立于统一开关之外、2.1 需要自己决定要不要处理的：

- `src/utils/testMode.ts` 的 `recordApiTrace()`/`api.trace` 事件：1.2、1.3 都决策保持独立（opt-in 调试通道，不纳入 `logCaptureMode` 统一开关）。

## 之前（1.1）留下的坑，依然有效

1. 不要在 `electron/main/services/logging/` 同级再建平铺 `logging.ts` 文件。
2. `appendLogEvents` 在 `push.ts` 里定义，`index.ts` 只 re-export；1.3 新增的 `applyEventSizeFuse` 调用点也放在这里，不要在别处重复调用。
3. 渲染层订阅通道 `listenLogEvent` 目前仍然没有任何代码把推送事件写入 `src/core/logging/store.ts` 的内存 store——**这正是 2.1（日志窗口）的核心工作范围**，1.2、1.3 都没有动它。
4. API key 等敏感字段的打码逻辑唯一入口是 `electron/main/services/logging/sanitize.ts` 的 `isSensitiveKey`，2.1 如果要展示日志内容，直接信任落盘的数据已经打码，不需要在渲染层再做一遍脱敏。
5. 前端桥接事件与后端事件写同一个文件，看 `source` 字段区分来源；旧 `frontend-*.log` 自然过期，不受清理逻辑影响。
6. `MainLogEvent` 新增了可选字段 `truncatedByLimit?: boolean`（`electron/main/services/logging/types.ts`），2.1 渲染层展示日志事件的类型定义（如果有独立于 `MainLogEvent` 的渲染层类型）记得同步这个字段，否则会丢失"这条事件被保险丝截断过"的展示线索。

## 快速自检命令（改完 2.1 也应该跑一遍）

```bash
npx tsc -p tsconfig.electron.json --noEmit
npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0
npm run lint
npx tsc --noEmit
```
