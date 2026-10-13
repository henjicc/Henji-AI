import { z } from 'zod'

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
}
const sessionId = z.string().uuid()
export const captureSelectionSchema = z.object({
  sourceId: z.string().regex(/^(screen|window):\d+:\d+$/),
  excludedSourceIds: z.array(z.string().regex(/^window:\d+:\d+$/)).max(256).default([]),
}).strict()
export type CaptureSelection = z.infer<typeof captureSelectionSchema>
export const screenRecordingRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sources'), excludedSourceIds: z.array(z.string()).max(256).default([]) }).strict(),
  z.object({ action: z.literal('permissions') }).strict(),
  z.object({ action: z.literal('grant'), sessionId, userReceipt: z.string().uuid(), kinds: z.array(z.enum(captureKinds)).min(1).max(4), selection: captureSelectionSchema.optional() }).strict(),
  z.object({ action: z.literal('revoke'), sessionId }).strict(),
  z.object({ action: z.literal('settings'), kind: z.enum(['microphone', 'camera', 'screen', 'systemAudio']) }).strict(),
  z.object({ action: z.literal('snapshot') }).strict(),
  z.object({ action: z.literal('control'), sessionId, command: z.enum(recordingActions) }).strict(),
  z.object({ action: z.literal('shortcuts'), shortcuts: recordingShortcutsSchema }).strict(),
])
export type ScreenRecordingRequest = z.infer<typeof screenRecordingRequestSchema>
