import type { WorkRootPlatform } from '@/platform/contracts/workRoot'

const DOMAIN = 'workRoot'

function getNativeWorkRoot(): WorkRootPlatform {
  const native = window.henjiNative
  if (!native?.workRoot) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.workRoot is not available`)
  }
  return native.workRoot
}

/** 作品目录：preload 桥已按 WorkRootPlatform 实现，这里只做可用性检查与转发。 */
export function createElectronWorkRoot(): WorkRootPlatform {
  return {
    getInfo: () => getNativeWorkRoot().getInfo(),
    inspectTarget: (target) => getNativeWorkRoot().inspectTarget(target),
    change: (target) => getNativeWorkRoot().change(target),
    cancel: () => getNativeWorkRoot().cancel(),
    onProgress: (handler) => getNativeWorkRoot().onProgress(handler),
    open: () => getNativeWorkRoot().open(),
    relaunch: () => getNativeWorkRoot().relaunch(),
  }
}
