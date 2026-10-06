import { VIDEO_PROXY_CHANNELS, type VideoProxyPlatform } from '../../src/platform/contracts/videoProxy'
export function createVideoProxyApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>, subscribe: (channel: string, handler: (payload: unknown) => void) => () => void): VideoProxyPlatform {
  return { create: request => invoke(VIDEO_PROXY_CHANNELS.create, request), lookup: request => invoke(VIDEO_PROXY_CHANNELS.lookup, request), cancel: id => invoke(VIDEO_PROXY_CHANNELS.cancel, id), onProgress: handler => subscribe(VIDEO_PROXY_CHANNELS.progress, value => handler(value as { requestId: string; progress: number })) }
}
