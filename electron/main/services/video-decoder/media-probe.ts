import type {
  NativeDecodeBackend,
  NativeMediaProbe,
  NativeMediaProbeOutcome,
  NativeMediaStream,
  NativeVideoDecoderStatus,
} from '../../../../src/platform/contracts/videoDecoderTypes'
import type { MainLogger } from '../logging/main-logger'
import { VideoDecoderError, type VideoDecoderHello, type VideoDecoderProbeResult } from './protocol'

/** 素材探测与可用性：把原生 probe 结果映射为渲染层契约，并按握手的解码器清单判断每条流能否解码。 */

export interface MediaProbeService {
  ensureStarted(): Promise<VideoDecoderHello>
  probe(filePath: string, options?: { signal?: AbortSignal }): Promise<VideoDecoderProbeResult>
}

type ProbeLogger = Pick<MainLogger, 'warn' | 'debug'>

/** FFmpeg 编码名与解码器名不同的情况（如 AV1 由 libdav1d 解码）。 */
const DECODER_ALIASES: Record<string, string[]> = {
  av1: ['libdav1d', 'av1'],
  mp3: ['mp3float', 'mp3'],
  vp9: ['vp9', 'libvpx-vp9'],
  vp8: ['vp8', 'libvpx'],
  opus: ['opus', 'libopus'],
}

export function nativeStreamDecodable(codec: string | null, kind: NativeMediaStream['kind'], hello: VideoDecoderHello): boolean {
  if (!codec || (kind !== 'video' && kind !== 'audio')) return false
  const decoders = kind === 'video' ? hello.ffmpeg.videoDecoders : hello.ffmpeg.audioDecoders
  return (DECODER_ALIASES[codec] ?? [codec]).some((name) => decoders.includes(name))
}

export function toNativeMediaProbe(result: VideoDecoderProbeResult, hello: VideoDecoderHello): NativeMediaProbe {
  return {
    container: { formatName: result.container.formatName, startTimeSeconds: result.container.startTimeSeconds, durationSeconds: result.container.durationSeconds },
    primaryVideoStreamIndex: result.primaryVideoStreamIndex,
    primaryAudioStreamIndex: result.primaryAudioStreamIndex,
    streams: result.streams.map((stream): NativeMediaStream => ({
      index: stream.index,
      kind: stream.kind,
      codec: stream.codec,
      profile: stream.profile,
      startTimeSeconds: stream.startTimeSeconds,
      durationSeconds: stream.durationSeconds,
      isAttachedPicture: stream.isAttachedPicture,
      decodable: nativeStreamDecodable(stream.codec, stream.kind, hello),
      ...(stream.video ? {
        video: {
          width: stream.video.width,
          height: stream.video.height,
          bitDepth: stream.video.bitDepth,
          chromaSubsampling: stream.video.chromaSubsampling,
          hasAlpha: stream.video.hasAlpha,
          avgFrameRate: stream.video.avgFrameRate,
          realFrameRate: stream.video.realFrameRate,
          rotationDegrees: stream.video.rotationDegrees,
        },
      } : {}),
      ...(stream.audio ? { audio: { sampleRate: stream.audio.sampleRate, channels: stream.audio.channels } } : {}),
    })),
  }
}

/** 读不了这个文件；其余错误（服务未安装、启动/握手失败、退出、超时、协议错误、取消）都按服务不可用处理。 */
const UNREADABLE_CODES = new Set(['OPEN_FAILED', 'STREAM_INFO_FAILED', 'INVALID_REQUEST'])

export async function probeNativeMedia(service: MediaProbeService, filePath: string, logger: ProbeLogger, signal?: AbortSignal): Promise<NativeMediaProbeOutcome> {
  try {
    const hello = await service.ensureStarted()
    const result = await service.probe(filePath, { signal })
    return { status: 'probed', probe: toNativeMediaProbe(result, hello) }
  } catch (error) {
    const code = error instanceof VideoDecoderError ? error.code : 'INTERNAL'
    const message = error instanceof Error ? error.message : String(error)
    if (UNREADABLE_CODES.has(code)) {
      logger.debug('原生素材探测无法读取文件', { event: 'video_decoder.media_probe.unreadable', context: { code }, error })
      return { status: 'unreadable', message }
    }
    if (code !== 'CANCELLED') logger.warn('原生素材探测不可用', { event: 'video_decoder.media_probe.unavailable', context: { code }, error })
    return { status: 'unavailable' }
  }
}

/** 开发诊断变量 `HENJI_VIDEO_DECODER=native|browser` 强制解码后端；未设置或无效值（记警告）为自动。 */
export function videoDecoderForcedBackend(env: NodeJS.ProcessEnv, logger?: ProbeLogger): NativeDecodeBackend | null {
  const value = env.HENJI_VIDEO_DECODER?.trim().toLowerCase()
  if (!value) return null
  if (value === 'native' || value === 'browser') return value
  logger?.warn('忽略无效的解码后端诊断变量', { event: 'video_decoder.forced_backend.invalid', context: { value } })
  return null
}

export async function nativeVideoDecoderStatus(service: Pick<MediaProbeService, 'ensureStarted'>, forcedBackend: NativeDecodeBackend | null): Promise<NativeVideoDecoderStatus> {
  const available = await service.ensureStarted().then(() => true, () => false)
  return { available, forcedBackend }
}
