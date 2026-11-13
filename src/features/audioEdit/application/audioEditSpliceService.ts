import type { AudioCaptureFile, AudioCapturePlacement } from '@/core/audioCapture/contracts'
import { assertAudioEditSplicePosition, spliceAudioEditProject } from '@/core/audioEdit/splice'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { acceptAudioEditNativeResult, flushAudioEditProject, loadAudioEditProject, lockAudioEditRecording } from './audioEditProjectInstances'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'
import { useAudioEditStore } from '../store/audioEditStore'

const logger = createLogger('features.audioEdit.splice')

/** 人和助手共享的拼接入口；来源与所有帧编辑一次提交、一次撤销，并立即保存。 */
export async function insertAudioEditFile(projectId: string, sourcePath: string, startFrame: number, endFrame = startFrame, requestId: string = crypto.randomUUID(), alreadyLocked = false, resultId?: string, matchRecordingLoudness = false): Promise<number> {
  const instance = await loadAudioEditProject(projectId)
  assertAudioEditSplicePosition(instance.document, startFrame, endFrame)
  const release = alreadyLocked ? () => undefined : lockAudioEditRecording(projectId)
  const version = instance.version
  logger.info('开始拼接音频', { event: 'audio_edit.splice.start', requestId, context: { projectId, startFrame, endFrame } })
  try {
    await flushAudioEditProject(projectId)
    const result = await getPlatform().audioEdit.splice({ projectId, sourcePath, startFrame, endFrame, requestId, resultId, matchRecordingLoudness })
    const next = spliceAudioEditProject(instance.document, result.source, startFrame, endFrame, result.insertedFrames)
    if (matchRecordingLoudness && result.recordingGainDb !== undefined) {
      next.gainRegions = [...(next.gainRegions ?? []), { id: crypto.randomUUID(), startFrame, endFrame: startFrame + result.insertedFrames, enabled: true, gainDb: result.recordingGainDb, fadeInFrames: 0, fadeOutFrames: 0 }]
    }
    acceptAudioEditNativeResult(projectId, next, version)
    await flushAudioEditProject(projectId)
    logger.info('音频拼接已保存', { event: 'audio_edit.splice.completed', requestId, context: { projectId, recordingGainDb: result.recordingGainDb } })
    return result.insertedFrames
  } catch (error) { logger.warn('音频拼接未完成，原录音保留', { event: 'audio_edit.splice.failed', requestId, error }); throw error }
  finally { release() }
}

/** 保存完成而恢复登记尚未清掉的崩溃窗口：读回结果文件引用，不能再拼一次。 */
export async function restoreAudioEditTake(file: AudioCaptureFile, alreadyLocked = false): Promise<number> {
  const placement = file.placement
  if (!placement) throw new Error('这段录音没有作品位置，请另存为新草稿')
  const instance = await loadAudioEditProject(placement.projectId)
  const current = instance.document.source.sourcePath.replaceAll('\\', '/')
  if (current.endsWith(`/${placement.spliceId}.wav`)) { await flushAudioEditProject(placement.projectId); return 0 }
  if (instance.persistedRevision !== placement.revision) throw new Error('原作品已发生后续编辑，请将这段录音另存为新草稿，避免覆盖修改')
  return insertAudioEditFile(placement.projectId, file.outputPath, placement.startFrame, placement.endFrame, crypto.randomUUID(), alreadyLocked, placement.spliceId, true)
}

/**
 * 录音默认从哪开始：当前播放头，夹在作品范围内。录音时播放头跟着走到这一段末尾，暂停后用户挪过就以挪后的为准；
 * 界面的“开始录音”“继续录音”与助手的 resume_audio_edit_recording 共用这一处。
 */
export function audioEditPlayheadFrame(durationFrames: number): number {
  return Math.max(0, Math.min(durationFrames, useAudioEditPlaybackStore.getState().sourceFrame))
}

/**
 * 助手“继续录音”的默认位置。播放头只属于音频编辑正显示的那份口播：显示的就是这份时与界面按钮一样取当前播放头，
 * 正在试听就先停下（界面按钮也是先停播放再录）；没显示这份时，接在刚拼回那一段的真实末尾（takeEnd，拼回后的坐标）。
 */
export function audioEditResumeFrame(documentId: string, durationFrames: number, takeEnd: number): number {
  if (useAudioEditStore.getState().project?.id !== documentId) return Math.max(0, Math.min(durationFrames, takeEnd))
  if (useAudioEditPlaybackStore.getState().playing) useAudioEditPlaybackStore.getState().setPlaying(false)
  return audioEditPlayheadFrame(durationFrames)
}

export async function prepareAudioEditTake(projectId: string, startFrame: number, endFrame: number): Promise<AudioCapturePlacement> {
  const instance = await loadAudioEditProject(projectId)
  await flushAudioEditProject(projectId)
  assertAudioEditSplicePosition(instance.document, startFrame, endFrame)
  return { projectId, startFrame, endFrame, revision: instance.persistedRevision, spliceId: crypto.randomUUID() }
}
