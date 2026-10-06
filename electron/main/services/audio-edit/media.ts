import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AudioEditProjectDocument, AudioEditSourceIdentity, AudioEditSourceMetadata } from '../../../../src/core/audioEdit/types'
import { resolveLocalMediaPath } from '../media/shared'
import { getProgramStoreDir } from '../appPaths'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { createMainLogger } from '../logging'
import { requireAudioEditProject } from './project-store'
import { runAudioEditProcess } from './process'
import { assertAudioEditProjectIdle, deleteAudioEditTasks, hasActiveAudioEditTask } from './task-store'
import { registerDocumentProgramStateCleaner } from '../documents/program-state-cleaners'

const logger = createMainLogger('main.audio_edit')
interface ProbeStream {
  index: number; codec_type?: string; sample_rate?: string; channels?: number; duration?: string
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
  return path.join(getProgramStoreDir('audioEdit'), projectId, 'cache')
}
// 口播文档离开作品（回收站、删除空草稿、从列表移除）时清掉程序目录 AudioEdit/<文档 ID>（解码缓存、处理结果）
// 与任务回执，都可重建；还有任务在跑时不动（下次离开或手动清理时再说）。别的类型的文档 ID 在这里没有数据，不受影响。
registerDocumentProgramStateCleaner('audio_edit', async (docId) => {
  if (!/^[\w-]+$/.test(docId) || hasActiveAudioEditTask(docId)) return
  const removedTasks = deleteAudioEditTasks(docId)
  await fs.rm(path.join(getProgramStoreDir('audioEdit'), docId), { recursive: true, force: true })
  if (removedTasks) logger.info('口播内部缓存已清理', { event: 'audio_edit.program_state.cleaned', context: { docId, removedTasks } })
})

export async function identifyAudioEditSource(sourcePath: string): Promise<AudioEditSourceIdentity> {
  const before = await fs.stat(sourcePath)
  const digest = crypto.createHash('sha256')
  for await (const chunk of createReadStream(sourcePath)) digest.update(chunk)
  const after = await fs.stat(sourcePath)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('素材正在被修改，请稍后重新导入。')
  return { size: after.size, mtimeMs: after.mtimeMs, digest: digest.digest('hex') }
}
export async function verifyAudioEditSource(project: AudioEditProjectDocument, deep = true): Promise<void> {
  let stat
  try { stat = await fs.stat(project.source.sourcePath) }
  catch { throw new Error('找不到原素材，请重新定位文件。') }
  const identity = project.source.identity
  if (!identity) return
  if (!deep && identity.size === stat.size && identity.mtimeMs === stat.mtimeMs) return
  const current = await identifyAudioEditSource(project.source.sourcePath)
  if (current.digest !== identity.digest) throw new Error('原素材内容已改变，请重新导入；旧剪辑不能用于新的录音。')
}

async function verifyVideoPacketTiming(ffprobe: string, sourcePath: string, frameRate: { numerator: number; denominator: number }): Promise<boolean> {
  const fps = frameRate.numerator / frameRate.denominator
  if (!(fps > 0 && Number.isFinite(fps))) return false
  let origin: number | undefined
  let cursor = 0
  let count = 0
  let valid = true
  const pending = new Set<number>()
  await runAudioEditProcess(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', sourcePath], undefined, undefined, (line) => {
    if (!line.trim()) return
    const [pts, duration] = line.split(',').map(Number)
    if (!Number.isFinite(pts) || !(duration > 0) || Math.abs(duration * fps - 1) > 0.02) { valid = false; return }
    origin ??= pts
    const position = (pts - origin) * fps
    const frame = Math.round(position)
    count += 1
    if (Math.abs(frame - position) > 0.02 || frame < cursor || frame > cursor + 256 || pending.has(frame)) { valid = false; return }
    pending.add(frame)
    while (pending.delete(cursor)) cursor += 1
  })
  return valid && count > 0 && pending.size === 0
}

