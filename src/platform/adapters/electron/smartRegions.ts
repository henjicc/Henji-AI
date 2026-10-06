import type { SmartRegionsPlatform } from '@/platform/contracts/smartRegions'

const DOMAIN = 'smartRegions'

function getNativeSmartRegions(): SmartRegionsPlatform {
  const native = window.henjiNative
  if (!native?.smartRegions) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.smartRegions is not available`)
  }
  return native.smartRegions
}

/** 智能区域分析（任务 4.7d）：preload 桥已按 SmartRegionsPlatform 实现，这里只做可用性检查与转发。 */
export function createElectronSmartRegions(): SmartRegionsPlatform {
  return {
    ensure: (request) => getNativeSmartRegions().ensure(request),
    cancel: (request) => getNativeSmartRegions().cancel(request),
    onProgress: (handler) => getNativeSmartRegions().onProgress(handler),
  }
}
