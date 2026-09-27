import { execFile } from 'node:child_process'
import type { AudioEditPreviewChunk, AudioEditPreviewChunkRequest } from '../../../../src/core/audioEdit/types'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { requireAudioEditProject } from './project-store'
import { prepareAudioEditProcessedAudio } from './processors'
import { prepareAudioEditAudio } from './media'

export async function prepareAudioEditPreviewChunk(request: AudioEditPreviewChunkRequest): Promise<AudioEditPreviewChunk> {
  const project = requireAudioEditProject(request.projectId)
  const sourceStartFrame = Math.max(0, Math.min(project.source.durationFrames, Math.round(request.sourceStartFrame)))
  const frameCount = Math.min(Math.max(1, Math.round(request.frameCount)), project.source.sampleRate * 4, project.source.durationFrames - sourceStartFrame)
  if (frameCount <= 0) return { sourceStartFrame, sourceEndFrame: sourceStartFrame, sampleRate: project.source.sampleRate, channels: project.source.channels, pcm: new ArrayBuffer(0) }
  const source = (request.processing ?? project.vstEnabled) ? await prepareAudioEditProcessedAudio(project) : await prepareAudioEditAudio(project)
  const binary = await loadFfmpegPath()
  const pcm = await new Promise<Buffer>((resolve, reject) => {
    execFile(binary, ['-v', 'error', '-ss', (sourceStartFrame / project.source.sampleRate).toFixed(9), '-i', source, '-t', (frameCount / project.source.sampleRate).toFixed(9),
      '-f', 'f32le', '-acodec', 'pcm_f32le', '-ar', String(project.source.sampleRate), '-ac', String(project.source.channels), 'pipe:1'],
    { encoding: 'buffer', windowsHide: true, maxBuffer: frameCount * project.source.channels * 4 + 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout))
  })
  const copied = new Uint8Array(pcm.byteLength)
  copied.set(pcm)
  return { sourceStartFrame, sourceEndFrame: sourceStartFrame + Math.floor(pcm.byteLength / 4 / project.source.channels), sampleRate: project.source.sampleRate, channels: project.source.channels, pcm: copied.buffer }
}
