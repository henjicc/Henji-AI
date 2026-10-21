import { MEDIA_CACHE_CHANNELS, type MediaCachePlatform } from '../../src/platform/contracts/mediaCache'
export function createMediaCacheApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>, subscribe: (channel: string, handler: (payload: unknown) => void) => () => void): MediaCachePlatform {
  const c = MEDIA_CACHE_CHANNELS
  return {
    getSettings: () => invoke(c.settings), setSettings: patch => invoke(c.setSettings, patch), usage: () => invoke(c.usage), clear: category => invoke(c.clear, { category }),
    onChanged: handler => subscribe(c.changed, () => handler()),
    renderList: projectId => invoke(c.renderList, { projectId }), renderBegin: request => invoke(c.renderBegin, request), renderCommit: request => invoke(c.renderCommit, request),
    renderDiscard: temporaryPath => invoke(c.renderDiscard, { temporaryPath }), renderRemove: request => invoke(c.renderRemove, request),
    hardwareCapabilities: () => invoke(c.hardware), detectHardwareCapabilities: encode => invoke(c.detectHardware, { encode }),
  }
}
