import type { ResolvedRuntimeContext } from '../runtime/RuntimeContext'

type ExtensibleString = string & Record<never, never>

export type CapabilityKind =
  | 'media-generation'
  | 'chat'
  | 'speech-recognition'
  | 'translation'
  | ExtensibleString

export type CapabilityContentKind =
  | 'text'
  | 'structured-data'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | ExtensibleString

export interface CapabilityValueContract {
  kind: CapabilityContentKind
  required?: boolean
  multiple?: boolean
  mediaTypes?: readonly string[]
  description?: string
}

export interface CapabilityContract {
  input: readonly CapabilityValueContract[]
  output: readonly CapabilityValueContract[]
}

export interface CapabilityDescriptor {
  id: string
  kind: CapabilityKind
  contract: CapabilityContract
  version?: string
  /** 发现信息只描述事实；不会触发任何供应商或模型的隐式导入。 */
  providerIds?: readonly string[]
  modelId?: string
  operations?: readonly string[]
  features?: readonly string[]
  tags?: readonly string[]
  executionModes?: readonly CapabilityExecutionMode[]
}

export type CapabilityExecutionMode = 'request-response' | 'event-stream' | 'realtime'

export interface CapabilityExecutionContext<TEvent = never> {
  runtime: ResolvedRuntimeContext
  requestId: string
  signal: AbortSignal
  emit(event: TEvent): Promise<void>
}

export interface CapabilityModule<TInput, TOutput, TEvent = never> {
  descriptor: CapabilityDescriptor
  execute(input: TInput, context: CapabilityExecutionContext<TEvent>): Promise<TOutput>
  dispose?(): void | Promise<void>
}

export interface CapabilityExecuteOptions<TEvent = never> {
  requestId?: string
  signal?: AbortSignal
  /** 超时与外部 signal 最终合并到同一个 AbortSignal。 */
  timeoutMs?: number
  /** 按事件逐条等待，天然提供背压；未提供时事件被安全忽略。 */
  onEvent?(event: TEvent): void | Promise<void>
}

export interface CapabilityHandle<TInput, TOutput, TEvent = never> {
  descriptor: CapabilityDescriptor
  execute(input: TInput, options?: CapabilityExecuteOptions<TEvent>): Promise<TOutput>
}

export interface CapabilityRealtimeSessionDriver<TInput, TOutput> {
  send(input: TInput): void | Promise<void>
  finish(): Promise<TOutput>
  close?(): void | Promise<void>
}

export interface CapabilityRealtimeModule<TStart, TInput, TEvent, TOutput> {
  descriptor: CapabilityDescriptor
  open(
    input: TStart,
    context: CapabilityExecutionContext<TEvent>
  ): Promise<CapabilityRealtimeSessionDriver<TInput, TOutput>>
  dispose?(): void | Promise<void>
}

export interface CapabilityRealtimeSession<TInput, TOutput> {
  readonly requestId: string
  readonly descriptor: CapabilityDescriptor
  send(input: TInput): Promise<void>
  finish(): Promise<TOutput>
  close(): Promise<void>
}

export type AnyCapabilityModule =
  | CapabilityModule<unknown, unknown, unknown>
  | CapabilityRealtimeModule<unknown, unknown, unknown, unknown>
