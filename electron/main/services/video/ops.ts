import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { getUploadsDir } from '../image/path-utils'
import { execFileAsyncBuffer, resolveLocalMediaPath } from '../media/shared'
import { loadFfmpegPath, loadFfprobePath } from './ffmpeg-loader'
import {
  getPreferredEncoder,
  invalidateEncoderCache,
  isHardwareEncoder,
  type VideoEncoderProfile,
} from './hwaccel'
import type {
  CompressVideoToFitPayloadDto,
  CompressVideoToFitResultDto,
  TrimVideoSourcePayloadDto,
  TrimVideoSourceResultDto,
  VideoInfoResultDto,
} from './types'

const MAX_BUFFER_BYTES = 32 * 1024 * 1024

function execFileAsync(binaryPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, args, { maxBuffer: MAX_BUFFER_BYTES }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${path.basename(binaryPath)} failed: ${error.message}\n${stderr}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

interface FfprobeStream {
  codec_type?: string
  width?: number
  height?: number
}

interface FfprobeOutput {
  format?: { duration?: string }
  streams?: FfprobeStream[]
}

export async function readVideoInfo(source: string): Promise<VideoInfoResultDto> {
  const ffprobePath = await loadFfprobePath()
  const localPath = await resolveLocalMediaPath(source)
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    localPath,
  ])
  const parsed = JSON.parse(stdout) as FfprobeOutput
  const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video')
  const durationSeconds = Number(parsed.format?.duration ?? 0)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Unable to read video duration')
  }
  return {
    durationSeconds,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
  }
}

export async function trimVideoSource(payload: TrimVideoSourcePayloadDto): Promise<TrimVideoSourceResultDto> {
  const { source, startSeconds, endSeconds } = payload
  const durationSeconds = endSeconds - startSeconds
  if (!(durationSeconds > 0)) {
    throw new Error('endSeconds must be greater than startSeconds')
  }

  const ffmpegPath = await loadFfmpegPath()
  const localPath = await resolveLocalMediaPath(source)

  const digest = crypto
    .createHash('md5')
    .update(`${localPath}:${startSeconds}:${endSeconds}:${(await fs.promises.stat(localPath)).mtimeMs}`)
    .digest('hex')
  // 输出容器跟随源文件后缀（而不是统一发 .mp4）：纯流复制时输出容器必须和源编码兼容
  // （比如源是 webm/VP9，复制进 .mp4 容器大概率失败），同容器内裁切天然兼容。
  const sourceExt = path.extname(localPath) || '.mp4'
  const outputPath = path.join(getUploadsDir(), `trim-${digest}${sourceExt}`)

  if (!fs.existsSync(outputPath)) {
    // 只做时间切割、不重新编码（-c copy）：直接按关键帧复制流，裁剪近乎瞬间完成，
    // 代价是起止点会贴最近的关键帧（通常偏差不到一两秒）。本地裁剪不追求帧级精确，
    // 体积/画质有需要会在生成提交时单独跑 compressVideoToFit 重新编码。
    const isMp4Like = ['.mp4', '.m4v', '.mov'].includes(sourceExt.toLowerCase())
    await execFileAsync(ffmpegPath, [
      '-y',
      '-ss', String(startSeconds),
      '-i', localPath,
      '-t', String(durationSeconds),
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      // movflags 是 mov/mp4 muxer 专用选项，喂给 webm/mkv 等容器会报错，按容器类型条件附加
      ...(isMp4Like ? ['-movflags', '+faststart'] : []),
      outputPath,
    ])
  }

  return { path: outputPath, durationSeconds }
}

/**
 * 把视频压缩到不超过 maxSizeMB：按目标体积反推平均码率，单遍编码（CRF + 码率上限的约束模式），
 * preset=medium 取画质/速度中档。已经满足体积要求时直接原样返回，不重复编码。
 */
