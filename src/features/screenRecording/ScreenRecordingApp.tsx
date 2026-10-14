import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronLeft, Download, Pause, Play, RefreshCw, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { UiButton, UiError, UiIconButton, UiModal, UiSegmented, UiToolbar } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { ICON_TOOL_SCREEN_RECORDING } from '@/core/theme/icons'
import { getPlatform } from '@/platform'
import type { CaptureSource } from '@/core/screenRecording/contracts'
import { captureOptionsSchema } from '@/core/screenRecording/capture'
import { RECORDING_MOVIE_RECIPES, type RecordingMovieRecipe } from '@/core/screenRecording/movie'
import { openApplicationSurface } from '@/features/navigation'
import { executeUiApplicationCapability } from '@/features/application-control'
import { recordingDevices } from './tracks/devices'
import { controlRecording, recordingView, recoverRecording, revealQuickRecording, saveQuickRecording, setRecordingDestination, showRecordingDocument, startRecording, subscribeRecording } from './application/recordingService'
import { RecordingQuickResult } from './RecordingQuickResult'
import { recordingTimeline } from './application/recordingTimeline'
import { RecordingSourcePicker } from './RecordingSourcePicker'
import { DEFAULT_RECORDING_SETUP, FULL_REGION, formatRecordingTime, orderedScreens, recordingOutput, type RecordingRangeMode, type RecordingRegion, type RecordingSetup } from './recordingSetupModel'
import { RecordingSetupPanel } from './RecordingSetupPanel'
import { RecordingLive } from './RecordingLive'
import { RecordingWorkbench } from './RecordingWorkbench'
import { RecordingDirectorGoal, RecordingDirectorScript } from './RecordingDirectorPanel'
import { RecordingProductOptions } from './RecordingProductOptions'
import { recordingTimeLabel } from './useRecordingControlSnapshot'

/** Kept for the app session so the next recording starts from the same range and devices. */
let rememberedSetup: { mode: RecordingRangeMode; sourceId: string; region: RecordingRegion; setup: RecordingSetup } | null = null

