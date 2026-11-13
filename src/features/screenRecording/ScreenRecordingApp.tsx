import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, Pause, Play, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { UiButton, UiError, UiIconButton, UiLoading, UiSegmented, UiToolbar } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { ICON_TOOL_SCREEN_RECORDING } from '@/core/theme/icons'
import { getPlatform } from '@/platform'
import { openApplicationSurface } from '@/features/navigation'
import { controlRecording, recordingView, setRecordingDestination, startRecording, subscribeRecording } from './application/recordingService'
import { RecordingSourcePicker } from './RecordingSourcePicker'
import { DEFAULT_WEB_APP_BACKUP, orderedScreens, recordingTracksFromSetup, webAppBackupOptions, type WebAppBackupSetup } from './recordingSetupModel'
import { useRecordingSetupState } from './useRecordingSetupState'
import { RecordingSetupPanel } from './RecordingSetupPanel'
import { RecordingLive } from './RecordingLive'
import { RecordingDirectorGoal, RecordingDirectorScript } from './RecordingDirectorPanel'
import { recordingTimeLabel } from './useRecordingControlSnapshot'
import { WebAppRecordingActions, WebAppRecordingPanel, WebAppRecordingStatus } from './WebAppRecordingPanel'
import { useWebAppRecording } from './useWebAppRecording'
import { subscribeWebRecordingFocus, takeWebRecordingFocus } from './application/webAppRecordingFocus'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * The recording page only does two things: set up what to record, and show the recording while it runs.
 * When it stops the result goes straight to the editor (full mode) or into a saved video file (quick mode).
 */
