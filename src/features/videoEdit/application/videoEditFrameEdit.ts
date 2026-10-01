import { createLogger } from '@/core/logging'
import { offerImageEditorHandoff } from '@/features/imageEdit/store/imageEditorHandoffStore'
import { openApplicationSurface } from '@/features/navigation/application/surfaceNavigationService'
import { captureVideoEditProgramFrame } from './videoEditProgramCapture'
import { captureVideoEditSendTarget } from './videoEditResultSend'
import type { VideoEditResultTarget } from './videoEditResultTarget'

const logger = createLogger('features.videoEdit.frameEdit')
export interface VideoEditImageReturn { target: VideoEditResultTarget; label: string }
const returns = new Map<string, VideoEditImageReturn>()
const RETURN_LIMIT = 16

/** The image editor asks by its handoff session; only frames opened from a program have a return. */
export function readVideoEditImageReturn(sessionRef: string | undefined): VideoEditImageReturn | undefined {
  return sessionRef ? returns.get(sessionRef) : undefined
}
/**
 * Program frame → existing V3 image editor. The return slot (above every picture at that frame)
 * is frozen before the frame is captured, so later page or selection changes cannot redirect it.
 */
export async function editVideoEditProgramFrame(projectId: string, signal?: AbortSignal): Promise<string | null> {
  const bound = captureVideoEditSendTarget({ mediaKind: 'image', mode: 'add', above: true }, projectId)
  const output = await captureVideoEditProgramFrame(projectId, undefined, undefined, signal)
  if (!output) return null
  const sessionRef = `video-edit-frame:${output.id}`
  returns.delete(sessionRef); returns.set(sessionRef, bound)
  while (returns.size > RETURN_LIMIT) returns.delete(returns.keys().next().value!)
  offerImageEditorHandoff({ sessionRef, sourceUrl: output.path, sourceName: output.path.split(/[/\\]/).at(-1) || 'frame.png' })
  openApplicationSurface('tool.image_edit')
  logger.info('节目帧已交给图片编辑', { event: 'video_edit.frame_edit.opened', context: { projectId, outputId: output.id } })
  return sessionRef
}
