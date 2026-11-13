import { z } from 'zod'

export const AUDIO_CAPTURE_RATES = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000] as const
export const AUDIO_CAPTURE_SETTINGS_TARGET = { tab: 'general', sectionId: 'general-recording' } as const
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
const audioCaptureDeviceSchema = z.object({
  index: z.number().int(), hostApi: z.string(), name: z.string(), maxInputChannels: z.number().int(), maxOutputChannels: z.number().int(), defaultSampleRate: z.number(),
  defaultLowInputLatency: z.number(), defaultHighInputLatency: z.number(), defaultLowOutputLatency: z.number(), defaultHighOutputLatency: z.number(),
  asioBuffers: z.object({ min: z.number(), max: z.number(), preferred: z.number(), granularity: z.number() }).nullable(),
})
export const audioCaptureInventorySchema = z.object({ hostApis: z.array(z.object({ id: z.string(), name: z.string(), defaultInputDevice: z.number().int() })), devices: z.array(audioCaptureDeviceSchema), defaultInputDevice: z.number().int(), asioCompiled: z.boolean() })
export type AudioCaptureInventory = z.infer<typeof audioCaptureInventorySchema>
export interface AudioCaptureSettingsState { settings: AudioCaptureSettings; effectiveSettings: AudioCaptureSettings; notice: string | null; revision: number }
/** 采集健康计数：驱动溢出/欠载、写盘跟不上丢的帧（已补静音）、来不及推送而丢的预览块、写盘耗时峰值。只记录，不中断录音。 */
export const audioCaptureHealthSchema = z.object({ inputOverflows: z.number(), inputUnderflows: z.number(), droppedFrames: z.number(), droppedPreviewBlocks: z.number(), maxWriteMs: z.number(), lastGlitchSeconds: z.number() })
export type AudioCaptureHealth = z.infer<typeof audioCaptureHealthSchema>
export const audioCaptureStatusSchema = z.object({ sessionId: z.string(), outputPath: z.string(), state: z.enum(['recording', 'paused', 'stopped']), sharedSubscribers: z.number().int().nonnegative().optional(), settings: audioCaptureSettingsSchema.optional(), sampleRate: z.number(), inputLatency: z.number(), callbackFrames: z.number().int().nonnegative(), frames: z.number(), writtenBytes: z.number(), durationSeconds: z.number(), health: audioCaptureHealthSchema.optional() })
export type AudioCaptureStatus = z.infer<typeof audioCaptureStatusSchema>
interface AudioCaptureFailure { code: string; message: string; recoverable: boolean }
export interface AudioCaptureLevel { event: 'level'; sessionId: string; peak: number[]; rms: number[]; clipped: boolean[]; durationSeconds: number; writtenBytes: number }
export interface AudioCaptureSamples {
  event: 'samples'; sessionId: string; sequence: number; firstFrame: number; frames: number; channels: number; sampleRate: number
  /** 第一采样帧的主进程 hrtime 微秒；渲染层使用 captureClockCorrelation 换算。暂停后的时间保留真实空隙。 */
  monoUs: number; nativeMonoUs: number; uncertaintyUs: number; format: 'float32le'; pcm: Uint8Array
}
export type AudioCaptureEvent = AudioCaptureLevel | AudioCaptureSamples
  | { event: 'interrupted'; sessionId: string; outputPath: string; writtenBytes: number; error: AudioCaptureFailure; health?: AudioCaptureHealth }
  | { event: 'health'; sessionId: string; durationSeconds: number; health: AudioCaptureHealth }
  | { event: 'devicesChanged'; inventory: AudioCaptureInventory }

