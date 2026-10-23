import { z } from 'zod'

export const AUDIO_CAPTURE_RATES = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000] as const
export const audioCaptureSettingsSchema = z.object({
  hostApi: z.enum(['default', 'MME', 'DirectSound', 'WASAPI', 'WDM-KS', 'ASIO', 'CoreAudio']),
  /** 设备名称和同名序号跨枚举保存，PortAudio 临时索引只在主进程内部使用。 */
  deviceName: z.string().max(512),
  deviceOrdinal: z.number().int().min(0).max(255),
  firstChannel: z.number().int().min(0).max(255),
  channels: z.union([z.literal(1), z.literal(2)]),
  sampleRate: z.union(AUDIO_CAPTURE_RATES.map(rate => z.literal(rate))),
  bitDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]),
  bufferFrames: z.number().int().min(0).max(8192),
  suggestedLatency: z.number().min(0).max(2),
  exclusive: z.boolean(),
}).strict()
export type AudioCaptureSettings = z.infer<typeof audioCaptureSettingsSchema>
export const DEFAULT_AUDIO_CAPTURE_SETTINGS: AudioCaptureSettings = { hostApi: 'default', deviceName: '', deviceOrdinal: 0, firstChannel: 0, channels: 1, sampleRate: 48000, bitDepth: 24, bufferFrames: 0, suggestedLatency: 0, exclusive: false }
export const AUDIO_CAPTURE_SETTINGS_VERSION = 1
export const audioCaptureSettingsEnvelopeSchema = z.object({ version: z.literal(1), minReaderVersion: z.literal(1), settings: audioCaptureSettingsSchema }).strict()
export const audioCaptureDeviceSchema = z.object({
  index: z.number().int(), hostApi: z.string(), name: z.string(), maxInputChannels: z.number().int(), maxOutputChannels: z.number().int(), defaultSampleRate: z.number(),
  defaultLowInputLatency: z.number(), defaultHighInputLatency: z.number(), defaultLowOutputLatency: z.number(), defaultHighOutputLatency: z.number(),
  asioBuffers: z.object({ min: z.number(), max: z.number(), preferred: z.number(), granularity: z.number() }).nullable(),
})
export const audioCaptureInventorySchema = z.object({ hostApis: z.array(z.object({ id: z.string(), name: z.string(), defaultInputDevice: z.number().int() })), devices: z.array(audioCaptureDeviceSchema), defaultInputDevice: z.number().int(), asioCompiled: z.boolean() })
export type AudioCaptureInventory = z.infer<typeof audioCaptureInventorySchema>
export interface AudioCaptureSettingsState { settings: AudioCaptureSettings; effectiveSettings: AudioCaptureSettings; notice: string | null; revision: number }
export const audioCaptureStatusSchema = z.object({ sessionId: z.string(), outputPath: z.string(), state: z.enum(['recording', 'paused', 'stopped']), sampleRate: z.number(), inputLatency: z.number(), callbackFrames: z.number().int().nonnegative(), frames: z.number(), writtenBytes: z.number(), durationSeconds: z.number() })
export type AudioCaptureStatus = z.infer<typeof audioCaptureStatusSchema>
export interface AudioCaptureFailure { code: string; message: string; recoverable: boolean }
export interface AudioCaptureLevel { event: 'level'; sessionId: string; peak: number[]; rms: number[]; clipped: boolean[]; durationSeconds: number; writtenBytes: number }
export interface AudioCaptureSamples {
  event: 'samples'; sessionId: string; sequence: number; firstFrame: number; frames: number; channels: number; sampleRate: number
  /** 第一采样帧的主进程 hrtime 微秒；渲染层使用 captureClockCorrelation 换算。暂停后的时间保留真实空隙。 */
  monoUs: number; nativeMonoUs: number; uncertaintyUs: number; format: 'float32le'; pcm: Uint8Array
}
export type AudioCaptureEvent = AudioCaptureLevel | AudioCaptureSamples
  | { event: 'interrupted'; sessionId: string; outputPath: string; writtenBytes: number; error: AudioCaptureFailure }
  | { event: 'devicesChanged'; inventory: AudioCaptureInventory }
export const audioCaptureStartSchema = z.object({ outputPath: z.string().min(1).max(4096), settings: audioCaptureSettingsSchema.optional(), streamSamples: z.boolean().default(false), monitor: z.literal(false).optional() }).strict()
export type AudioCaptureStart = z.input<typeof audioCaptureStartSchema>
export const audioCaptureRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('enumerate') }).strict(),
  z.object({ action: z.literal('clock') }).strict(),
  z.object({ action: z.literal('watchDevices'), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('ack'), sessionId: z.string().uuid(), sequence: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('settings') }).strict(),
  z.object({ action: z.literal('setSettings'), settings: audioCaptureSettingsSchema, expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('probe'), settings: audioCaptureSettingsSchema }).strict(),
  z.object({ action: z.literal('start'), request: audioCaptureStartSchema }).strict(),
  z.object({ action: z.enum(['pause', 'resume', 'stop', 'status']), sessionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('asioPanel'), settings: audioCaptureSettingsSchema }).strict(),
  z.object({ action: z.literal('recover'), outputPath: z.string().min(1).max(4096) }).strict(),
])
export const AUDIO_CAPTURE_CONTROL_EXCLUSION = '原生录音生命周期由音频编辑、录屏和讲解的所属会话维护；本期不单独向助手开放开始/停止，避免无作品归属、无结果撤销的后台录音。设备和参数可通过通用属性读写。'
