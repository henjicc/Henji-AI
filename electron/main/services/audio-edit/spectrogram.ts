import fs from 'node:fs/promises'
import { audioEditSpectrogramRequestSchema, type AudioEditSpectrogramChunk, type AudioEditSpectrogramRequest } from '../../../../src/core/audioEdit/regions'
import { joinSpectrogramChunks, planSpectrogramTiles, spectrogramTileColumns, SPECTROGRAM_MAX_BYTES } from '../../../../src/core/audioEdit/spectrogramTiles'
import { audioEditCacheDirectory, identifyAudioEditSource, prepareAudioEditAudio, verifyAudioEditSource } from './media'
import { requireAudioEditProject } from './project-store'
import { audioRenderKey, cachedAudioFile } from './render-cache'
import { readSpectrogram, runSpectrogram } from './dsp-adapter'
import { runAudioEditTask } from './task-store'
import { prepareAudioEditRenderSource } from './render'

export function spectrogramTileKey(source: unknown, mode: string, edited: unknown, fftSize: number, hop: number, channel: number | undefined, tile: number): string {
  return audioRenderKey(['spectrogram-tile-v2', source, mode, edited, fftSize, hop, channel, tile])
}

/** 返回固定块对齐的连续范围，最多 8 MiB；长范围从 endFrame 继续。 */
export async function getAudioEditSpectrogram(raw: AudioEditSpectrogramRequest): Promise<AudioEditSpectrogramChunk> {
  const request = audioEditSpectrogramRequestSchema.parse(raw)
  const project = await requireAudioEditProject(request.projectId)
  const channels = request.channel === undefined ? project.source.channels : 1
  if (request.channel !== undefined && request.channel >= project.source.channels) throw new Error('频谱声道超出素材声道数')
  if (request.startFrame >= project.source.durationFrames) throw new Error('频谱开始位置超出音频')
  const hop = request.hop ?? request.fftSize / 4
  const columns = spectrogramTileColumns(channels, request.fftSize)
  const maxTiles = Math.max(1, Math.floor(SPECTROGRAM_MAX_BYTES / (columns * channels * (request.fftSize / 2 + 1))))
  const boundedEnd = Math.min(request.endFrame, (Math.floor(request.startFrame / (hop * columns)) + maxTiles) * hop * columns)
  const tiles = planSpectrogramTiles(request.startFrame, boundedEnd, project.source.durationFrames, hop, columns)
  const files = await runAudioEditTask(project.id, 'spectrogram', async signal => {
    await verifyAudioEditSource(project, false, signal)
    const identity = project.source.identity ?? await identifyAudioEditSource(project.source.sourcePath, signal)
    const edited = request.mode === 'edited' ? await prepareAudioEditRenderSource(project, project.vstEnabled, signal) : undefined
    const result: string[] = []
    for (const tile of tiles) {
      signal.throwIfAborted()
      const key = spectrogramTileKey([identity.digest, project.source.audioStreamIndex, project.source.sampleRate, channels, project.source.durationFrames], request.mode, edited, request.fftSize, hop, request.channel, tile.index)
      result.push(await cachedAudioFile(audioEditCacheDirectory(project.id), key, 'spectrum', async output => {
        await runSpectrogram(edited ?? await prepareAudioEditAudio(project, signal), output, { startFrame: tile.startFrame, endFrame: tile.endFrame, fftSize: request.fftSize, hop, channel: request.channel }, signal)
      }, signal))
    }
    return result
  }, request.requestId, JSON.stringify(['spectrogram-tile-v2', project.source, request.mode === 'edited' ? project.revision : undefined, request]), true)
  // 回执只存文件引用；IPC 保持 Uint8Array 契约，不做数组化或 base64 中转。
  return joinSpectrogramChunks(await Promise.all(files.map(async file => readSpectrogram(await fs.readFile(file)))))
}
