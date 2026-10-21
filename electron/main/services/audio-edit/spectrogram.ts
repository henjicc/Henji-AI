import fs from 'node:fs/promises'
import { audioEditSpectrogramRequestSchema, type AudioEditSpectrogramChunk, type AudioEditSpectrogramRequest } from '../../../../src/core/audioEdit/regions'
import { audioEditCacheDirectory, identifyAudioEditSource, prepareAudioEditAudio, verifyAudioEditSource } from './media'
import { requireAudioEditProject } from './project-store'
import { audioRenderKey, cachedAudioFile } from './render-cache'
import { runSpectrogram } from './dsp-adapter'
import { runAudioEditTask } from './task-store'
import { prepareAudioEditRenderSource } from './render'

/** Returns at most 8 MiB of columns. Continue from endFrame for a long requested interval; a larger hop covers more time per chunk. */
export async function getAudioEditSpectrogram(raw: AudioEditSpectrogramRequest): Promise<AudioEditSpectrogramChunk> {
  const request = audioEditSpectrogramRequestSchema.parse(raw)
  const project = await requireAudioEditProject(request.projectId)
  const channels = request.channel === undefined ? project.source.channels : 1
  if (request.channel !== undefined && request.channel >= project.source.channels) throw new Error('频谱声道超出素材声道数')
  if (request.startFrame >= project.source.durationFrames) throw new Error('频谱开始位置超出音频')
  const hop = request.hop ?? request.fftSize / 4
  const maxFrames = Math.floor(8 * 1024 * 1024 / channels / (request.fftSize / 2 + 1)) * hop
  const endFrame = Math.min(request.endFrame, project.source.durationFrames, request.startFrame + maxFrames)
  const file = await runAudioEditTask(project.id, 'spectrogram', async signal => {
    await verifyAudioEditSource(project, false, signal)
    const identity = project.source.identity ?? await identifyAudioEditSource(project.source.sourcePath, signal)
    const edited = request.mode === 'edited' ? await prepareAudioEditRenderSource(project, project.vstEnabled, signal) : undefined
    const options = { startFrame: request.startFrame, endFrame, fftSize: request.fftSize, hop, channel: request.channel }
    const key = audioRenderKey(['spectrogram-v1', identity.digest, project.source.audioStreamIndex, edited, options])
    return cachedAudioFile(audioEditCacheDirectory(project.id), key, 'spectrum', async output => {
      await runSpectrogram(edited ?? await prepareAudioEditAudio(project, signal), output, options, signal)
    }, signal)
  }, request.requestId, JSON.stringify([project.source, request.mode === 'edited' ? project.revision : undefined, request]), true)
  // Persist only the cache reference in task receipts; typed arrays do not survive JSON replay.
  const cached = JSON.parse(await fs.readFile(file, 'utf8')) as Omit<AudioEditSpectrogramChunk, 'values'> & { values: string }
  return { ...cached, values: Uint8Array.from(Buffer.from(cached.values, 'base64')) }
}
