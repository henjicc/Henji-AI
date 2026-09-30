import { app } from 'electron'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { VideoPreviewProxyRequest, VideoPreviewProxyResult } from '../../../../src/core/videoEdit/preview'
import { loadFfmpegPath } from './ffmpeg-loader'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.video_preview')
const jobs = new Map<string, { owner: number; abort: AbortController }>()
const leases = new Map<string, { owner: number; path: string }>()
let tail = Promise.resolve()
let encoder: Promise<string[]> | undefined
function previewEncoder(binary: string): Promise<string[]> {
  return encoder ??= new Promise(resolve => {
    execFile(binary, ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=128x72:rate=60', '-frames:v', '1', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { windowsHide: true, maxBuffer: 1024 * 1024 }, error => resolve(error
      ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18']
      : ['-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'ull', '-rc', 'constqp', '-qp', '18']))
  })
}
export function releaseVideoPreviewOwner(owner: number): void {
  for (const job of jobs.values()) if (job.owner === owner) job.abort.abort()
  for (const [id, lease] of leases) if (lease.owner === owner) leases.delete(id)
}
export function cancelVideoPreview(requestId: string, owner: number): void {
  const job = jobs.get(requestId)
  if (job && job.owner !== owner) throw new Error('预览任务不属于当前窗口。')
  job?.abort.abort()
  const lease = leases.get(requestId)
  if (lease && lease.owner !== owner) throw new Error('预览缓存不属于当前窗口。')
  leases.delete(requestId)
}
export function validateVideoPreviewRequest(input: unknown): VideoPreviewProxyRequest {
  const value = input as Partial<VideoPreviewProxyRequest> | null
  if (!value || typeof value.requestId !== 'string' || !/^[\da-f-]{36}$/i.test(value.requestId) || typeof value.source !== 'string' || !path.isAbsolute(value.source)
    || typeof value.startSeconds !== 'number' || !Number.isFinite(value.startSeconds) || value.startSeconds < 0
    || typeof value.durationSeconds !== 'number' || !Number.isFinite(value.durationSeconds) || value.durationSeconds <= 0 || value.durationSeconds > 32) throw new Error('预览素材或时间范围无效。')
  return value as VideoPreviewProxyRequest
}
async function trimCache(directory: string, keep: string): Promise<void> {
  const entries = await Promise.all((await fs.readdir(directory)).filter(name => /^[\da-f]{64}\.mp4$/.test(name)).map(async name => { const file = path.join(directory, name); const stat = await fs.stat(file); return { file, ...stat } }))
  let bytes = entries.reduce((sum, entry) => sum + entry.size, 0)
  for (const entry of entries.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (bytes <= 8 * 1024 ** 3) break
    if (entry.file === keep || [...leases.values()].some(lease => lease.path === entry.file)) continue
    await fs.unlink(entry.file); bytes -= entry.size
  }
}
/** One cancellable FFmpeg process at a time. No media copies enter a project. */
export async function prepareVideoPreview(request: VideoPreviewProxyRequest, owner: number): Promise<VideoPreviewProxyResult> {
  if (jobs.has(request.requestId) || leases.has(request.requestId) || jobs.size >= 16) throw new Error('已有预览任务正在准备。')
  const abort = new AbortController(); jobs.set(request.requestId, { owner, abort })
  const preceding = tail; let release!: () => void; tail = new Promise(resolve => { release = resolve })
  const started = performance.now()
  let temporary: string | undefined
  logger.info('准备流畅视频预览', { event: 'video_preview.prepare.start', requestId: request.requestId })
  try {
    await preceding; abort.signal.throwIfAborted()
    const source = await fs.realpath(request.source); const original = await fs.stat(source)
    if (!original.isFile()) throw new Error('预览源必须是本地文件。')
    const directory = path.join(app.getPath('userData'), 'cache', 'video-edit-preview'); await fs.mkdir(directory, { recursive: true })
    const digest = crypto.createHash('sha256').update(JSON.stringify([source, original.size, original.mtimeMs, request.startSeconds, request.durationSeconds, 'full-resolution-all-i-source-timebase-v3'])).digest('hex')
    const output = path.join(directory, `${digest}.mp4`)
    let cacheHit = true
    try { await fs.access(output) } catch {
      cacheHit = false; temporary = path.join(directory, `${digest}-${request.requestId}.partial.mp4`)
      const binary = await loadFfmpegPath(); abort.signal.throwIfAborted()
      const codec = await previewEncoder(binary); abort.signal.throwIfAborted()
      const args = ['-v', 'error', '-y', '-threads', '6', '-copyts', '-ss', String(request.startSeconds), '-i', source, '-t', String(request.durationSeconds), '-map', '0:v:0', '-an', '-vf', `setpts=PTS-${request.startSeconds}/TB`, ...codec, '-g', '1', '-bf', '0', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-enc_time_base', 'demux', '-avoid_negative_ts', 'disabled', '-movflags', '+faststart', temporary]
      await new Promise<void>((resolve, reject) => { execFile(binary, args, { windowsHide: true, maxBuffer: 1024 * 1024, signal: abort.signal }, error => error ? reject(error) : resolve()) })
      abort.signal.throwIfAborted(); await fs.rename(temporary, output); temporary = undefined
    }
    const result = { path: output, startSeconds: request.startSeconds, durationSeconds: request.durationSeconds, preparationMs: performance.now() - started, sizeBytes: (await fs.stat(output)).size, cacheHit }
    abort.signal.throwIfAborted(); leases.set(request.requestId, { owner, path: output })
    logger.info('流畅视频预览已准备', { event: 'video_preview.prepare.completed', requestId: request.requestId, context: { preparationMs: result.preparationMs, sizeBytes: result.sizeBytes, cacheHit } })
    await trimCache(directory, output)
    return result
  } catch (error) {
    leases.delete(request.requestId)
    if (abort.signal.aborted) logger.info('已取消预览准备', { event: 'video_preview.prepare.cancelled', requestId: request.requestId })
    else logger.error('预览准备失败', { error, event: 'video_preview.prepare.failed', requestId: request.requestId })
    throw error
  } finally { jobs.delete(request.requestId); release(); if (temporary) await fs.rm(temporary, { force: true }) }
}
app.on('before-quit', () => { for (const job of jobs.values()) job.abort.abort() })
