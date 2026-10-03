import { app, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeLocalSource } from '../services/image/source'
import { isPathWithinAllowedMediaRoots } from '../protocol'
import { extractAudioSamples, extractAudioWaveformPyramid, extractAudioWaveformRange, disposeAudioWaveformService, validateAudioWaveformPyramid, validateAudioWaveformRange } from '../services/audio/ops'
import type { AudioWaveformPyramidRequest, AudioWaveformRangeRequest } from '../services/audio/types'
import { assertTrustedApplicationSender } from './application-control'
import { parseRecord, registerIpcHandler } from './registry'

type SamplesPayload = ({ mode: 'range'; requestId: string } & AudioWaveformRangeRequest)
  | ({ mode: 'pyramid'; requestId: string } & AudioWaveformPyramidRequest)
  | { mode: 'legacy'; requestId?: string; source: string; bucketCount: number }
const isRemote = (source: string): boolean => source.startsWith('http://') || source.startsWith('https://')
const requests = new Map<number, Map<string, AbortController>>()
const watched = new WeakSet<WebContents>()

function requestId(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 128) throw new Error('无效的音频采样请求。')
  return value
}
function parseSamples(input: unknown): SamplesPayload {
  const record = parseRecord(input)
  if (record.mode === 'range') {
    const allowed = new Set(['mode', 'requestId', 'source', 'sourceRevision', 'startUs', 'endUs', 'bucketCount', 'channels', 'audioStream', 'audioChannel', 'samples'])
    if (Object.keys(record).some(key => !allowed.has(key))) throw new Error('未知的音频范围字段。')
    const result = { ...record, mode: 'range', requestId: requestId(record.requestId) } as SamplesPayload & { mode: 'range' }
    validateAudioWaveformRange(result)
    return result
  }
  if (record.mode === 'pyramid') {
    const allowed = new Set(['mode', 'requestId', 'source', 'sourceRevision', 'channels', 'audioStream', 'audioChannel', 'maxBuckets', 'ifNoneMatch'])
    if (Object.keys(record).some(key => !allowed.has(key))) throw new Error('未知的音频波形字段。')
    const result = { ...record, mode: 'pyramid', requestId: requestId(record.requestId) } as SamplesPayload & { mode: 'pyramid' }
    validateAudioWaveformPyramid(result)
    return result
  }
  if (Object.keys(record).some(key => !['source', 'bucketCount', 'requestId'].includes(key))) throw new Error('未知的音频采样字段。')
  if (typeof record.source !== 'string' || !record.source.trim() || record.source.length > 8192 || record.source.includes('\0')) throw new Error('无效的音频素材路径。')
  if (typeof record.bucketCount !== 'number' || !Number.isFinite(record.bucketCount) || record.bucketCount < 1 || record.bucketCount > 360_000) throw new Error('无效的波形采样数量。')
  return { mode: 'legacy', source: record.source, bucketCount: record.bucketCount, ...(record.requestId !== undefined ? { requestId: requestId(record.requestId) } : {}) }
}
function abortSender(senderId: number): void {
  const owned = requests.get(senderId)
  requests.delete(senderId)
  for (const controller of owned?.values() ?? []) controller.abort(new DOMException('音频采样已取消', 'AbortError'))
}
function watch(sender: WebContents): void {
  if (watched.has(sender)) return
  watched.add(sender)
  sender.once('destroyed', () => abortSender(sender.id))
  sender.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) abortSender(sender.id) })
}
async function authorizedLocalPath(source: string): Promise<string> {
  const normalized = normalizeLocalSource(source)
  if (!path.isAbsolute(normalized) || !isPathWithinAllowedMediaRoots(normalized)) throw new Error('音频素材尚未获得读取权限，请从素材库导入。')
  const canonical = await fs.realpath(normalized)
  if (!isPathWithinAllowedMediaRoots(canonical)) throw new Error('音频素材的实际路径不在已授权目录内。')
  return canonical
}
async function extract(payload: SamplesPayload, event: IpcMainInvokeEvent): Promise<unknown> {
  watch(event.sender)
  let owned = requests.get(event.sender.id)
  if (!owned) { owned = new Map(); requests.set(event.sender.id, owned) }
  const id = payload.requestId ?? randomUUID()
  if (owned.has(id)) throw new Error('音频采样请求仍在进行。')
  if (owned.size >= 64) throw new Error('音频采样请求过多，请稍后重试。')
  const controller = new AbortController()
  owned.set(id, controller)
  try {
    // Install ownership before filesystem awaits so an immediate cancel cannot be lost.
    // Remote http(s) audio (legacy overview and pyramid only) is downloaded by the service; local paths must be authorized.
    const source = payload.mode !== 'range' && isRemote(payload.source)
      ? payload.source
      : await authorizedLocalPath(payload.source)
    controller.signal.throwIfAborted()
    const selection = payload.mode === 'legacy' ? {} : { channels: payload.channels, ...(payload.sourceRevision !== undefined ? { sourceRevision: payload.sourceRevision } : {}), ...(payload.audioStream !== undefined ? { audioStream: payload.audioStream } : {}), ...(payload.audioChannel !== undefined ? { audioChannel: payload.audioChannel } : {}) }
    const result = payload.mode === 'range'
      ? await extractAudioWaveformRange({ source, startUs: payload.startUs, endUs: payload.endUs, bucketCount: payload.bucketCount, channels: payload.channels, ...selection, ...(payload.samples !== undefined ? { samples: payload.samples } : {}) }, controller.signal)
      : payload.mode === 'pyramid'
        ? await extractAudioWaveformPyramid({ source, channels: payload.channels, ...selection, ...(payload.maxBuckets !== undefined ? { maxBuckets: payload.maxBuckets } : {}), ...(payload.ifNoneMatch !== undefined ? { ifNoneMatch: payload.ifNoneMatch } : {}) }, controller.signal)
        : await extractAudioSamples(source, payload.bucketCount, controller.signal)
    controller.signal.throwIfAborted()
    if (event.sender.isDestroyed() || requests.get(event.sender.id) !== owned || owned.get(id) !== controller) throw new DOMException('音频采样已取消', 'AbortError')
    return result
  } finally {
    if (owned.get(id) === controller) owned.delete(id)
    if (!owned.size && requests.get(event.sender.id) === owned) requests.delete(event.sender.id)
  }
}

export function registerAudioSampleHandlers(): void {
  registerIpcHandler('audio:extractSamples', parseSamples, extract, assertTrustedApplicationSender)
  registerIpcHandler('audio:cancelExtractSamples', input => requestId(parseRecord(input).requestId), (id, event) => {
    requests.get(event.sender.id)?.get(id)?.abort(new DOMException('音频采样已取消', 'AbortError'))
  }, assertTrustedApplicationSender)
  app.once('before-quit', () => {
    for (const sender of [...requests.keys()]) abortSender(sender)
    void disposeAudioWaveformService().catch(() => undefined)
  })
}
