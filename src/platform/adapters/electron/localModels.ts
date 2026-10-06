import type { LocalModelsPlatform } from '@/platform/contracts/localModels'

const DOMAIN = 'localModels'

function getNativeLocalModels(): LocalModelsPlatform {
  const native = window.henjiNative
  if (!native?.localModels) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.localModels is not available`)
  }
  return native.localModels
}

/** 本地模型：preload 桥已按 LocalModelsPlatform 实现，这里只做可用性检查与转发。 */
export function createElectronLocalModels(): LocalModelsPlatform {
  return {
    getState: () => getNativeLocalModels().getState(),
    ensure: (id) => getNativeLocalModels().ensure(id),
    cancel: (id) => getNativeLocalModels().cancel(id),
    remove: (id) => getNativeLocalModels().remove(id),
    openFolder: (id) => getNativeLocalModels().openFolder(id),
    getDownloadSource: () => getNativeLocalModels().getDownloadSource(),
    setDownloadSource: (source) => getNativeLocalModels().setDownloadSource(source),
    onProgress: (handler) => getNativeLocalModels().onProgress(handler),
  }
}
