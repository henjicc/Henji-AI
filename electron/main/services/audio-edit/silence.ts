import type { AudioEditRange, AudioEditSilenceRequest, AudioEditSuggestion } from '../../../../src/core/audioEdit/types'
import { subtractRanges } from '../../../../src/core/audioEdit/edits'
import { requireAudioEditProject } from './project-store'
import { verifyAudioEditSource } from './media'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { runAudioEditProcess } from './process'
import { runAudioEditTask } from './task-store'

export async function detectAudioEditSilence(request: AudioEditSilenceRequest): Promise<{ revision: number; suggestions: AudioEditSuggestion[] }> {
  const project = requireAudioEditProject(request.projectId)
  await verifyAudioEditSource(project)
  const settings = request.settings
  if (!(settings.noiseDb >= -80 && settings.noiseDb <= -10 && settings.silenceThresholdMs >= 100 && settings.silenceThresholdMs <= 10000
    && settings.retainedSilenceMs >= 0 && settings.retainedSilenceMs < settings.silenceThresholdMs)) throw new Error('停顿参数无效：保留时长必须小于检测时长。')
  return runAudioEditTask(project.id, 'silence', async (signal, progress) => {
    const intervals: AudioEditRange[] = []
    let start: number | undefined
    await runAudioEditProcess(await loadFfmpegPath(), ['-hide_banner', '-nostats', '-i', project.source.audioPath,
      '-map', project.source.ownership === 'external' ? `0:${project.source.audioStreamIndex ?? 0}` : '0:a:0',
      '-af', `asetpts=PTS-STARTPTS,silencedetect=noise=${settings.noiseDb}dB:d=${settings.silenceThresholdMs / 1000}`, '-vn', '-f', 'null', '-'], signal, (line) => {
      const began = /silence_start: ([\d.e+-]+)/.exec(line)
      const ended = /silence_end: ([\d.e+-]+)/.exec(line)
      if (began) start = Math.max(0, Math.round(Number(began[1]) * project.source.sampleRate))
      if (ended && start !== undefined) {
        const endFrame = Math.min(project.source.durationFrames, Math.round(Number(ended[1]) * project.source.sampleRate))
        intervals.push({ startFrame: start, endFrame })
        progress(endFrame / project.source.durationFrames)
        start = undefined
      }
    })
    if (start !== undefined) intervals.push({ startFrame: start, endFrame: project.source.durationFrames })
    // ASR speech blocks are conservative exclusion zones, including unlocked speech.
    const safe = subtractRanges(intervals, project.transcript.filter((block) => block.included || block.locked))
    const threshold = settings.silenceThresholdMs * project.source.sampleRate / 1000
    const suggestions: AudioEditSuggestion[] = safe.filter((range) => range.endFrame - range.startFrame >= threshold
      && (settings.trimEdges || (range.startFrame > 0 && range.endFrame < project.source.durationFrames))
      && (!request.range || (range.startFrame >= request.range.startFrame && range.endFrame <= request.range.endFrame)))
      .map((range) => ({ ...range, id: `silence:${range.startFrame}:${range.endFrame}`, kind: 'long_silence', evidence: 'audio', title: '压缩停顿', detail: `保留 ${settings.retainedSilenceMs} 毫秒气口`, blockIds: [], confidence: 'high', status: 'pending' }))
    signal.throwIfAborted()
    await verifyAudioEditSource(project)
    return { revision: project.revision, suggestions }
  }, request.requestId, JSON.stringify([project.revision, project.source.identity, settings, request.range]))
}
