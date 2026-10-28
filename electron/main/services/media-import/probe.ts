import { execFile } from 'node:child_process'
import path from 'node:path'

import { getProgramStoreDir } from '../appPaths'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { withMediaHeavyTask } from './concurrency'
import { writeOwnedMediaPreview } from '../asset-library/thumbnailService'
import { redactMediaError } from '../../../../src/core/media/localMediaImportSafety'

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

function execText(binaryPath: string, args: string[], inspectFormatError = false, sourcePaths: readonly string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (inspectFormatError) {
          try {
            const result = JSON.parse(stdout) as { error?: { code?: number } }
            // FFmpeg 的 AVERROR_INVALIDDATA 表示解析器已确定输入数据无效；退出码本身不能区分格式与系统故障。
            if (result.error?.code === -1094995529) {
              reject(Object.assign(new Error('媒体解析器确认文件格式无效。'), { name: 'MediaProbeFormatError', code: 'MEDIA_FORMAT_UNSUPPORTED' }))
              return
            }
          } catch { /* 没有结构化格式结论时保留原始执行错误，供调用方重试。 */ }
        }
        const failure = redactMediaError(error, [binaryPath, ...sourcePaths])
        if (stderr.trim()) failure.message += `\n${redactMediaError(new Error(stderr), sourcePaths).message}`
        reject(failure)
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
      '-show_error',
      fullPath,
    ], true, [fullPath])
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
  const thumbnailsDir = getProgramStoreDir('thumbnails')
  const posterPath = path.join(thumbnailsDir, `video-${cacheKey}.jpg`)
  const cacheHit = await writeOwnedMediaPreview(posterPath, sourcePath, async pending => await withMediaHeavyTask(async () => {
    const ffmpegPath = await loadFfmpegPath()
    const seekTime = Math.min(0.1, Math.max(0, durationSeconds - 0.05))
    await execText(ffmpegPath, [
      '-y',
      '-ss', String(seekTime),
      '-i', sourcePath,
      '-frames:v', '1',
      '-vf', 'scale=480:-1',
      '-q:v', '3',
      '-f', 'image2',
      pending,
    ], false, [sourcePath, pending])
  }))
  return { posterPath, cacheHit }
}

export async function warmNativeMediaTools(): Promise<void> {
  const [ffprobePath, ffmpegPath] = await Promise.all([loadFfprobePath(), loadFfmpegPath()])
  await Promise.all([
    execText(ffprobePath, ['-version']),
    execText(ffmpegPath, ['-version']),
  ])
}