/** 系统声采集健康计数：补的静音（没声音播放）、设备不可用补的静音、去掉的重叠、驱动报的数据不连续、写盘跟不上丢的帧（已补静音）、设备切换、写盘峰值。 */
export const systemAudioHealthSchema = z.object({ segments: z.number(), silenceSeconds: z.number(), unavailableSeconds: z.number(), trimmedFrames: z.number(), discontinuities: z.number(), droppedFrames: z.number(), deviceSwitches: z.number(), maxWriteMs: z.number() })
export type SystemAudioHealth = z.infer<typeof systemAudioHealthSchema>
/** 原生分段轨道（系统声、录屏的麦克风轨）的事件；只在主进程内流转，不推给界面。时间已换算到主进程单调时钟（monoUs）。 */
export type SystemAudioNativeEvent =
  | { event: 'segment'; sessionId: string; phase: 'open' | 'seal'; segmentId: string; file: string; firstFrame: number; frames?: number; sampleRate: number; channels: number; bitDepth: 16 | 24 | 32; nativeMonoUs: number; monoUs: number; uncertaintyUs: number }
  | { event: 'device'; sessionId: string; state: 'capturing' | 'unavailable'; name: string; reason: string | null; atSeconds: number }
  | { event: 'systemHealth'; sessionId: string; durationSeconds: number; health: SystemAudioHealth }
const audioCaptureStartSchema = z.object({ outputPath: z.string().min(1).max(4096), settings: audioCaptureSettingsSchema.optional(), streamSamples: z.boolean().default(false), shared: z.boolean().optional(), monitor: z.literal(false).optional() }).strict()
export type AudioCaptureStart = z.input<typeof audioCaptureStartSchema>
/** 作品目录内尚未交给编辑器的录音；相对文件名让作品目录迁移后仍可恢复。 */
const audioCapturePlacementSchema = z.object({ projectId: z.string().regex(/^[\w-]+$/), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().nonnegative(), revision: z.number().int().nonnegative(), spliceId: z.string().uuid() }).strict()
export type AudioCapturePlacement = z.infer<typeof audioCapturePlacementSchema>
export const audioCaptureRecoverySchema = z.object({ version: z.literal(2), minReaderVersion: z.literal(1), placements: z.record(z.string(), audioCapturePlacementSchema).optional(), files: z.array(z.string().regex(/^录音 \d{4}-\d{2}-\d{2} \d{6}(?: \(\d+\))?\.wav$/)) }).strict()
export type AudioCaptureFile = { outputPath: string; name: string; placement?: AudioCapturePlacement; durationSeconds?: number }
export const audioCaptureRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepareFile'), placement: audioCapturePlacementSchema.optional() }).strict(),
  z.object({ action: z.literal('pendingFiles') }).strict(),
  /** 当前窗口仍在进行的音频编辑录音（界面重载后接管用）；没有时为 null。 */
  z.object({ action: z.literal('active') }).strict(),
  z.object({ action: z.enum(['completeFile', 'trashFile']), outputPath: z.string().min(1).max(4096) }).strict(),
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
  /** 界面自己的录制（网页录制的备份声音）要系统声或麦克风：原生写进 directory，停止时交回这段的轨道记录；时间相对 originUs（主进程单调微秒）。 */
  z.object({ action: z.enum(['systemAudioStart', 'microphoneTrackStart']), directory: z.string().min(1).max(4096), originUs: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.enum(['systemAudioStop', 'microphoneTrackStop']), sessionId: z.string().uuid() }).strict(),
  /** 主进程里录音的真实状态（只读，不动推送确认）：界面重载后、接管之前也准。 */
  z.object({ action: z.literal('recordingState') }).strict(),
])
/**
 * 主进程持有的录音事实。界面里的录音会话可能还没建立（重载后要等接管），状态以这里为准。
 * recording 只报本窗口的音频编辑录音；讲解共用麦克风时只报 sharedMicrophone。
 */
export interface AudioCaptureRecordingState {
  recording: { outputPath: string; state: 'recording' | 'paused'; durationSeconds: number; health: AudioCaptureHealth | null } | null
  /** 讲解正用着麦克风：这时音频编辑开始录音会被拒绝（录屏的麦克风轨与音频编辑录音可以同时进行）。 */
  sharedMicrophone: boolean
  /** 本窗口最近一次音频编辑录音的中断；再开始录音就清掉。at 为毫秒时间戳。 */
  interruption: { outputPath: string; code: string; message: string; at: number } | null
  /** 还没拼回作品的录音文件（含正在录的那个）与它们的作品位置。 */
  pending: AudioCaptureFile[]
  /** 录音设置的修订号：只读录音状态时不必去枚举设备、解析设置。 */
  settingsRevision: number
}
