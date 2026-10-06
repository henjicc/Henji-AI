import type { VideoEditTrackMethod, VideoEditTrackPrompt } from '@/core/videoEdit/tracking'
import type { TrackingCandidates } from '@/platform/contracts/tracking'
import { setVideoEditMaskEditing } from './videoEditMaskEditing'

/** View-only selection and creation gesture; persisted definitions live exclusively in clip.trackers. */
export interface VideoEditTrackingEditing {
  projectId: string
  sequenceId: string
  clipId: string
  trackerId?: string
  method: VideoEditTrackMethod
  mode: 'point' | 'box' | 'show'
  candidates?: { result: TrackingCandidates; prompt: VideoEditTrackPrompt; preview: number; document: object; frame: number }
}
let current: VideoEditTrackingEditing | null = null
let revision = 0
const listeners = new Set<() => void>()
export const getVideoEditTrackingEditing = (): VideoEditTrackingEditing | null => current
export const videoEditTrackingEditingRevision = (): number => revision
export function subscribeVideoEditTrackingEditing(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function setVideoEditTrackingEditing(next: VideoEditTrackingEditing | null): void {
  if (next) setVideoEditMaskEditing(null)
  current = next; revision++; for (const listener of listeners) listener()
}
