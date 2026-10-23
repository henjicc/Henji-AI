import { z } from 'zod'
import { defaultDocumentOperationChanges } from '@/features/documents'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { videoEditComposition, videoEditDocumentSchema } from '@/core/videoEdit/document'
import { videoEditClipSourceSecondsAt } from '@/core/videoEdit/clipSpeed'
import { recordingRedubTarget, redubExtension, replaceRecordingNarration } from '@/core/screenRecording/redub'
import type { RecordingVoice } from '@/core/screenRecording/director'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { openVideoEditDocument, importVideoEditSources, requireVideoEditInstance, holdVideoEditActivity, saveVideoEdit, verifyVideoEditSaved, prepareVideoEditAudioGain, measureVideoEditClips, observeVideoEditFrame } from '@/features/videoEdit'
import { readRecordingUnderstanding } from './recordingUnderstandingService'
import { generateRecordingNarration, narrationIdentity } from './recordingNarration'
import { replaySession } from './recordingReplayService'

const logger = createLogger('features.screenRecording.redub')
const running = new Set<string>()
export interface RecordingRedubOptions { documentId: string; clipId: string; text: string; voice?: RecordingVoice; rerecord: boolean }
export async function redubRecordingSentence(sessionId: string, options: RecordingRedubOptions, context: CapabilityExecutionContext): Promise<{ verified: boolean; clipId: string; sequenceId: string; undoSteps: number }> {
  if (running.has(options.documentId)) throw new Error('该剪辑正在补录旁白。')
  const { signal } = context
  signal.throwIfAborted()
  const read = await readRecordingUnderstanding(sessionId)
  const owner = await openVideoEditDocument({ id: options.documentId }, { focus: false })
  let target = recordingRedubTarget(owner.document, options.clipId), version = owner.contentVersion
  const clip = owner.document.sequences.find(v => v.id === target.sequenceId)!.clips.find(v => v.id === target.clipId)!
  if (clip.creativeSource?.type !== 'document' || clip.creativeSource.docRef.docId !== sessionId) throw new Error('旁白不属于所选录制会话。')
  const transcriptId = clip.creativeSource.part!.slice('recording-narration:'.length)
  const step = read.content.understanding.operationScript.steps.find(v => v.narrationIds.includes(transcriptId))
  const voice = options.voice ?? read.content.understanding.director?.voice
  if (!voice) throw new Error('请选择配音模型和音色。')
  if (options.rerecord && (!step || step.blockedReason)) throw new Error('这句话没有可重录的操作步骤，请只重新配音。')
  running.add(options.documentId)
  const release = holdVideoEditActivity(options.documentId, '旁白补录')
  const current = () => { signal.throwIfAborted(); if (owner.session.isEnded || requireVideoEditInstance(options.documentId) !== owner || owner.contentVersion !== version) throw new Error('配音期间时间线已修改，新配音已保留，未覆盖现有编辑。') }
  logger.info('开始补录旁白', { event: 'recording.redub.start', context: { sessionId, documentId: options.documentId, clipId: options.clipId } })
  try {
    const run = read.content.directorRun ??= { takes: [] }, identity = narrationIdentity(options.text, voice)
    run.redubs ??= []
    let take = run.redubs.find(v => v.clipId === options.clipId && v.documentId === options.documentId && v.identity === identity)
    if (!take) { take = { clipId: options.clipId, documentId: options.documentId, identity }; run.redubs.push(take) }
    let revision = read.meta.revision
    const saveReceipt = async () => { const saved = await getPlatform().documents.saveDocument({ target: { id: sessionId }, expectedRevision: revision, content: read.content }); revision = saved.meta.revision; defaultDocumentOperationChanges.changed(); context.execution?.report({ targetMutation: 'applied' }) }
    const entry = take
    const audio = take.path && take.durationUs ? { path: take.path, durationUs: take.durationUs } : await generateRecordingNarration(options.text, voice, options.documentId, context, { taskId: take.taskId, dispatched: async taskId => { entry.taskId = taskId; await saveReceipt() } })
    Object.assign(take, audio); await saveReceipt(); current()
    if (options.rerecord) {
      await replaySession(sessionId, { stepId: step!.id, destinationId: options.documentId, sourceId: z.string().parse(await getPlatform().screenRecording.capture({ operation: 'application-source', sessionId })) }, context)
      version = owner.contentVersion; target = recordingRedubTarget(owner.document, options.clipId)
    }
    const measurement = (await measureVideoEditClips({ projectId: options.documentId, sequenceId: target.sequenceId, clipIds: [target.clipId] }, signal))[0]
    const targetLufs = measurement.integratedLufs ?? -16
    current()
    const extension = redubExtension(target, audio.durationUs)
    let stillPath: string | undefined
    if (extension.hold && !target.holdId) {
      const sequence = owner.document.sequences.find(v => v.id === target.sequenceId)!, picture = sequence.clips.find(v => v.id === target.pictureId)!
      const item = owner.document.items.find(v => v.id === picture.itemId)!
      if (!item.sequenceId) throw new Error('画面来源不可读，请先恢复录制成片。')
      const screen = owner.document.sequences.find(v => v.id === item.sequenceId)!, fps = screen.frameRate.numerator / screen.frameRate.denominator
      const frame = Math.floor(videoEditClipSourceSecondsAt(picture, target.end - 1, target.fps) * fps)
      const image = await observeVideoEditFrame(options.documentId, { kind: 'program', sequenceId: screen.id, frame }, null, signal, { ...videoEditComposition(owner.document, screen.id), captions: [] })
      stillPath = image.asset.filePath; current()
    }
    await importVideoEditSources(options.documentId, [{ path: audio.path }, ...(stillPath ? [{ path: stillPath }] : [])], undefined, signal, async draft => {
      current()
      const pathKey = (path: string) => path.replaceAll('\\', '/')
      const media = draft.media.find(v => pathKey(v.path) === pathKey(audio.path))!
      const still = stillPath ? draft.media.find(v => pathKey(v.path) === pathKey(stillPath!)) : undefined
      const changed = replaceRecordingNarration(draft, target, media, options.text, still)
      const gain = await prepareVideoEditAudioGain(videoEditComposition(draft, target.sequenceId), [changed], 'loudness', targetLufs, signal, current, true)
      changed.gainDb = gain[0].gainDb
      current()
      return videoEditDocumentSchema.parse(draft)
    })
    context.execution?.report({ targetMutation: 'applied' })
    const expected = owner.document
    try { await saveVideoEdit(options.documentId) } catch (error) { throw new ApplicationPersistenceFailure('旁白已替换但尚未保存，请重试保存剪辑，不要重新配音。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: { kind: 'video_edit.document', id: options.documentId }, replayMutation: false } }, error) }
    const verified = await verifyVideoEditSaved(options.documentId, expected, { contentOnly: true })
    logger.info('旁白补录完成', { event: 'recording.redub.completed', context: { sessionId, documentId: options.documentId, clipId: options.clipId, extraFrames: extension.extra, hold: extension.hold, verified } })
    return { verified, clipId: options.clipId, sequenceId: target.sequenceId, undoSteps: options.rerecord ? 2 : 1 }
  } catch (error) { logger.error('旁白补录未完成', error, { event: signal.aborted ? 'recording.redub.cancelled' : 'recording.redub.failed', context: { sessionId, documentId: options.documentId } }); throw error }
  finally { release(); running.delete(options.documentId) }
}
