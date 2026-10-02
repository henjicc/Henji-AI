import path from 'node:path'
import type { NativeMediaProbeOutcome, NativeMediaProbeRequest, NativeVideoDecoderStatus } from '../../../src/platform/contracts/videoDecoderTypes'
import { isPathWithinAllowedMediaRoots } from '../protocol'
import { createMainLogger } from '../services/logging/main-logger'
import { getVideoDecoderService } from '../services/video-decoder'
import { nativeVideoDecoderStatus, probeNativeMedia, videoDecoderForcedBackend } from '../services/video-decoder/media-probe'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'

/**
 * 原生视频解码服务的素材探测与状态 IPC。探测只读已授权媒体目录内的本地文件（与 henji-media 协议同一授权），
 * 渲染层可按请求标识取消；服务故障返回 `unavailable`，由渲染层回到后备探测。
 */

const logger = createMainLogger('main.video_decoder')
const inflight = new Map<string, AbortController>()
let forcedBackend: ReturnType<typeof videoDecoderForcedBackend> | undefined

function parseProbeRequest(input: unknown): NativeMediaProbeRequest {
  const record = parseRecord(input)
  const requestId = parseStringField(record, 'requestId')
  const filePath = parseStringField(record, 'path')
  if (requestId.length > 100) throw new Error('Invalid probe request id')
  if (!path.isAbsolute(filePath) || filePath.includes('\0')) throw new Error('Media source path must be an absolute file path')
  return { requestId, path: filePath }
}

export function registerVideoDecoderIpc(): void {
  registerIpcHandler<NativeMediaProbeRequest, NativeMediaProbeOutcome>('videoDecoder:probe', parseProbeRequest, async (request, event) => {
    if (!isPathWithinAllowedMediaRoots(request.path)) return { status: 'unreadable', message: '素材所在目录尚未授权读取' }
    const key = `${event.sender.id}:${request.requestId}`
    const controller = new AbortController()
    inflight.get(key)?.abort()
    inflight.set(key, controller)
    try {
      return await probeNativeMedia(getVideoDecoderService(), request.path, logger, controller.signal)
    } finally {
      if (inflight.get(key) === controller) inflight.delete(key)
    }
  })
  registerIpcHandler<string, boolean>('videoDecoder:cancelProbe', (input) => parseStringField(input, 'requestId'), (requestId, event) => {
    const controller = inflight.get(`${event.sender.id}:${requestId}`)
    controller?.abort()
    return Boolean(controller)
  })
  registerIpcHandler<void, NativeVideoDecoderStatus>('videoDecoder:status', parseVoid, () => {
    forcedBackend ??= videoDecoderForcedBackend(process.env, logger)
    return nativeVideoDecoderStatus(getVideoDecoderService(), forcedBackend)
  })
}
