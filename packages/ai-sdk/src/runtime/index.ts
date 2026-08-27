/**
 * 运行时契约层：SDK 与宿主环境之间的全部接口，以及零依赖的纯内存任务登记表。
 *
 * 本目录定义「供应商适配逻辑需要宿主提供什么」，不含任何具体实现——具体实现由每个
 * 宿主自行提供并组装成 {@link RuntimeContext}（Electron 侧实现见
 * `electron/main/services/ai-runtime/sdk-runtime.ts`）。
 */

export {
  AiRuntimeError,
  cancelledError,
  modelProviderErrorCategorySchema,
  modelProviderErrorSchema,
  parseModelProviderError,
  ProviderModelStepError,
  serializeModelProviderError,
} from './errors'
export type {
  ModelProviderError,
  ModelProviderErrorCategory,
  ProviderErrorContext,
} from './errors'
export {
  createCancelledError,
  createCredentialError,
  describeNetworkFailure,
  isAgentSemanticRetryable,
  normalizeProviderError,
  shouldRetry,
} from './error-classify'
export type { NetworkFailure, RetryMode } from './error-classify'
export type { Transport } from './Transport'
export type { CredentialScope, CredentialStore } from './CredentialStore'
export type { MediaBinary, MediaReader } from './MediaReader'
export type { LogContext, Logger } from './Logger'
export { noopLogger } from './Logger'
export type { TraceSpan, Tracer } from './Tracer'
export { noopTracer } from './Tracer'
export {
  cancelTask,
  clearCancelFlag,
  isCancelled,
  registerAbortController,
} from './task-registry'
export type { TaskNamespace } from './task-registry'

import type { CredentialStore } from './CredentialStore'
import { noopLogger, type Logger } from './Logger'
import type { MediaReader } from './MediaReader'
import { noopTracer, type Tracer } from './Tracer'
import type { Transport } from './Transport'

/**
 * 聚合宿主环境提供的全部运行时能力。后续所有从主进程迁入 SDK 的供应商适配代码
 * （2.2/2.3/2.4/4.1/4.2）都只接收这一个参数，不直接依赖任何具体宿主 API——
 * 这是「供应商逻辑与运行环境解耦」在类型层面的落地点：函数签名里出现的是
 * `RuntimeContext`，而不是 `electron` 的 `safeStorage` 或 Node 的 `fs`。
 *
 * `logger`/`tracer` 是可选字段，缺省分别落到 {@link noopLogger}/{@link noopTracer}——
 * 日志与追踪属于可观测性，不该成为"不提供就无法运行"的硬依赖；`transport`/
 * `credentials`/`media` 是必需字段，因为供应商适配逻辑离开这三者完全无法工作
 * （发不出请求、拿不到密钥、传不了媒体文件）。
 *
 * 这个类型本身**不含任何具体实现**——它只是一个把 5 个接口装进一个对象的形状声明，
 * 满足验收标准「`RuntimeContext` 聚合类型可用，且不含任何具体实现」。
 */
export interface RuntimeContext {
  transport: Transport
  credentials: CredentialStore
  media: MediaReader
  logger?: Logger
  tracer?: Tracer
}

/**
 * 从可能省略了 `logger`/`tracer` 的 {@link RuntimeContext} 得到一个字段全部齐备的版本，
 * 缺省项分别补上 {@link noopLogger}/{@link noopTracer}。
 *
 * 供应商适配代码内部应该统一消费这个函数的返回值（而不是直接读
 * `context.logger?.info(...)` 到处判空），避免每个调用点都重复"可能是 undefined"的判断。
 */
export function resolveRuntimeContext(
  context: RuntimeContext
): Required<RuntimeContext> {
  return {
    transport: context.transport,
    credentials: context.credentials,
    media: context.media,
    logger: context.logger ?? noopLogger,
    tracer: context.tracer ?? noopTracer,
  }
}
