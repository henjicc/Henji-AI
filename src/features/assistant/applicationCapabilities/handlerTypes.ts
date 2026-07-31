export interface CapabilityExecutionContext {
  signal: AbortSignal
  requestId?: string
  taskId?: string
}

export type CapabilityHandler = (
  input: unknown,
  context: CapabilityExecutionContext
) => Promise<Record<string, unknown>> | Record<string, unknown>

export interface ApplicationCapabilityHandlerRegistrar {
  registerHandler(id: string, handler: CapabilityHandler): void
}
