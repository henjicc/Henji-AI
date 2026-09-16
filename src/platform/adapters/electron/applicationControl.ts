import type { ApplicationHostPlatform } from '@/core/application-control/localHostContracts'

export function createElectronApplicationControl(): ApplicationHostPlatform {
  const native = (): ApplicationHostPlatform => {
    const api = window.henjiNative?.applicationControl
    if (!api) throw new Error('应用能力需要桌面宿主，请重新启动应用。')
    return api
  }
  return {
    publishContext: input => native().publishContext(input),
    registerHost: input => native().registerHost(input), complete: input => native().complete(input),
    onRequest: handler => native().onRequest(handler), onCancel: handler => native().onCancel(handler),
    onRevoke: handler => native().onRevoke(handler),
  }
}
