import type { VideoEditMaskEditingTarget } from './videoEditMaskEditing'
import type { VideoEditTrackingEditing } from './videoEditTrackingEditing'

/** 两种监视器编辑模式共享互斥状态；领域包装模块之间只有类型依赖。 */
let maskCurrent: VideoEditMaskEditingTarget | null = null
let maskRevision = 0
const maskListeners = new Set<() => void>()

let trackingCurrent: VideoEditTrackingEditing | null = null
let trackingRevision = 0
const trackingListeners = new Set<() => void>()
export const getVideoEditTrackingEditing = (): VideoEditTrackingEditing | null => trackingCurrent
export const videoEditTrackingEditingRevision = (): number => trackingRevision
export function subscribeVideoEditTrackingEditing(listener: () => void): () => void { trackingListeners.add(listener); return () => { trackingListeners.delete(listener) } }
export function setVideoEditTrackingEditing(next: VideoEditTrackingEditing | null): void {
  if (next) setVideoEditMaskEditing(null)
  trackingCurrent = next; trackingRevision++; for (const listener of trackingListeners) listener()
}

export function getVideoEditMaskEditing(): VideoEditMaskEditingTarget | null { return maskCurrent }
export function videoEditMaskEditingRevision(): number { return maskRevision }
export function subscribeVideoEditMaskEditing(listener: () => void): () => void { maskListeners.add(listener); return () => { maskListeners.delete(listener) } }
export function setVideoEditMaskEditing(target: VideoEditMaskEditingTarget | null): void {
  if (target) setVideoEditTrackingEditing(null)
  if (JSON.stringify(target) === JSON.stringify(maskCurrent)) return
  maskCurrent = target; maskRevision++
  for (const listener of maskListeners) listener()
}
