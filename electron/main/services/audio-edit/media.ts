import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AudioEditProjectDocument, AudioEditRange, AudioEditSourceMetadata } from '../../../../src/core/audioEdit/types'
import type { AsrUploadEncoding } from '../../../../src/core/audioEdit/asrCatalog'
import { resolveLocalMediaPath } from '../media/shared'
import { getProgramStoreDir } from '../appPaths'
import { getMediaCacheManager } from '../media/media-cache-runtime'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { createMainLogger } from '../logging'
import { ensureAudioLineageRoot, recordAudioLineage } from '../audio/lineage'
import { requireAudioEditProject } from './project-store'
import { runAudioEditProcess } from './process'
import { cachedAudioFile } from './render-cache'
import { assertAudioEditProjectIdle, deleteAudioEditTasks, hasActiveAudioEditTask, registerAudioEditTaskController, runAudioEditTask } from './task-store'
import { registerDocumentProgramStateCleaner } from '../documents/program-state-cleaners'
import { audioEditSourceContentKey, fingerprintAudioEditSource, digestWholeAudioEditSource } from './source-identity'

const logger = createMainLogger('main.audio_edit')
// 无输出/无读取进展的退出预算，与素材总长度无关。
const SOURCE_IDLE_TIMEOUT_MS = 30_000
/** 抽查视频时间戳的窗口：开头、正中、结尾各这么长（秒）；更短的素材整段检查。 */
const VIDEO_SAMPLE_SECONDS = 10
interface ProbeStream {
  index: number; codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; duration?: string
  duration_ts?: number; time_base?: string; start_time?: string; avg_frame_rate?: string; r_frame_rate?: string
  width?: number; height?: number
}
function fraction(value: string | undefined): { numerator: number; denominator: number } {
  const [numerator, denominator] = (value ?? '0/1').split('/').map(Number)
  return { numerator: Number.isFinite(numerator) ? numerator : 0, denominator: denominator > 0 ? denominator : 1 }
}
function streamDuration(stream: ProbeStream, fallback: number): number {
  const time = fraction(stream.time_base)
  return stream.duration_ts && time.numerator ? stream.duration_ts * time.numerator / time.denominator : Number(stream.duration ?? fallback)
}
export function audioEditCacheDirectory(projectId: string): string {
  if (!/^[\w-]+$/.test(projectId)) throw new Error('口播引用无效')
  const directory = getMediaCacheManager().categoryDirectory('audio_edit', projectId)
  if (!directory) throw new Error('作品目录不可用，暂时无法处理口播。')
  return directory
}
/** 频谱按素材内容寻址，在同一媒体缓存根下跨文档复用，不随某一文档删除。 */
export function audioEditSpectralCacheDirectory(): string {
  return audioEditCacheDirectory('spectral-pyramid-v1')
}
// 口播文档离开作品（回收站、删除空草稿、从列表移除）时清掉程序目录 AudioEdit/<文档 ID>（解码缓存、处理结果）
// 与任务回执，都可重建；还有任务在跑时不动（下次离开或手动清理时再说）。别的类型的文档 ID 在这里没有数据，不受影响。
registerDocumentProgramStateCleaner('audio_edit', async (docId) => {
  if (!/^[\w-]+$/.test(docId) || hasActiveAudioEditTask(docId)) return
  const removedTasks = deleteAudioEditTasks(docId)
  await removeUnmanagedCachePath(path.join(getProgramStoreDir('audioEdit'), docId), { recursive: true, force: true })
  const cache = getMediaCacheManager().categoryDirectory('audio_edit', docId)
  if (cache) await removeUnmanagedCachePath(cache, { recursive: true, force: true })
  if (removedTasks) logger.info('口播内部缓存已清理', { event: 'audio_edit.program_state.cleaned', context: { docId, removedTasks } })
})

/**
 * 原素材是否还是导入时那一份。quick（取块、渲染、频谱这类高频路径）：大小与修改时间一致即通过，不一致才比内容。
 * deep（打开、拼接、转写、导出这类关口）：带采样指纹的素材总比指纹（只读几 MB）；只有整文件摘要的素材（格式 8 之前导入）整文件比对太贵，
 * 大小与修改时间一致就不读内容，不一致才整文件比对。没有任何身份记录的素材（极早期作品）只检查文件还在。
 */
