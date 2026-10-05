import { WORK_ROOT_IPC_CHANNELS, type WorkRootMoveProgress, type WorkRootPlatform } from '../../src/platform/contracts/workRoot'

type NativeInvoke = <T>(channel: string, payload?: unknown) => Promise<T>
type Subscribe = (channel: string, listener: (payload: unknown) => void) => () => void

/** 作品目录桥：方法与 WorkRootPlatform 一一对应，通道表与主进程共用。 */
export function createWorkRootApi(invoke: NativeInvoke, subscribe: Subscribe): WorkRootPlatform {
  const c = WORK_ROOT_IPC_CHANNELS
  return {
    getInfo: () => invoke(c.getInfo),
    inspectTarget: (target) => invoke(c.inspectTarget, target),
    change: (target) => invoke(c.change, target),
    cancel: () => invoke(c.cancel),
    onProgress: (handler) => subscribe(c.progress, (payload) => handler(payload as WorkRootMoveProgress)),
    open: () => invoke(c.open),
    relaunch: () => invoke(c.relaunch),
  }
}
