import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AudioEditProjectCreateRequest, AudioEditProjectDocument, AudioEditSourceIdentity, AudioEditSourceMetadata } from '../../../../src/core/audioEdit/types'
import { DEFAULT_AUDIO_EDIT_SETTINGS } from '../../../../src/core/audioEdit/edits'
import { resolveLocalMediaPath } from '../media/shared'
import { getDb, getHenjiDataDir } from '../db'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { createMainLogger } from '../logging'
import { requireAudioEditProject, saveAudioEditProject } from './project-store'
import { runAudioEditProcess } from './process'
import { assertAudioEditProjectIdle } from './task-store'

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
  if (!/^[\w-]+$/.test(projectId)) throw new Error('工程引用无效')
  return path.join(getHenjiDataDir(), 'AudioEdit', projectId, 'cache')
}
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

export async function createAudioEditProject(request: AudioEditProjectCreateRequest): Promise<AudioEditProjectDocument> {
  const requestId = crypto.randomUUID()
  logger.info('开始创建口播剪辑工程', { event: 'audio_edit.project.create.start', requestId })
  try {
    const sourcePath = path.resolve(await resolveLocalMediaPath(request.sourcePath))
    const source = await probeAudioEditSource(sourcePath)
    const now = Date.now()
    const project = saveAudioEditProject({ id: crypto.randomUUID(), name: request.name?.trim() || path.basename(sourcePath), source,
      referenceScript: request.referenceScript?.trim() ?? '', transcript: [], suggestions: [], cuts: [],
      batchSettings: { ...DEFAULT_AUDIO_EDIT_SETTINGS }, processorChain: [], vstEnabled: false, createdAt: now, updatedAt: now, revision: 1 })
    logger.info('口播剪辑工程创建完成', { event: 'audio_edit.project.create.completed', requestId, context: { projectId: project.id } })
    return project
  } catch (error) {
    logger.error('口播剪辑工程创建失败', { event: 'audio_edit.project.create.failed', requestId, error })
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

export async function relinkAudioEditSource(projectId: string, sourcePath: string): Promise<AudioEditProjectDocument> {
  assertAudioEditProjectIdle(projectId)
  const current = requireAudioEditProject(projectId)
  const next = await probeAudioEditSource(path.resolve(await resolveLocalMediaPath(sourcePath)))
  const oldDigest = current.source.identity?.digest ?? (await identifyAudioEditSource(current.source.sourcePath)).digest
  if (next.identity?.digest !== oldDigest) throw new Error('所选文件不是原素材。请将不同内容作为新工程导入。')
  return saveAudioEditProject({ ...requireAudioEditProject(projectId), source: next })
}

export async function deleteAudioEditProject(projectId: string): Promise<void> {
  assertAudioEditProjectIdle(projectId)
  requireAudioEditProject(projectId)
  // Only the explicit cache child is owned here; legacy source copies remain untouched.
  await fs.rm(audioEditCacheDirectory(projectId), { recursive: true, force: true })
  getDb().transaction(() => {
    getDb().prepare('DELETE FROM audio_edit_tasks WHERE project_id = ?').run(projectId)
    getDb().prepare('DELETE FROM audio_edit_projects WHERE id = ?').run(projectId)
  })()
}

/** Verify a rendered derivative before caching or publishing it. */
export async function validateAudioEditAudio(file: string, sampleRate: number, channels: number, durationFrames: number, signal?: AbortSignal): Promise<void> {
  const output = JSON.parse(await runAudioEditProcess(await loadFfprobePath(), ['-v', 'error', '-select_streams', 'a:0', '-show_streams', '-of', 'json', file], signal)) as { streams?: ProbeStream[] }
  const audio = output.streams?.[0]
  if (!audio || Number(audio.sample_rate) !== sampleRate || audio.channels !== channels || Math.abs(streamDuration(audio, 0) * sampleRate - durationFrames) > 1.01) throw new Error('处理音轨的长度或声道不匹配，未提交导出。')
}
