/**
 * 单条日志调用附带的结构化元信息。
 *
 * 字段结构刻意对齐主进程现有 `electron/main/services/logging/main-logger.ts` 的
 * `MainLoggerMeta`（`createMainLogger(domain).info(message, meta)` 的 `meta` 参数），
 * 这样 Electron 侧的 `Logger` 实现（见 `electron/main/services/ai-runtime/sdk-runtime.ts`）
 * 可以把调用原样转发给 `createMainLogger` 得到的实例，不需要在中间写一层字段映射/改名代码。
 */
export interface LogContext {
  /** 结构化事件名，如 `'ai_runtime.generate.start'`；不传时由宿主实现自行推断。 */
  event?: string
  /** 单次生成/调用的请求 id，用于按链路串联同一次任务的多条日志。 */
  requestId?: string
  /** 供应商侧的任务 id（轮询场景常用）。 */
  taskId?: string
  /** 触发本次日志的模型 id。 */
  modelId?: string
  /** 触发本次日志的供应商 id。 */
  providerId?: string
  /** 任意结构化上下文数据；宿主侧的日志实现负责脱敏（如 API Key、Authorization 头）与截断。 */
  context?: unknown
  /** 错误对象或错误相关数据，通常配合 `error()` 使用。 */
  error?: unknown
}

/**
 * `Logger` 是 SDK 内部结构化日志的唯一出口。SDK 不直接 `console.log`，
 * 也不假设任何具体的日志落盘/上报方式——三个目标运行时的日志基础设施完全不同：
 * Electron 主进程把日志落盘为 `henji-*.log` 文件并推送给渲染层的日志查看器；
 * Tauri 可能用 `tauri-plugin-log` 或直接转发到前端；UXP 插件的诊断信息大多只能
 * 输出到 Photoshop 的开发者控制台。这层差异必须留给宿主决定。
 *
 * 只暴露 `info`/`warn`/`error` 三个级别（不含主进程 `MainLogger` 里的 `trace`/`debug`）——
 * SDK 侧的日志需求目前只有"正常流程记录"“可恢复的异常”“需要关注的失败”三档，
 * 更细的级别留给宿主的日志实现内部决定要不要再细分。
 */
export interface Logger {
  info(message: string, ctx?: LogContext): void
  warn(message: string, ctx?: LogContext): void
  error(message: string, ctx?: LogContext): void
}

/**
 * 缺省日志实现：什么都不做。
 *
 * 消费方（尤其是先写的单测、或还没接好宿主日志系统的早期集成）不应该被强制先实现一个
 * `Logger` 才能跑起来——`RuntimeContext.logger` 缺省用这个实现即可安全运行。
 */
export const noopLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}
