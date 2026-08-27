import type { RuntimeContext } from '../runtime/RuntimeContext'

export type CapabilityKind =
  | 'media-generation'
  | 'chat'
  | (string & {})

export type CapabilityContentKind =
  | 'text'
  | 'structured-data'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | (string & {})

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
}

export interface CapabilityExecutionContext {
  runtime: Required<RuntimeContext>
  requestId: string
  signal: AbortSignal
}

export interface CapabilityModule<TInput, TOutput> {
  descriptor: CapabilityDescriptor
  execute(input: TInput, context: CapabilityExecutionContext): Promise<TOutput>
  dispose?(): void | Promise<void>
}

export interface CapabilityExecuteOptions {
  requestId?: string
  signal?: AbortSignal
}

export interface CapabilityHandle<TInput, TOutput> {
  descriptor: CapabilityDescriptor
  execute(input: TInput, options?: CapabilityExecuteOptions): Promise<TOutput>
}