export async function verifyAudioEditSource(project: { source: Pick<AudioEditSourceMetadata, 'sourcePath' | 'identity' | 'fingerprint'> }, signal?: AbortSignal, depth: 'quick' | 'deep' = 'deep'): Promise<void> {
  signal?.throwIfAborted()
  const { sourcePath, identity, fingerprint } = project.source
  let stat
  try { stat = await fs.stat(sourcePath) }
  catch { throw new Error('找不到原素材，请重新定位文件。') }
  const recorded = fingerprint ?? identity
  if (!recorded || (recorded.size === stat.size && recorded.mtimeMs === stat.mtimeMs && (depth === 'quick' || !fingerprint))) return
  const same = fingerprint
    ? (await fingerprintAudioEditSource(sourcePath, signal)).digest === fingerprint.digest
    : (await digestWholeAudioEditSource(sourcePath, signal)).digest === identity!.digest
  if (!same) throw new Error('原素材内容已改变，请重新导入；旧剪辑不能用于新的录音。')
}

/**
 * 视频包时间戳是否稳定（逐帧等间隔、无缺帧、无重复）。points 为 undefined 时检查整段；
 * 否则只读这些时刻（文件里的绝对时间戳）起的窗口，每个窗口单独对齐，窗口末尾因 B 帧解码顺序被截掉的帧不算缺帧。
 * 抽查有窗口一个包都没读到时答不上来，返回 unknown（不当成不稳定，交给导出前的整段检查）。
 */
async function videoPacketTiming(ffprobe: string, sourcePath: string, frameRate: { numerator: number; denominator: number }, signal: AbortSignal | undefined, points?: readonly number[]): Promise<'stable' | 'unstable' | 'unknown'> {
  const fps = frameRate.numerator / frameRate.denominator
  if (!(fps > 0 && Number.isFinite(fps))) return 'unstable'
  const windows: number[][] = (points ?? [0]).map(() => [])
  let valid = true
  const intervals = points ? ['-read_intervals', points.map(point => `${point.toFixed(3)}%+${VIDEO_SAMPLE_SECONDS}`).join(',')] : []
  await runAudioEditProcess(ffprobe, ['-v', 'error', '-select_streams', 'v:0', ...intervals, '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', sourcePath], signal, undefined, (line) => {
    if (!line.trim()) return
    const [pts, duration] = line.split(',').map(Number)
    if (!Number.isFinite(pts) || !(duration > 0) || Math.abs(duration * fps - 1) > 0.02) { valid = false; return }
    // 抽查窗口相距很远（素材长于 6 个窗口才抽查）：每个包归到时间上最近的窗口，窗口内的空缺照样算缺帧。
    let nearest = 0
    points?.forEach((point, index) => { if (Math.abs(pts - point - VIDEO_SAMPLE_SECONDS / 2) < Math.abs(pts - points[nearest] - VIDEO_SAMPLE_SECONDS / 2)) nearest = index })
    windows[nearest].push(pts)
  }, SOURCE_IDLE_TIMEOUT_MS)
  if (!valid) return 'unstable'
  if (windows.some(window => !window.length)) return points ? 'unknown' : 'unstable'
  // 解码顺序里 B 帧可以晚于后面的参考帧出现；抽查窗口在任意一包处截断，最后这些帧之间的空缺可能只是没读到。
  const reorderTail = points ? 32 : 0
  for (const window of windows) {
    const sorted = [...window].sort((a, b) => a - b)
    const origin = sorted[0]
    let previous = -1
    for (const [index, pts] of sorted.entries()) {
      const position = (pts - origin) * fps
      const frame = Math.round(position)
      if (Math.abs(frame - position) > 0.02 || frame === previous) return 'unstable'
      if (frame !== previous + 1 && index < sorted.length - reorderTail) return 'unstable'
      previous = frame
    }
  }
  return 'stable'
}

const videoTimingChecks = new Map<string, Promise<boolean>>()
/**
 * XML 导出联动画面前的完整检查（导入时只抽查，抽查答不上来时不标不稳定）：整段读一遍视频包时间戳，同一份素材只查一次。
 * 已标为不稳定的（抽查在窗口里实际看到缺帧或间隔不对、帧率与平均帧率不符）直接拒绝。
 */
