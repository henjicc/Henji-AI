import type { AudioCaptureFile, AudioCapturePlacement } from '@/core/audioCapture/contracts'
import { assertAudioEditSplicePosition, spliceAudioEditProject } from '@/core/audioEdit/splice'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { acceptAudioEditNativeResult, flushAudioEditProject, loadAudioEditProject, lockAudioEditRecording } from './audioEditProjectInstances'

const logger = createLogger('features.audioEdit.splice')

/** 人和助手共享的拼接入口；来源与所有帧编辑一次提交、一次撤销，并立即保存。 */
export async function insertAudioEditFile(projectId: string, sourcePath: string, startFrame: number, endFrame = startFrame, requestId: string = crypto.randomUUID(), alreadyLocked = false, resultId?: string): Promise<number> {
  const instance = await loadAudioEditProject(projectId)
  assertAudioEditSplicePosition(instance.document, startFrame, endFrame)
  const release = alreadyLocked ? () => undefined : lockAudioEditRecording(projectId)
  const version = instance.version
  logger.info('开始拼接音频', { event: 'audio_edit.splice.start', requestId, context: { projectId, startFrame, endFrame } })
  try {
    await flushAudioEditProject(projectId)
    const result = await getPlatform().audioEdit.splice({ projectId, sourcePath, startFrame, endFrame, requestId, resultId })
    const next = spliceAudioEditProject(instance.document, result.source, startFrame, endFrame, result.insertedFrames)
    acceptAudioEditNativeResult(projectId, next, version)
    await flushAudioEditProject(projectId)
    logger.info('音频拼接已保存', { event: 'audio_edit.splice.completed', requestId, context: { projectId } })
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
  return insertAudioEditFile(placement.projectId, file.outputPath, placement.startFrame, placement.endFrame, crypto.randomUUID(), alreadyLocked, placement.spliceId)
}

export async function prepareAudioEditTake(projectId: string, startFrame: number, endFrame: number): Promise<AudioCapturePlacement> {
  const instance = await loadAudioEditProject(projectId)
  await flushAudioEditProject(projectId)
  assertAudioEditSplicePosition(instance.document, startFrame, endFrame)
  return { projectId, startFrame, endFrame, revision: instance.persistedRevision, spliceId: crypto.randomUUID() }
}
