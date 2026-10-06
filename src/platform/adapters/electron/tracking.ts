import type { TrackingPlatform } from '@/platform/contracts/tracking'

function native(): TrackingPlatform {
  const value = window.henjiNative
  if (!value?.tracking) throw new Error('[platform:tracking] henjiNative.tracking is not available')
  return value.tracking
}

/** 跟踪器（任务 4.10）：preload 桥已按 TrackingPlatform 实现，这里只做可用性检查与转发。 */
export function createElectronTracking(): TrackingPlatform {
  return {
    status: (definition) => native().status(definition),
    run: (definition, range, options) => native().run(definition, range, options),
    stop: (definition) => native().stop(definition),
    candidates: (request) => native().candidates(request),
    onProgress: (handler) => native().onProgress(handler),
  }
}
