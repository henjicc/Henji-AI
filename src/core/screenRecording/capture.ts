import { recordingEncodingFields } from './encoding'
import { z } from 'zod'
import { recordingSessionOptionsSchema, type RecordingSessionOptions } from './sessionOptions'
import { recordingTrackRecordSchema } from './trackJournal'
import type { RecordingTracks } from './tracks'
import { recordingBaselineSchema, recordingCallSchema } from './script'

export const captureOptionsSchema = z.object({
  ...recordingEncodingFields,
  sourceId: z.string().regex(/^(screen|window):\d+:\d+$/),
  backend: z.enum(['auto', 'gfxcapture', 'chromium']).default('auto'),
  width: z.number().int().min(2).max(3840).multipleOf(2),
  height: z.number().int().min(2).max(2160).multipleOf(2),
  fps: z.union([z.literal(30), z.literal(60)]),
  /** Normalized coordinates in the selected display; independent of desktop DIP and monitor order. */
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.region && (!value.sourceId.startsWith('screen:') || value.region.x + value.region.width > 1 || value.region.y + value.region.height > 1)) ctx.addIssue({ code: 'custom', path: ['region'], message: '区域必须位于所选屏幕内' })
})
export type ScreenCaptureOptions = z.infer<typeof captureOptionsSchema>
export type CaptureBackendKind = 'gfxcapture' | 'chromium'
export type CaptureOperation = 'start' | 'pause' | 'resume' | 'stop' | 'cancel'
export interface ScreenCaptureBackend {
  prepare(): Promise<void>
  start(signal: AbortSignal): Promise<void>
  pause(signal: AbortSignal): Promise<void>
  resume(signal: AbortSignal): Promise<void>
  stop(signal: AbortSignal): Promise<void>
  cancel(): Promise<void>
}
export interface CaptureCommand { sessionId: string; requestId: string; operation: CaptureOperation }
const captureSpanSchema = z.object({
  index: z.number().int().nonnegative(), file: z.string().regex(/^screen-\d{6}\.mp4$/),
  monoUs: z.number().int().nonnegative(), durationUs: z.number().int().nonnegative(),
  finalized: z.boolean(),
}).strict()
export const captureManifestSchema = z.object({
  version: z.literal(2), minReaderVersion: z.number().int().positive().optional(), sessionId: z.string().uuid(), options: captureOptionsSchema,
  backend: z.enum(['gfxcapture', 'chromium']), cursorEmbedded: z.boolean(),
  status: z.enum(['prepared', 'recording', 'paused', 'stopped', 'failed']),
  spans: z.array(captureSpanSchema),
  encoding: z.object({ codec: z.enum(['h264', 'hevc']), encoder: z.string(), softwareFallback: z.boolean(), reason: z.string().optional() }).strict().optional(),
}).strict()
export type CaptureManifest = z.infer<typeof captureManifestSchema>
export type CaptureSpan = z.infer<typeof captureSpanSchema>
/**
 * Pass this exact main-process monotonic origin to event and audio/camera capture.
 * `hostTracks`：由主进程（原生录音服务）录的轨道，界面不再采集它们；界面重载或崩溃时这些轨道不断。
 * 麦克风在所有平台都在这里，系统声只在 Windows 上。
 */
export interface CapturePrepared { sessionId: string; originUs: number; backend: CaptureBackendKind; cursorEmbedded: boolean; options: ScreenCaptureOptions; directory?: string; hostTracks?: Array<'microphone' | 'systemAudio'> }
/** 停止后界面接着做什么；主进程只代为保管，界面重载后接回进行中的录制时原样交还。 */
export const captureFollowUpSchema = z.object({
  handoff: z.boolean(),
  quick: z.object({ directory: z.string().min(1).max(4096).optional() }).strict().optional(),
  destination: z.object({ documentId: z.string().min(1), sequenceId: z.string().min(1).optional(), frame: z.number().int().nonnegative().optional(), placement: z.enum(['end', 'overwrite']).optional(), basis: z.string().min(1).max(64).optional() }).strict().optional(),
}).strict()
export type CaptureFollowUp = z.infer<typeof captureFollowUpSchema>
/** 界面重新接上进行中的录制所需的全部事实。 */
export interface CaptureAttachment { prepared: CapturePrepared; session: RecordingSessionOptions; followUp?: CaptureFollowUp }
/**
 * 长录的采集事实（只在主进程内存里）：录制中实时给出，停止后保留到应用退出；重启后只剩录制文档里的轨道与状态。
 * 计数都是这次录制累计的：丢帧与重复帧来自编码器，系统声补的静音分没声音播放（silenceSeconds）与设备不可用（unavailableSeconds）。
 */
