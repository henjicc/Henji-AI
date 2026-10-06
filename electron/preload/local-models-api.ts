import { LOCAL_MODELS_IPC_CHANNELS, type LocalModelProgressEvent, type LocalModelsPlatform } from '../../src/platform/contracts/localModels'

type NativeInvoke = <T>(channel: string, payload?: unknown) => Promise<T>
type Subscribe = (channel: string, listener: (payload: unknown) => void) => () => void

/** 本地模型桥：方法与 LocalModelsPlatform 一一对应，通道表与主进程共用。 */
export function createLocalModelsApi(invoke: NativeInvoke, subscribe: Subscribe): LocalModelsPlatform {
  const c = LOCAL_MODELS_IPC_CHANNELS
  return {
    getState: () => invoke(c.getState),
    ensure: (id) => invoke(c.ensure, { id }),
    cancel: (id) => invoke(c.cancel, { id }),
    remove: (id) => invoke(c.remove, { id }),
    openFolder: (id) => invoke(c.openFolder, { id }),
    getDownloadSource: () => invoke(c.getDownloadSource),
    setDownloadSource: (source) => invoke(c.setDownloadSource, { source }),
    onProgress: (handler) => subscribe(c.progress, (payload) => handler(payload as LocalModelProgressEvent)),
  }
}
