import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Flag, Mic, MicOff } from 'lucide-react'
import { UiButton, UiInput } from '@/components/ui'
import { UI_ICON_SIZE_CLASS, UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import type { RecordingControlSnapshot } from '@/core/screenRecording/contracts'
import { recordingTimeLabel } from './useRecordingControlSnapshot'

/** The in-app view of a running session: what is happening and the one thing worth doing here (marking). */
export function RecordingLive({ snapshot, onMark }: { snapshot: RecordingControlSnapshot; onMark(note: string): Promise<void> }): React.ReactElement {
  const { t } = useTranslation('ui')
  const [note, setNote] = useState('')
  const [marks, setMarks] = useState<Array<{ at: number; note: string }>>([])
  const level = snapshot.microphoneLevel
  const recording = snapshot.phase === 'recording'
  const warning = snapshot.trackWarnings?.includes('device-disconnected') ? 'device-disconnected' : snapshot.trackWarnings?.[0]
  const mark = async (): Promise<void> => {
    const at = snapshot.elapsedMs
    await onMark(note)
    setMarks(values => [...values, { at, note: note.trim() }]); setNote('')
  }
  const dot = recording ? 'bg-danger-solid' : snapshot.phase === 'paused' ? 'bg-warning-solid' : 'bg-text3'
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6" data-recording-live={snapshot.phase}>
    <div className="flex flex-col items-center gap-3">
      <span className="flex items-center gap-2 text-sm text-text2"><span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />{t(`screenRecording.${snapshot.phase}`, { seconds: snapshot.countdown })}</span>
      <span className={`${UI_TEXT_TIMECODE_CLASS} text-display font-light text-text1`}>{snapshot.phase === 'countdown' && snapshot.countdown > 0 ? snapshot.countdown : recordingTimeLabel(snapshot.elapsedMs)}</span>
    </div>
    <div className="flex items-center gap-6">
      {snapshot.cameraPreview && <img src={snapshot.cameraPreview} alt={t('screenRecording.cameraPreview')} className="h-24 w-24 rounded-full object-cover" />}
      <span className="flex items-center gap-2 text-text2" role="meter" aria-label={t('screenRecording.microphoneLevel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((level ?? 0) * 100)}>
        {level === null ? <><MicOff className={UI_ICON_SIZE_CLASS.md} aria-hidden />{t('screenRecording.microphoneInactive')}</> : <>
          <Mic className={UI_ICON_SIZE_CLASS.md} aria-hidden />
          <span className="h-1.5 w-48 overflow-hidden rounded-full bg-hover"><span className="block h-full w-full origin-left rounded-full bg-success-solid" style={{ transform: `scaleX(${Math.min(1, Math.max(0, level))})` }} /></span>
        </>}
      </span>
    </div>
    {warning && <p className="text-13 text-warning-text" role="status">{t(`screenRecording.trackWarning.${warning}`)}</p>}
    <div className="flex w-full max-w-md items-center gap-2">
      <UiInput aria-label={t('recording.marker')} className="min-w-0 flex-1" value={note} onChange={event => setNote(event.target.value)} maxLength={4000} placeholder={t('recording.markerPlaceholder')}
        onKeyDown={event => { if (event.key === 'Enter' && recording && !snapshot.busy) void mark() }} />
      <UiButton variant="secondary" disabled={!recording || snapshot.busy} disabledReason={t('recording.markDuringRecording')} onClick={() => { void mark() }}><Flag />{t('recording.mark')}</UiButton>
    </div>
    {marks.length > 0 && <p className="max-w-md text-center text-xs text-text3">{t('recording.marksSoFar', { count: marks.length })} · {marks.map(item => `${recordingTimeLabel(item.at).slice(3)}${item.note ? ` ${item.note}` : ''}`).join(' · ')}</p>}
  </div>
}
