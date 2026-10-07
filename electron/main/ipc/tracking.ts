import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { IpcMainInvokeEvent } from 'electron'
import { TRACKING_IPC_CHANNELS, TRACKING_FRAME_MAX_BYTES, TRACKING_FRAME_MAX_COUNT, type TrackingCandidatesRequest, type TrackingDefinition, type TrackingRange, type TrackingRunOptions, type TrackingSource, type TrackingFrameProvider, type TrackingFrameReply } from '../../../src/platform/contracts/tracking'
import { videoEditTrackPointSchema, videoEditTrackPromptSchema, VIDEO_EDIT_TRACK_METHODS, VIDEO_EDIT_MAX_TRACK_PROMPTS } from '../../../src/core/videoEdit/tracking'
import { isPathWithinAllowedMediaRoots } from '../protocol'
import { normalizeLocalSource } from '../services/image/source'
import { getTrackingService } from '../services/tracking/runtime'
import { parseRecord, registerIpcHandler } from './registry'
import { TrackingFrameBroker } from '../services/tracking/frameBroker'

/*
 * 跟踪 IPC（任务 4.10）：渲染层经 preload `henjiNative.tracking` → PAL 调用。素材路径必须在已授权目录内（与智能区域同一规则）。
 */

const MAX_TIME_US = 24 * 3600 * 1e6
const sequenceSource = z.object({ kind: z.literal('sequence'), signature: z.string().uuid(), fps: z.number().finite().positive().max(240), width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192) }).strict()
const frames = new TrackingFrameBroker()
function parseSource(source: unknown): TrackingSource {
  if (typeof source === 'string' && source.trim()) return source
  return sequenceSource.parse(source)
}
function frameProvider(source: TrackingSource, event: IpcMainInvokeEvent): TrackingFrameProvider | undefined {
  if (typeof source === 'string') return undefined
  const sender = event.sender
  return frames.provider(source, { id: sender.id, send: value => { if (!sender.isDestroyed()) sender.send(TRACKING_IPC_CHANNELS.frames, value) }, onClosed: listener => { sender.once('destroyed', listener); return () => { sender.removeListener('destroyed', listener) } } })
}
export function parseTrackingFrameReply(input: unknown): TrackingFrameReply {
  const record = parseRecord(input)
  if (typeof record.id !== 'string' || record.id.length > 100 || !Array.isArray(record.frames) || record.frames.length > TRACKING_FRAME_MAX_COUNT) throw new Error('无效的跟踪帧回复。')
  if (record.error !== undefined && (typeof record.error !== 'string' || !record.error.length || record.error.length > 300)) throw new Error('无效的取帧错误。')
  let bytes = 0
  for (const frame of record.frames) {
    if (!(frame instanceof Uint8Array)) throw new Error('跟踪帧必须为 RGB 字节。')
    bytes += frame.byteLength
    if (bytes > TRACKING_FRAME_MAX_BYTES) throw new Error('跟踪帧批次过大。')
  }
  return { id: record.id, frames: record.frames as Uint8Array[], ...(record.error ? { error: record.error as string } : {}) }
}

function parseDefinition(value: unknown): TrackingDefinition {
  const record = parseRecord(value)
  if (Object.keys(record).some(key => !['source', 'method', 'prompts'].includes(key))) throw new Error('跟踪请求含未知字段。')
  if (typeof record.method !== 'string' || !(VIDEO_EDIT_TRACK_METHODS as readonly string[]).includes(record.method)) throw new Error('无效的跟踪方式。')
  if (!Array.isArray(record.prompts) || !record.prompts.length || record.prompts.length > VIDEO_EDIT_MAX_TRACK_PROMPTS) throw new Error('跟踪提示数量无效。')
  return { source: parseSource(record.source), method: record.method as TrackingDefinition['method'], prompts: record.prompts.map(prompt => videoEditTrackPromptSchema.parse(prompt)) }
}
function parseRange(value: unknown): TrackingRange {
  const record = parseRecord(value)
  const valid = (entry: unknown): entry is number => typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0 && entry <= MAX_TIME_US
  if (!valid(record.startUs) || !valid(record.endUs) || record.endUs <= record.startUs) throw new Error('无效的跟踪范围。')
  return { startUs: record.startUs, endUs: record.endUs }
}
function parseOptions(value: unknown): TrackingRunOptions {
  const record = parseRecord(value)
  if (record.direction !== 'both' && record.direction !== 'forward' && record.direction !== 'backward') throw new Error('无效的跟踪方向。')
  if (record.limit !== undefined && !(typeof record.limit === 'number' && Number.isSafeInteger(record.limit) && record.limit >= 1 && record.limit <= 100_000)) throw new Error('无效的跟踪帧数。')
  return { direction: record.direction, ...(record.limit !== undefined ? { limit: record.limit as number } : {}) }
}
export function parseTrackingRun(input: unknown): { definition: TrackingDefinition; range: TrackingRange; options: TrackingRunOptions } {
  const record = parseRecord(input)
  return { definition: parseDefinition(record.definition), range: parseRange(record.range), options: parseOptions(record.options) }
}
export function parseTrackingCandidates(input: unknown): TrackingCandidatesRequest {
  const record = parseRecord(input)
  if (!(typeof record.timeUs === 'number' && Number.isSafeInteger(record.timeUs) && record.timeUs >= 0 && record.timeUs <= MAX_TIME_US)) throw new Error('无效的候选帧时间。')
  if (!Array.isArray(record.points) || !record.points.length || record.points.length > 16) throw new Error('候选请求的点无效。')
  return { source: parseSource(record.source), timeUs: record.timeUs, points: record.points.map(point => videoEditTrackPointSchema.parse(point) as [number, number, 0 | 1]) }
}

async function authorizedSource(source: TrackingSource): Promise<void> {
  if (typeof source !== 'string') return // 只消费调用窗口合成后的像素，不扩大本地文件权限。
  const normalized = normalizeLocalSource(source)
  if (!path.isAbsolute(normalized) || !isPathWithinAllowedMediaRoots(normalized)) throw new Error('素材尚未获得读取权限，请从素材库导入。')
  const canonical = await fs.realpath(normalized)
  if (!isPathWithinAllowedMediaRoots(canonical)) throw new Error('素材的实际路径不在已授权目录内。')
}

export function registerTrackingIpc(): void {
  const c = TRACKING_IPC_CHANNELS
  // 保留调用方的路径写法：进度事件按原定义匹配，内容身份由服务按真实路径计算。
  registerIpcHandler(c.status, parseDefinition, async definition => { await authorizedSource(definition.source); return getTrackingService().status(definition) })
  registerIpcHandler(c.run, parseTrackingRun, async ({ definition, range, options }, event) => { await authorizedSource(definition.source); return getTrackingService().run(definition, range, options, frameProvider(definition.source, event)) })
  registerIpcHandler(c.stop, parseDefinition, async definition => { await authorizedSource(definition.source); getTrackingService().stop(definition) })
  registerIpcHandler(c.candidates, parseTrackingCandidates, async (request, event) => { await authorizedSource(request.source); return getTrackingService().candidates(request, frameProvider(request.source, event)) })
  registerIpcHandler(c.framesReply, parseTrackingFrameReply, (reply, event) => { frames.reply(event.sender.id, reply) })
}
