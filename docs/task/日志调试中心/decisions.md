# 日志调试中心 - 执行期决策记录

## 1.1 主进程日志中枢与统一落盘

### 决策：`electron/main/services/logging.ts` 删除而非改为再导出

- 任务文件里这一点标注"执行时确认，避免双份实现"。
- 排查确认全仓库只有 `electron/main/ipc/logging.ts` 一处 `import ... from '../services/logging'`，没有其他文件依赖旧文件的具体导出名。
- 选择**直接删除**旧文件，新建同名目录 `electron/main/services/logging/` 承接（`index.ts` 作为目录入口，`import '../services/logging'` 自动解析到 `logging/index.ts`，调用方 import 路径不用改）。
- 理由：只有一个调用点，保留再导出文件没有实际兼容价值，反而会让"哪份是主实现"变得含糊，与"避免双份实现"的要求相悖。

### 决策：`appendLogEvents` 与 `pushLogEvents` 放在同一个 `push.ts` 文件

- 任务文件建议的文件划分是 types / writer / main-logger / push / retention / index，`appendLogEvents`（统一写入口，写完再推送）没有单独归属文件。
- 若把 `appendLogEvents` 放进 `index.ts`，`main-logger.ts` 想复用它就必须 `import from './index'`，而 `index.ts` 又要 `export { createMainLogger } from './main-logger'`，会形成 `main-logger.ts` ↔ `index.ts` 循环依赖（CommonJS 下虽然多数情况能跑，但不确定、不好排查）。
- 选择把 `appendLogEvents`（write→push 两步编排）放进 `push.ts`，与 `pushLogEvents` 放在一起；`main-logger.ts` 和 `index.ts` 都从 `push.ts` 单向导入，依赖图是纯 DAG（`types` ← `writer` ← `push` ← `main-logger`；`retention` 只依赖 `writer`；`index` 汇总导出，没有人反向依赖 `index`）。
- 理由：避免循环依赖带来的加载顺序不确定性，同时 `appendLogEvents` 的落点（写完就推送）在语义上确实更贴近"推送"这一步的收尾动作。

### 决策：试点接入选 `ai-runtime/runtime.ts` 的 `generate()`，不动 `continuePolling()`

- 任务文件建议"generate 结果处"，验收标准也只要求一处试点验证链路通。
- 只改 `generate()`（新增 start/result/failed 三个 backend 事件），`continuePolling()` 暂不动，避免这次改动扩大到"顺手把整个 ai-runtime 都加日志"。
- `continuePolling()` 及其余主进程模块的日志覆盖留给 1.2、3.2 或日常开发按规范逐步接入。

### 决策：`createMainLogger` 不做批量防抖，单条事件直接进写入队列

- 渲染层 `enqueueFrontendLogForBridge` 有 450ms/60 条的批量攒批逻辑，是因为要过 IPC 到主进程，减少调用次数。
- 主进程内 `createMainLogger` 已经在同进程内，没有 IPC 开销；`writer.ts` 内部有写入队列做串行化，足够避免并发写文件交错。
- 选择不加防抖/批量，每条日志立即入队写入，保持调用方语义简单（"记完就落盘"），代价是高频日志场景下 appendFile 调用次数更多，可接受。

## 验收反馈修复：`retention.ts` 误清理旧 `frontend-*.log`（同日，主控 agent 验收发现）

- **问题**：初版 `retention.ts` 的 `listLogFiles()` 用 `entry.endsWith('.log')` 匹配日志目录下所有文件，没有区分新旧命名规则。这会导致旧的 `frontend-YYYY-MM-DD.log` 也被纳入"1 天过期删除"和"总大小超限删最旧"两条清理规则，与实施方案"旧文件名 `frontend-YYYY-MM-DD.log` 不迁移不删除，自然过期"直接矛盾，也和 `handoff.md` 里写的"保留策略只清理 `henji-*.log`"矛盾。这是我实现时的疏漏：写清理逻辑时只想着"清理 `.log` 文件"，没有回头核对实施方案里"旧文件不删"这条约束。
- **修复**：把 `MAIN_LOG_FILE_PREFIX = 'henji-'` 从 `writer.ts` 的文件私有常量提到 `types.ts` 作为共享导出常量；`retention.ts` 的匹配条件改为 `entry.startsWith(MAIN_LOG_FILE_PREFIX) && entry.endsWith('.log')`，`writer.ts` 拼文件名时也改用这个共享常量（消除"两处各写一份 `'henji-'` 字符串、以后改一处忘改另一处"的风险）。
- **提醒**：以后任何人改日志文件命名规则（比如前缀改名），只需要改 `types.ts` 的 `MAIN_LOG_FILE_PREFIX` 一处，`writer.ts`/`retention.ts` 会自动同步；不要再在 `retention.ts` 或其他文件里重新硬编码 `'henji-'` 或裸 `.endsWith('.log')` 之类的匹配条件。
