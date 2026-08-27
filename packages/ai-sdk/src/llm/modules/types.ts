import type { CapabilitySource } from '../../capabilities/types'
import type { ResolvedRuntimeContext, RuntimeContext } from '../../runtime/RuntimeContext'
import type { DiscoveredModelItem } from '../discovery'
import type {
  LlmChatRequestDto,
  LlmStreamEventDto,
  LlmStreamOutput,
  LlmUsageDto,
} from '../chatTypes'
import type { LlmCapabilities } from '../types'

export type LlmModuleExecutionMode = 'request-response' | 'event-stream'

export interface LlmModuleDescriptor {
  /** 宿主内全局稳定的模块 ID；与 provider/model 坐标分别校验。 */
  id: string
  source: CapabilitySource
  providerId: string
  modelId: string
  displayName?: string
  capabilities: LlmCapabilities
  executionModes: readonly LlmModuleExecutionMode[]
  tags?: readonly string[]
}

export type LlmModuleRequest = Omit<LlmChatRequestDto, 'providerId' | 'modelId'> & {
  /** 可省略；填写时必须与所选模块一致，防止宿主路由串线。 */
  providerId?: string
  modelId?: string
}

export interface LlmModuleOutput extends LlmStreamOutput {
  providerMetadata?: Readonly<Record<string, unknown>>
}

export type LlmModuleStreamEvent = Extract<
  LlmStreamEventDto,
  { type: 'Token' | 'ReasoningToken' }
>

export type LlmModuleEvent =
  | LlmModuleStreamEvent
  | { type: 'Usage'; data: LlmUsageDto }
  | { type: 'Finish'; data: { finishReason: string | null } }
  | Extract<LlmStreamEventDto, { type: 'Done' | 'Error' }>

export interface LlmModuleExecutionContext {
  runtime: ResolvedRuntimeContext
  requestId: string
  signal: AbortSignal
  mode: LlmModuleExecutionMode
  /** 只接收增量 token；Usage/Finish/Done/Error 由 client 统一发射。 */
  emit(event: LlmModuleStreamEvent): Promise<void>
}

export interface LlmModuleDiscoveryContext {
  runtime: ResolvedRuntimeContext
  requestId: string
  signal: AbortSignal
}

export interface LlmModule {
  descriptor: LlmModuleDescriptor
  execute(request: LlmChatRequestDto, context: LlmModuleExecutionContext): Promise<LlmModuleOutput>
  discover?(context: LlmModuleDiscoveryContext): Promise<readonly DiscoveredModelItem[]>
  dispose?(): void | Promise<void>
}

export interface LlmModuleExecuteOptions {
  requestId?: string
  signal?: AbortSignal
  timeoutMs?: number
  mode?: LlmModuleExecutionMode
  /** 逐条等待，给 QuickJS/IPC 等宿主桥提供背压。 */
  onEvent?(event: LlmModuleEvent): void | Promise<void>
}

export interface LlmModuleDiscoveryOptions {
  requestId?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface LlmModuleExecutionOutcome extends LlmModuleOutput {
  providerId: string
  modelId: string
  startedAtMs: number
  elapsedMs: number
  inputChars: number
  outputChars: number
}

export interface LlmModuleHandle {
  readonly descriptor: LlmModuleDescriptor
  execute(
    request: LlmModuleRequest,
    options?: LlmModuleExecuteOptions
  ): Promise<LlmModuleExecutionOutcome>
  discover(options?: LlmModuleDiscoveryOptions): Promise<readonly DiscoveredModelItem[]>
}

export interface CreateLlmModuleClientConfig {
  runtime: RuntimeContext
  modules?: readonly LlmModule[]
}

export interface LlmModuleClient {
  register(module: LlmModule): LlmModuleHandle
  unregister(moduleId: string): Promise<boolean>
  /** 取消并等待当前 namespace 的活动操作，但保留注册；返回本次等待的操作数。 */
  drainSource(namespace: string): Promise<number>
  /** 先从注册表移除，再取消/等待并 dispose namespace 下全部模块。 */
  unregisterSource(namespace: string): Promise<number>
  list(): readonly LlmModuleDescriptor[]
  get(moduleId: string): LlmModuleHandle | undefined
  execute(
    moduleId: string,
    request: LlmModuleRequest,
    options?: LlmModuleExecuteOptions
  ): Promise<LlmModuleExecutionOutcome>
  discover(
    moduleId: string,
    options?: LlmModuleDiscoveryOptions
  ): Promise<readonly DiscoveredModelItem[]>
  cancel(requestId: string): void
  dispose(): Promise<void>
}
