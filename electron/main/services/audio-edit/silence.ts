import type { AudioEditRange, AudioEditSilenceRequest, AudioEditSilenceResult, AudioEditSuggestion } from '../../../../src/core/audioEdit/types'
import { subtractRanges } from '../../../../src/core/audioEdit/edits'
import { requireAudioEditProject } from './project-store'
import { probeAudioEditImport, verifyAudioEditSource } from './media'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { runAudioEditProcess } from './process'
import { registerAudioEditTaskController, runAudioEditTask } from './task-store'
import { analyzeSpeechEnergy } from './speech-energy'

export async function detectAudioEditSilence(request: AudioEditSilenceRequest): Promise<AudioEditSilenceResult> {
  const requestId = request.requestId ?? crypto.randomUUID()
  const controller = new AbortController()
  const release = registerAudioEditTaskController(requestId, request.projectId ?? requestId, controller, true)
  try {
    const result = await detectRegisteredSilence({ ...request, requestId }, controller)
    controller.signal.throwIfAborted()
    return result
  } finally { release() }
}

async function detectRegisteredSilence(request: AudioEditSilenceRequest, controller: AbortController): Promise<AudioEditSilenceResult> {
  // Source-only analysis is read-only: no draft, transcript, or navigation side effect.
  const projectId = request.projectId ?? request.requestId ?? crypto.randomUUID()
  const project = request.projectId !== undefined ? await requireAudioEditProject(request.projectId)
    : { id: projectId, revision: 0, source: await probeAudioEditImport(request.sourcePath, crypto.randomUUID(), controller.signal), transcript: [] }
  await verifyAudioEditSource(project, true, controller.signal)
  const settings = request.settings
  if (!(settings.noiseDb >= -80 && settings.noiseDb <= -10 && settings.silenceThresholdMs >= 100 && settings.silenceThresholdMs <= 10000
    && settings.retainedSilenceMs >= 0 && settings.retainedSilenceMs < settings.silenceThresholdMs)) throw new Error('停顿参数无效：保留时长必须小于检测时长。')
  return runAudioEditTask(projectId, 'silence', async (signal, progress) => {
    const intervals: AudioEditRange[] = []
    let start: number | undefined
    const energy = request.energy ? await analyzeSpeechEnergy(project.source, request.energy, signal, progress, () => verifyAudioEditSource(project, true, signal)) : undefined
    if (energy) intervals.push(...energy.pauses.map(pause => ({ startFrame: Math.ceil(pause.startMs * project.source.sampleRate / 1000), endFrame: Math.floor(pause.endMs * project.source.sampleRate / 1000) })))
    else await runAudioEditProcess(await loadFfmpegPath(), ['-hide_banner', '-nostats', '-i', project.source.audioPath,
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
    await verifyAudioEditSource(project, true, signal)
    return { revision: project.revision, suggestions, ...(energy ? { energy } : {}) }
  }, request.requestId, JSON.stringify([project.revision, project.source.identity, settings, request.range, request.energy]), true, controller)
}
