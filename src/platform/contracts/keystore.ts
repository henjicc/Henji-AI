/**
 * 通用密钥存储能力。本契约主要供 Electron 侧 safeStorage 实现，被
 * aiRuntime / llmRuntime 的 Electron 适配器内部复用（见决定 002/007）。
 */
export interface KeystorePlatform {
  setKey(namespace: string, providerId: string, apiKey: string): Promise<void>
  removeKey(namespace: string, providerId: string): Promise<void>
  getKey(namespace: string, providerId: string): Promise<string | null>
  hasKey(namespace: string, providerId: string): Promise<boolean>
}
