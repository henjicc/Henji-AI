import { useEffect, useRef, useState } from 'react'
import type { RecordingDocument } from '@/core/screenRecording/document'
import type { PrivacyCandidate, RecordingPrivacy } from '@/core/screenRecording/privacy'
import { executeUiApplicationCapability } from '@/features/application-control'
import { RecordingPrivacyPanel } from './RecordingPrivacyPanel'
import { readRecordingUnderstanding } from './application/recordingUnderstandingService'
import { UNDERSTANDING_ENTITY, UNDERSTANDING_PROPERTY } from './application/recordingUnderstandingFields'
import { showRecordingDocument } from './application/recordingService'

export function RecordingSessionPrivacy({ recording, originUs, disabled, focusedId, onBusyChange, onSeek }: {
  recording: RecordingDocument; originUs: number; disabled: boolean; focusedId?: string; onBusyChange(value: boolean): void; onSeek(candidate: PrivacyCandidate): void
}): JSX.Element {
  const controller = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => { controller.current?.abort() }, [])
  const run = async (privacy?: RecordingPrivacy): Promise<void> => {
    if (controller.current || disabled || !recording.sessionId) return
    const sessionId = recording.sessionId
    const operation = new AbortController(); controller.current = operation
    setBusy(true); onBusyChange(true); setError('')
    try {
      const before = await readRecordingUnderstanding(sessionId)
      if (JSON.stringify(before.content.understanding) !== JSON.stringify(recording.understanding)) throw new Error('会话已修改，请重新打开后确认。')
      const target = { kind: UNDERSTANDING_ENTITY, id: sessionId }
      const result = await executeUiApplicationCapability(privacy ? {
        id: 'change_application_entities', version: 2, expectedRevisions: { screen_recording: before.meta.revision },
        input: { summary: '确认录制敏感信息', changes: [{ kind: 'set_properties', entityType: target.kind, target, properties: { [UNDERSTANDING_PROPERTY]: { ...before.content.understanding, privacy } } }] },
      } : { id: 'detect_screen_recording_sensitive_text', version: 1, input: { sessionRef: { kind: 'screen_recording.session', id: sessionId } } }, operation.signal)
      if (!result.ok) throw new Error(result.error.message)
      operation.signal.throwIfAborted()
      await showRecordingDocument(sessionId)
    } catch (failure) { if (!operation.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { controller.current = null; setBusy(false); onBusyChange(false) }
  }
  return <RecordingPrivacyPanel privacy={recording.understanding.privacy} originUs={originUs} busy={busy} disabled={disabled} error={error} focusedId={focusedId}
    onAnalyze={() => { void run() }} onCancel={() => controller.current?.abort()} onChange={value => { void run(value) }} onSeek={onSeek} />
}
