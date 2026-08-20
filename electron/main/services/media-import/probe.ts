import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import { getDataRootDir } from '../image/path-utils'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { withMediaHeavyTask } from './concurrency'

interface ProbeStream {
  codec_type?: string
  width?: number
  height?: number
}

interface ProbeOutput {
  format?: { duration?: string }
  streams?: ProbeStream[]
}

export interface NativeMediaProbe {
  durationSeconds: number
  width: number
  height: number
  hasAudio: boolean
}

function execText(binaryPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${path.basename(binaryPath)} failed: ${error.message}\n${stderr}`))
        return
      }
      resolve(stdout)
    })
  })
}

export async function probeLocalMedia(fullPath: string): Promise<NativeMediaProbe> {
  return await withMediaHeavyTask(async () => {
    const ffprobePath = await loadFfprobePath()
    const stdout = await execText(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      fullPath,
    ])
    const parsed = JSON.parse(stdout) as ProbeOutput
    const video = parsed.streams?.find((stream) => stream.codec_type === 'video')
    const durationSeconds = Number(parsed.format?.duration ?? 0)
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('Unable to read media duration')
    }
    return {
      durationSeconds,
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      hasAudio: parsed.streams?.some((stream) => stream.codec_type === 'audio') ?? false,
    }
  })
}

export async function writeVideoPoster(
  sourcePath: string,
  cacheKey: string,
  durationSeconds: number,
): Promise<{ posterPath: string; cacheHit: boolean }> {
  const thumbnailsDir = path.join(getDataRootDir(), 'Thumbnails')
  await fs.mkdir(thumbnailsDir, { recursive: true })
  const posterPath = path.join(thumbnailsDir, `video-${cacheKey}.jpg`)
  try {
    await fs.access(posterPath)
    return { posterPath, cacheHit: true }
  } catch {
    // Generate once below.
  }
  await withMediaHeavyTask(async () => {
    const ffmpegPath = await loadFfmpegPath()
    const seekTime = Math.min(0.1, Math.max(0, durationSeconds - 0.05))
    await execText(ffmpegPath, [
      '-y',
      '-ss', String(seekTime),
      '-i', sourcePath,
      '-frames:v', '1',
      '-vf', 'scale=480:-1',
      '-q:v', '3',
      posterPath,
    ])
  })
  return { posterPath, cacheHit: false }
}

export async function warmNativeMediaTools(): Promise<void> {
  const [ffprobePath, ffmpegPath] = await Promise.all([loadFfprobePath(), loadFfmpegPath()])
  await Promise.all([
    execText(ffprobePath, ['-version']),
    execText(ffmpegPath, ['-version']),
  ])
}
