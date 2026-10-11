import { rendererEpoch } from '@/core/application-control/runtimeIdentity'
import type { VideoEditInstance } from './videoEditService'

// 不落盘；同一渲染器内重开文档也会取得新的实例代次。
const instanceEpochs = new WeakMap<VideoEditInstance, string>()

/** 标识实际采样快照；只比较相等性，不跨宿主按数字修订号排序。 */
export function videoEditObservationVersion(owner: VideoEditInstance, revision: number): string {
  const instanceEpoch = instanceEpochs.get(owner) ?? crypto.randomUUID()
  instanceEpochs.set(owner, instanceEpoch)
  return `${rendererEpoch}:${instanceEpoch}:${revision}`
}
