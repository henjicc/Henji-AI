import type { VideoEditTrackMethod, VideoEditTrackPrompt } from '@/core/videoEdit/tracking'
import type { TrackingCandidates } from '@/platform/contracts/tracking'

/** View-only selection and creation gesture; persisted definitions live exclusively in clip.trackers. */
export interface VideoEditTrackingEditing {
  projectId: string
  sequenceId: string
  clipId: string
  trackerId?: string
  method: VideoEditTrackMethod
  mode: 'point' | 'box' | 'quad' | 'show'
  pointCount?: number
  candidates?: { result: TrackingCandidates; prompt: VideoEditTrackPrompt; preview: number; document: object; frame: number }
}
export { getVideoEditTrackingEditing, videoEditTrackingEditingRevision, subscribeVideoEditTrackingEditing, setVideoEditTrackingEditing } from './videoEditMonitorEditing'
