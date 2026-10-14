import { useApplyRuntimeTheme } from '@/hooks/useApplyRuntimeTheme'
import { useI18n } from '@/hooks/useI18n'
import { useRecordingControlSnapshot } from './useRecordingControlSnapshot'

/** Drawn in a click-through window excluded from capture: tells the user exactly what is being recorded. */
export default function RecordingFrame(): React.ReactElement | null {
  useApplyRuntimeTheme()
  const { t } = useI18n('ui')
  const snapshot = useRecordingControlSnapshot()
  const phase = snapshot?.phase
  if (phase !== 'countdown' && phase !== 'recording' && phase !== 'paused') return null
  const tone = phase === 'recording' ? 'border-danger-solid' : phase === 'paused' ? 'border-warning-solid' : 'border-accent'
  return <div className={`relative h-full w-full border-4 ${tone}`} data-recording-frame={phase}>
    {phase === 'countdown' && <div className="absolute inset-0 flex items-center justify-center">
      {/* Zero means capture is still warming up: never show a frozen 0. */}
      {snapshot?.countdown
        ? <span className="flex h-32 w-32 items-center justify-center rounded-full bg-media-scrim font-mono text-display font-semibold tabular-nums text-on-media" aria-live="assertive">{snapshot.countdown}</span>
        : <span className="rounded-full bg-media-scrim px-4 py-2 text-sm font-medium text-on-media" aria-live="assertive">{t('screenRecording.preparing')}</span>}
    </div>}
    {phase === 'paused' && <span className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b-md bg-warning-solid px-3 py-1 text-xs font-semibold text-on-warning">{t('screenRecording.paused')}</span>}
  </div>
}
