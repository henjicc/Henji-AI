import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { AudioEditPreviewChunk, AudioEditPreviewChunkRequest } from '../../../../src/core/audioEdit/types'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { requireAudioEditProject } from './project-store'
import { processAudioEditVstChain } from './processors'

const MAX_PREVIEW_FRAMES = 48_000 * 4
const VST_CONTEXT_SECONDS = 0.75
const previewCache = new Map<string, AudioEditPreviewChunk>()

function decodeFloatPcm(binary: string, args: string[], maxBuffer: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { encoding: 'buffer', maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`预览音频解码失败：${error.message}\n${stderr.toString()}`))
        return
      }
      resolve(stdout)
    })
  })
}

export async function prepareAudioEditPreviewChunk(request: AudioEditPreviewChunkRequest): Promise<AudioEditPreviewChunk> {
  const project = requireAudioEditProject(request.projectId)
  const sourceStartFrame = Math.max(0, Math.min(project.source.durationFrames, Math.round(request.sourceStartFrame)))
  const requestedFrames = Math.max(1, Math.min(MAX_PREVIEW_FRAMES, Math.round(request.frameCount)))
  const frameCount = Math.min(requestedFrames, project.source.durationFrames - sourceStartFrame)
  if (frameCount <= 0) {
    return { sourceStartFrame, sourceEndFrame: sourceStartFrame, sampleRate: project.source.sampleRate, channels: project.source.channels, pcm: new ArrayBuffer(0) }
  }
  const ffmpeg = await loadFfmpegPath()
  if (project.vstEnabled) {
    const cacheKey = `${project.id}:${project.revision}:${sourceStartFrame}:${frameCount}`
    const cached = previewCache.get(cacheKey)
    if (cached) return cached
    const contextFrames = Math.round(project.source.sampleRate * VST_CONTEXT_SECONDS)
    const contextStart = Math.max(0, sourceStartFrame - contextFrames)
    const contextEnd = Math.min(project.source.durationFrames, sourceStartFrame + frameCount + contextFrames)
    const runId = crypto.randomUUID()
    const workingDirectory = path.dirname(project.source.audioPath)
    const rawPath = path.join(workingDirectory, `preview-${runId}-input.wav`)
    const temporaryPaths = [rawPath]
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(ffmpeg, [
          '-v', 'error', '-y', '-ss', (contextStart / project.source.sampleRate).toFixed(9),
          '-i', project.source.audioPath, '-t', ((contextEnd - contextStart) / project.source.sampleRate).toFixed(9),
          '-acodec', 'pcm_s16le', rawPath,
        ], { maxBuffer: 4 * 1024 * 1024 }, (error, _stdout, stderr) => {
          if (error) reject(new Error(`VST3 预览块准备失败：${error.message}\n${stderr}`))
          else resolve()
        })
      })
      const processed = await processAudioEditVstChain(rawPath, workingDirectory)
      temporaryPaths.push(...processed.temporaryPaths)
      const offsetFrames = sourceStartFrame - contextStart
      const pcm = await decodeFloatPcm(ffmpeg, [
        '-v', 'error', '-ss', (offsetFrames / project.source.sampleRate).toFixed(9),
        '-i', processed.outputPath, '-t', (frameCount / project.source.sampleRate).toFixed(9),
        '-f', 'f32le', '-acodec', 'pcm_f32le', '-ar', String(project.source.sampleRate),
        '-ac', String(project.source.channels), 'pipe:1',
      ], frameCount * project.source.channels * 4 + 1024 * 1024)
      const copied = new Uint8Array(pcm.byteLength)
      copied.set(pcm)
      const decodedFrames = Math.floor(copied.byteLength / 4 / project.source.channels)
      const chunk = {
        sourceStartFrame,
        sourceEndFrame: sourceStartFrame + decodedFrames,
        sampleRate: project.source.sampleRate,
        channels: project.source.channels,
        pcm: copied.buffer,
      }
      previewCache.set(cacheKey, chunk)
      while (previewCache.size > 24) previewCache.delete(previewCache.keys().next().value as string)
      return chunk
    } finally {
      await Promise.all(temporaryPaths.map((temporaryPath) => fs.rm(temporaryPath, { force: true }).catch(() => undefined)))
    }
  }
  const pcm = await decodeFloatPcm(ffmpeg, [
    '-v', 'error', '-ss', (sourceStartFrame / project.source.sampleRate).toFixed(9),
    '-i', project.source.audioPath, '-t', (frameCount / project.source.sampleRate).toFixed(9),
    '-f', 'f32le', '-acodec', 'pcm_f32le', '-ar', String(project.source.sampleRate),
    '-ac', String(project.source.channels), 'pipe:1',
  ], frameCount * project.source.channels * 4 + 1024 * 1024)
  const copied = new Uint8Array(pcm.byteLength)
  copied.set(pcm)
  const decodedFrames = Math.floor(copied.byteLength / 4 / project.source.channels)
  return {
    sourceStartFrame,
    sourceEndFrame: sourceStartFrame + decodedFrames,
    sampleRate: project.source.sampleRate,
    channels: project.source.channels,
    pcm: copied.buffer,
  }
}
