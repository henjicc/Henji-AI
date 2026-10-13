import type { CaptureKind, CapturePermissionStatus, CaptureSelection, CaptureSource, RecordingAction, RecordingControlSnapshot, RecordingShortcuts } from '../../core/screenRecording/contracts'
import type { CapabilityCapture } from '../../core/captureLog/events'

export interface ScreenRecordingPlatform {
  recordCapability(sessionId: string, fact: CapabilityCapture): Promise<void>
  sources(excludedSourceIds?: string[]): Promise<CaptureSource[]>
  permissions(): Promise<CapturePermissionStatus[]>
  grant(input: { sessionId: string; userReceipt: string; kinds: CaptureKind[]; selection?: CaptureSelection }): Promise<void>
  revoke(sessionId: string): Promise<void>
  openPermissionSettings(kind: CaptureKind): Promise<void>
  snapshot(): Promise<RecordingControlSnapshot | null>
  control(sessionId: string, command: RecordingAction, note?: string): Promise<RecordingControlSnapshot | null>
  shortcuts(shortcuts: RecordingShortcuts): Promise<RecordingAction[]>
  onChanged(listener: (snapshot: RecordingControlSnapshot | null) => void): () => void
}
