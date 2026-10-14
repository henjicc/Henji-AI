import { useCallback, useState } from 'react'
import { AlertTriangle, Flag, GripVertical, Mic, MicOff, Pause, Play, Square } from 'lucide-react'
import { UiButton, UiPanel } from '@/components/ui'
import { UI_ICON_SIZE_CLASS, UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { useApplyRuntimeTheme } from '@/hooks/useApplyRuntimeTheme'
import { useI18n } from '@/hooks/useI18n'
import { getPlatform } from '@/platform'
import type { RecordingAction } from '@/core/screenRecording/contracts'
import { recordingTimeLabel, useRecordingControlSnapshot } from './useRecordingControlSnapshot'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/**
 * Floating pill excluded from capture: status on the left, the three recording actions on the right.
 * The window is exactly the pill, so no tooltips: every action carries its own short label.
 */
export default function RecordingControlBar(): React.ReactElement {
  useApplyRuntimeTheme()
  const { t } = useI18n('ui')
  const [error, setError] = useState<string | null>(null)
  const readFailed = useCallback(() => setError(t('screenRecording.readFailed')), [t])
  const snapshot = useRecordingControlSnapshot(readFailed)
  const command = async (action: RecordingAction): Promise<void> => {
    if (!snapshot) return
    setError(null)
    try { await getPlatform().screenRecording.control(snapshot.sessionId, action) }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('screenRecording.operationFailed')) }
  }
  const phase = snapshot?.phase
  const running = phase === 'recording'
  const level = snapshot?.microphoneLevel
  const trackWarning = snapshot?.trackWarnings?.includes('device-disconnected') ? 'device-disconnected' : snapshot?.trackWarnings?.[0]
  const problem = error ?? snapshot?.error ?? (trackWarning && (running || phase === 'paused') ? t(`screenRecording.trackWarning.${trackWarning}`) : snapshot?.shortcutConflicts.length ? t('screenRecording.shortcutConflict') : null)
  const dot = phase === 'recording' ? 'bg-danger-solid' : phase === 'paused' ? 'bg-warning-solid' : 'bg-text3'
  const toggleKey = phase === 'ready' ? 'start' : phase === 'paused' ? 'resume' : 'pause'
  // ui-surface-allow: E 控制条窗口本身就是胶囊形透明窗口，面板圆角必须与窗口外形一致（屏幕录制界面重做）
  return <UiPanel className="flex h-full items-center gap-2 rounded-full pl-2 pr-1.5" style={drag} role="region" aria-label={t('screenRecording.title')} data-recording-control-bar>
    <GripVertical className={`${UI_ICON_SIZE_CLASS.sm} shrink-0 text-text3`} aria-hidden />
    {snapshot?.cameraPreview && <img src={snapshot.cameraPreview} alt={t('screenRecording.cameraPreview')} className="h-8 w-8 shrink-0 rounded-full object-cover" />}
    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
    <span className="sr-only" aria-live="polite">{t(`screenRecording.${phase ?? 'preparing'}`, { seconds: snapshot?.countdown })}</span>
    {problem
      ? <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-warning-text" role="status"><AlertTriangle className={`${UI_ICON_SIZE_CLASS.sm} shrink-0`} aria-hidden /><span className="truncate">{problem}</span></span>
      : <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className={`${UI_TEXT_TIMECODE_CLASS} text-sm font-medium text-text1`}>{phase === 'countdown' ? t('screenRecording.countdown', { seconds: snapshot?.countdown }) : recordingTimeLabel(snapshot?.elapsedMs ?? 0)}</span>
        <span className="flex items-center gap-1.5 text-text2" aria-label={t('screenRecording.microphoneLevel')} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level === null || level === undefined ? 0 : Math.round(level * 100)}>
          {level === null || level === undefined ? <MicOff className={UI_ICON_SIZE_CLASS.sm} aria-label={t('screenRecording.microphoneInactive')} /> : <>
            <Mic className={UI_ICON_SIZE_CLASS.sm} aria-hidden />
            <span className="h-1 w-10 overflow-hidden rounded-full bg-hover"><span className="block h-full w-full origin-left rounded-full bg-success-solid" style={{ transform: `scaleX(${Math.min(1, Math.max(0, level))})` }} /></span>
          </>}
        </span>
      </span>}
    <span className="flex shrink-0 items-center gap-1" style={noDrag}>
      <UiButton size="sm" variant={phase === 'ready' ? 'primary' : 'quiet'} aria-label={t(`screenRecording.${toggleKey}`)} disabled={!snapshot || snapshot.busy || !['ready', 'recording', 'paused'].includes(phase ?? '')} disabledReason={t('screenRecording.toggleUnavailable')} onClick={() => { void command('toggle') }}>{running ? <Pause /> : <Play />}{t(`screenRecording.${toggleKey}Short`)}</UiButton>
      <UiButton size="sm" aria-label={t('screenRecording.mark')} disabled={!running || snapshot?.busy} disabledReason={t('screenRecording.markUnavailable')} onClick={() => { void command('mark') }}><Flag />{t('screenRecording.markShort')}</UiButton>
      <UiButton size="sm" variant={phase === 'ready' ? 'quiet' : 'primary'} aria-label={t('screenRecording.stop')} disabled={!snapshot || phase === 'stopped'} disabledReason={t('screenRecording.stopUnavailable')} onClick={() => { void command('stop') }}><Square />{t('screenRecording.stopShort')}</UiButton>
    </span>
  </UiPanel>
}