export default function ScreenRecordingApp({ onBack }: { onBack: () => void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const state = useSyncExternalStore(subscribeRecording, recordingView)
  const [error, setError] = useState('')
  const reportError = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)), [])
  const recording = useRecordingSetupState(reportError)
  const { sources, devices, loading, mode, sourceId, region, setup, setSetup, setSourceId, setRegion, changeMode, refresh } = recording
  const webAppEnabled = useSettingsStore(value => value.experimentalWebAppRecording)
  const [chosenKind, setKind] = useState<'self' | 'director' | 'webapp'>('self')
  // Web app recording is experimental: without the setting the mode does not exist on this page.
  const kind = chosenKind === 'webapp' && !webAppEnabled ? 'self' : chosenKind
  const director = kind === 'director'
  const webApp = useWebAppRecording()
  // Opened from an edit in a project: web recordings go into that project (素材/录屏/<名称>.hjweb).
  const destinationDocumentId = state.destination?.documentId
  const [webAppProjectId, setWebAppProjectId] = useState<string | null>(null)
  useEffect(() => {
    setWebAppProjectId(null)
    if (!destinationDocumentId) return
    let current = true
    void getPlatform().documents.listDocuments({ kind: 'video_edit', includeMissing: false }).then(documents => {
      const container = documents.find(document => document.id === destinationDocumentId)?.container
      if (current) setWebAppProjectId(container?.kind === 'project' ? container.projectId : null)
    }).catch(() => undefined)
    return () => { current = false }
  }, [destinationDocumentId])
  // A web recording opened from the work list shows here, selected.
  const { selectRecording } = webApp
  useEffect(() => {
    const focus = (): void => { const id = takeWebRecordingFocus(); if (id) { setKind('webapp'); selectRecording(id) } }
    focus()
    return subscribeWebRecordingFocus(focus)
  }, [selectRecording])
  const run = (work: () => Promise<unknown>): void => { setError(''); void work().catch(error => setError(error instanceof Error ? error.message : String(error))) }
  const snapshot = state.snapshot
  const active = Boolean(snapshot)
  const planned = !active && Boolean(state.content?.understanding.director) && !state.content?.sessionId
  const begin = async (): Promise<void> => {
    const quick = setup.mode === 'quick'
    const options = recording.captureOptions()
    const destination = state.destination ? { documentId: state.destination.documentId, ...(setup.insert ? { sequenceId: state.destination.sequenceId, frame: state.destination.frame } : {}) } : null
    await startRecording(options, { name: setup.name.trim() || `${t('recording.title')} ${new Date().toLocaleString().replace(/[/:]/g, '-')}`, tracks: recordingTracksFromSetup(setup, quick) }, destination, undefined, quick ? { ...(setup.saveDirectory ? { directory: setup.saveDirectory } : {}) } : undefined, true)
    setSetup(value => ({ ...value, name: '' }))
  }
  const webAppBackup = setup.webAppBackup ?? DEFAULT_WEB_APP_BACKUP
  const changeWebAppBackup = (patch: Partial<WebAppBackupSetup>): void => setSetup(value => ({ ...value, webAppBackup: { ...(value.webAppBackup ?? DEFAULT_WEB_APP_BACKUP), ...patch } }))
  const back = (): void => { if (state.destination) openApplicationSurface('workspace.video_edit'); else onBack() }

  let leading: React.ReactNode = <span className="text-sm font-medium">{t('recording.title')}</span>
  let center: React.ReactNode = null
  let trailing: React.ReactNode = null
  if (planned) {
    leading = <span className="flex items-center gap-2 text-sm font-medium">{t('recording.title')}<span className="text-xs font-normal text-text2">{t('recording.directorTitle')}</span></span>
    trailing = <UiButton onClick={() => setRecordingDestination(state.destination)}>{t('recording.new')}</UiButton>
  } else if (snapshot) {
    leading = <span className="flex items-center gap-2 text-sm font-medium">{t('recording.title')}<span className={`${UI_TEXT_TIMECODE_CLASS} text-xs text-text2`}>{snapshot.phase === 'countdown' ? snapshot.countdown ? t('recording.countdown', { count: snapshot.countdown }) : t('screenRecording.preparing') : recordingTimeLabel(snapshot.elapsedMs)}</span></span>
    trailing = <>
      <UiButton variant="danger" disabled={state.busy} disabledReason={t('screenRecording.toggleUnavailable')} onClick={() => run(() => controlRecording(snapshot.sessionId, 'cancel'))}>{t('recording.cancel')}</UiButton>
      {snapshot.phase === 'recording' || snapshot.phase === 'paused' ? <UiButton disabled={snapshot.busy} disabledReason={t('screenRecording.toggleUnavailable')} onClick={() => run(() => controlRecording(snapshot.sessionId, snapshot.phase === 'paused' ? 'resume' : 'pause'))}>{snapshot.phase === 'paused' ? <Play /> : <Pause />}{t(snapshot.phase === 'paused' ? 'recording.resume' : 'recording.pause')}</UiButton> : null}
      <UiButton variant="primary" disabled={state.busy} disabledReason={t('recording.saving')} onClick={() => run(() => controlRecording(snapshot.sessionId, snapshot.phase === 'failed' ? 'cancel' : 'stop'))}><Square />{t('recording.stop')}</UiButton>
    </>
  } else if (!state.opening) {
    center = <UiSegmented ariaLabel={t('recording.recordMode')} value={kind} onChange={setKind} options={[{ value: 'self', label: t('recording.mode_self') }, { value: 'director', label: t('recording.mode_director') }, ...(webAppEnabled ? [{ value: 'webapp' as const, label: t('recording.mode_webapp') }] : [])]} />
    if (kind === 'webapp' && webApp.activeId) leading = <span className="flex items-center gap-2 text-sm font-medium">{t('recording.title')}<WebAppRecordingStatus model={webApp} /></span>
    trailing = director ? null : kind === 'webapp' ? <WebAppRecordingActions model={webApp} setup={webAppBackup} backup={webAppBackupOptions(webAppBackup, sources)} projectId={webAppProjectId} /> : <UiButton variant="primary" loading={state.busy} disabled={!sourceId} disabledReason={t('recording.selectSource')} onClick={() => run(begin)}><ICON_TOOL_SCREEN_RECORDING />{t('recording.start')}</UiButton>
  }

  return <div className="flex h-full min-h-0 flex-col" data-application-surface="tool.screen_recording" data-testid="screen-recording-page">
    <UiToolbar variant="command" center={center} centerLayout="fit" trailing={trailing}>
      <UiIconButton aria-label={t('recording.back')} tooltip={t('recording.back')} onClick={back}><ArrowLeft /></UiIconButton>{leading}
    </UiToolbar>
    {(error || state.error || snapshot?.error) && <div className="px-4 pt-3"><UiError message={error || state.error || snapshot?.error || ''} /></div>}
    {planned && state.documentId && state.content ? <RecordingDirectorScript sessionId={state.documentId} recording={state.content} />
      : snapshot ? <RecordingLive snapshot={snapshot} saving={state.busy} onMark={note => controlRecording(snapshot.sessionId, 'mark', note)} />
      : state.opening ? <div className="flex min-h-0 flex-1 items-center justify-center"><UiLoading message={t('recording.openingEditor')} /></div>
      : director ? <RecordingDirectorGoal />
      : kind === 'webapp' ? <WebAppRecordingPanel model={webApp} backup={webAppBackup} screens={orderedScreens(sources)} onBackupChange={changeWebAppBackup} />
      : <div className="flex min-h-0 flex-1">
        <RecordingSourcePicker sources={sources} loading={loading} mode={mode} sourceId={sourceId} region={region} onModeChange={changeMode} onSourceChange={setSourceId} onRegionChange={setRegion} onRefresh={() => run(refresh)} />
        <RecordingSetupPanel value={setup} devices={devices} destination={Boolean(state.destination)} onChange={patch => setSetup(value => ({ ...value, ...patch }))} />
      </div>}
  </div>
}
