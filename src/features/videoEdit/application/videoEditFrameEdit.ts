import { createLogger } from '@/core/logging'
import { offerImageEditorHandoff } from '@/features/imageEdit/store/imageEditorHandoffStore'
import { openApplicationSurface } from '@/features/navigation/application/surfaceNavigationService'
import { observeVideoEditFrame } from './videoEditFrameObservation'
import { captureVideoEditSendTarget } from './videoEditResultSend'
import { assertVideoEditResultTarget, type VideoEditResultTarget } from './videoEditResultTarget'
import { requireVideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.frameEdit')
export interface VideoEditImageReturn { target: VideoEditResultTarget; label: string; assetRef: { kind: 'asset'; id: string } }
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
  const bound = captureVideoEditSendTarget({ mediaKind: 'image', mode: 'add', above: true, duration: 1 }, projectId)
  const owner = requireVideoEditInstance(projectId)
  const output = await observeVideoEditFrame(projectId, { kind: 'program', sequenceId: bound.target.sequenceId, frame: owner.frame }, null, signal)
  assertVideoEditResultTarget(bound.target, signal)
  const sessionRef = `video-edit-frame:${crypto.randomUUID()}`
  returns.delete(sessionRef); returns.set(sessionRef, { ...bound, assetRef: { kind: 'asset', id: output.asset.id } })
  while (returns.size > RETURN_LIMIT) returns.delete(returns.keys().next().value!)
  offerImageEditorHandoff({ sessionRef, sourceUrl: output.asset.filePath, sourceName: output.asset.displayName })
  openApplicationSurface('tool.image_edit')
  logger.info('节目帧已交给图片编辑', { event: 'video_edit.frame_edit.opened', context: { projectId, assetId: output.asset.id } })
  return sessionRef
}
