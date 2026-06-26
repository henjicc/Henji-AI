export interface HenjiIpcErrorEnvelope {
  name: string
  message: string
  code: string
  stack?: string
}

export interface HenjiWindowStatePayload {
  isMaximized: boolean
}

export interface HenjiWindowApi {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  toggleDevTools(): Promise<void>
  onStateChanged(handler: (payload: HenjiWindowStatePayload) => void): () => void
}

export interface HenjiDiagnosticsStreamEvent {
  streamId: string
  type: 'chunk' | 'done'
  data?: string
}

export interface HenjiDiagnosticsApi {
  ping(): Promise<{ pong: true; timestamp: number }>
  streamEcho(message: string, onEvent: (event: HenjiDiagnosticsStreamEvent) => void): Promise<() => Promise<void>>
}

export type HenjiSqlBindValue = string | number | boolean | null | Uint8Array

export interface HenjiSqlExecuteResult {
  rowsAffected: number
  lastInsertId?: number
}

export interface HenjiDbApi {
  execute(sql: string, params?: HenjiSqlBindValue[]): Promise<HenjiSqlExecuteResult>
  select<T = unknown>(sql: string, params?: HenjiSqlBindValue[]): Promise<T[]>
}

export interface HenjiProviderKeyStatus {
  providerId: string
  configured: boolean
}

export interface HenjiKeystoreApi {
  setKey(namespace: string, providerId: string, apiKey: string): Promise<void>
  removeKey(namespace: string, providerId: string): Promise<void>
  getKey(namespace: string, providerId: string): Promise<string | null>
  hasKey(namespace: string, providerId: string): Promise<boolean>
}

export interface HenjiAiApi {
  setProviderApiKey(providerId: string, apiKey: string): Promise<void>
  removeProviderApiKey(providerId: string): Promise<void>
  getProviderApiKey(providerId: string): Promise<string | null>
  getProviderKeyStatus(): Promise<HenjiProviderKeyStatus[]>
}

export interface HenjiLlmApi {
  setProviderApiKey(providerId: string, apiKey: string): Promise<void>
  removeProviderApiKey(providerId: string): Promise<void>
  getProviderApiKey(providerId: string): Promise<string | null>
  getProviderKeyStatus(providerIds: string[]): Promise<HenjiProviderKeyStatus[]>
}

export interface HenjiFsDirEntry {
  name: string
  isDirectory: boolean
}

export interface HenjiDialogFilter {
  name: string
  extensions: string[]
}

export interface HenjiDialogSaveOptions {
  defaultPath?: string
  filters?: HenjiDialogFilter[]
}

export interface HenjiDialogOpenOptions {
  directory?: boolean
  multiple?: boolean
  defaultPath?: string
  filters?: HenjiDialogFilter[]
}

export interface HenjiFsApi {
  readFile(path: string): Promise<Uint8Array>
  readTextFile(path: string): Promise<string>
  writeFile(path: string, data: Uint8Array): Promise<void>
  writeTextFile(path: string, data: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  readDir(path: string): Promise<HenjiFsDirEntry[]>
  copyFile(src: string, dest: string): Promise<void>
  remove(path: string, options?: { recursive?: boolean }): Promise<void>
}

export interface HenjiDialogApi {
  save(options?: HenjiDialogSaveOptions): Promise<string | null>
  open(options?: HenjiDialogOpenOptions): Promise<string | string[] | null>
}

export interface HenjiShellApi {
  openExternal(url: string): Promise<void>
}

export interface HenjiPathsApi {
  appLocalDataDir(): Promise<string>
  downloadDir(): Promise<string>
  join(...parts: string[]): Promise<string>
  dirname(path: string): Promise<string>
  tempDir(): Promise<string>
}

export interface HenjiNativeFetchRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
}

export interface HenjiNativeFetchResponse {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: Uint8Array
}

export interface HenjiHttpApi {
  fetch(request: HenjiNativeFetchRequest): Promise<HenjiNativeFetchResponse>
}

export interface HenjiMediaApi {
  allowRoot(rootPath: string): Promise<void>
}

export interface HenjiLogEventBridgeDto {
  timestamp: string
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error'
  domain: string
  event: string
  message: string
  requestId?: string
  taskId?: string
  modelId?: string
  providerId?: string
  context?: unknown
  error?: unknown
}

export interface HenjiRuntimeRequestPreviewPayload {
  requestId: string
  taskId?: string
  modelId: string
  providerId: string
  method: string
  route: string
  requestBody: unknown
}

export interface HenjiLoggingApi {
  logFrontendEvents(events: HenjiLogEventBridgeDto[]): Promise<void>
  onRuntimeRequestPreview(handler: (payload: HenjiRuntimeRequestPreviewPayload) => void): () => void
  onLlmRuntimeRequestPreview(handler: (payload: HenjiRuntimeRequestPreviewPayload) => void): () => void
}

export interface HenjiNativeApi {
  ai: HenjiAiApi
  llm: HenjiLlmApi
  db: HenjiDbApi
  keystore: HenjiKeystoreApi
  fs: HenjiFsApi
  dialog: HenjiDialogApi
  shell: HenjiShellApi
  paths: HenjiPathsApi
  http: HenjiHttpApi
  media: HenjiMediaApi
  clipboard: Record<string, never>
  drag: Record<string, never>
  projectPackage: Record<string, never>
  logging: HenjiLoggingApi
  modelscope: Record<string, never>
  window: HenjiWindowApi
  diagnostics: HenjiDiagnosticsApi
}

declare global {
  interface Window {
    henjiNative?: HenjiNativeApi
  }
}

export {}
