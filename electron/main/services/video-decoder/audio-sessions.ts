import type { MainLogger } from '../logging/main-logger'
import type { VideoDecoderService } from './client'
import { VIDEO_DECODER_MAX_MESSAGE_BYTES, VideoDecoderError } from './protocol'
import type { VideoFrameTarget } from './texture-bridge'
import { VIDEO_AUDIO_MAX_READ_FRAMES, type VideoAudioOpenRequest, type VideoAudioReadRequest, type VideoAudioReadResult, type VideoAudioSessionInfo } from '../../../../src/platform/contracts/videoFrameTypes'

/**
 * 原生声音会话（2.3）：渲染 Worker 经帧通道端口打开、读取、关闭；PCM 走 CPU（数据量小，48kHz 立体声约 384KB/秒），
 * 不经显卡纹理通道。会话归属打开它的窗口与通道：只有该窗口能读写，窗口失效、通道断开或服务退出时全部关闭。
 * 路径授权由 IPC 层检查。
 */

export type VideoAudioSessionService = Pick<VideoDecoderService, 'openAudio' | 'readAudio' | 'closeAudio' | 'onLifecycle'>

export interface VideoAudioSessionsOptions {
  service: VideoAudioSessionService
  logger: Pick<MainLogger, 'debug' | 'info' | 'warn' | 'error'>
  /** 每个窗口同时打开的声音会话上限（每个可闻片段一个，不占显存）。 */
  maxSessionsPerTarget?: number
}

interface AudioSession {
  id: string
  target: VideoFrameTarget
  route: string
  channels: number
}

const ROUTE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const AUDIO_ID_PATTERN = /^va-[0-9]{1,15}$/
/** 读取起点的绝对值上限（48kHz 下约 6000 小时），只防明显无效的请求。 */
const MAX_START_FRAME = 2 ** 40

function parseRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label}参数无效`)
  return input as Record<string, unknown>
}

function parseAudioId(record: Record<string, unknown>): string {
  if (typeof record.audioId !== 'string' || !AUDIO_ID_PATTERN.test(record.audioId)) throw new Error('声音参数 audioId 无效')
  return record.audioId
}

export function parseVideoAudioOpenRequest(input: unknown): VideoAudioOpenRequest {
  const record = parseRecord(input, '声音会话')
  if (typeof record.route !== 'string' || !ROUTE_PATTERN.test(record.route)) throw new Error('声音参数 route 无效')
  if (typeof record.path !== 'string' || record.path.length === 0 || record.path.length > 4096 || record.path.includes('\0')) throw new Error('声音参数 path 无效')
  const integer = (field: string, min: number, max: number): number | undefined => {
    const value = record[field]
    if (value === undefined) return undefined
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`声音参数 ${field} 无效`)
    return value
  }
  const audioStream = integer('audioStream', 0, 1023)
  const sampleRate = integer('sampleRate', 8000, 384_000)
  return { route: record.route, path: record.path, ...(audioStream !== undefined ? { audioStream } : {}), ...(sampleRate !== undefined ? { sampleRate } : {}) }
}

export function parseVideoAudioReadRequest(input: unknown): VideoAudioReadRequest {
  const record = parseRecord(input, '声音读取')
  const { startFrame, frames } = record
  if (typeof startFrame !== 'number' || !Number.isSafeInteger(startFrame) || Math.abs(startFrame) > MAX_START_FRAME) throw new Error('声音参数 startFrame 无效')
  if (typeof frames !== 'number' || !Number.isInteger(frames) || frames < 1 || frames > VIDEO_AUDIO_MAX_READ_FRAMES) throw new Error('声音参数 frames 无效')
  return { audioId: parseAudioId(record), startFrame, frames }
}

export function parseVideoAudioCloseRequest(input: unknown): string {
  return parseAudioId(parseRecord(input, '声音会话'))
}

export class VideoAudioSessions {
  private readonly sessions = new Map<string, AudioSession>()
  /** 每个窗口只登记一次失效监听（会话可多达数十个），最后一个会话关闭时取消。 */
  private readonly watched = new Map<number, () => void>()
  private nextId = 1
  private readonly maxSessionsPerTarget: number
  private readonly unsubscribe: () => void

  constructor(private readonly options: VideoAudioSessionsOptions) {
    this.maxSessionsPerTarget = options.maxSessionsPerTarget ?? 64
    // 服务进程退出时它的声音会话随之消失：只清理登记，之后的读取得到“会话不存在”，渲染层重新打开。
    this.unsubscribe = options.service.onLifecycle((event) => {
      if (event.type !== 'exited' || this.sessions.size === 0) return
      const count = this.sessions.size
      this.sessions.clear()
      for (const stop of this.watched.values()) stop()
      this.watched.clear()
      this.options.logger.warn('原生服务退出，声音会话失效', { event: 'video_audio.service.exited', context: { pid: event.pid, sessions: count } })
    })
  }

  get size(): number {
    return this.sessions.size
  }

  async open(target: VideoFrameTarget, request: VideoAudioOpenRequest): Promise<VideoAudioSessionInfo> {
    if (target.isDestroyed()) throw new VideoDecoderError('TARGET_GONE', '目标窗口已关闭')
    const owned = [...this.sessions.values()].filter((session) => session.target.id === target.id).length
    if (owned >= this.maxSessionsPerTarget) {
      this.options.logger.warn('窗口声音会话数达到上限', { event: 'video_audio.budget.window_limit', context: { targetId: target.id, limit: this.maxSessionsPerTarget } })
      throw new VideoDecoderError('BUDGET_EXCEEDED', `同一窗口最多 ${this.maxSessionsPerTarget} 路声音会话`)
    }
    const audioId = `va-${this.nextId++}`
    const { route, ...rest } = request
    let opened: Awaited<ReturnType<VideoAudioSessionService['openAudio']>>
    try {
      opened = await this.options.service.openAudio({ audioId, ...rest })
    } catch (error) {
      this.options.logger.warn('打开声音会话失败', { event: 'video_audio.open.failed', error, context: { audioId, targetId: target.id, route, audioStream: rest.audioStream ?? 0, code: error instanceof VideoDecoderError ? error.code : undefined } })
      throw error
    }
    if (!opened.found) return { found: false, audioStream: opened.audioStream }
    if (target.isDestroyed()) {
      void this.options.service.closeAudio(audioId).catch(() => undefined)
      throw new VideoDecoderError('TARGET_GONE', '目标窗口已关闭')
    }
    this.sessions.set(audioId, { id: audioId, target, route, channels: opened.channels })
    if (!this.watched.has(target.id)) this.watched.set(target.id, target.onGone((reason) => void this.closeTarget(target.id, reason)))
    this.options.logger.info('声音会话已打开', {
      event: 'video_audio.open.completed',
      context: { audioId, targetId: target.id, route, audioStream: opened.audioStream, streamIndex: opened.streamIndex, codec: opened.codec, decoder: opened.decoderName, sourceSampleRate: opened.sourceSampleRate, sampleRate: opened.sampleRate, channels: opened.channels, channelLayout: opened.channelLayout, resampler: opened.resampler, setupMs: opened.setupMs },
    })
    const { setupMs: _setupMs, ...info } = opened
    return { ...info, route }
  }

  private owned(audioId: string, targetId: number): AudioSession {
    const session = this.sessions.get(audioId)
    // Gone with an exited service, or never this window's: the consumer reopens the session (3.1).
    if (!session || session.target.id !== targetId) throw new VideoDecoderError('SESSION_GONE', '声音会话不存在或不属于当前窗口')
    return session
  }

  async read(targetId: number, request: VideoAudioReadRequest): Promise<VideoAudioReadResult> {
    const session = this.owned(request.audioId, targetId)
    if (request.frames * session.channels * 4 > VIDEO_DECODER_MAX_MESSAGE_BYTES) throw new Error('单次声音读取过长')
    const read = await this.options.service.readAudio(request.audioId, request.startFrame, request.frames)
    if (read.frames !== request.frames || read.startFrame !== request.startFrame || read.channels !== session.channels || read.data.length !== read.frames * read.channels * 4) {
      throw new VideoDecoderError('PROTOCOL_ERROR', '原生视频解码服务返回的声音数据与请求不符')
    }
    return { audioId: read.audioId, startFrame: read.startFrame, frames: read.frames, channels: read.channels, data: read.data, seeked: read.seeked, decodeMs: read.decodeMs }
  }

  async close(audioId: string, targetId?: number, reason = 'requested'): Promise<boolean> {
    const session = this.sessions.get(audioId)
    if (!session || (targetId !== undefined && session.target.id !== targetId)) return false
    this.sessions.delete(audioId)
    if (![...this.sessions.values()].some((other) => other.target.id === session.target.id)) {
      this.watched.get(session.target.id)?.()
      this.watched.delete(session.target.id)
    }
    try {
      await this.options.service.closeAudio(audioId)
    } catch (error) {
      this.options.logger.warn('关闭声音会话时原生服务未响应', { event: 'video_audio.close_failed', error, context: { audioId, reason } })
    }
    return true
  }

  /** 关闭某窗口某条通道上的全部声音会话（通道断开时兜底）。 */
  async closeRoute(targetId: number, route: string): Promise<number> {
    const owned = [...this.sessions.values()].filter((session) => session.target.id === targetId && session.route === route)
    await Promise.all(owned.map((session) => this.close(session.id, undefined, 'route_closed')))
    return owned.length
  }

  async closeTarget(targetId: number, reason: string): Promise<void> {
    const owned = [...this.sessions.values()].filter((session) => session.target.id === targetId)
    await Promise.all(owned.map((session) => this.close(session.id, undefined, reason)))
  }

  async dispose(): Promise<void> {
    this.unsubscribe()
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id, undefined, 'disposed')))
  }
}
