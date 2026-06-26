import { PlatformNotImplementedError } from '@/platform/types'
import type { KeystorePlatform } from '@/platform/contracts/keystore'

/**
 * Tauri 现状下密钥存取内嵌在 ai_ 与 llm_ 相关命令里（见 src-tauri/src/ai_runtime/key_store.rs），
 * 没有独立对应的 Tauri 命令。本契约主要服务于 Electron safeStorage 实现，
 * Tauri 侧暂不需要被调用。
 */
export function createTauriKeystore(): KeystorePlatform {
  const notImplemented = (method: string) => {
    throw new PlatformNotImplementedError('keystore', method)
  }
  return {
    async setKey() {
      notImplemented('setKey')
    },
    async removeKey() {
      notImplemented('removeKey')
    },
    async getKey() {
      return notImplemented('getKey')
    },
    async hasKey() {
      return notImplemented('hasKey')
    },
  }
}
