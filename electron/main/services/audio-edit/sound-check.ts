import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import { DEFAULT_AUDIO_EDIT_SETTINGS } from '../../../../src/core/audioEdit/edits'
import { summarizeAudioEditSound, type AudioEditSoundCheck, type AudioEditSoundCheckRequest, type AudioEditSoundStats } from '../../../../src/core/audioEdit/soundCheck'
import { createMainLogger } from '../logging'
import { measureAudioFileLoudnessTimeline } from '../audio/loudness'
import { runAudioEditEffectsWorker } from './effects-worker-client'
import { renderAudioEditProject } from './render'

const logger = createMainLogger('main.audio_edit.sound_check')
const DEFAULT_WINDOW_SECONDS = 10

/**
 * 口播成品“现在听起来怎样”：渲染剪好的整条声音（和导出的 WAV 同一份，缓存可复用），
 * 响度时间线交给 FFmpeg 子进程、采样级统计交给效果工作线程，两者并行，主进程只做汇总。
 */
export async function checkAudioEditSound(project: AudioEditProjectDocument, request: Omit<AudioEditSoundCheckRequest, 'projectId' | 'requestId'>, signal: AbortSignal): Promise<AudioEditSoundCheck> {
  const started = performance.now()
  logger.info('开始读回口播声音', { event: 'audio_edit.sound_check.start', context: { projectId: project.id, revision: project.revision, range: request.startSeconds !== undefined || request.endSeconds !== undefined } })
  try {
    const rendered = await renderAudioEditProject(project, signal)
    const rate = rendered.sampleRate
    const startFrame = Math.min(rendered.durationFrames, Math.round((request.startSeconds ?? 0) * rate))
    const endFrame = Math.min(rendered.durationFrames, request.endSeconds === undefined ? rendered.durationFrames : Math.round(request.endSeconds * rate))
    if (endFrame - startFrame < rate * 0.1) throw new Error(`测量范围不到 0.1 秒：剪后作品共 ${(rendered.durationFrames / rate).toFixed(2)} 秒，请给 startSeconds < endSeconds 且在这之内。`)
    const [loudness, stats] = await Promise.all([
      measureAudioFileLoudnessTimeline(rendered.audioPath, startFrame, endFrame - startFrame, rate, signal),
      runAudioEditEffectsWorker({ kind: 'sound-stats', input: rendered.audioPath, startFrame, endFrame }, signal) as Promise<AudioEditSoundStats>,
    ])
    const settings = project.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
    const loudnessOutput = project.output?.loudness
    const result = summarizeAudioEditSound(stats, { integratedLufs: loudness.measurement.integratedLufs, loudnessRangeLu: loudness.loudnessRangeLu, truePeakDbtp: loudness.measurement.truePeakDbtp, momentaryLufs: loudness.momentaryLufs }, {
      offsetSeconds: startFrame / rate, windowSeconds: request.windowSeconds ?? DEFAULT_WINDOW_SECONDS, longPauseSeconds: settings.silenceThresholdMs / 1000,
      includeWindows: request.includeWindows === true, ...(loudnessOutput?.enabled ? { targetLufs: loudnessOutput.targetLufs } : {}),
    })
    logger.info('口播声音读回完成', { event: 'audio_edit.sound_check.completed', context: { projectId: project.id, elapsedMs: Math.round(performance.now() - started), durationSeconds: result.durationSeconds, integratedLufs: result.loudness.integratedLufs, truePeakDbtp: result.loudness.truePeakDbtp, clipping: result.clipping.count, longPauses: result.silence.longPauseCount, noise: result.noise.rating, hum: result.noise.hum.status } })
    return result
  } catch (error) {
    logger.error('口播声音读回失败', { event: 'audio_edit.sound_check.failed', error, context: { projectId: project.id, elapsedMs: Math.round(performance.now() - started) } })
    throw error
  }
}
