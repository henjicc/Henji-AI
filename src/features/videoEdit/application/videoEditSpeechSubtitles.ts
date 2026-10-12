import { withPaidOperation, transcriptionEstimatedCny } from '@/services/paidApproval'
import { buildSpeechSubtitles } from '@/core/videoEdit/speechSubtitles'
import type { SpeechTimings } from '@/core/media/speechTimings'
import { autoSubtitleOptionsSchema, type AutoSubtitleOptions } from '@/core/videoEdit/autoSubtitles'
import { readClipEnergyPauses } from './videoEditPauseMap'
import { readGenerationResultTimings } from '@/features/generation'
import { createAudioEditDraft, flushAudioEditProject, loadAudioEditProject, transcribeAudioEdit } from '@/features/audioEdit'
import { readTranscriptionFacts, TranscriptionFailure, type TranscriptionFacts } from '@/core/audioEdit/transcriptionFailure'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { appendAutoSubtitles } from './videoEditAutoSubtitles'
import { holdVideoEditActivity, requireVideoEditInstance, saveVideoEdit } from './videoEditService'

const logger = createLogger('features.videoEdit.speechSubtitles')
export async function generateClipSpeechSubtitles(projectId: string, sequenceId: string, clipId: string,
  options: AutoSubtitleOptions & { originalText?: string; audioDocumentId?: string; modelId?: string; language?: 'zh' | 'en'; timeSource?: 'auto' | 'native' },
  signal?: AbortSignal, requestId?: string) {
  const owner = requireVideoEditInstance(projectId)
  const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  const clip = sequence?.clips.find(value => value.id === clipId)
  const item = owner.document.items.find(value => value.id === clip?.itemId)
  const media = owner.document.media.find(value => value.id === item?.mediaId)
  if (!sequence || !clip || clip.kind !== 'audio' || !media) throw new ApplicationPreflightFailure('请选择目标序列中引用声音素材的音频片段。')
  const origin = media.creativeSource
  const originalText = options.originalText ?? (origin?.type === 'generation' ? origin.prompt : undefined)
  if (!originalText?.trim()) throw new ApplicationPreflightFailure('请提供这段声音的原文；此片段没有生成原文。')
  const fingerprint = JSON.stringify([sequence.frameRate, clip, media])
  const assertTarget = () => {
    signal?.throwIfAborted()
    const current = requireVideoEditInstance(projectId)
    const next = current.document.sequences.find(value => value.id === sequenceId)
    if (current !== owner || JSON.stringify([next?.frameRate, next?.clips.find(value => value.id === clipId), current.document.media.find(value => value.id === media.id)]) !== fingerprint) throw new Error('字幕准备期间原片段已改变，已阻止回填；识别结果保留。')
  }
  const release = holdVideoEditActivity(projectId, '原文字幕')
  let audioDocumentId: string | undefined
  let cancel: (() => void) | undefined
  let billing: TranscriptionFacts['billing'] = 'not_charged'
  let applied = false
  try {
    assertTarget()
    let timings = origin?.type === 'generation' ? (await readGenerationResultTimings(origin.recordId)).find(value => value.outputIndex === origin.outputIndex)?.timings : undefined
    let timingSource: 'native' | 'recognition' = 'native'
    if (!timings?.items.length) {
      if (options.timeSource === 'native') throw new ApplicationPreflightFailure('此生成结果没有原生时间戳；auto 模式可在确认识别费用后对齐原文。')
      timingSource = 'recognition'
      audioDocumentId = options.audioDocumentId
      const platform = getPlatform()
      let audio = audioDocumentId ? await loadAudioEditProject(audioDocumentId) : undefined
      if (audio && audio.document.source.sourcePath !== media.path) throw new ApplicationPreflightFailure('使用 clipRef 时不要传 prepare_video_edit_subtitle_audio 返回的混音文档；audioDocumentRef 只用于恢复 clipRef 模式上次返回的引用，且必须引用这段音频的同一原始素材。首次调用请省略 audioDocumentRef。')
      if (!audio?.document.transcript.length) {
        const source = audio?.document.source ?? await platform.audioEdit.probeSource(media.path)
        const prepared = await platform.audioEdit.preflightTranscription({ sourcePath: media.path, durationMs: source.durationFrames * 1000 / source.sampleRate, modelId: options.modelId, language: options.language, audioDocumentId })
        const transcribe = async (paidSignal?: AbortSignal) => {
        assertTarget()
        audio ??= await createAudioEditDraft(source, owner.session.documentMeta.container)
        audioDocumentId = audio.document.id
        await flushAudioEditProject(audioDocumentId)
        const transcriptionId = requestId ?? crypto.randomUUID()
        cancel = () => {
          // A resume can retain the original provider task's requestId.
          void platform.audioEdit.listTasks(audioDocumentId!).then(tasks => Promise.all(tasks.filter(task => task.state === 'running' || task.state === 'queued').map(task => platform.audioEdit.cancelTask(task.requestId))))
            .catch(error => logger.warn('原文字幕取消失败', { event: 'video_edit.speech_subtitles.cancel_failed', error }))
        }
        signal?.addEventListener('abort', cancel, { once: true })
        signal?.throwIfAborted()
        billing = 'unknown'
        await transcribeAudioEdit({ projectId: audioDocumentId, modelId: prepared.modelId, language: options.language, requestId: transcriptionId }, paidSignal, projectId)
        billing = 'completed'
        }
        if (prepared.requiresConfirmation) {
          await withPaidOperation({ category: 'recognition', documentId: projectId, estimatedCny: transcriptionEstimatedCny(prepared), title: '识别声音并对齐原文' }, transcribe, signal)
        } else {
          await transcribe(signal)
        }
      }
      if (!audio) throw new Error('没有可用的口播识别结果。')
      const sampleRate = audio.document.source.sampleRate
      timings = { granularity: audio.document.transcript.every(block => block.granularity === 'word') ? 'word' : 'sentence', items: audio.document.transcript.map(block => ({ text: block.text,
        startMs: block.startFrame * 1000 / sampleRate, endMs: block.endFrame * 1000 / sampleRate, ...(block.confidence === undefined ? {} : { confidence: block.confidence }) })) } satisfies SpeechTimings
    }
    assertTarget()
    const pauses = timings.granularity === 'word' ? [] : await readClipEnergyPauses(projectId, sequenceId, clipId, signal)
    const subtitles = await buildSpeechSubtitles(originalText, timings, clip, sequence.frameRate, autoSubtitleOptionsSchema.strip().parse(options), signal, pauses)
    assertTarget()
    appendAutoSubtitles(projectId, sequenceId, subtitles.map(value => value.caption))
    const created = new Map(requireVideoEditInstance(projectId).document.sequences.find(value => value.id === sequenceId)!.captions!.map(caption => [caption.id, caption]))
    subtitles.forEach(subtitle => { subtitle.caption = created.get(subtitle.caption.id)! })
    applied = true
    await saveVideoEdit(projectId)
    logger.info('原文字幕已保存', { event: 'video_edit.speech_subtitles.completed', requestId, context: { projectId, clipId, timingSource, count: subtitles.length } })
    return { subtitles, timingSource, audioDocumentId }
  } catch (error) {
    logger.error('原文字幕失败', { event: 'video_edit.speech_subtitles.failed', requestId, error, context: { projectId, clipId, audioDocumentId } })
    const facts = readTranscriptionFacts(error)
    throw new TranscriptionFailure(error, { billing: facts?.billing ?? billing, targetMutation: applied ? 'applied' : 'none', ...(audioDocumentId ? { audioDocumentId } : {}) })
  } finally { if (cancel) signal?.removeEventListener('abort', cancel); release() }
}