export async function verifyAudioEditVideoTiming(source: AudioEditSourceMetadata, signal?: AbortSignal): Promise<boolean> {
  if (!source.video) return true
  if (source.video.variableFrameRate) return false
  const key = JSON.stringify([await audioEditSourceContentKey(source, signal), source.video.frameRate])
  let check = videoTimingChecks.get(key)
  if (!check) {
    const started = performance.now()
    check = loadFfprobePath().then(ffprobe => videoPacketTiming(ffprobe, source.sourcePath, source.video!.frameRate, signal)).then(timing => {
      const stable = timing === 'stable'
      logger.info('视频时间戳完整检查完成', { event: 'audio_edit.source.video_timing.completed', context: { stable, durationSeconds: source.video!.durationSeconds, elapsedMs: performance.now() - started } })
      return stable
    })
    videoTimingChecks.set(key, check)
    check.catch(() => videoTimingChecks.delete(key))
  }
  return check
}

/**
 * 容器直接给出精确采样数时返回它（PCM 各容器、FLAC，以及时间基等于采样率的 mov/mp4/m4a：这些容器的时长按采样计，
 * 与逐帧解码计数一致）；mp3、ogg 等可能按码率估算的格式返回 undefined，由调用方解码计数。
 */
function exactContainerFrames(audio: ProbeStream, formatName: string | undefined, sampleRate: number): number | undefined {
  const time = fraction(audio.time_base)
  if (!Number.isSafeInteger(audio.duration_ts) || !(audio.duration_ts! > 0) || time.numerator !== 1 || time.denominator !== sampleRate) return undefined
  const codec = audio.codec_name ?? ''
  const containers = (formatName ?? '').split(',')
  return codec.startsWith('pcm_') || codec === 'flac' || containers.some(name => name === 'mov' || name === 'mp4' || name === 'm4a') ? audio.duration_ts : undefined
}

async function decodedFrameCount(ffprobe: string, sourcePath: string, signal?: AbortSignal): Promise<number> {
  let durationFrames = 0
  await runAudioEditProcess(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_frames', '-show_entries', 'frame=nb_samples', '-of', 'csv=p=0', sourcePath], signal, undefined, (line) => {
    const samples = Number(line.split(',')[0])
    if (Number.isSafeInteger(samples) && samples > 0) durationFrames += samples
  }, SOURCE_IDLE_TIMEOUT_MS)
  return durationFrames
}

/** 探测各阶段的耗时与读法，供导入日志使用。 */
export interface AudioEditProbeTimings { bytes: number; framesFrom: 'container' | 'decode'; videoTiming?: 'stable' | 'unstable' | 'unknown'; headerMs: number; framesMs: number; videoMs: number; fingerprintMs: number }

/**
 * 读素材信息：只读文件头；帧数优先取容器里的精确值，视频时间戳抽查三个窗口，指纹只读采样块，三者并行。
 * 容器没有精确帧数时才整段解码计数。
 */
