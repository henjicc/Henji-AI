import type { MediaCachePlatform } from '../../contracts/mediaCache'
function native(): MediaCachePlatform {
  const api = window.henjiNative?.mediaCache
  if (!api) throw new Error('缓存管理不可用，请重新启动应用。')
  return api
}
export function createElectronMediaCache(): MediaCachePlatform {
  return {
    getSettings: () => native().getSettings(), setSettings: patch => native().setSettings(patch), usage: () => native().usage(), clear: category => native().clear(category),
    onChanged: listener => native().onChanged(listener),
    renderList: projectId => native().renderList(projectId), renderBegin: request => native().renderBegin(request), renderCommit: request => native().renderCommit(request),
    renderDiscard: temporaryPath => native().renderDiscard(temporaryPath), renderRemove: request => native().renderRemove(request),
    hardwareCapabilities: () => native().hardwareCapabilities(), detectHardwareCapabilities: encode => native().detectHardwareCapabilities(encode),
  }
}
