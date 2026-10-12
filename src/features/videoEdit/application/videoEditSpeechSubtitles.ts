import { buildSpeechSubtitles } from '@/core/videoEdit/speechSubtitles'
import type { SpeechTimings } from '@/core/media/speechTimings'
import type { AutoSubtitleOptions } from '@/core/videoEdit/autoSubtitles'
import { readGenerationResultTimings } from '@/features/generation'
import { createAudioEditDraft, flushAudioEditProject, loadAudioEditProject, transcribeAudioEdit } from '@/features/audioEdit'
import { getPlatform } from '@/platform/runtime'
import { requestAlertConfirmation } from '@/stores/alertDialogStore'
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
      if (audio && audio.document.source.sourcePath !== media.path) throw new ApplicationPreflightFailure('恢复用口播文档必须引用这段音频的同一原始素材。')
      if (!audio?.document.transcript.length) {
        const accepted = await requestAlertConfirmation({ title: '识别声音并对齐原文', message: '这段声音没有原生时间戳。将使用已配置的语音识别模型获取时间，按该模型计费；字幕文字仍以原文为准。是否继续？', type: 'warning', confirmLabel: '确认识别费用' }, signal)
        if (!accepted) throw new ApplicationPreflightFailure('已取消识别，未生成字幕。')
        assertTarget()
        audio ??= await createAudioEditDraft(await platform.audioEdit.probeSource(media.path), owner.session.documentMeta.container)
        audioDocumentId = audio.document.id
        await flushAudioEditProject(audioDocumentId)
        const transcriptionId = requestId ?? crypto.randomUUID()
        cancel = () => { void platform.audioEdit.cancelTask(transcriptionId).catch(error => logger.warn('原文字幕取消失败', { event: 'video_edit.speech_subtitles.cancel_failed', error })) }
        signal?.addEventListener('abort', cancel, { once: true })
        signal?.throwIfAborted()
        await transcribeAudioEdit({ projectId: audioDocumentId, modelId: options.modelId, language: options.language, requestId: transcriptionId })
      }
      if (!audio) throw new Error('没有可用的口播识别结果。')
      timings = { granularity: audio.document.transcript.every(block => block.granularity === 'word') ? 'word' : 'sentence', items: audio.document.transcript.map(block => ({ text: block.text,
        startMs: block.startFrame * 1000 / audio.document.source.sampleRate, endMs: block.endFrame * 1000 / audio.document.source.sampleRate, ...(block.confidence === undefined ? {} : { confidence: block.confidence }) })) } satisfies SpeechTimings
    }
    assertTarget()
    const subtitles = await buildSpeechSubtitles(originalText, timings, clip, sequence.frameRate, { maxCharacters: options.maxCharacters, maxLines: options.maxLines, pauseSeconds: options.pauseSeconds, minDurationSeconds: options.minDurationSeconds }, signal)
    assertTarget()
    appendAutoSubtitles(projectId, sequenceId, subtitles.map(value => value.caption))
    await saveVideoEdit(projectId)
    logger.info('原文字幕已保存', { event: 'video_edit.speech_subtitles.completed', requestId, context: { projectId, clipId, timingSource, count: subtitles.length } })
    return { subtitles, timingSource, audioDocumentId }
  } catch (error) {
    logger.error('原文字幕失败', { event: 'video_edit.speech_subtitles.failed', requestId, error, context: { projectId, clipId, audioDocumentId } })
    if (audioDocumentId && error instanceof Error && !(error instanceof ApplicationPreflightFailure)) throw new Error(`${error.message} 恢复时复用 audioDocumentRef={"kind":"audio_edit.document","id":"${audioDocumentId}"}，不要另建识别任务。`, { cause: error })
    throw error
  } finally { if (cancel) signal?.removeEventListener('abort', cancel); release() }
}
