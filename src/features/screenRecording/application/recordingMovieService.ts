import { createLogger } from '@/core/logging'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { videoEditComposition, videoEditDocumentSchema } from '@/core/videoEdit/document'
import { recordingMovieRecipeSchema, type RecordingMovieRecipe } from '@/core/screenRecording/movie'
import { importVideoEditSources, openVideoEditDocument, saveVideoEdit, requireVideoEditInstance, verifyVideoEditSaved, holdVideoEditActivity, prepareVideoEditAudioGain } from '@/features/videoEdit'
import { analyzeRecording, readRecordingUnderstanding, assertRecordingEditable } from './recordingUnderstandingService'
import { recordingMovieCursorSources } from './recordingMovieSources'
import { buildRecordingMoviePlan, type RecordingMoviePlan } from './recordingMoviePlan'
import { applyRecordingMovieAttention } from './recordingMovieAttention'

const logger = createLogger('features.screenRecording.movie')
const running = new Set<string>()
export interface RecordingMovieOptions { documentId: string; sequenceId?: string; recipe: RecordingMovieRecipe }
export interface RecordingMovieResult { documentId: string; sequenceIds: string[]; warnings: string[]; verified: boolean }
/** UI and public capabilities share this service. Everything is prepared on the import draft, then committed once. */
export async function generateRecordingMovie(sessionId: string, options: RecordingMovieOptions, signal: AbortSignal, progress?: (phase: 'analyzing' | 'preparing' | 'attention' | 'audio' | 'saving') => void): Promise<RecordingMovieResult> {
  if (running.has(options.documentId)) throw new Error('目标剪辑正在生成成片，请等待或取消后重试。')
  const recipe = recordingMovieRecipeSchema.parse(options.recipe)
  running.add(options.documentId)
  let release: (() => void) | undefined
  logger.info('开始生成录制成片', { event: 'recording.movie.start', context: { sessionId, documentId: options.documentId, formats: recipe.formats } })
  try {
    signal.throwIfAborted()
    const read = await readRecordingUnderstanding(sessionId), recording = read.content
    assertRecordingEditable(recording)
    const owner = await openVideoEditDocument({ id: options.documentId }, { focus: false })
    const version = owner.contentVersion
    release = holdVideoEditActivity(options.documentId, '录制成片')
    const current = (): void => { signal.throwIfAborted(); if (requireVideoEditInstance(options.documentId) !== owner || owner.contentVersion !== version || owner.session.isEnded) throw new Error('生成期间目标剪辑已改变，请重新生成。') }
    let understanding = recording.understanding
    if (!understanding.steps.length) { progress?.('analyzing'); understanding = (await analyzeRecording(sessionId, { transcribe: false, detectVisuals: true }, signal)).understanding }
    current(); progress?.('preparing')
    const cursors = await recordingMovieCursorSources(recording, signal)
    const warnings = [...understanding.warnings]
    if (!cursors.size && (recipe.cursor || recipe.attention !== 'off')) warnings.push('没有操作日志，保留原画面，未生成光标或推近。')
    if (recipe.captions && !understanding.transcript.length) warnings.push('尚无文字稿，未生成字幕；可先理解录制并开启转写，再重新生成。')
    let plan: RecordingMoviePlan | undefined
    await importVideoEditSources(options.documentId, recording.media.filter(v => v.durationUs > 0).map(v => ({ path: v.path })), undefined, signal, async draft => {
      current()
      for (const source of recording.media) {
        const cursor = cursors.get(source.id)
        const media = draft.media.find(v => v.path.replaceAll('\\', '/') === source.path.replaceAll('\\', '/'))
        if (cursor && media) media.recordingCursor = cursor
        if (media) media.creativeSource = { type: 'document', docRef: { docId: sessionId, path: read.meta.path }, revision: read.meta.revision }
      }
      plan = buildRecordingMoviePlan(draft, recording, understanding, recipe, read.meta.name, options.sequenceId)
      if (recipe.attention !== 'off' && cursors.size) {
        progress?.('attention')
        await applyRecordingMovieAttention(draft, plan.screenSequenceIds, recipe.attention, signal, current)
      }
      if (recipe.normalizeAudio) {
        progress?.('audio')
        // Every aspect uses the same timing/audio. Analyze once, copy only the resulting gains.
        const first = draft.sequences.find(v => v.id === plan!.sequenceIds[0])!
        const clips = first.clips.filter(v => v.kind === 'audio')
        if (clips.length) {
          const gains = await prepareVideoEditAudioGain(videoEditComposition(draft, first.id), clips, 'loudness', -16, signal, current, true)
          if (gains.some(v => v.measurement?.integratedLufs === null)) warnings.push('部分声音低于响度测量门限，已保留原音量。')
          for (const id of plan.sequenceIds) {
            const audio = draft.sequences.find(v => v.id === id)!.clips.filter(v => v.kind === 'audio')
            audio.forEach((clip, index) => { clip.volume = gains[index].volume })
          }
        }
      }
      current()
      if ((await readRecordingUnderstanding(sessionId)).meta.revision !== read.meta.revision) throw new Error('生成期间录制会话已修改，请重新生成。')
      return videoEditDocumentSchema.parse(draft)
    })
    const expected = owner.document, savedVersion = owner.contentVersion
    progress?.('saving')
    try { await saveVideoEdit(options.documentId) } catch (error) {
      throw new ApplicationPersistenceFailure('成片已生成但尚未保存，请重试保存剪辑，不要重复生成。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: { kind: 'video_edit.document', id: options.documentId }, replayMutation: false } }, error)
    }
    const verified = await verifyVideoEditSaved(options.documentId, expected, { contentOnly: true }) && owner.contentVersion === savedVersion
    logger.info('录制成片已生成', { event: 'recording.movie.completed', context: { sessionId, documentId: options.documentId, sequences: plan!.sequenceIds.length, verified } })
    return { documentId: options.documentId, sequenceIds: plan!.sequenceIds, warnings, verified }
  } catch (error) { logger.error('录制成片未完成', error, { event: signal.aborted ? 'recording.movie.cancelled' : 'recording.movie.failed', context: { sessionId, documentId: options.documentId } }); throw error }
  finally { release?.(); running.delete(options.documentId) }
}