export async function compressVideoToFit(payload: CompressVideoToFitPayloadDto): Promise<CompressVideoToFitResultDto> {
  const { source, maxSizeMB } = payload
  const localPath = await resolveLocalMediaPath(source)
  const stat = await fs.promises.stat(localPath)
  const maxBytes = Math.floor(maxSizeMB * 1024 * 1024)

  if (stat.size <= maxBytes) {
    return { path: localPath, sizeBytes: stat.size }
  }

  const ffmpegPath = await loadFfmpegPath()
  const info = await readVideoInfo(localPath)

  const audioBitrateBps = 128_000
  const containerOverheadRatio = 0.92
  const targetTotalBitsPerSecond = (maxBytes * 8 * containerOverheadRatio) / info.durationSeconds
  const videoBitrateKbps = Math.round(Math.max(400_000, targetTotalBitsPerSecond - audioBitrateBps) / 1000)
  const maxrateKbps = Math.round(videoBitrateKbps * 1.5)
  const bufsizeKbps = videoBitrateKbps * 2

  // 缓存键加版本片段（:kf1）：下面新增了强制关键帧参数，编码产物变了但旧 hash 输入不变，
  // 不加版本号会导致改动前就压缩过的视频继续复用旧的（关键帧稀疏的）缓存文件。
  const digest = crypto
    .createHash('md5')
    .update(`${localPath}:${maxSizeMB}:${stat.mtimeMs}:kf1`)
    .digest('hex')
  const outputPath = path.join(getUploadsDir(), `compressed-${digest}.mp4`)

  if (!fs.existsSync(outputPath)) {
    await encodeCompressedVideo(ffmpegPath, localPath, outputPath, videoBitrateKbps, maxrateKbps, bufsizeKbps)
  }

  const compressedStat = await fs.promises.stat(outputPath)
  return { path: outputPath, sizeBytes: compressedStat.size }
}

/**
 * 优先用探测到的硬件编码器（NVENC/QSV/AMF/VideoToolbox）编码；若编码失败则重新探测一次
 * 硬件可用性（识别显卡被拔掉/驱动变化等场景）。重新探测后编码器选择不变，说明硬件仍正常、
 * 失败另有原因，不重试直接抛错；选择变化（含降级到 CPU）则用新选择重试一次。
 */
async function encodeCompressedVideo(
  ffmpegPath: string,
  localPath: string,
  outputPath: string,
  videoBitrateKbps: number,
  maxrateKbps: number,
  bufsizeKbps: number
): Promise<void> {
  const buildArgs = (profile: VideoEncoderProfile): string[] => [
    '-y',
    '-i', localPath,
    ...profile.buildEncodeArgs(videoBitrateKbps, maxrateKbps, bufsizeKbps),
    // 每 1 秒强制一个关键帧（按演示时间，不依赖帧率）：既然这趟压缩本来就要重新编码，
    // 顺便把关键帧铺密，让后续裁剪可以一直用代价极低的 -c copy 流复制，且能精确卡在
    // 任意整数秒边界，不会因为关键帧稀疏导致裁剪点明显跑偏。
    '-force_key_frames', 'expr:gte(t,n_forced*1)',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ]

  const profile = await getPreferredEncoder()
  if (!isHardwareEncoder(profile)) {
    await execFileAsync(ffmpegPath, buildArgs(profile))
    return
  }

  try {
    await execFileAsync(ffmpegPath, buildArgs(profile))
  } catch (error) {
    const retried = await invalidateEncoderCache()
    if (retried.id === profile.id) throw error
    await execFileAsync(ffmpegPath, buildArgs(retried))
  }
}

export async function generateVideoThumbnail(
  source: string,
  timeOffsetSeconds: number = 1.0
): Promise<string> {
  const ffmpegPath = await loadFfmpegPath()
  const localPath = await resolveLocalMediaPath(source)

  let seekTime = timeOffsetSeconds
  try {
    const info = await readVideoInfo(source)
    seekTime = Math.min(Math.max(0, timeOffsetSeconds), Math.max(0, info.durationSeconds - 0.1))
  } catch {
    // use default seek time if info cannot be read
  }

  const { stdout } = await execFileAsyncBuffer(ffmpegPath, [
    '-ss', String(seekTime),
    '-i', localPath,
    '-frames:v', '1',
    '-vf', 'scale=480:-1',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    'pipe:1',
  ])

  return `data:image/png;base64,${stdout.toString('base64')}`
}

/**
 * 200px 约束的 webp 缩略图，供缩略图缓存场景使用（区别于 generateVideoThumbnail 的
 * 480px PNG poster 场景，两者用途/格式不同，不合并成一个通用函数）。
 */
export async function generateVideoThumbnailBytes(source: string, maxSize = 200): Promise<Buffer> {
  const ffmpegPath = await loadFfmpegPath()
  const localPath = await resolveLocalMediaPath(source)

  const { stdout } = await execFileAsyncBuffer(ffmpegPath, [
    '-ss', '0.1',
    '-i', localPath,
    '-frames:v', '1',
    '-vf', `scale='min(${maxSize},iw)':'min(${maxSize},ih)':force_original_aspect_ratio=decrease`,
    '-c:v', 'libwebp',
    '-f', 'webp',
    'pipe:1',
  ])

  return stdout
}
