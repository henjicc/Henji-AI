import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { ChevronLeft, Pause, Play, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { UiButton, UiError, UiIconButton, UiLoading, UiSegmented, UiToolbar } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { ICON_TOOL_SCREEN_RECORDING } from '@/core/theme/icons'
import { getPlatform } from '@/platform'
import type { CaptureSource } from '@/core/screenRecording/contracts'
import { captureOptionsSchema } from '@/core/screenRecording/capture'
import { openApplicationSurface } from '@/features/navigation'
import { recordingDevices } from './tracks/devices'
import { controlRecording, recordingView, setRecordingDestination, startRecording, subscribeRecording } from './application/recordingService'
import { RecordingSourcePicker } from './RecordingSourcePicker'
import { loadRecordingSetup, orderedScreens, recordingOutput, saveRecordingSetup, type RecordingRangeMode, type RecordingRegion, type RecordingSetup } from './recordingSetupModel'
import { RecordingSetupPanel } from './RecordingSetupPanel'
import { RecordingLive } from './RecordingLive'
import { RecordingDirectorGoal, RecordingDirectorScript } from './RecordingDirectorPanel'
import { recordingTimeLabel } from './useRecordingControlSnapshot'

/**
 * The recording page only does two things: set up what to record, and show the recording while it runs.
 * When it stops the result goes straight to the editor (full mode) or into a saved video file (quick mode).
 */
export default function ScreenRecordingApp({ onBack }: { onBack: () => void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const state = useSyncExternalStore(subscribeRecording, recordingView)
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof recordingDevices>>>([])
  const [remembered] = useState(() => loadRecordingSetup())
  const [mode, setMode] = useState<RecordingRangeMode>(remembered.range)
  const [sourceId, setSourceId] = useState(remembered.sourceId)
  const [region, setRegion] = useState<RecordingRegion>(remembered.region)
  const [setup, setSetup] = useState<RecordingSetup>(remembered.setup)
  const [director, setDirector] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => { saveRecordingSetup({ range: mode, sourceId, region, setup }) }, [mode, sourceId, region, setup])
  const run = (work: () => Promise<unknown>): void => { setError(''); void work().catch(error => setError(error instanceof Error ? error.message : String(error))) }
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const values = await getPlatform().screenRecording.sources()
      setSources(values)
      // Keep the remembered source when it still exists; otherwise start from the primary monitor.
      setSourceId(current => {
        if (values.some(item => item.id === current)) return current
        // The remembered window has closed: fall back to the main screen, and show the screen range with it.
        setMode(range => range === 'window' ? 'screen' : range)
        return (values.find(item => item.display?.primary) ?? orderedScreens(values)[0] ?? values[0])?.id ?? ''
      })
      setDevices(await recordingDevices())
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh().catch(error => setError(String(error))) }, [refresh])
  const changeMode = (next: RecordingRangeMode): void => {
    setMode(next)
    const current = sources.find(source => source.id === sourceId)
    const wanted = next === 'window' ? 'window' : 'screen'
    if (current?.kind !== wanted) setSourceId((wanted === 'screen' ? sources.find(source => source.display?.primary) ?? orderedScreens(sources)[0] : sources.find(source => source.kind === 'window'))?.id ?? '')
  }
  const selected = sources.find(source => source.id === sourceId)
  const snapshot = state.snapshot
  const active = Boolean(snapshot)
  const planned = !active && Boolean(state.content?.understanding.director) && !state.content?.sessionId
  const begin = async (): Promise<void> => {
    const useRegion = mode === 'region' && selected?.kind === 'screen' && (region.width < 1 || region.height < 1)
    const quick = setup.mode === 'quick'
    const options = captureOptionsSchema.parse({ sourceId, ...recordingOutput(setup), ...(useRegion ? { region } : {}) })
    const destination = state.destination ? { documentId: state.destination.documentId, ...(setup.insert ? { sequenceId: state.destination.sequenceId, frame: state.destination.frame } : {}) } : null
    await startRecording(options, { name: setup.name.trim() || `${t('recording.title')} ${new Date().toLocaleString().replace(/[/:]/g, '-')}`, tracks: { systemAudio: setup.systemAudio, ...(setup.microphone ? { microphone: setup.microphoneId ? { deviceId: setup.microphoneId } : {} } : {}), ...(setup.camera && !quick ? { camera: { ...(setup.cameraId ? { deviceId: setup.cameraId } : {}), width: 1280, height: 720, frameRate: 30 } } : {}) } }, destination, undefined, quick ? { ...(setup.saveDirectory ? { directory: setup.saveDirectory } : {}) } : undefined, true)
    setSetup(value => ({ ...value, name: '' }))
  }
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
    center = <UiSegmented ariaLabel={t('recording.recordMode')} value={director ? 'director' : 'self'} onChange={value => setDirector(value === 'director')} options={[{ value: 'self', label: t('recording.mode_self') }, { value: 'director', label: t('recording.mode_director') }]} />
    trailing = director ? null : <UiButton variant="primary" loading={state.busy} disabled={!sourceId} disabledReason={t('recording.selectSource')} onClick={() => run(begin)}><ICON_TOOL_SCREEN_RECORDING />{t('recording.start')}</UiButton>
  }

  return <div className="flex h-full min-h-0 flex-col" data-application-surface="tool.screen_recording" data-testid="screen-recording-page">
    <UiToolbar variant="command" center={center} centerLayout="fit" trailing={trailing}>
      <UiIconButton aria-label={t('recording.back')} onClick={back}><ChevronLeft /></UiIconButton>{leading}
    </UiToolbar>
    {(error || state.error || snapshot?.error) && <div className="px-4 pt-3"><UiError message={error || state.error || snapshot?.error || ''} /></div>}
    {planned && state.documentId && state.content ? <RecordingDirectorScript sessionId={state.documentId} recording={state.content} />
      : snapshot ? <RecordingLive snapshot={snapshot} saving={state.busy} onMark={note => controlRecording(snapshot.sessionId, 'mark', note)} />
      : state.opening ? <div className="flex min-h-0 flex-1 items-center justify-center"><UiLoading message={t('recording.openingEditor')} /></div>
      : director ? <RecordingDirectorGoal />
      : <div className="flex min-h-0 flex-1">
        <RecordingSourcePicker sources={sources} loading={loading} mode={mode} sourceId={sourceId} region={region} onModeChange={changeMode} onSourceChange={setSourceId} onRegionChange={setRegion} onRefresh={() => run(refresh)} />
        <RecordingSetupPanel value={setup} devices={devices} destination={Boolean(state.destination)} onChange={patch => setSetup(value => ({ ...value, ...patch }))} />
      </div>}
  </div>
}
