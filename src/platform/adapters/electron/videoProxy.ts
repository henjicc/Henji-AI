import type { VideoProxyPlatform } from '../../contracts/videoProxy'
function native(): VideoProxyPlatform {
  const api = window.henjiNative?.videoProxy
  if (!api) throw new Error('代理剪辑不可用，请重新启动应用。')
  return api
}
export function createElectronVideoProxy(): VideoProxyPlatform {
  return { create: request => native().create(request), lookup: request => native().lookup(request), cancel: id => native().cancel(id), onProgress: listener => native().onProgress(listener) }
}
