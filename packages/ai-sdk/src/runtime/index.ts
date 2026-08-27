/**
 * 运行时契约层：SDK 与宿主环境之间的全部接口，以及零依赖的纯内存任务登记表。
 *
 * 本目录定义「供应商适配逻辑需要宿主提供什么」，不含任何具体实现——具体实现由每个
 * 宿主自行提供并组装成 {@link RuntimeContext}（Electron 侧实现见
 * `electron/main/services/ai-runtime/sdk-runtime.ts`）。
 */

export {
  modelProviderErrorCategorySchema,
  modelProviderErrorSchema,
  parseModelProviderError,
  ProviderModelStepError,
  serializeModelProviderError,
} from './errors'
export { AiRuntimeError, cancelledError } from './AiRuntimeError'
export type {
  ModelProviderError,
  ModelProviderErrorCategory,
  ProviderErrorContext,
} from './errors'
export {
  createCancelledError,
  createCredentialError,
  isAgentSemanticRetryable,
  normalizeProviderError,
} from './error-classify'
export { describeNetworkFailure, shouldRetry } from './retry'
export type { NetworkFailure, RetryMode } from './retry'
export type { Transport } from './Transport'
export { resolveRuntimeContext } from './RuntimeContext'
export type { RuntimeContext } from './RuntimeContext'
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
