import type { CredentialStore } from './CredentialStore'
import { noopLogger, type Logger } from './Logger'
import type { MediaReader } from './MediaReader'
import { noopTracer, type Tracer } from './Tracer'
import type { Transport } from './Transport'

/** SDK 可移植运行时需要宿主提供的能力集合。 */
export interface RuntimeContext {
  transport: Transport
  credentials: CredentialStore
  media: MediaReader
  logger?: Logger
  tracer?: Tracer
}

/** 补齐可选的日志与追踪能力，供供应商实现统一消费。 */
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
