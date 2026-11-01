import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { createLogger } from '@/core/logging'
import { audibleVideoEditClips, videoEditComposition } from '@/core/videoEdit/document'
import { buildVideoEditTextTranscription, mergeVideoEditTextTranscription, resolveVideoEditTextRanges, type VideoEditTextSelector, type VideoEditTextRange } from '@/core/videoEdit/textTranscript'
import { deleteVideoEditTextRanges, prepareVideoEditTextExcerpt, insertVideoEditTextRanges } from '@/core/videoEdit/textEdits'
import { createVideoEditTimelineMapping } from '@/core/videoEdit/timelineEdits'
import { copyVideoEditSequence } from '@/core/videoEdit/sequenceCopy'
import { DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import { getPlatform } from '@/platform/runtime'
import { loadAudioEditProject } from '@/features/audioEdit/application/audioEditProjectInstances'
import { videoEditSubtitleSequenceSignatureMatches } from './videoEditAutoSubtitles'
import { readVideoEditSubtitleManifest } from './videoEditSubtitleManifest'
import { editVideoProject, editVideoSequence, holdVideoEditActivity, requireVideoEditInstance, withVideoEditCurrentMetadata } from './videoEditService'
import { propagateVideoEditSpatialFields } from './videoEditSpatialPropagation'
import { withVideoEditCodeMetadata, readVideoEditCodeMetadata } from './videoEditCodeState'
import { resolveVideoEditTranscriptMatch } from './videoEditTranscriptQuery'
import { verifyVideoEditSpeechMediaContent } from '../videoEditMediaContent'

const logger = createLogger('features.videoEdit.textEditing')
export async function hasSavedVideoEditText(audioDocumentId: string): Promise<boolean> { return Boolean((await loadAudioEditProject(audioDocumentId)).document.transcript.length) }
export interface VideoEditTextEditResult { ranges: VideoEditTextRange[]; sequenceId: string; changed: boolean }
export async function editVideoEditText(projectId: string, sequenceId: string, selector: VideoEditTextSelector, action: 'delete' | 'extract' | 'insert', frame?: number, name?: string, baseline?: object, signal?: AbortSignal): Promise<VideoEditTextEditResult> {
  const owner = requireVideoEditInstance(projectId); const document = owner.document; const contentVersion = owner.contentVersion
  if (baseline && baseline !== document.sequences.find(sequence => sequence.id === sequenceId)) throw new Error('时间线已有修改，请重新选中文字。')
  const resolved = selector.kind === 'match' ? resolveVideoEditTranscriptMatch(projectId, sequenceId, selector.matchId) : selector
  const composition = videoEditComposition(document, sequenceId)
  const ranges = resolveVideoEditTextRanges(composition, resolved)
  if (!ranges.length) return { ranges, sequenceId, changed: false }
  logger.info('文本剪辑开始', { event: 'video_edit.text.edit.start', context: { projectId, sequenceId, action, count: ranges.length } })
  const release = holdVideoEditActivity(projectId, '核对并剪辑文字')
  try {
    const clips = composition.clips.filter(clip => ranges.some(range => clip.start < range.to && clip.start + clip.duration > range.from))
    await verifyVideoEditSpeechMediaContent(composition, clips, signal)
    if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('核对期间时间线已有修改，请重新选择文字。')
    const metadata = readVideoEditCodeMetadata(owner, document)
    let target = sequenceId
    const { candidate, mapping } = await withVideoEditCodeMetadata(() => {
      const mapping = createVideoEditTimelineMapping(sequenceId)
      let candidate = document
      if (action === 'delete') candidate = deleteVideoEditTextRanges(document, sequenceId, ranges, metadata, mapping)
      else if (action === 'insert') {
        if (frame === undefined) throw new Error('insert 必须指定插入帧。')
        candidate = insertVideoEditTextRanges(document, sequenceId, ranges, frame, metadata, mapping)
      } else {
        const excerpt = prepareVideoEditTextExcerpt(document, sequenceId, ranges, metadata, mapping)
        candidate = { ...document, sequences: document.sequences.map(sequence => sequence.id === sequenceId ? excerpt : sequence) }
      }
      return { candidate, mapping }
    })
    let planned = await propagateVideoEditSpatialFields(document, candidate, signal ?? new AbortController().signal, { clipMap: mapping.clipMap, sequenceTimeMap: mapping.clock.maps })
    if (action === 'extract') {
      const excerpt = copyVideoEditSequence(planned.sequences.find(sequence => sequence.id === sequenceId)!); excerpt.name = name ?? '文本摘选'; target = excerpt.id
      planned = { ...document, sequences: [...document.sequences, excerpt] }
    }
    await withVideoEditCodeMetadata(() => editVideoProject(projectId, current => {
      signal?.throwIfAborted()
      if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('文本剪辑规划期间时间线已有修改，请重新选择文字。')
      return withVideoEditCurrentMetadata(planned, current)
    }))
    logger.info('文本剪辑完成', { event: 'video_edit.text.edit.completed', context: { projectId, sequenceId, action, ranges } })
    return { ranges, sequenceId: target, changed: owner.contentVersion !== contentVersion }
  } catch (error) {
    if (signal?.aborted) logger.info('文本剪辑已取消', { event: 'video_edit.text.edit.cancelled', context: { projectId, sequenceId, action } })
    else logger.error('文本剪辑失败', error, { event: 'video_edit.text.edit.failed', context: { projectId, sequenceId, action } })
    throw error
  }
  finally { release() }
}

/** Recover paid ASR results without recognizing again. New manifests preserve the original mix clips. */
export async function restoreVideoEditText(projectId: string, sequenceId: string, audioDocumentId: string, detectSilence = false, signal?: AbortSignal): Promise<void> {
  const owner = requireVideoEditInstance(projectId); const snapshot = owner.document; const contentVersion = owner.contentVersion; const composition = videoEditComposition(snapshot, sequenceId)
  const release = holdVideoEditActivity(projectId, '整理转录稿')
  logger.info('整理转录稿开始', { event: 'video_edit.text.restore.start', context: { projectId, sequenceId, detectSilence } })
  let requestId = crypto.randomUUID()
  const cancel = (): void => { void getPlatform().audioEdit.cancelTask(requestId).catch(error => logger.warn('停顿检测取消失败', { event: 'video_edit.text.restore.cancel_failed', error })) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    signal?.throwIfAborted()
    await verifyVideoEditSpeechMediaContent(composition, audibleVideoEditClips(composition), signal)
    const known = composition.textTranscription?.audioDocumentIds ?? (composition.textTranscription ? [composition.textTranscription.audioDocumentId] : [])
    const documents = detectSilence && known.length ? known : [audioDocumentId]
    let textTranscription = composition.textTranscription
    for (const id of documents) {
      signal?.throwIfAborted()
      const audio = await loadAudioEditProject(id); const audioSnapshot = audio.document
      const manifest = await readVideoEditSubtitleManifest(`${audioSnapshot.source.sourcePath}.subtitle.json`)
      if (manifest.projectId !== projectId || manifest.sequenceId !== sequenceId && !known.includes(id)) throw new Error('此转录稿不属于目标序列。')
      if ((!manifest.soundClips || !manifest.soundIdentities) && !await videoEditSubtitleSequenceSignatureMatches(composition, manifest.signature)) throw new Error('旧转录没有保存原片段范围，剪辑已改变，请重新转录。')
      if (!audioSnapshot.transcript.length) throw new Error('上次识别尚未完成，请继续上次转录。')
      let project = audioSnapshot
      if (detectSilence) {
        signal?.throwIfAborted(); requestId = crypto.randomUUID()
        const result = await getPlatform().audioEdit.detectSilence({ projectId: id, settings: project.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS, requestId })
        if (result.revision !== audio.persistedRevision || audio.document !== audioSnapshot) throw new Error('口播文档已有修改，请重新检测停顿。')
        project = { ...project, suggestions: result.suggestions }
      }
      const incoming = buildVideoEditTextTranscription(composition, manifest.soundClips ?? audibleVideoEditClips(composition), project, manifest.startFrame, manifest.soundIdentities)
      textTranscription = mergeVideoEditTextTranscription(textTranscription, incoming, composition)
    }
    signal?.throwIfAborted()
    await verifyVideoEditSpeechMediaContent(composition, audibleVideoEditClips(composition), signal)
    if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('整理期间剪辑已有修改，请重新整理。')
    editVideoSequence(projectId, sequenceId, sequence => ({ ...sequence, textTranscription }))
    logger.info('整理转录稿完成', { event: 'video_edit.text.restore.completed', context: { projectId, sequenceId } })
  } catch (error) {
    if (signal?.aborted) logger.info('整理转录稿已取消', { event: 'video_edit.text.restore.cancelled', context: { projectId, sequenceId } })
    else logger.error('整理转录稿失败', error, { event: 'video_edit.text.restore.failed', context: { projectId, sequenceId } })
    throw error
  }
  finally { signal?.removeEventListener('abort', cancel); release() }
}
