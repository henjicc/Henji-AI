import { useTranslation } from 'react-i18next'
import type { RecordingPrivacy, PrivacyCandidate } from '@/core/screenRecording/privacy'
import { UiButton, UiEmpty, UiError, UiGroup, UiLoading, UiVirtualList } from '@/components/ui'
import { UI_PANEL_BODY_HEIGHT_CLASS, UI_TEXT_BODY_CLASS, UI_TEXT_SECONDARY_CLASS, UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'

export interface RecordingPrivacyPanelProps {
  originUs?: number
  privacy: RecordingPrivacy
  disabled?: boolean
  busy?: boolean
  progress?: number
  error?: string
  onAnalyze(): void
  onCancel(): void
  /** Host delegates to screen_recording.understanding.result through the existing transaction engine. */
  onChange(value: RecordingPrivacy): void
  onSeek(candidate: PrivacyCandidate): void
}
/** Content group only: merge host supplies its existing command strip and the authoritative session. */
export function RecordingPrivacyPanel({ privacy, originUs = 0, busy = false, disabled = false, progress, error, onAnalyze, onCancel, onChange, onSeek }: RecordingPrivacyPanelProps): JSX.Element {
  const { t } = useTranslation('ui')
  const setStatus = (status: PrivacyCandidate['status'], id?: string): void => onChange({ ...privacy, candidates: privacy.candidates.map(c => !id || c.id === id ? { ...c, status } : c) })
  return <UiGroup title={t('recordingPrivacy.title')} actions={<div className="flex items-center gap-2">
    {busy ? <UiButton onClick={onCancel}>{t('recordingPrivacy.cancel')}</UiButton> : <UiButton disabled={disabled} disabledReason={t('recordingPrivacy.busy')} onClick={onAnalyze}>{t('recordingPrivacy.analyze')}</UiButton>}
    <UiButton disabled={disabled || busy || !privacy.candidates.some(c => c.status !== 'accepted')} disabledReason={t('recordingPrivacy.noPending')} onClick={() => setStatus('accepted')}>{t('recordingPrivacy.acceptAll')}</UiButton>
  </div>}>
    {error && <UiError message={error} />}
    {busy && <UiLoading message={progress === undefined ? t('recordingPrivacy.analyzing') : t('recordingPrivacy.progress', { percent: Math.round(progress * 100) })} />}
    <p className={`${UI_TEXT_SECONDARY_CLASS} text-text2`}>{t('recordingPrivacy.review')}</p>
    <div className={`${UI_PANEL_BODY_HEIGHT_CLASS.compact} min-h-0`}>
      <UiVirtualList data={privacy.candidates} getKey={c => c.id} emptyState={<UiEmpty title={t('recordingPrivacy.empty')} />}
        renderItem={c => <div className="flex items-center gap-3 border-b border-line py-3">
          <div className="min-w-0 flex-1"><p className={UI_TEXT_BODY_CLASS}>{t(`recordingPrivacy.kind.${c.kind}`)}</p><p className={`${UI_TEXT_SECONDARY_CLASS} text-text2`}>{t(`recordingPrivacy.status.${c.status}`)} · <span className={UI_TEXT_TIMECODE_CLASS}>{((c.startUs - originUs) / 1e6).toFixed(1)}–{((c.endUs - originUs) / 1e6).toFixed(1)} s</span></p></div>
          <UiButton size="sm" disabled={disabled || busy} disabledReason={t('recordingPrivacy.busy')} onClick={() => onSeek(c)}>{t('recordingPrivacy.locate')}</UiButton>
          <UiButton size="sm" disabled={disabled || busy || c.status === 'accepted'} disabledReason={t('recordingPrivacy.noPending')} onClick={() => setStatus('accepted', c.id)}>{t('recordingPrivacy.accept')}</UiButton>
          <UiButton size="sm" disabled={disabled || busy || c.status === 'rejected'} disabledReason={t('recordingPrivacy.noPending')} onClick={() => setStatus('rejected', c.id)}>{t('recordingPrivacy.reject')}</UiButton>
        </div>} />
    </div>
  </UiGroup>
}
