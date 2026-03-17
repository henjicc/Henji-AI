export type AiRuntimeTracePhase = 'generate' | 'continuePolling'

export interface AiRuntimeTrace {
  modelId: string
  providerId: string
  requestId: string
  phase: AiRuntimeTracePhase
  route: string
  method: string
  taskId?: string
  requestBody?: unknown
  responseBody: unknown
}
