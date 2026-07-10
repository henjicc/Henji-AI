# 日志调试中心 - 交接说明（写给下一个执行者）

面向任务：1.2 LLM请求响应完整捕获

## 本任务（1.1）留下了什么

主进程现在有了自己的 logger 能力，位于 `electron/main/services/logging/`（原 `electron/main/services/logging.ts` 单文件已删除，改成了目录）。

### 怎么用 `createMainLogger`

```ts
import { createMainLogger } from '../logging' // 相对路径按你的文件位置调整

const logger = createMainLogger('llm-runtime') // domain 建议用点分层级，如 'llm-runtime.chat-stream'

logger.info('后端收到聊天请求', {
  event: 'llm_runtime.chat_stream.request', // 建议显式传 event，不传会由 message 自动推断（不够语义化）
  requestId,
  modelId,
  providerId,
  context: { route, method, requestBody },
})

logger.error('后端聊天请求失败', {
  event: 'llm_runtime.chat_stream.failed',
  requestId,
  error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
})
```

- 接口对齐渲染层 `src/core/logging/logger.ts` 的 `createLogger`，但主进程版本参数更直白：`logger.info(message, meta?)`，`meta` 里能传 `event/requestId/taskId/modelId/providerId/context/error`。
- 每条日志会**立即**落盘（`henji-YYYY-MM-DD.log`，`source: 'backend'`）并推给所有未销毁的 `BrowserWindow`（`henji://log-event`），不需要额外调用任何 flush。
- 落盘失败会被静默吞掉（`main-logger.ts` 里 `.catch(() => undefined)`），不会抛出异常影响业务主流程——这是有意为之，日志不应该拖垮正常功能，但也意味着**写入失败你完全看不到报错**，如果怀疑日志没落盘，先检查磁盘权限/目录是否被占用。

### 文件与目录结构

```
electron/main/services/logging/
├── types.ts        # MainLogEvent / LogEventBridgeDto / 保留策略常量
├── writer.ts        # 落盘：getLogDir() / getLogFilePath() / writeLogEventsToFile()
├── push.ts          # 推送 + 统一写入口：pushLogEvents() / appendLogEvents()（写完再推）
├── main-logger.ts    # createMainLogger(domain)
├── retention.ts       # runLogRetention()（app.whenReady 时调一次，1.2 不需要碰）
└── index.ts          # 统一导出，其他模块只从这里 import
```

日志文件路径：`%LOCALAPPDATA%\com.henji.ai\Henji-AI\logs\henji-YYYY-MM-DD.log`（非 Windows 走 `app.getPath('appData')`），JSONL 格式，每行一个 `MainLogEvent`（含 `source: 'frontend' | 'backend'`）。

### 已有的坑 / 注意事项

1. **不要再新建 `services/logging.ts` 平铺文件**——目录已经占用了这个 import 路径（`import ... from '../services/logging'` 会自动解析到 `logging/index.ts`），如果你在同级再建一个 `logging.ts` 文件，Node 模块解析会优先选文件，把目录整个短路掉。
2. **`appendLogEvents` 在 `push.ts` 里，不在 `index.ts` 里定义**（虽然 `index.ts` 会 re-export 它）——这是为了避免 `main-logger.ts` 和 `index.ts` 之间循环依赖，见 `decisions.md`。如果你要新增文件依赖 `appendLogEvents`，直接从 `./push` 或者聚合出口 `../logging`（即 `index.ts`）import 都可以，不会有循环依赖问题，只是新增文件不要反过来被 `push.ts`/`main-logger.ts` import。
3. **渲染层订阅通道已经打通到"能订阅"这一步，但没有任何消费方**——`window.henjiNative.logging.onLogEvent(handler)`（preload）→ `src/platform/adapters/electron/logging.ts` 的 `listenLogEvent`（platform 契约）→ `src/commands/logging.ts` 的 `listenLogEvent()`。2.1 建日志窗口时直接调用 `src/commands/logging.ts` 里的 `listenLogEvent`，不要再重新声明一遍 IPC 通道。
4. **1.2 要捕获 LLM 完整请求/响应时，注意脱敏问题不属于本任务范围**——`createMainLogger` 本身不做任何脱敏/截断，事件里的 `context`/`error` 原样落盘。API key 等敏感字段的打码逻辑在 `electron/main/services/ai-runtime/trace.ts` 的 `isSensitiveKey`，1.2/1.3 如果要在 LLM 链路记录敏感信息，记得复用或对齐这套脱敏逻辑，不要绕过。
5. **前端桥接事件与后端事件现在写同一个文件**，判断来源看每行 JSON 的 `source` 字段，不要再假设"前端日志在 `frontend-*.log`，后端日志在别的地方"——旧的 `frontend-YYYY-MM-DD.log` 文件不会再有新内容写入，但也不会被删除或合并，纯粹自然过期（保留策略只清理 `henji-*.log`）。
6. **`emitPreview`（`henji://runtime-request-preview` / `henji://llm-runtime-request-preview`）没有被本任务替换**——`ai-runtime/runtime.ts` 的 `generate()` 现在是"`emitPreview` 推给渲染层再桥接回写"和"`createMainLogger` 直接落盘"两条路径**同时存在**（试点阶段有意保留双路径，方便对照验证）。1.2/1.3 如果要清理旧的 `emitPreview` 绕路链路，需要单独确认再动，不在本次任务范围内自动做了。

## 快速自检命令（改完 1.2 也应该跑一遍）

```bash
npx tsc -p tsconfig.electron.json --noEmit
npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0
npm run lint
```
