import { SMART_REGIONS_IPC_CHANNELS, type SmartRegionProgressEvent, type SmartRegionsPlatform } from '../../src/platform/contracts/smartRegions'
import type { OcrPrivacyProgress } from '../../src/platform/contracts/ocrPrivacy'

type NativeInvoke = <T>(channel: string, payload?: unknown) => Promise<T>
type Subscribe = (channel: string, listener: (payload: unknown) => void) => () => void

/** 智能区域桥（任务 4.7d）：方法与 SmartRegionsPlatform 一一对应，通道表与主进程共用。 */
export function createSmartRegionsApi(invoke: NativeInvoke, subscribe: Subscribe): SmartRegionsPlatform {
  const c = SMART_REGIONS_IPC_CHANNELS
  return {
    detectSensitiveText: request => invoke(c.detectSensitiveText, request),
    cancelSensitiveText: requestId => invoke(c.cancelSensitiveText, { requestId }),
    onPrivacyProgress: handler => subscribe(c.privacyProgress, payload => handler(payload as OcrPrivacyProgress)),
    ensure: (request) => invoke(c.ensure, request),
    cancel: (request) => invoke(c.cancel, request),
    onProgress: (handler) => subscribe(c.progress, (payload) => handler(payload as SmartRegionProgressEvent)),
  }
}
