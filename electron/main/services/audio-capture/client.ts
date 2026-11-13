import { z } from 'zod'
import { audioCaptureHealthSchema, systemAudioHealthSchema, type AudioCaptureEvent, type SystemAudioNativeEvent } from '../../../../src/core/audioCapture/contracts'
import { createMainLogger } from '../logging'
import { NativeProcessClient, mainClockUs, type NativeProcessLoss } from '../native-process/client'
import { AudioCaptureError, AudioCaptureFrameReader, type NativeAudioMessage } from './protocol'

export { mainClockUs }
const logger = createMainLogger('main.audio_capture.process')
/** 原生进程失联（退出、协议错误、不应答）的原因，交给崩溃回调用作中断说明。 */
export type AudioCaptureLoss = NativeProcessLoss
const sampleSchema = z.object({ event: z.literal('samples'), sessionId: z.string(), sequence: z.number().int().nonnegative(), firstFrame: z.number().int().nonnegative(), frames: z.number().int().min(1).max(1024), channels: z.number().int().min(1).max(2), sampleRate: z.number().positive(), nativeMonoUs: z.number(), uncertaintyUs: z.number().nonnegative(), format: z.literal('float32le') })
const levelSchema = z.object({ event: z.literal('level'), sessionId: z.string(), peak: z.array(z.number()).max(2), rms: z.array(z.number()).max(2), clipped: z.array(z.boolean()).max(2), durationSeconds: z.number(), writtenBytes: z.number() })
const interruptedSchema = z.object({ event: z.literal('interrupted'), sessionId: z.string(), outputPath: z.string(), writtenBytes: z.number(), error: z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() }), health: audioCaptureHealthSchema.optional() })
const healthSchema = z.object({ event: z.literal('health'), sessionId: z.string(), durationSeconds: z.number(), health: audioCaptureHealthSchema })
const segmentSchema = z.object({ event: z.literal('segment'), sessionId: z.string(), phase: z.enum(['open', 'seal']), segmentId: z.string().uuid(), file: z.string().regex(/^[a-f0-9-]+\.wav$/), firstFrame: z.number().int().nonnegative(), frames: z.number().int().nonnegative().optional(), sampleRate: z.number().int().positive(), channels: z.number().int().min(1).max(2), bitDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]), nativeMonoUs: z.number(), uncertaintyUs: z.number().nonnegative() })
const deviceSchema = z.object({ event: z.literal('device'), sessionId: z.string(), state: z.enum(['capturing', 'unavailable']), name: z.string(), reason: z.string().nullable(), atSeconds: z.number() })
const systemHealthSchema = z.object({ event: z.literal('systemHealth'), sessionId: z.string(), durationSeconds: z.number(), health: systemAudioHealthSchema })
/**
 * 协议 4：麦克风的一路采集可同时交给音频编辑的整段文件和录屏的分段轨道（startMicrophoneTrack），段事件带位深与采集时钟误差。
 * 新旧程序不配套时在握手就失败，不在录音中途才报协议错误。
 */
export const AUDIO_CAPTURE_PROTOCOL = 4

export class AudioCaptureClient extends NativeProcessClient<NativeAudioMessage> {
  private panelOpen = false
  constructor(executable: () => string, private readonly onEvent: (event: AudioCaptureEvent | SystemAudioNativeEvent) => void, onCrash: (loss: AudioCaptureLoss) => void) {
    super({
      label: '原生录音服务', event: 'audio_capture', logger, protocol: AUDIO_CAPTURE_PROTOCOL,
      versionMismatch: '录音组件版本与应用不一致，请重新安装痕迹AI；开发环境请先运行 npm run build:audio-capture 重新构建录音组件。',
      texts: { closed: '录音服务已关闭', unavailable: '录音服务连续异常，请稍后重试并检查驱动', notStarted: '录音服务未启动', exited: '录音服务已退出，已写文件可恢复', timeout: '录音驱动响应超时，请检查设备；已录文件可恢复', closing: '录音服务正在关闭，已写文件保留' },
      losses: { exited: { code: 'PROCESS_EXITED', message: '录音服务异常退出，已写文件保留，可恢复后重新录制' }, notResponding: { code: 'NOT_RESPONDING', message: '录音服务没有应答，录音已结束；已采集的部分正在写完，稍后可以恢复' } },
      // 停止要先排空采集队列（4096 块、每块最多 1024 帧，48 kHz 下最多约 87 秒音频，正常磁盘不到一秒写完）和推流通道再收尾文件，
      // 磁盘慢时也不能被提前打断；驱动面板等用户操作。
      timeouts: { stop: 90_000, asioPanel: 300_000 },
      reader: () => new AudioCaptureFrameReader(), error: (code, message) => new AudioCaptureError(code, message),
    }, executable, onCrash)
  }
  override async request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (type !== 'asioPanel') return super.request(type, payload)
    this.panelOpen = true
    try { return await super.request(type, payload) } finally { this.panelOpen = false }
  }
  protected override calibrationAllowed(): boolean { return !this.panelOpen }
  protected event(message: NativeAudioMessage, binary: Buffer): void {
    if (message.event === 'samples') {
      const block = sampleSchema.parse(message)
      if (binary.length !== block.frames * block.channels * 4) throw new AudioCaptureError('PROTOCOL_ERROR', '录音采样字节数不匹配')
      this.onEvent({ ...block, monoUs: block.nativeMonoUs + this.clock.offsetUs, uncertaintyUs: block.uncertaintyUs + this.clockUncertaintyUs(), pcm: new Uint8Array(binary) })
    } else if (message.event === 'level') this.onEvent(levelSchema.parse(message))
    else if (message.event === 'interrupted') this.onEvent(interruptedSchema.parse(message))
    else if (message.event === 'health') this.onEvent(healthSchema.parse(message))
    else if (message.event === 'segment') { const segment = segmentSchema.parse(message); this.onEvent({ ...segment, monoUs: segment.nativeMonoUs + this.clock.offsetUs, uncertaintyUs: segment.uncertaintyUs + this.clockUncertaintyUs() }) }
    else if (message.event === 'device') this.onEvent(deviceSchema.parse(message))
    else if (message.event === 'systemHealth') this.onEvent(systemHealthSchema.parse(message))
  }
}
