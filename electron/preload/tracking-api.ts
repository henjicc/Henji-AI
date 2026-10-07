import { TRACKING_IPC_CHANNELS, type TrackingPlatform, type TrackingProgressEvent, type TrackingFrameEvent } from '../../src/platform/contracts/tracking'

type NativeInvoke = <T>(channel: string, payload?: unknown) => Promise<T>
type Subscribe = (channel: string, listener: (payload: unknown) => void) => () => void

/** 跟踪桥（任务 4.10）：方法与 TrackingPlatform 一一对应，通道表与主进程共用。 */
export function createTrackingApi(invoke: NativeInvoke, subscribe: Subscribe): TrackingPlatform {
  const c = TRACKING_IPC_CHANNELS
  return {
    status: (definition) => invoke(c.status, definition),
    run: (definition, range, options) => invoke(c.run, { definition, range, options }),
    stop: (definition) => invoke(c.stop, definition),
    candidates: (request) => invoke(c.candidates, request),
    onProgress: (handler) => subscribe(c.progress, (payload) => handler(payload as TrackingProgressEvent)),
    onFrameRequest: handler => subscribe(c.frames, payload => handler(payload as TrackingFrameEvent)),
    replyFrames: reply => invoke(c.framesReply, reply),
  }
}