export async function probeAudioEditSource(sourcePath: string): Promise<AudioEditSourceMetadata> {
  const ffprobe = await loadFfprobePath()
  const parsed = JSON.parse(await runAudioEditProcess(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', sourcePath])) as { format?: { duration?: string }; streams?: ProbeStream[] }
  const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio')
  if (!audio) throw new Error('所选文件没有可用音轨。')
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video')
  const sampleRate = Number(audio.sample_rate)
  const duration = streamDuration(audio, Number(parsed.format?.duration))
  if (!(sampleRate > 0 && duration > 0 && Number.isFinite(duration))) throw new Error('无法读取音频的准确时长或采样率。')
  let durationFrames = 0
  await runAudioEditProcess(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_frames', '-show_entries', 'frame=nb_samples', '-of', 'csv=p=0', sourcePath], undefined, undefined, (line) => {
    const samples = Number(line.split(',')[0])
    if (Number.isSafeInteger(samples) && samples > 0) durationFrames += samples
  })
  if (!Number.isSafeInteger(durationFrames) || durationFrames <= 0) throw new Error('无法确认音频的实际采样长度。')
  const frameRate = fraction(video?.r_frame_rate)
  const averageRate = fraction(video?.avg_frame_rate)
  const stableVideo = video ? await verifyVideoPacketTiming(ffprobe, sourcePath, frameRate) : true
  return {
    sourcePath, audioPath: sourcePath, ownership: 'external', identity: await identifyAudioEditSource(sourcePath),
    mediaType: video ? 'video' : 'audio', sampleRate, durationFrames,
    channels: audio.channels ?? 1, audioStreamIndex: audio.index, audioStartSeconds: Number(audio.start_time ?? 0),
    ...(video ? { video: { frameRate, width: video.width ?? 0, height: video.height ?? 0, startSeconds: Number(video.start_time ?? 0), durationSeconds: streamDuration(video, Number(parsed.format?.duration)),
      variableFrameRate: !stableVideo || !frameRate.numerator || !averageRate.numerator || Math.abs(frameRate.numerator / frameRate.denominator - averageRate.numerator / averageRate.denominator) > 0.01 } } : {}),
  }
}

/**
 * 导入音频或视频（3.3：导入即建草稿）：只探测素材、计算内容指纹，返回素材信息；
 * 草稿文档由渲染层经文档会话新建（默认引用原文件，重要记录 006），主进程不写口播内容。
 */
export async function probeAudioEditImport(sourcePath: string): Promise<AudioEditSourceMetadata> {
  const requestId = crypto.randomUUID()
  logger.info('开始读取口播素材', { event: 'audio_edit.source.probe.start', requestId })
  try {
    const source = await probeAudioEditSource(path.resolve(await resolveLocalMediaPath(sourcePath)))
    logger.info('口播素材读取完成', { event: 'audio_edit.source.probe.completed', requestId, context: { mediaType: source.mediaType } })
    return source
  } catch (error) {
    logger.error('口播素材读取失败', { event: 'audio_edit.source.probe.failed', requestId, error })
    throw error
  }
}

/** Only algorithms that require WAV request this rebuildable derivative. */
export async function prepareAudioEditAudio(project: AudioEditProjectDocument, signal?: AbortSignal): Promise<string> {
  await verifyAudioEditSource(project, false)
  if (project.source.ownership !== 'external') return project.source.audioPath
  const directory = audioEditCacheDirectory(project.id)
  await fs.mkdir(directory, { recursive: true })
  const output = path.join(directory, `audio-${project.source.identity?.digest ?? 'source'}.wav`)
  if (await fs.stat(output).then(() => true, () => false)) return output
  const temporary = path.join(directory, `${crypto.randomUUID()}.wav`)
  try {
    await runAudioEditProcess(await loadFfmpegPath(), ['-v', 'error', '-y', '-i', project.source.sourcePath, '-map', `0:${project.source.audioStreamIndex ?? 0}`, '-vn', '-c:a', 'pcm_s16le', '-ar', String(project.source.sampleRate), '-ac', String(project.source.channels), temporary], signal)
    signal?.throwIfAborted()
    await fs.rename(temporary, output)
    return output
  } finally { await fs.rm(temporary, { force: true }) }
}

/**
 * 重新定位原素材：确认所选文件与原素材内容相同，返回新的素材信息；渲染层实例接收后经会话保存。
 */
export async function relinkAudioEditSource(projectId: string, sourcePath: string): Promise<AudioEditSourceMetadata> {
  assertAudioEditProjectIdle(projectId)
  const current = await requireAudioEditProject(projectId)
  const next = await probeAudioEditSource(path.resolve(await resolveLocalMediaPath(sourcePath)))
  const oldDigest = current.source.identity?.digest ?? (await identifyAudioEditSource(current.source.sourcePath)).digest
  if (next.identity?.digest !== oldDigest) throw new Error('所选文件不是原素材。请将不同内容作为新口播导入。')
  return next
}

/** Verify a rendered derivative before caching or publishing it. */
export async function validateAudioEditAudio(file: string, sampleRate: number, channels: number, durationFrames: number, signal?: AbortSignal): Promise<void> {
  const output = JSON.parse(await runAudioEditProcess(await loadFfprobePath(), ['-v', 'error', '-select_streams', 'a:0', '-show_streams', '-of', 'json', file], signal)) as { streams?: ProbeStream[] }
  const audio = output.streams?.[0]
  if (!audio || Number(audio.sample_rate) !== sampleRate || audio.channels !== channels || Math.abs(streamDuration(audio, 0) * sampleRate - durationFrames) > 1.01) throw new Error('处理音轨的长度或声道不匹配，未提交导出。')
}
