export interface CapabilityExecutionContext {
  signal: AbortSignal
  requestId?: string
  taskId?: string
  /** Gateway 信封中的权威并发基线；业务输入里的兼容字段不能覆盖它。 */
  expectedRevisions?: Record<string, number>
}

export type CapabilityHandler = (
  input: unknown,
  context: CapabilityExecutionContext
) => Promise<Record<string, unknown>> | Record<string, unknown>

export interface ApplicationCapabilityHandlerRegistrar {
  registerHandler(id: string, handler: CapabilityHandler): void
}
