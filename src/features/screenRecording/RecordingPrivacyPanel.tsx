import { useTranslation } from 'react-i18next'
import type { RecordingPrivacy, PrivacyCandidate } from '@/core/screenRecording/privacy'
import { UiActionGroup, UiButton, UiEmpty, UiError, UiLoading, UiRecordItem, UiVirtualList } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'

export interface RecordingPrivacyPanelProps {
  originUs?: number
  privacy: RecordingPrivacy
  disabled?: boolean
  busy?: boolean
  progress?: number
  error?: string
  /** Candidate the user last pointed at on the timeline; highlighted in the list. */
  focusedId?: string
  onAnalyze(): void
  onCancel(): void
  /** Host delegates to screen_recording.understanding.result through the existing transaction engine. */
  onChange(value: RecordingPrivacy): void
  onSeek(candidate: PrivacyCandidate): void
}
/** Inspector page: find, then confirm or ignore each candidate in place. Confirmed ones are blurred in every output. */
export function RecordingPrivacyPanel({ privacy, originUs = 0, busy = false, disabled = false, progress, error, focusedId, onAnalyze, onCancel, onChange, onSeek }: RecordingPrivacyPanelProps): JSX.Element {
  const { t } = useTranslation('ui')
  const setStatus = (status: PrivacyCandidate['status'], id?: string): void => onChange({ ...privacy, candidates: privacy.candidates.map(c => !id || c.id === id ? { ...c, status } : c) })
  const pending = privacy.candidates.filter(c => c.status === 'pending').length
  return <div className="flex min-h-0 flex-1 flex-col gap-3" data-recording-privacy>
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 text-xs text-text2">{privacy.candidates.length ? t('recordingPrivacy.summary', { count: privacy.candidates.length, pending }) : t('recordingPrivacy.local')}</span>
      <UiActionGroup tier="quiet" size="sm">
        {busy ? <UiButton onClick={onCancel}>{t('recordingPrivacy.cancel')}</UiButton> : <UiButton disabled={disabled} disabledReason={t('recordingPrivacy.busy')} onClick={onAnalyze}>{t('recordingPrivacy.analyze')}</UiButton>}
        <UiButton disabled={disabled || busy || !privacy.candidates.some(c => c.status !== 'accepted')} disabledReason={t('recordingPrivacy.noPending')} onClick={() => setStatus('accepted')}>{t('recordingPrivacy.acceptAll')}</UiButton>
      </UiActionGroup>
    </div>
    {error && <UiError message={error} />}
    {busy && <UiLoading message={progress === undefined ? t('recordingPrivacy.analyzing') : t('recordingPrivacy.progress', { percent: Math.round(progress * 100) })} />}
    {privacy.candidates.length ? <div className="min-h-0 flex-1">
      <UiVirtualList data={privacy.candidates} getKey={c => c.id} renderItem={(c, index) => <UiRecordItem index={index} density="compact" data-focused={c.id === focusedId || undefined}
        title={t(`recordingPrivacy.kind.${c.kind}`)}
        meta={[t(`recordingPrivacy.status.${c.status}`), <span key="time" className={UI_TEXT_TIMECODE_CLASS}>{((c.startUs - originUs) / 1e6).toFixed(1)}–{((c.endUs - originUs) / 1e6).toFixed(1)} s</span>]}
        actions={<UiActionGroup tier="quiet" size="sm">
          <UiButton disabled={disabled || busy} disabledReason={t('recordingPrivacy.busy')} onClick={() => onSeek(c)}>{t('recordingPrivacy.locate')}</UiButton>
          <UiButton disabled={disabled || busy || c.status === 'accepted'} disabledReason={t('recordingPrivacy.noPending')} onClick={() => setStatus('accepted', c.id)}>{t('recordingPrivacy.accept')}</UiButton>
          <UiButton disabled={disabled || busy || c.status === 'rejected'} disabledReason={t('recordingPrivacy.noPending')} onClick={() => setStatus('rejected', c.id)}>{t('recordingPrivacy.reject')}</UiButton>
        </UiActionGroup>} />} />
    </div> : !busy && <UiEmpty title={t('recordingPrivacy.empty')} description={t('recordingPrivacy.emptyHint')} />}
    {privacy.candidates.length > 0 && <p className="text-xs text-text3">{t('recordingPrivacy.review')}</p>}
  </div>
}
