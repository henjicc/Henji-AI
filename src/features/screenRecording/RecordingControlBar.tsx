import { useEffect, useState } from 'react'
import { Flag, Mic, Pause, Play, Square } from 'lucide-react'
import { UiButton, UiError, UiPanel, UiToolbar } from '@/components/ui'
import { UI_ICON_SIZE_CLASS, UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { useApplyRuntimeTheme } from '@/hooks/useApplyRuntimeTheme'
import { useI18n } from '@/hooks/useI18n'
import { getPlatform } from '@/platform'
import type { RecordingAction, RecordingControlSnapshot } from '@/core/screenRecording/contracts'

function timeLabel(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

export default function RecordingControlBar(): React.ReactElement {
  useApplyRuntimeTheme()
  const { t } = useI18n('ui')
  const [snapshot, setSnapshot] = useState<RecordingControlSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const api = getPlatform().screenRecording
    let disposed = false
    let receivedEvent = false
    const unsubscribe = api.onChanged(value => { receivedEvent = true; if (!disposed) setSnapshot(value) })
    void api.snapshot().then(value => { if (!disposed && !receivedEvent) setSnapshot(value) }).catch(() => { if (!disposed) setError(t('screenRecording.readFailed')) })
    return () => { disposed = true; unsubscribe() }
  }, [t])
  const command = async (action: RecordingAction): Promise<void> => {
    if (!snapshot) return
    setError(null)
    try { await getPlatform().screenRecording.control(snapshot.sessionId, action) }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('screenRecording.operationFailed')) }
  }
  const phase = snapshot?.phase
  const running = phase === 'recording'
  const toggleLabel = t(`screenRecording.${phase === 'ready' ? 'start' : phase === 'paused' ? 'resume' : 'pause'}`)
  const phaseLabel = t(`screenRecording.${phase ?? 'preparing'}`, { seconds: snapshot?.countdown })
  const level = snapshot?.microphoneLevel
  const trackWarning = snapshot?.trackWarnings?.includes('device-disconnected') ? 'device-disconnected' : snapshot?.trackWarnings?.[0]
  return <UiPanel className="flex h-full flex-col p-2" role="region" aria-label={t('screenRecording.title')}>
    <div className="flex items-center justify-between gap-2 text-xs text-text2" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <span aria-live="polite">{phaseLabel}</span>
      <span className={UI_TEXT_TIMECODE_CLASS}>{timeLabel(snapshot?.elapsedMs ?? 0)}</span>
      <span className="flex items-center gap-1" aria-label={t('screenRecording.microphoneLevel')}><Mic className={UI_ICON_SIZE_CLASS.sm} />{level === null || level === undefined ? t('screenRecording.microphoneInactive') : `${Math.round(level * 100)}%`}</span>
    </div>
    <UiToolbar gap="group" className="justify-center">
      {snapshot?.cameraPreview && <img src={snapshot.cameraPreview} alt={t('screenRecording.cameraPreview')} className="w-16 aspect-video object-contain rounded-control" />}
      <UiButton size="sm" variant={phase === 'ready' ? 'primary' : 'quiet'} disabled={!snapshot || snapshot.busy || !['ready', 'recording', 'paused'].includes(phase ?? '')} disabledReason={t('screenRecording.toggleUnavailable')} onClick={() => { void command('toggle') }}>{running ? <Pause /> : <Play />}{toggleLabel}</UiButton>
      <UiButton size="sm" disabled={!running || snapshot?.busy} disabledReason={t('screenRecording.markUnavailable')} onClick={() => { void command('mark') }}><Flag />{t('screenRecording.mark')}</UiButton>
      <UiButton size="sm" variant={phase === 'ready' ? 'quiet' : 'primary'} disabled={!snapshot || phase === 'stopped'} disabledReason={t('screenRecording.stopUnavailable')} onClick={() => { void command('stop') }}><Square />{t('screenRecording.stop')}</UiButton>
    </UiToolbar>
    {(error || snapshot?.error) ? <UiError size="xs" align="start" title={error ?? snapshot?.error ?? ''} message="" /> : Boolean(snapshot?.shortcutConflicts.length) && <span className="text-xs text-danger-text">{t('screenRecording.shortcutConflict')}</span>}
    {trackWarning && (phase === 'recording' || phase === 'paused') && <span className="text-xs text-danger-text" role="status">{t(`screenRecording.trackWarning.${trackWarning}`)}</span>}
  </UiPanel>
}
