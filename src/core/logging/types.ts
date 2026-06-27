export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface LogEvent {
  id: string
  timestamp: string
  level: LogLevel
  domain: string
  event: string
  message: string
  requestId?: string
  taskId?: string
  modelId?: string
  providerId?: string
  context?: DynamicValue
  error?: DynamicValue
  source: 'frontend' | 'backend'
}

export interface LogConfig {
  level: LogLevel
  enabledDomains: string[] | null
  persistToFile: boolean
  bufferSize: number
  flushIntervalMs: number
  flushBatchSize: number
}

export interface LogCallMeta {
  event?: string
  requestId?: string
  taskId?: string
  modelId?: string
  providerId?: string
  context?: DynamicValue
  error?: DynamicValue
}

export interface LogEventBridgeDto {
  timestamp: string
  level: LogLevel
  domain: string
  event: string
  message: string
  requestId?: string
  taskId?: string
  modelId?: string
  providerId?: string
  context?: DynamicValue
  error?: DynamicValue
}
