import { z } from 'zod'
import { captureRequestSchema } from './capture'
import { capabilityCaptureSchema } from '../captureLog/events'

export const captureKinds = ['microphone', 'camera', 'screen', 'systemAudio'] as const
export type CaptureKind = typeof captureKinds[number]
export const recordingActions = ['toggle', 'mark', 'stop'] as const
export type RecordingAction = typeof recordingActions[number]
export const recordingShortcutsSchema = z.object({
  toggle: z.string().regex(/^(?:(?:CommandOrControl|Control|Command|Alt|Shift|Super)\+)+(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/).nullable(),
  mark: z.string().regex(/^(?:(?:CommandOrControl|Control|Command|Alt|Shift|Super)\+)+(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/).nullable(),
  stop: z.string().regex(/^(?:(?:CommandOrControl|Control|Command|Alt|Shift|Super)\+)+(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/).nullable(),
}).strict().superRefine((value, context) => {
  const used = new Set<string>()
  for (const action of recordingActions) {
    const key = value[action]
    if (!key) continue
    const normalized = key.split('+').sort().join('+')
    if (used.has(normalized)) context.addIssue({ code: 'custom', path: [action], message: '录制快捷键不能重复' })
    used.add(normalized)
  }
})
export type RecordingShortcuts = z.infer<typeof recordingShortcutsSchema>
export const DEFAULT_RECORDING_SHORTCUTS: RecordingShortcuts = {
  toggle: 'CommandOrControl+Shift+F9', mark: 'CommandOrControl+Shift+F10', stop: 'CommandOrControl+Shift+F11',
}

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  displayId: string
  thumbnailUrl?: string
  /** Window sources only: the owning application's icon, used to tell same-titled windows apart. */
  iconUrl?: string
  /** Screen sources only: desktop arrangement in DIP, used to draw the monitor layout picker. */
  display?: { x: number; y: number; width: number; height: number; scaleFactor: number; primary: boolean }
}
export interface CapturePermissionStatus {
  kind: CaptureKind
  status: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' | 'unsupported'
  recovery: 'request' | 'system-settings' | 'none'
}
export type RecordingPhase = 'ready' | 'countdown' | 'recording' | 'paused' | 'stopping' | 'stopped' | 'failed'
export interface RecordingControlSnapshot {
  sessionId: string
  phase: RecordingPhase
  countdown: number
  elapsedMs: number
  microphoneLevel: number | null
  busy: boolean
  error: string | null
  shortcutConflicts: RecordingAction[]
  cameraPreview?: string | null
  trackWarnings?: Array<'system-audio-silent' | 'system-audio-unavailable' | 'device-disconnected'>
}
export const recordingTrackStatusSchema = z.object({ microphoneLevel: z.number().finite().min(0).max(1).nullable(), cameraPreview: z.string().max(100_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).nullable(), warnings: z.array(z.enum(['system-audio-silent', 'system-audio-unavailable', 'device-disconnected'])).max(3) }).strict()
export type RecordingTrackStatus = z.infer<typeof recordingTrackStatusSchema>
const sessionId = z.string().uuid()
export const recordingSensitiveDomSchema = z.array(z.object({ id: z.string().uuid(), x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(), width: z.number().finite().positive(), height: z.number().finite().positive() }).strict()).max(256)
export type RecordingSensitiveDom = z.infer<typeof recordingSensitiveDomSchema>
export const captureSelectionSchema = z.object({
  sourceId: z.string().regex(/^(screen|window):\d+:\d+$/),
  excludedSourceIds: z.array(z.string().regex(/^window:\d+:\d+$/)).max(256).default([]),
}).strict()
export type CaptureSelection = z.infer<typeof captureSelectionSchema>
export const screenRecordingRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('dom-privacy'), sessionId, regions: recordingSensitiveDomSchema }).strict(),
  z.object({ action: z.literal('clock') }).strict(),
  z.object({ action: z.literal('track-status'), sessionId, status: recordingTrackStatusSchema }).strict(),
  z.object({ action: z.literal('capture'), request: captureRequestSchema }).strict(),
  z.object({ action: z.literal('capability'), sessionId: z.string().uuid(), fact: capabilityCaptureSchema }).strict(),
  z.object({ action: z.literal('sources'), excludedSourceIds: z.array(z.string()).max(256).default([]) }).strict(),
  z.object({ action: z.literal('permissions') }).strict(),
  z.object({ action: z.literal('grant'), sessionId, userReceipt: z.string().uuid(), kinds: z.array(z.enum(captureKinds)).min(1).max(4), selection: captureSelectionSchema.optional() }).strict(),
  z.object({ action: z.literal('revoke'), sessionId }).strict(),
  z.object({ action: z.literal('settings'), kind: z.enum(['microphone', 'camera', 'screen', 'systemAudio']) }).strict(),
  z.object({ action: z.literal('snapshot') }).strict(),
  z.object({ action: z.literal('control'), sessionId, command: z.enum(recordingActions), note: z.string().max(4000).optional() }).strict(),
  z.object({ action: z.literal('shortcuts'), shortcuts: recordingShortcutsSchema }).strict(),
])
export type ScreenRecordingRequest = z.infer<typeof screenRecordingRequestSchema>
