import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { getUploadsDir } from '../image/path-utils'
import { execFileAsyncBuffer, resolveLocalMediaPath } from '../media/shared'
import { loadFfmpegPath, loadFfprobePath } from './ffmpeg-loader'
import { withMediaHeavyTask } from '../media-import/concurrency'
import { createMainLogger } from '../logging'
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
const logger = createMainLogger('main.video.ops')
const ENCODE_TIMEOUT_MS = 30 * 60 * 1000

function execFileAsync(binaryPath: string, args: string[], signal?: AbortSignal, timeout = ENCODE_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    execFile(binaryPath, args, { maxBuffer: MAX_BUFFER_BYTES, signal, timeout }, (error, stdout, stderr) => {
      if (signal?.aborted) { reject(signal.reason); return }
      if (error) {
        reject(new Error(`${path.basename(binaryPath)} failed: ${error.message}\n${stderr}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

interface MediaJob { controller: AbortController; promise: Promise<void>; users: number }
const pendingOutputs = new Map<string, MediaJob>()

/** 相同产物共用编码；单个消费者取消不影响其他消费者，最后一个取消才结束进程。 */
async function prepareOutput(outputPath: string, encode: (temporaryPath: string, signal: AbortSignal) => Promise<void>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  let job = pendingOutputs.get(outputPath)
  if (!job) {
    const controller = new AbortController()
    const created: MediaJob = { controller, users: 0, promise: Promise.resolve() }
    created.promise = Promise.resolve().then(async () => {
      const jobSignal = controller.signal
      jobSignal.throwIfAborted()
      if (await validOutput(outputPath, jobSignal)) return
      // media-recycle-allow: invalid unpublished derived cache, no valid consumer may reuse it.
      await fs.promises.rm(outputPath, { force: true })
      const ext = path.extname(outputPath)
      const temporaryPath = `${outputPath.slice(0, -ext.length)}.${crypto.randomUUID()}.tmp${ext}`
      const requestId = crypto.randomUUID()
      logger.info('开始处理视频', { event: 'video.prepare.start', requestId })
      try {
        await encode(temporaryPath, jobSignal)
        jobSignal.throwIfAborted()
        if (!await validOutput(temporaryPath, jobSignal)) throw new Error('视频处理未生成有效文件，请重试。')
        jobSignal.throwIfAborted()
        await fs.promises.rename(temporaryPath, outputPath)
        logger.info('视频处理完成', { event: 'video.prepare.completed', requestId })
      } catch (error) {
        logger.warn('视频处理未完成', { event: 'video.prepare.failed', requestId, error })
        throw error
      } finally {
        // media-recycle-allow: failed unpublished encoding staging or already renamed staging.
        await fs.promises.rm(temporaryPath, { force: true })
      }
    }).finally(() => { if (pendingOutputs.get(outputPath) === created) pendingOutputs.delete(outputPath) })
    pendingOutputs.set(outputPath, created)
    job = created
  }
  const active = job
  active.users++
  let released = false
  const release = (): void => { if (!released) { released = true; active.users-- } }
  await new Promise<void>((resolve, reject) => {
    const cancel = (): void => {
      release()
      if (active.users === 0) {
        active.controller.abort(signal?.reason)
        if (pendingOutputs.get(outputPath) === active) pendingOutputs.delete(outputPath)
        active.promise.then(() => reject(signal?.reason), () => reject(signal?.reason))
      } else reject(signal?.reason)
    }
    signal?.addEventListener('abort', cancel, { once: true })
    active.promise.then(resolve, reject).finally(() => { signal?.removeEventListener('abort', cancel); release() })
    if (signal?.aborted) cancel()
  })
  signal?.throwIfAborted()
}

async function validOutput(outputPath: string, signal: AbortSignal): Promise<boolean> {
  try {
    if ((await fs.promises.stat(outputPath)).size === 0) return false
    const info = await readVideoInfo(outputPath, signal)
    return info.width > 0 && info.height > 0
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') throw error
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) logger.warn('视频缓存无法读取，将重新处理', { event: 'video.prepare.invalid_cache', error })
    return false
  }
}

interface FfprobeStream {
  codec_type?: string
  width?: number
  height?: number
  sample_aspect_ratio?: string
  side_data_list?: Array<{ rotation?: number }>
  tags?: { rotate?: string }
}

interface FfprobeOutput {
  format?: { duration?: string }
  streams?: FfprobeStream[]
}

async function probeVideoSource(source: string, signal?: AbortSignal): Promise<FfprobeOutput> {
  signal?.throwIfAborted()
  const ffprobePath = await loadFfprobePath()
  const localPath = await resolveLocalMediaPath(source, signal)
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    localPath,
  ], signal, 30_000)
  return JSON.parse(stdout) as FfprobeOutput
}

/** Motion analysis decodes without autorotation. Distances are calibrated to
 * square display pixels and the rotated display width, without clipping edges. */
export async function readVideoAnalysisGeometry(source: string, signal?: AbortSignal): Promise<{ aspectRatio: number; rotation: number }> {
  const parsed = await probeVideoSource(source, signal)
  const stream = parsed.streams?.find(stream => stream.codec_type === 'video')
  if (!stream || !Number.isFinite(stream.width) || !Number.isFinite(stream.height) || stream.width! <= 0 || stream.height! <= 0) throw new Error('无法读取原视频画幅，不能推测运动比例。')
  const ratio = stream.sample_aspect_ratio?.split(':').map(Number)
  const sar = !ratio || stream.sample_aspect_ratio === 'N/A' || ratio[0] === 0 ? 1 : ratio.length === 2 && ratio[0] > 0 && ratio[1] > 0 ? ratio[0] / ratio[1] : NaN
  const rotation = stream.side_data_list?.find(value => value.rotation !== undefined)?.rotation ?? Number(stream.tags?.rotate ?? 0)
  const aspectRatio = stream.width! * sar / stream.height!
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0 || !Number.isFinite(rotation)) throw new Error('原视频像素比例或旋转信息无效，请检查原片。')
  return { aspectRatio, rotation }
}

export async function readVideoInfo(source: string, signal?: AbortSignal): Promise<VideoInfoResultDto> {
  const parsed = await probeVideoSource(source, signal)
  const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video')
  const hasAudio = parsed.streams?.some((stream) => stream.codec_type === 'audio') ?? false
  const durationSeconds = Number(parsed.format?.duration ?? 0)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Unable to read video duration')
  }
  return {
    durationSeconds,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    hasAudio,
  }
}

export async function trimVideoSource(payload: TrimVideoSourcePayloadDto, signal?: AbortSignal): Promise<TrimVideoSourceResultDto> {
  signal?.throwIfAborted()
  const { source, startSeconds, endSeconds } = payload
  const durationSeconds = endSeconds - startSeconds
  if (!(durationSeconds > 0)) {
    throw new Error('endSeconds must be greater than startSeconds')
  }

  const ffmpegPath = await loadFfmpegPath()
  const localPath = await resolveLocalMediaPath(source, signal)

  const digest = crypto
    .createHash('md5')
    .update(`${localPath}:${startSeconds}:${endSeconds}:${(await fs.promises.stat(localPath)).mtimeMs}`)
    .digest('hex')
  // 输出容器跟随源文件后缀（而不是统一发 .mp4）：纯流复制时输出容器必须和源编码兼容
  // （比如源是 webm/VP9，复制进 .mp4 容器大概率失败），同容器内裁切天然兼容。
  const sourceExt = path.extname(localPath) || '.mp4'
  const outputPath = path.join(getUploadsDir(), `trim-${digest}${sourceExt}`)

  await prepareOutput(outputPath, async (temporaryPath, jobSignal) => {
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
      temporaryPath,
    ], jobSignal)
  }, signal)

  return { path: outputPath, durationSeconds }
}

/**
 * 把视频压缩到不超过 maxSizeMB：按目标体积反推平均码率，单遍编码（CRF + 码率上限的约束模式），
 * preset=medium 取画质/速度中档。已经满足体积要求时直接原样返回，不重复编码。
 */
export async function compressVideoToFit(payload: CompressVideoToFitPayloadDto, signal?: AbortSignal): Promise<CompressVideoToFitResultDto> {
  signal?.throwIfAborted()
  const { source, maxSizeMB } = payload
  const localPath = await resolveLocalMediaPath(source, signal)
  const stat = await fs.promises.stat(localPath)
  const maxBytes = Math.floor(maxSizeMB * 1024 * 1024)
  signal?.throwIfAborted()

  if (stat.size <= maxBytes) {
    return { path: localPath, sizeBytes: stat.size }
  }

  const ffmpegPath = await loadFfmpegPath()
  const info = await readVideoInfo(localPath, signal)

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

  await prepareOutput(outputPath, (temporaryPath, jobSignal) =>
    encodeCompressedVideo(ffmpegPath, localPath, temporaryPath, videoBitrateKbps, maxrateKbps, bufsizeKbps, jobSignal), signal)

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
  bufsizeKbps: number,
  signal?: AbortSignal,
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
  signal?.throwIfAborted()
  if (!isHardwareEncoder(profile)) {
    await execFileAsync(ffmpegPath, buildArgs(profile), signal)
    return
  }

  try {
    await execFileAsync(ffmpegPath, buildArgs(profile), signal)
  } catch (error) {
    signal?.throwIfAborted()
    const retried = await invalidateEncoderCache()
    signal?.throwIfAborted()
    if (retried.id === profile.id) throw error
    // media-recycle-allow: unpublished failed encoder output, retry must start with a clean file.
    await fs.promises.rm(outputPath, { force: true })
    await execFileAsync(ffmpegPath, buildArgs(retried), signal)
  }
}

export async function generateVideoThumbnail(
  source: string,
  timeOffsetSeconds: number = 1.0,
  knownDurationSeconds?: number,
): Promise<string> {
  const ffmpegPath = await loadFfmpegPath()
  const localPath = await resolveLocalMediaPath(source)

  let seekTime = timeOffsetSeconds
  if (typeof knownDurationSeconds === 'number' && Number.isFinite(knownDurationSeconds)) {
    seekTime = Math.min(Math.max(0, timeOffsetSeconds), Math.max(0, knownDurationSeconds - 0.1))
  } else {
    try {
      const info = await readVideoInfo(source)
      seekTime = Math.min(Math.max(0, timeOffsetSeconds), Math.max(0, info.durationSeconds - 0.1))
    } catch {
      // use default seek time if info cannot be read
    }
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
export async function generateVideoThumbnailBytes(source: string, maxSize = 200, signal?: AbortSignal, atSeconds = 0.1): Promise<Buffer> {
  if (!Number.isSafeInteger(maxSize) || maxSize < 16 || maxSize > 1024) throw new Error('缩略图尺寸超出范围。')
  return withMediaHeavyTask(async () => {
  const ffmpegPath = await loadFfmpegPath()
  const localPath = await resolveLocalMediaPath(source, signal)
  signal?.throwIfAborted()
  const { stdout } = await execFileAsyncBuffer(ffmpegPath, [
    // 超出时长时 ffmpeg 取不到帧：调用方给的是估计值，取不到就退回开头
    '-ss', String(Number.isFinite(atSeconds) && atSeconds > 0 ? Math.round(atSeconds * 1000) / 1000 : 0.1),
    '-i', localPath,
    '-frames:v', '1',
    '-vf', `scale='min(${maxSize},iw)':'min(${maxSize},ih)':force_original_aspect_ratio=decrease`,
    '-c:v', 'libwebp',
    '-f', 'webp',
    'pipe:1',
  ], { signal, timeout: 15000 })

  return stdout
  }, signal).then(async (bytes) => (bytes.length === 0 && atSeconds > 0.1 ? await generateVideoThumbnailBytes(source, maxSize, signal, 0.1) : bytes))
}