export async function probeAudioEditSource(sourcePath: string, signal?: AbortSignal, timings?: Partial<AudioEditProbeTimings>): Promise<AudioEditSourceMetadata> {
  signal?.throwIfAborted()
  const started = performance.now()
  const ffprobe = await loadFfprobePath()
  const parsed = JSON.parse(await runAudioEditProcess(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', sourcePath], signal, undefined, undefined, SOURCE_IDLE_TIMEOUT_MS)) as { format?: { duration?: string; format_name?: string }; streams?: ProbeStream[] }
  const headerMs = performance.now() - started
  const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio')
  if (!audio) throw new Error('所选文件没有可用音轨。')
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video')
  const sampleRate = Number(audio.sample_rate)
  const duration = streamDuration(audio, Number(parsed.format?.duration))
  if (!(sampleRate > 0 && duration > 0 && Number.isFinite(duration))) throw new Error('无法读取音频的准确时长或采样率。')
  const frameRate = fraction(video?.r_frame_rate)
  const averageRate = fraction(video?.avg_frame_rate)
  const videoSeconds = video ? streamDuration(video, Number(parsed.format?.duration)) : 0
  const containerFrames = exactContainerFrames(audio, parsed.format?.format_name, sampleRate)
  const timed = async <T>(work: () => Promise<T>): Promise<[T, number]> => { const at = performance.now(); const value = await work(); return [value, performance.now() - at] }
  // 抽查点是文件里的绝对时间戳：从视频流的起点算（部分 TS/MTS 起点时间戳很大）。
  const videoStart = Number(video?.start_time ?? 0) || 0
  const samplePoints = videoSeconds > VIDEO_SAMPLE_SECONDS * 6 ? [0, videoSeconds / 2 - VIDEO_SAMPLE_SECONDS / 2, videoSeconds - VIDEO_SAMPLE_SECONDS].map(offset => videoStart + offset) : undefined
  const [[durationFrames, framesMs], [videoTiming, videoMs], [fingerprint, fingerprintMs]] = await Promise.all([
    timed(async () => containerFrames ?? decodedFrameCount(ffprobe, sourcePath, signal)),
    timed(async () => video ? videoPacketTiming(ffprobe, sourcePath, frameRate, signal, samplePoints) : 'stable' as const),
    timed(() => fingerprintAudioEditSource(sourcePath, signal)),
  ])
  if (!Number.isSafeInteger(durationFrames) || durationFrames <= 0) throw new Error('无法确认音频的实际采样长度。')
  if (timings) Object.assign(timings, { bytes: fingerprint.size, framesFrom: containerFrames ? 'container' : 'decode', ...(video ? { videoTiming } : {}), headerMs, framesMs, videoMs, fingerprintMs } satisfies AudioEditProbeTimings)
  return {
    sourcePath, audioPath: sourcePath, ownership: 'external', fingerprint,
    mediaType: video ? 'video' : 'audio', sampleRate, durationFrames,
    channels: audio.channels ?? 1, audioStreamIndex: audio.index, audioStartSeconds: Number(audio.start_time ?? 0),
    ...(video ? { video: { frameRate, width: video.width ?? 0, height: video.height ?? 0, startSeconds: Number(video.start_time ?? 0), durationSeconds: videoSeconds,
      variableFrameRate: videoTiming === 'unstable' || !frameRate.numerator || !averageRate.numerator || Math.abs(frameRate.numerator / frameRate.denominator - averageRate.numerator / averageRate.denominator) > 0.01 } } : {}),
  }
}

/**
 * 导入音频或视频（3.3：导入即建草稿）：只探测素材、计算内容指纹，返回素材信息；
 * 草稿文档由渲染层经文档会话新建（默认引用原文件，重要记录 006），主进程不写口播内容。
 */
export async function probeAudioEditImport(sourcePath: string, requestId: string = crypto.randomUUID(), signal?: AbortSignal): Promise<AudioEditSourceMetadata> {
  const controller = new AbortController()
  const abort = (): void => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const release = registerAudioEditTaskController(requestId, requestId, controller, true)
  logger.info('开始读取口播素材', { event: 'audio_edit.source.probe.start', requestId })
  const startedAt = performance.now()
  try {
    const timings: Partial<AudioEditProbeTimings> = {}
    const source = await probeAudioEditSource(path.resolve(await resolveLocalMediaPath(sourcePath)), controller.signal, timings)
    controller.signal.throwIfAborted()
    logger.info('口播素材读取完成', { event: 'audio_edit.source.probe.completed', requestId, context: { mediaType: source.mediaType, durationFrames: source.durationFrames, durationSeconds: source.durationFrames / source.sampleRate, sampleRate: source.sampleRate, channels: source.channels, ...timings, elapsedMs: performance.now() - startedAt } })
    return source
  } catch (error) {
    logger.error('口播素材读取未完成', { event: controller.signal.aborted ? 'audio_edit.source.probe.cancelled' : 'audio_edit.source.probe.failed', requestId, error, context: { elapsedMs: performance.now() - startedAt } })
    throw error
  } finally { release(); signal?.removeEventListener('abort', abort) }
}

/**
 * 外部素材整条转成 32 位浮点 WAV：在后台作为本作品的“准备”任务运行（界面显示进度，可以取消），帧数对齐到文档里的长度。
 * 转好的副本记为来历的根：它的波形会留增量用的摘要，之后补录拼接能从它派生。
 */
async function transcodeAudioEditSource(project: AudioEditProjectDocument, temporary: string, published: string): Promise<void> {
  const { sampleRate, channels, durationFrames } = project.source
  await runAudioEditTask(project.id, 'prepare', async (signal, progress) => {
    const started = performance.now()
    // 先按样本序号重排时间戳再裁剪/补齐：起点不在 0 的素材（mp3 编码延迟、视频里晚开始的音轨）也按解码出的第一个样本对齐。
    await runAudioEditProcess(await loadFfmpegPath(), ['-v', 'error', '-nostdin', '-y', '-i', project.source.sourcePath, '-map', `0:${project.source.audioStreamIndex ?? 0}`, '-vn',
      '-af', `asetpts=N/SR/TB,atrim=end_sample=${durationFrames},apad=whole_len=${durationFrames}`,
      '-c:a', 'pcm_f32le', '-rf64', 'auto', '-ar', String(sampleRate), '-ac', String(channels), '-progress', 'pipe:2', temporary], signal, line => {
      if (line.startsWith('out_time_us=')) progress(Math.min(1, Number(line.slice(12)) / 1e6 * sampleRate / durationFrames))
    })
    await validateAudioEditAudio(temporary, sampleRate, channels, durationFrames, signal)
    await recordAudioLineage(published, durationFrames, undefined, { stampFrom: temporary })
    logger.info('口播素材已转成浮点副本', { event: 'audio_edit.source.transcode.completed', context: { projectId: project.id, durationFrames, durationSeconds: durationFrames / sampleRate, bytes: (await fs.stat(temporary)).size, elapsedMs: performance.now() - started } })
  }, crypto.randomUUID(), '', true)
}

/** 只等到 operation 完成或 signal 取消为止：取消只让这一个调用方不再等，operation 照常跑完。 */
function waitUnless<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return operation
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason ?? new DOMException('已取消', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/**
 * Only algorithms that require WAV request this rebuildable derivative.
 * 转码是这份素材所有调用方（试听、频谱、转写、导出、拼接）共用的后台任务：只能由它自己的任务取消（界面上的“取消”），
 * 任一调用方取消只是自己不再等，转好的副本照常发布给其他人。
 */
export async function prepareAudioEditAudio(project: AudioEditProjectDocument, signal?: AbortSignal): Promise<string> {
  await verifyAudioEditSource(project, signal, 'quick')
  if (project.source.ownership !== 'external') {
    await ensureAudioLineageRoot(project.source.audioPath, project.source.durationFrames)
    return project.source.audioPath
  }
  const directory = audioEditCacheDirectory(project.id)
  const name = `audio-f32-${await audioEditSourceContentKey(project.source, signal)}-${project.source.audioStreamIndex ?? 0}-${project.source.sampleRate}-${project.source.channels}`
  const transcoded = cachedAudioFile(directory, name, 'wav', temporary => transcodeAudioEditSource(project, temporary, path.join(directory, `${name}.wav`)))
  transcoded.catch(() => undefined)
  return waitUnless(transcoded, signal)
}

const TRANSCRIPTION_SAMPLE_RATE = 16_000
const TRANSCRIPTION_ENCODERS: Record<AsrUploadEncoding, { extension: string; codec: string[] }> = {
  opus: { extension: 'ogg', codec: ['-c:a', 'libopus', '-b:a', '32k'] },
  pcm16: { extension: 'wav', codec: ['-c:a', 'pcm_s16le'] },
}

/**
 * 转写上传用的副本：16 kHz 单声道（识别模型按 16 kHz 单声道工作），Opus（32 kbit/s）每小时不超过约 14 MB、16 位 PCM 每小时约 115 MB；
 * 浮点副本原样上传时 60 分钟单声道约 691 MB、立体声超过百炼临时存储 1 GB 上限。
 * 时间轴与文档帧一一对应：与浮点副本同一套按样本序号重排、裁剪补齐到文档长度，再重采样，识别回的毫秒时间戳直接换算回原素材帧。
 * 不用 MP3、AAC：它们的编码延迟（16 kHz 下约 60–70 ms）要靠解码端读私有头才扣得掉；Ogg Opus 的编码前导写在容器里，按标准解码时扣除。
 * 副本只为上传存在：按素材内容寻址放在本口播的缓存目录，重试直接复用。
 */
export async function prepareAudioEditTranscriptionAudio(project: AudioEditProjectDocument, encoding: AsrUploadEncoding, signal?: AbortSignal, range?: AudioEditRange): Promise<{ path: string; bytes: number }> {
  await verifyAudioEditSource(project, signal, 'quick')
  const { sampleRate, channels, ownership } = project.source
  // 补转写插入段时只截这一段（原素材采样帧区间），识别结果的时间再由调用方加上起点
  const startFrame = range?.startFrame ?? 0
  const durationFrames = (range?.endFrame ?? project.source.durationFrames) - startFrame
  // 应用内录音本身就是浮点 WAV；外部素材从原文件的那条音轨直接转，不必先落一份浮点副本。
  const input = ownership === 'external' ? project.source.sourcePath : project.source.audioPath
  const stream = ownership === 'external' ? project.source.audioStreamIndex ?? 0 : 0
  const encoder = TRANSCRIPTION_ENCODERS[encoding]
  const name = `asr-${encoding}-${await audioEditSourceContentKey(project.source, signal)}-${stream}${range ? `-${startFrame}-${durationFrames}` : ''}`
  // 各声道等权平均：单声道识别够用，也不会像直接相加那样削顶。
  const downmix = channels > 1 ? `pan=mono|c0=${Array.from({ length: channels }, (_, index) => `${1 / channels}*c${index}`).join('+')},` : ''
  const file = await cachedAudioFile(audioEditCacheDirectory(project.id), name, encoder.extension, async temporary => {
    await runAudioEditProcess(await loadFfmpegPath(), ['-v', 'error', '-nostdin', '-y', '-i', input, '-map', `0:${stream}`, '-vn',
      '-af', `asetpts=N/SR/TB,atrim=${range ? `start_sample=${startFrame}:end_sample=${startFrame + durationFrames},asetpts=N/SR/TB,` : `end_sample=${durationFrames},`}apad=whole_len=${durationFrames},${downmix}aresample=${TRANSCRIPTION_SAMPLE_RATE}`,
      ...encoder.codec, temporary], signal)
    const output = JSON.parse(await runAudioEditProcess(await loadFfprobePath(), ['-v', 'error', '-select_streams', 'a:0', '-show_streams', '-of', 'json', temporary], signal)) as { streams?: ProbeStream[] }
    const audio = output.streams?.[0]
    // 只拦截写坏、写短的副本；Ogg Opus 报告的时长含 6.5 ms 编码前导，对齐由容器语义保证。
    if (!audio || audio.channels !== 1 || Math.abs(streamDuration(audio, 0) - durationFrames / sampleRate) > 0.05) throw new Error('转写用的音频副本长度不对，未上传。')
  }, signal)
  return { path: file, bytes: (await fs.stat(file)).size }
}

/**
 * 重新定位原素材：确认所选文件与原素材内容相同，返回新的素材信息；渲染层实例接收后经会话保存。
 * 带采样指纹的素材比指纹与帧数；只有整文件摘要的素材按整文件摘要比对，并保留原帧数与摘要，已有派生缓存继续命中。
 */
export async function relinkAudioEditSource(projectId: string, sourcePath: string): Promise<AudioEditSourceMetadata> {
  assertAudioEditProjectIdle(projectId)
  const current = (await requireAudioEditProject(projectId)).source
  const file = path.resolve(await resolveLocalMediaPath(sourcePath))
  const next = await probeAudioEditSource(file)
  const mismatch = (): Error => new Error('所选文件不是原素材。请将不同内容作为新口播导入。')
  if (current.fingerprint) {
    if (next.fingerprint?.digest !== current.fingerprint.digest || next.durationFrames !== current.durationFrames || next.sampleRate !== current.sampleRate || next.channels !== current.channels) throw mismatch()
    return next
  }
  const oldDigest = current.identity?.digest ?? (await digestWholeAudioEditSource(current.sourcePath)).digest
  const identity = await digestWholeAudioEditSource(file)
  if (identity.digest !== oldDigest) throw mismatch()
  return { ...next, identity, durationFrames: current.durationFrames }
}

/** Verify a rendered derivative before caching or publishing it. */
export async function validateAudioEditAudio(file: string, sampleRate: number, channels: number, durationFrames: number, signal?: AbortSignal): Promise<void> {
  const output = JSON.parse(await runAudioEditProcess(await loadFfprobePath(), ['-v', 'error', '-select_streams', 'a:0', '-show_streams', '-of', 'json', file], signal)) as { streams?: ProbeStream[] }
  const audio = output.streams?.[0]
  if (!audio || Number(audio.sample_rate) !== sampleRate || audio.channels !== channels || Math.abs(streamDuration(audio, 0) * sampleRate - durationFrames) > 1.01) throw new Error('处理音轨的长度或声道不匹配，未提交导出。')
}
