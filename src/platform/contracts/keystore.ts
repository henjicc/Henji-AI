/**
 * 通用密钥存储能力。Tauri 现状下密钥管理内嵌在 ai_ 与 llm_ 相关命令里，没有独立的
 * Tauri 命令对应本契约；本契约主要供 Electron 侧 safeStorage 实现，被
 * aiRuntime / llmRuntime 的 Electron 适配器内部复用（见决定 002/007）。
 */
export interface KeystorePlatform {
  setKey(namespace: string, providerId: string, apiKey: string): Promise<void>
  removeKey(namespace: string, providerId: string): Promise<void>
  getKey(namespace: string, providerId: string): Promise<string | null>
  hasKey(namespace: string, providerId: string): Promise<boolean>
}
