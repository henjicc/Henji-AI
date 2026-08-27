/**
 * UXP 与其他受限宿主的原生 OpenAI-compatible SSE 入口。
 *
 * 此入口刻意不导出模型目录、modelStep、Zod 或 Vercel AI SDK。旧的 `./llm` 与包根仍会
 * 通过同一 `chat.ts` / `streaming.ts` 实现重导出这些 API，不存在第二份流式执行逻辑。
 */
export {
  cancelLlmChatTask,
  normalizeLlmChatError,
  resolveLlmTaskId,
  runLlmChatStream,
} from '../chat'
export type {
  LlmChatCompletedInfo,
  LlmChatRequestBuiltInfo,
  LlmChatStreamHooks,
  LlmChatStreamOutcome,
} from '../chat'
export type {
  JsonObject,
  JsonValue,
  LlmChatMessageDto,
  LlmChatRequestDto,
  LlmContentPart,
  LlmRole,
  LlmStreamEmitter,
  LlmStreamEventDto,
  LlmStreamOutput,
  LlmTraceDto,
  LlmUsageDto,
} from '../chatTypes'
export type { LlmReasoningConfig, LlmReasoningEffort } from '../reasoning'
export {
  parseModelProviderError,
  ProviderModelStepError,
  serializeModelProviderError,
} from '../../runtime/provider-error-core'
export type {
  ModelProviderError,
  ModelProviderErrorCategory,
} from '../../runtime/provider-error-core'
export type { RuntimeContext } from '../../runtime/RuntimeContext'
export type { Transport } from '../../runtime/Transport'
export type { CredentialScope, CredentialStore } from '../../runtime/CredentialStore'
export type { MediaBinary, MediaReader } from '../../runtime/MediaReader'
export type { LogContext, Logger } from '../../runtime/Logger'
export type { TraceSpan, Tracer } from '../../runtime/Tracer'
