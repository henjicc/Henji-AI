import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { createMainLogger } from '../logging'
import type { VideoEditExportEncoding, VideoEditExportCapabilities } from '../../../../src/core/videoEdit/exportEncoding'
import { videoEditExportCapabilities } from './capabilities'
import { runVideoEditExportFfmpeg, videoEditExportFfmpegArgs } from './ffmpeg'

const logger = createMainLogger('main.video_edit_export')
const activeDirectories = new Set<string>()
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}
interface Session {
  id: string; owner: string; jobId: string; path: string; directory: string; intermediatePath: string
  controller: AbortController; progress: number; running?: Promise<void>
}
export class VideoEditExportCompression {
  private readonly sessions = new Map<string, Session>()
  private tail: Promise<void> = Promise.resolve()
  private preparing: Promise<void> = Promise.resolve()
  constructor(private readonly binary = loadFfmpegPath, private readonly capabilities: () => Promise<VideoEditExportCapabilities> = videoEditExportCapabilities) {}
  prepare(owner: string, jobId: string, outputPath: string, estimatedBytes = 0): Promise<{ id: string; intermediatePath: string }> {
    const pending = this.preparing.then(() => this.prepareSession(owner, jobId, outputPath, estimatedBytes))
    this.preparing = pending.then(() => undefined, () => undefined)
    return pending
  }
  private async prepareSession(owner: string, jobId: string, outputPath: string, estimatedBytes: number): Promise<{ id: string; intermediatePath: string }> {
    const parent = path.dirname(outputPath)
    for (const item of await fs.readdir(parent, { withFileTypes: true })) {
      const directory = path.join(parent, item.name)
      const temporary = /^\.henji-export-(?:(\d+)-)?[a-zA-Z0-9]{6}$/.exec(item.name)
      if (!item.isDirectory() || !temporary || activeDirectories.has(directory)) continue
      // 正式窗口和助手可在不同进程导出到同一目录，不能清理仍存活的其他进程。
      if (temporary[1] && Number(temporary[1]) !== process.pid && processAlive(Number(temporary[1]))) continue
      await this.removeTemporary(directory, { jobId })
    }
    const disk = await fs.statfs(parent, { bigint: true })
    const available = disk.bavail * disk.bsize
    // 成片按高码率中间文件的四分之一估算，再留 1 GB 给封装与分析日志。
    const required = BigInt(Math.ceil(estimatedBytes * 1.25)) + 1_000_000_000n
    if (available < required) throw new Error(`导出磁盘空间不足：预计需要 ${(Number(required) / 1_000_000_000).toFixed(2)} GB，可用 ${(Number(available) / 1_000_000_000).toFixed(2)} GB。`)
    const directory = await fs.mkdtemp(path.join(parent, `.henji-export-${process.pid}-`))
    activeDirectories.add(directory)
    const session: Session = { id: randomUUID(), owner, jobId, path: outputPath, directory, intermediatePath: path.join(directory, 'intermediate.mp4'), controller: new AbortController(), progress: 0 }
    try { await fs.writeFile(session.intermediatePath, new Uint8Array(), { flag: 'wx' }) }
    catch (error) { activeDirectories.delete(directory); await this.removeTemporary(directory, { jobId }); throw error }
    this.sessions.set(session.id, session)
    logger.info('准备导出中间文件', { event: 'video_edit_export.intermediate.start', context: { jobId, sessionId: session.id } })
    return { id: session.id, intermediatePath: session.intermediatePath }
  }
  private require(owner: string, id: string): Session {
    const session = this.sessions.get(id)
    if (!session || session.owner !== owner) throw new Error('导出压制任务不存在或已结束。')
    return session
  }
  progress(owner: string, id: string): number { return this.require(owner, id).progress }
  finish(owner: string, id: string, encoding: VideoEditExportEncoding, fps: number, durationSeconds: number, publish: (jobId: string, target: string, staging: string) => Promise<void>, videoBitrateMbps = 50): Promise<void> {
    const session = this.require(owner, id)
    if (session.running) throw new Error('此导出已在压制。')
    const previous = this.tail
    const work = async (): Promise<void> => {
      const context = { jobId: session.jobId, sessionId: id, encoder: encoding.encoder }
      try {
        session.controller.signal.throwIfAborted()
        await new Promise<void>((resolve, reject) => {
          const signal = session.controller.signal
          const aborted = (): void => reject(signal.reason)
          signal.addEventListener('abort', aborted, { once: true })
          void previous.then(() => { signal.removeEventListener('abort', aborted); resolve() })
        })
        session.controller.signal.throwIfAborted()
        const capability = await this.capabilities()
        const supported = capability.encoders[encoding.encoder]
        if (!supported.supported || encoding.tenBit && !supported.tenBit) throw new Error(supported.reason ?? '此编码器不支持所选输出位深。')
        const binary = await this.binary(), output = path.join(session.directory, 'compressed.mp4')
        const passes = encoding.rateControl === 'two_pass' && !encoding.encoder.endsWith('_nvenc') ? [1, 2] as const : [2] as const
        logger.info('开始压制导出视频', { event: 'video_edit_export.compress.start', context })
        for (const [index, number] of passes.entries()) {
          session.controller.signal.throwIfAborted()
          const pass = passes.length === 2 ? { number, log: path.join(session.directory, 'analysis') } : undefined
          await runVideoEditExportFfmpeg(binary, videoEditExportFfmpegArgs(session.intermediatePath, output, encoding, fps, capability.cuda, pass, videoBitrateMbps), session.controller.signal, line => {
            const match = /^out_time_us=(\d+)$/.exec(line)
            if (match) session.progress = Math.max(session.progress, Math.min(.99, (index + Math.min(1, Number(match[1]) / 1_000_000 / durationSeconds)) / passes.length))
          }, session.directory)
        }
        session.controller.signal.throwIfAborted()
        if (!(await fs.stat(output)).size) throw new Error('视频压制结果为空。')
        await publish(session.jobId, session.path, output)
        session.progress = 1
        logger.info('视频压制完成', { event: 'video_edit_export.compress.completed', context })
      } catch (error) {
        if (session.controller.signal.aborted) logger.info('视频压制已取消', { event: 'video_edit_export.compress.cancelled', context })
        else logger.error('视频压制失败', { event: 'video_edit_export.compress.failed', error, context })
        throw error
      } finally { await this.clean(session) }
    }
    session.running = work()
    // 排队任务可以提前取消，但不能让其后续任务越过尚未结束的前驱。
    this.tail = Promise.all([previous, session.running.catch(() => undefined)]).then(() => undefined)
    return session.running
  }
  async cancel(owner: string, id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session || session.owner !== owner) return
    session.controller.abort()
    if (session.running) await session.running.catch(() => undefined)
    else await this.clean(session)
  }
  async release(match: (owner: string) => boolean): Promise<void> {
    const sessions = [...this.sessions.values()].filter(session => match(session.owner))
    for (const session of sessions) session.controller.abort()
    for (const session of sessions) await this.cancel(session.owner, session.id)
  }
  private async clean(session: Session): Promise<void> {
    await this.removeTemporary(session.directory, { jobId: session.jobId, sessionId: session.id })
    activeDirectories.delete(session.directory)
    this.sessions.delete(session.id)
  }
  private async removeTemporary(directory: string, context: { jobId: string; sessionId?: string }): Promise<void> {
    try { await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
    catch (error) { logger.warn('清理导出中间文件失败，下次导出时重试', { event: 'video_edit_export.intermediate.cleanup_failed', error, context }) }
  }
}
export const videoEditExportCompression = new VideoEditExportCompression()
