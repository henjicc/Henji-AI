import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { AudioEditProjectCreateRequest, AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import { resolveLocalMediaPath } from '../media/shared'
import { getHenjiDataDir } from '../db'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { createMainLogger } from '../logging'
import { saveAudioEditProject } from './project-store'

const logger = createMainLogger('main.audio_edit')

interface AudioProbe {
  format?: { duration?: string }
  streams?: Array<{
    codec_type?: string
    sample_rate?: string
    channels?: number
  }>
}

function run(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${path.basename(binary)} failed: ${error.message}\n${stderr}`))
        return
      }
      resolve(stdout)
    })
  })
}

async function probeAudio(sourcePath: string): Promise<{ durationSeconds: number; sampleRate: number; channels: number; hasVideo: boolean }> {
  const ffprobe = await loadFfprobePath()
  const output = await run(ffprobe, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', sourcePath,
  ])
  const parsed = JSON.parse(output) as AudioProbe
  const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio')
  if (!audio) throw new Error('MEDIA_HAS_NO_AUDIO：所选文件没有可用音轨。')
  const durationSeconds = Number(parsed.format?.duration ?? 0)
  const sampleRate = Number(audio.sample_rate ?? 0)
  const channels = Number(audio.channels ?? 0)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('MEDIA_PROBE_FAILED：无法读取音频时长或采样率。')
  }
  return {
    durationSeconds,
    sampleRate: Math.round(sampleRate),
    channels: Math.max(1, Math.round(channels || 1)),
    hasVideo: parsed.streams?.some((stream) => stream.codec_type === 'video') ?? false,
  }
}

function safeBaseName(sourcePath: string): string {
  const withoutReserved = path.basename(sourcePath, path.extname(sourcePath)).replace(/[<>:"/\\|?*]/g, ' ')
  return [...withoutReserved].map((character) => character.charCodeAt(0) < 32 ? ' ' : character).join('').trim() || '未命名口播'
}

export async function createAudioEditProject(request: AudioEditProjectCreateRequest): Promise<AudioEditProjectDocument> {
  const requestId = crypto.randomUUID()
  logger.info('开始创建口播剪辑工程', { event: 'audio_edit.project.create.start', requestId })
  try {
    const localSource = await resolveLocalMediaPath(request.sourcePath)
    const probe = await probeAudio(localSource)
    const projectId = crypto.randomUUID()
    const projectDir = path.join(getHenjiDataDir(), 'AudioEdit', projectId)
    await fs.mkdir(projectDir, { recursive: true })
    const sourceExtension = path.extname(localSource) || '.bin'
    const managedSource = path.join(projectDir, `source${sourceExtension.toLowerCase()}`)
    const audioProxy = path.join(projectDir, 'audio.wav')
    await fs.copyFile(localSource, managedSource)
    const ffmpeg = await loadFfmpegPath()
    await run(ffmpeg, [
      '-y', '-i', managedSource, '-vn', '-map', '0:a:0',
      '-c:a', 'pcm_s16le', '-ar', String(probe.sampleRate), '-ac', String(probe.channels),
      audioProxy,
    ])
    const now = Date.now()
    const project = saveAudioEditProject({
      id: projectId,
      name: request.name?.trim() || safeBaseName(localSource),
      source: {
        mediaType: probe.hasVideo ? 'video' : 'audio',
        sourcePath: managedSource,
        audioPath: audioProxy,
        durationFrames: Math.round(probe.durationSeconds * probe.sampleRate),
        sampleRate: probe.sampleRate,
        channels: probe.channels,
      },
      referenceScript: request.referenceScript?.trim() ?? '',
      transcript: [],
      suggestions: [],
      vstEnabled: false,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    })
    logger.info('口播剪辑工程创建完成', {
      event: 'audio_edit.project.create.completed', requestId,
      context: { projectId, mediaType: project.source.mediaType },
    })
    return project
  } catch (error) {
    logger.error('口播剪辑工程创建失败', {
      event: 'audio_edit.project.create.failed', requestId, error,
    })
    throw error
  }
}