export default function ScreenRecordingApp({ onBack }: { onBack: () => void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const state = useSyncExternalStore(subscribeRecording, recordingView)
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof recordingDevices>>>([])
  const [mode, setMode] = useState<RecordingRangeMode>(rememberedSetup?.mode ?? 'screen')
  const [sourceId, setSourceId] = useState(rememberedSetup?.sourceId ?? '')
  const [region, setRegion] = useState<RecordingRegion>(rememberedSetup?.region ?? FULL_REGION)
  const [setup, setSetup] = useState<RecordingSetup>(rememberedSetup?.setup ?? DEFAULT_RECORDING_SETUP)
  const [director, setDirector] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [recipe, setRecipe] = useState<RecordingMovieRecipe>(RECORDING_MOVIE_RECIPES.tutorial)
  const [privacyBusy, setPrivacyBusy] = useState(false)
  const [productBusy, setProductBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [moviePhase, setMoviePhase] = useState('')
  const [workbenchFor, setWorkbenchFor] = useState<string | null>(null)
  const movieController = useRef<AbortController | null>(null)
  const movieTarget = useRef<{ sessionId: string; documentId: string } | null>(null)
  useEffect(() => () => movieController.current?.abort(), [])
  useEffect(() => { rememberedSetup = { mode, sourceId, region, setup } }, [mode, sourceId, region, setup])
  const generateMovie = async (): Promise<void> => {
    if (!state.documentId || movieController.current) return
    const controller = new AbortController(); movieController.current = controller
    try {
      setMoviePhase('analyzing')
      // Understanding is its own existing, undoable preparation step; generation is one subsequent timeline transaction.
      if (!state.content?.understanding.steps.length) {
        const analyzed = await executeUiApplicationCapability({ id: 'understand_screen_recording', version: 1, input: { sessionRef: { kind: 'screen_recording.session', id: state.documentId }, transcribe: false, detectVisuals: true } }, controller.signal)
        if (!analyzed.ok) throw new Error(analyzed.error.message)
        await showRecordingDocument(state.documentId)
      }
      controller.signal.throwIfAborted()
      const editor = await import('@/features/videoEdit')
      const documentId = state.destination?.documentId ?? (movieTarget.current?.sessionId === state.documentId ? movieTarget.current.documentId : (await editor.createVideoEditProject()).document.id)
      movieTarget.current = { sessionId: state.documentId, documentId }
      const { generateRecordingMovie } = await import('./application/recordingMovieService')
      const result = await generateRecordingMovie(state.documentId, { documentId, recipe }, controller.signal, setMoviePhase)
      controller.signal.throwIfAborted()
      if (!result.verified) throw new Error(t('recording.movieUnverified'))
      await editor.openVideoEditDocument({ id: documentId })
      editor.switchVideoEditSequence(documentId, result.sequenceIds[0], { fromStart: true })
      openApplicationSurface('workspace.video_edit')
    } finally { movieController.current = null; setMoviePhase('') }
  }
  const run = (work: () => Promise<unknown>): void => { setError(''); void work().catch(error => setError(error instanceof Error ? error.message : String(error))) }
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const values = await getPlatform().screenRecording.sources()
      setSources(values)
      // Keep the remembered source when it still exists; otherwise start from the primary monitor.
      setSourceId(current => values.some(item => item.id === current) ? current : (values.find(item => item.display?.primary) ?? orderedScreens(values)[0] ?? values[0])?.id ?? '')
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
  const active = Boolean(state.snapshot)
  const planned = !active && Boolean(state.content?.understanding.director) && !state.content?.sessionId
  const finished = !active && Boolean(state.content?.sessionId)
  const media = state.content?.media.filter(item => item.durationUs > 0) ?? []
  const workBusy = state.busy || privacyBusy || productBusy || Boolean(moviePhase)
  const begin = async (): Promise<void> => {
    const useRegion = mode === 'region' && selected?.kind === 'screen' && (region.width < 1 || region.height < 1)
    const quick = setup.mode === 'quick'
    const options = captureOptionsSchema.parse({ sourceId, ...recordingOutput(setup), ...(useRegion ? { region } : {}) })
    const destination = state.destination ? { documentId: state.destination.documentId, ...(setup.insert ? { sequenceId: state.destination.sequenceId, frame: state.destination.frame } : {}) } : null
    await startRecording(options, { name: setup.name.trim() || `${t('recording.title')} ${new Date().toLocaleString().replace(/[/:]/g, '-')}`, tracks: { systemAudio: setup.systemAudio, ...(setup.microphone ? { microphone: setup.microphoneId ? { deviceId: setup.microphoneId } : {} } : {}), ...(setup.camera && !quick ? { camera: { ...(setup.cameraId ? { deviceId: setup.cameraId } : {}), width: 1280, height: 720, frameRate: 30 } } : {}) } }, destination, undefined, quick ? { ...(setup.saveDirectory ? { directory: setup.saveDirectory } : {}) } : undefined)
  }
  const back = (): void => { if (state.destination) openApplicationSurface('workspace.video_edit'); else onBack() }
  const sendToEditor = async (): Promise<void> => {
    const { createVideoEditProject, appendVideoEditSequence, switchVideoEditSequence } = await import('@/features/videoEdit')
    const { importRecordingToVideo } = await import('./application/recordingVideoImport')
    const instance = await createVideoEditProject()
    const sequenceId = appendVideoEditSequence(instance.document.id)
    await importRecordingToVideo(state.documentId!, { documentId: instance.document.id, sequenceId, frame: 0 })
    switchVideoEditSequence(instance.document.id, sequenceId)
    openApplicationSurface('workspace.video_edit')
  }
  const newRecording = (): void => { setRecordingDestination(state.destination); setSetup(value => ({ ...value, name: '' })) }
  const snapshot = state.snapshot
  const content = state.content
  const quickResult = finished && state.quick?.sessionId === state.documentId && workbenchFor !== state.documentId ? state.quick : null
  const duration = content ? recordingTimeline(content).durationUs / 1e6 : 0

  let leading: React.ReactNode = <span className="text-sm font-medium">{t('recording.title')}</span>
  let center: React.ReactNode = null
  let trailing: React.ReactNode
  if (planned) {
    leading = <span className="flex items-center gap-2 text-sm font-medium">{t('recording.title')}<span className="text-xs font-normal text-text2">{t('recording.directorTitle')}</span></span>
    trailing = <UiButton onClick={newRecording}>{t('recording.new')}</UiButton>
  }
  else if (active && snapshot) {
    leading = <span className="flex items-center gap-2 text-sm font-medium">{t('recording.title')}<span className={`${UI_TEXT_TIMECODE_CLASS} text-xs text-text2`}>{snapshot.phase === 'countdown' ? t('recording.countdown', { count: snapshot.countdown }) : recordingTimeLabel(snapshot.elapsedMs)}</span></span>
    trailing = <>
      <UiButton variant="danger" disabled={state.busy} disabledReason={t('screenRecording.toggleUnavailable')} onClick={() => run(() => controlRecording(snapshot.sessionId, 'cancel'))}>{t('recording.cancel')}</UiButton>
      {snapshot.phase === 'recording' || snapshot.phase === 'paused' ? <UiButton disabled={snapshot.busy} disabledReason={t('screenRecording.toggleUnavailable')} onClick={() => run(() => controlRecording(snapshot.sessionId, snapshot.phase === 'paused' ? 'resume' : 'pause'))}>{snapshot.phase === 'paused' ? <Play /> : <Pause />}{t(snapshot.phase === 'paused' ? 'recording.resume' : 'recording.pause')}</UiButton> : null}
      <UiButton variant="primary" disabled={state.busy} disabledReason={t('recording.saving')} onClick={() => run(() => controlRecording(snapshot.sessionId, snapshot.phase === 'failed' ? 'cancel' : 'stop'))}><Square />{t('recording.stop')}</UiButton>
    </>
  } else if (quickResult) {
    leading = <span className="flex items-center gap-2 text-sm font-medium">{t('recording.title')}<span className="text-xs font-normal text-text2">{t('recording.mode_quick')}</span></span>
    trailing = <>
      <UiButton disabled={quickResult.status !== 'saved' || workBusy} disabledReason={t('recording.quickSaving')} onClick={() => run(sendToEditor)}>{t('recording.import')}</UiButton>
      <UiButton variant="primary" disabled={quickResult.status === 'saving'} disabledReason={t('recording.quickSaving')} onClick={newRecording}>{t('recording.new')}</UiButton>
    </>
  } else if (finished && content) {
    leading = <span className="flex min-w-0 items-center gap-2"><span className="shrink-0 text-sm font-medium">{t('recording.title')}</span><span className={`${UI_TEXT_TIMECODE_CLASS} shrink-0 text-xs text-text2`}>{formatRecordingTime(duration)}</span>{content.source && <span className="truncate text-xs text-text2" data-observation-sensitive>{content.source.name}</span>}</span>
    trailing = <>
      {content.status !== 'stopped' && <UiButton disabled={workBusy} disabledReason={t('recording.movieBusy')} onClick={() => run(() => recoverRecording(state.documentId!))}><RefreshCw />{t('recording.recover')}</UiButton>}
      <UiButton disabled={workBusy} disabledReason={t('recording.movieBusy')} onClick={newRecording}>{t('recording.new')}</UiButton>
      <UiButton disabled={!content.understanding.steps.length || workBusy} disabledReason={t('recording.productNeedsSteps')} onClick={() => setExportOpen(true)}><Download />{t('recording.exportMenu')}</UiButton>
      <UiButton disabled={!media.length || workBusy} disabledReason={t('recording.movieBusy')} onClick={() => run(sendToEditor)}>{t('recording.import')}</UiButton>
      {moviePhase ? <UiButton onClick={() => movieController.current?.abort()}>{t('recording.cancelMovie')}</UiButton> : null}
      <UiButton variant="primary" disabled={!media.length || workBusy} disabledReason={moviePhase ? t('recording.movieBusy') : t('recording.noMedia')} onClick={() => run(generateMovie)}>{t('recording.createMovie')}</UiButton>
    </>
  } else {
    center = <UiSegmented ariaLabel={t('recording.recordMode')} value={director ? 'director' : 'self'} onChange={value => setDirector(value === 'director')} options={[{ value: 'self', label: t('recording.mode_self') }, { value: 'director', label: t('recording.mode_director') }]} />
    trailing = director ? null : <UiButton variant="primary" loading={state.busy} disabled={!sourceId} disabledReason={t('recording.selectSource')} onClick={() => run(begin)}><ICON_TOOL_SCREEN_RECORDING />{t('recording.start')}</UiButton>
  }

  return <div className="flex h-full min-h-0 flex-col" data-application-surface="tool.screen_recording" data-testid="screen-recording-page">
    <UiToolbar variant="command" center={center} centerLayout="fit" trailing={trailing}>
      <UiIconButton aria-label={t('recording.back')} onClick={back}><ChevronLeft /></UiIconButton>{leading}
    </UiToolbar>
    {(error || state.error || snapshot?.error) && <div className="px-4 pt-3"><UiError message={error || state.error || snapshot?.error || ''} /></div>}
    {planned && state.documentId && content ? <RecordingDirectorScript sessionId={state.documentId} recording={content} />
      : active && snapshot ? <RecordingLive snapshot={snapshot} saving={state.busy} onMark={note => controlRecording(snapshot.sessionId, 'mark', note)} />
      : quickResult && state.documentId ? <RecordingQuickResult result={quickResult} onReveal={() => run(() => revealQuickRecording(state.documentId!))} onRetry={() => run(() => saveQuickRecording(state.documentId!, quickResult.directory))} onOpenWorkbench={() => setWorkbenchFor(state.documentId)} />
      : finished && state.documentId && content ? <RecordingWorkbench sessionId={state.documentId} recording={content} recipe={recipe} onRecipeChange={setRecipe} busy={state.busy || productBusy} moviePhase={moviePhase} onBusyChange={(_, value) => setPrivacyBusy(value)} />
      : director ? <RecordingDirectorGoal />
      : <div className="flex min-h-0 flex-1">
        <RecordingSourcePicker sources={sources} loading={loading} mode={mode} sourceId={sourceId} region={region} onModeChange={changeMode} onSourceChange={setSourceId} onRegionChange={setRegion} onRefresh={() => run(refresh)} />
        <RecordingSetupPanel value={setup} devices={devices} destination={Boolean(state.destination)} onChange={patch => setSetup(value => ({ ...value, ...patch }))} />
      </div>}
    {finished && state.documentId && content && <UiModal isOpen={exportOpen} title={t('recording.exportTitle')} size="form" onClose={() => { if (!productBusy) setExportOpen(false) }}>
      <RecordingProductOptions key={state.documentId} sessionId={state.documentId} recording={content} disabled={state.busy || privacyBusy || Boolean(moviePhase)} onBusyChange={setProductBusy} />
    </UiModal>}
  </div>
}
