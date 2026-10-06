import { createLogger } from '@/core/logging'
import { audibleVideoEditClips, videoEditComposition } from '@/core/videoEdit/document'
import { buildVideoEditTextTranscription, mergeVideoEditTextTranscription, resolveVideoEditTextRanges, type VideoEditTextSelector, type VideoEditTextRange } from '@/core/videoEdit/textTranscript'
import { deleteVideoEditTextRanges, extractVideoEditTextRanges, insertVideoEditTextRanges } from '@/core/videoEdit/textEdits'
import { DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import { getPlatform } from '@/platform/runtime'
import { loadAudioEditProject } from '@/features/audioEdit/application/audioEditProjectInstances'
import { videoEditSubtitleManifestSchema, videoEditSubtitleSequenceSignature } from './videoEditAutoSubtitles'
import { editVideoProject, editVideoSequence, holdVideoEditActivity, requireVideoEditInstance } from './videoEditService'
import { readVideoEditCodeMetadata } from './videoEditCodeState'

const logger = createLogger('features.videoEdit.textEditing')
export async function hasSavedVideoEditText(audioDocumentId: string): Promise<boolean> { return Boolean((await loadAudioEditProject(audioDocumentId)).document.transcript.length) }
export interface VideoEditTextEditResult { ranges: VideoEditTextRange[]; sequenceId: string; changed: boolean }
export function editVideoEditText(projectId: string, sequenceId: string, selector: VideoEditTextSelector, action: 'delete' | 'extract' | 'insert', frame?: number, name?: string, baseline?: object): VideoEditTextEditResult {
  const owner = requireVideoEditInstance(projectId); const document = owner.document
  if (baseline && baseline !== document.sequences.find(sequence => sequence.id === sequenceId)) throw new Error('时间线已有修改，请重新选中文字。')
  const ranges = resolveVideoEditTextRanges(videoEditComposition(document, sequenceId), selector)
  if (!ranges.length) return { ranges, sequenceId, changed: false }
  logger.info('文本剪辑开始', { event: 'video_edit.text.edit.start', context: { projectId, sequenceId, action, count: ranges.length } })
  try {
    const metadata = readVideoEditCodeMetadata(owner, document)
    let target = sequenceId
    editVideoProject(projectId, snapshot => {
      if (action === 'delete') return deleteVideoEditTextRanges(snapshot, sequenceId, ranges, metadata)
      if (action === 'insert') {
        if (frame === undefined) throw new Error('insert 必须指定插入帧。')
        return insertVideoEditTextRanges(snapshot, sequenceId, ranges, frame, metadata)
      }
      const excerpt = extractVideoEditTextRanges(snapshot, sequenceId, ranges, name, metadata); target = excerpt.id
      return { ...snapshot, sequences: [...snapshot.sequences, excerpt] }
    })
    logger.info('文本剪辑完成', { event: 'video_edit.text.edit.completed', context: { projectId, sequenceId, action, ranges } })
    return { ranges, sequenceId: target, changed: owner.document !== document }
  } catch (error) { logger.error('文本剪辑失败', { event: 'video_edit.text.edit.failed', error, context: { projectId, sequenceId, action } }); throw error }
}

/** Recover paid ASR results without recognizing again. New manifests preserve the original mix clips. */
export async function restoreVideoEditText(projectId: string, sequenceId: string, audioDocumentId: string, detectSilence = false, signal?: AbortSignal): Promise<void> {
  const owner = requireVideoEditInstance(projectId); const snapshot = owner.document; const composition = videoEditComposition(snapshot, sequenceId)
  const release = holdVideoEditActivity(projectId, '整理转录稿')
  logger.info('整理转录稿开始', { event: 'video_edit.text.restore.start', context: { projectId, sequenceId, detectSilence } })
  let requestId = crypto.randomUUID()
  const cancel = (): void => { void getPlatform().audioEdit.cancelTask(requestId).catch(error => logger.warn('停顿检测取消失败', { event: 'video_edit.text.restore.cancel_failed', error })) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    signal?.throwIfAborted()
    const known = composition.textTranscription?.audioDocumentIds ?? (composition.textTranscription ? [composition.textTranscription.audioDocumentId] : [])
    const documents = detectSilence && known.length ? known : [audioDocumentId]
    let textTranscription = composition.textTranscription
    for (const id of documents) {
      signal?.throwIfAborted()
      const audio = await loadAudioEditProject(id); const audioSnapshot = audio.document
      const manifest = videoEditSubtitleManifestSchema.parse(JSON.parse(await getPlatform().system.fs.readTextFile(`${audioSnapshot.source.sourcePath}.subtitle.json`)))
      if (manifest.projectId !== projectId || manifest.sequenceId !== sequenceId && !known.includes(id)) throw new Error('此转录稿不属于目标序列。')
      if ((!manifest.soundClips || !manifest.soundIdentities) && await videoEditSubtitleSequenceSignature(composition) !== manifest.signature) throw new Error('旧转录没有保存原片段范围，剪辑已改变，请重新转录。')
      if (!audioSnapshot.transcript.length) throw new Error('上次识别尚未完成，请继续上次转录。')
      let project = audioSnapshot
      if (detectSilence) {
        signal?.throwIfAborted(); requestId = crypto.randomUUID()
        const result = await getPlatform().audioEdit.detectSilence({ projectId: id, settings: project.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS, requestId })
        if (result.revision !== audio.persistedRevision || audio.document !== audioSnapshot) throw new Error('口播文档已有修改，请重新检测停顿。')
        project = { ...project, suggestions: result.suggestions }
      }
      const incoming = buildVideoEditTextTranscription(composition, manifest.soundClips ?? audibleVideoEditClips(composition), project, manifest.startFrame, manifest.soundIdentities)
      textTranscription = mergeVideoEditTextTranscription(textTranscription, incoming)
    }
    signal?.throwIfAborted()
    if (requireVideoEditInstance(projectId) !== owner || owner.document !== snapshot) throw new Error('整理期间剪辑已有修改，请重新整理。')
    editVideoSequence(projectId, sequenceId, sequence => ({ ...sequence, textTranscription }))
    logger.info('整理转录稿完成', { event: 'video_edit.text.restore.completed', context: { projectId, sequenceId } })
  } catch (error) { logger.error('整理转录稿失败', { event: 'video_edit.text.restore.failed', error, context: { projectId, sequenceId } }); throw error }
  finally { signal?.removeEventListener('abort', cancel); release() }
}