export interface RecordingCaptureFacts {
  live: boolean
  /** 采集出错的原因；用户取消不算。 */
  failure: string | null
  /** 界面进程断开（重载、崩溃）的次数：断开期间摄像头（与 macOS 的系统声）没有数据，麦克风照常录。 */
  detaches: number
  video: { droppedFrames: number; duplicatedFrames: number; encoderRestarts: number; encoder: string } | null
  systemAudio: { silenceSeconds: number; unavailableSeconds: number; droppedFrames: number; discontinuities: number; deviceSwitches: number; reconnects: number } | null
  microphone: { device: string; inputOverflows: number; inputUnderflows: number; droppedFrames: number; droppedPreviewBlocks: number; reconnects: number } | null
  /** 应用上次意外退出后，启动时自动补齐的。 */
  recovered: boolean
  /** 录制因被录的来源没了而自动停止时的说明（如“被录制的窗口已关闭”）；不是采集出错，已录内容照常保存。 */
  sourceEnded?: string
  /** 录制中的轨道（分段与空档）；停止后读录制文档里的 tracks。 */
  tracks?: RecordingTracks
}
/** 应用崩溃后补齐的录制。 */
export interface RecoveredRecording { documentId: string; name: string; durationUs: number }
const sessionId = z.string().uuid()
export const captureRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('application-source'), sessionId }).strict(),
  z.object({ operation: z.literal('encoders'), codec: z.enum(['h264', 'hevc']) }).strict(),
  z.object({ operation: z.literal('encoding'), sessionId, encoding: captureManifestSchema.shape.encoding.unwrap() }).strict(),
  z.object({ operation: z.literal('script-call'), sessionId, call: recordingCallSchema, baselines: z.array(recordingBaselineSchema).max(16) }).strict(),
  /** `cursor: 'embed'` records the system pointer into the picture (quick mode); the outcome is kept as manifest.cursorEmbedded. */
  z.object({ operation: z.literal('prepare'), sessionId, options: captureOptionsSchema, session: recordingSessionOptionsSchema.optional(), cursor: z.enum(['redraw', 'embed']).optional(), followUp: captureFollowUpSchema.optional() }).strict(),
  /** 声音与摄像头每开一段、封一段、记一个空档都报一条；主进程追加进 tracks.journal。 */
  z.object({ operation: z.literal('track'), sessionId, record: recordingTrackRecordSchema }).strict(),
  /** 界面重载或崩溃重开后接回进行中的录制。 */
  z.object({ operation: z.literal('attach'), sessionId }).strict(),
  /** 找出上次应用意外退出时没收尾的录制，补齐后返回。 */
  z.object({ operation: z.literal('unfinished') }).strict(),
  z.object({ operation: z.literal('recover-session'), sessionId }).strict(),
  /** 长录事实（丢帧、续录、补静音、断开与中断）；不认识这次录制时返回 null。 */
  z.object({ operation: z.literal('facts'), sessionId }).strict(),
  /** Quick mode: join spans, mix sound and write pointer facts into one MP4 in the chosen folder. */
  z.object({ operation: z.literal('quick-export'), sessionId, directory: z.string().min(1).max(4096).optional() }).strict(),
  z.object({ operation: z.literal('reveal-export'), sessionId }).strict(),
  /** 导入剪辑前把暂停分出的画面分片与各路声音各拼成一个文件；不需要或拼不成时返回 null。 */
  z.object({ operation: z.literal('combine'), sessionId }).strict(),
  z.object({ operation: z.literal('events'), sessionId, offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(256), markersOnly: z.boolean().default(false) }).strict(),
  z.object({ operation: z.literal('read'), sessionId }).strict(),
  z.object({ operation: z.literal('clock'), sessionId }).strict(),
  z.object({ operation: z.literal('anchor'), sessionId, index: z.number().int().nonnegative(), monoUs: z.number().int().nonnegative() }).strict(),
  z.object({ operation: z.literal('close'), sessionId }).strict(),
  z.object({ operation: z.literal('recover'), sessionId }).strict(),
  z.object({ operation: z.literal('open-span'), sessionId }).strict(),
  z.object({ operation: z.literal('write'), sessionId, index: z.number().int().nonnegative(), position: z.number().int().nonnegative(), data: z.instanceof(Uint8Array).refine(value => value.byteLength <= 2 * 1024 * 1024) }).strict(),
  z.object({ operation: z.literal('seal-span'), sessionId, index: z.number().int().nonnegative(), durationUs: z.number().int().nonnegative() }).strict(),
  z.object({ operation: z.literal('ack'), sessionId, requestId: z.string().uuid(), error: z.string().max(1000).optional() }).strict(),
  z.object({ operation: z.literal('failed'), sessionId, error: z.string().max(1000) }).strict(),
])
export type CaptureRequest = z.infer<typeof captureRequestSchema>

/**
 * 原生画面采集进程在画面文件旁写的活动时间线（每秒画面变化量、前台窗口、暂停与停止，一行一条 JSON）。
 * 只有原生采集录的才有；现有录法录的画面旁没有这个文件。窗口标题是明文，只在本机会话目录里。
 */
export const captureActivityTimelineFile = (screenFile: string): string => screenFile.replace(/\.mp4$/i, '.activity.jsonl')
/** 原生画面采集进程在画面文件旁写的逐帧时刻表（二进制，格式见 native/screen-capture/README.md）；与主进程 native-timing.ts 的同名规则一致。 */
export const captureFrameTimingFile = (screenFile: string): string => screenFile.replace(/\.mp4$/i, '.frames')

/** Desktop DIP rectangle → normalized selected-display coordinates (including negative desktop origins). */
export function captureRegionFromDip(region: { x: number; y: number; width: number; height: number }, display: { x: number; y: number; width: number; height: number }): NonNullable<ScreenCaptureOptions['region']> {
  return { x: (region.x - display.x) / display.width, y: (region.y - display.y) / display.height, width: region.width / display.width, height: region.height / display.height }
}
export function captureCrop(region: ScreenCaptureOptions['region'], width: number, height: number): { x: number; y: number; width: number; height: number } {
  const r = region ?? { x: 0, y: 0, width: 1, height: 1 }
  const x = Math.floor(r.x * width), y = Math.floor(r.y * height)
  return { x, y, width: Math.max(1, Math.min(width - x, Math.round(r.width * width))), height: Math.max(1, Math.min(height - y, Math.round(r.height * height))) }
}
