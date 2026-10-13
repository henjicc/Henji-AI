import type { CaptureKind, CapturePermissionStatus, CaptureSelection, CaptureSource, RecordingAction, RecordingControlSnapshot, RecordingShortcuts } from '../../core/screenRecording/contracts'

export interface ScreenRecordingPlatform {
  sources(excludedSourceIds?: string[]): Promise<CaptureSource[]>
  permissions(): Promise<CapturePermissionStatus[]>
  grant(input: { sessionId: string; userReceipt: string; kinds: CaptureKind[]; selection?: CaptureSelection }): Promise<void>
  revoke(sessionId: string): Promise<void>
  openPermissionSettings(kind: CaptureKind): Promise<void>
  snapshot(): Promise<RecordingControlSnapshot | null>
  control(sessionId: string, command: RecordingAction): Promise<RecordingControlSnapshot | null>
  shortcuts(shortcuts: RecordingShortcuts): Promise<RecordingAction[]>
  onChanged(listener: (snapshot: RecordingControlSnapshot | null) => void): () => void
}
