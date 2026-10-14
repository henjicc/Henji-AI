import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronLeft, Flag, Pause, Play, RefreshCw, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dropdown, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiIconButton, UiInput, UiLoading, UiOptionButton, UiRegion, UiSwitch, UiToolbar } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { ICON_TOOL_SCREEN_RECORDING } from '@/core/theme/icons'
import { getPlatform } from '@/platform'
import type { CaptureSource } from '@/core/screenRecording/contracts'
import { captureOptionsSchema } from '@/core/screenRecording/capture'
import { recordingDevices } from './tracks/devices'
import { controlRecording, recordingView, recoverRecording, setRecordingDestination, startRecording, subscribeRecording } from './application/recordingService'
import { RecordingSessionPreview } from './RecordingSessionPreview'
import { openApplicationSurface } from '@/features/navigation'
import { RECORDING_MOVIE_RECIPES, type RecordingMovieRecipe } from '@/core/screenRecording/movie'
import { RecordingMovieOptions } from './RecordingMovieOptions'
import { showRecordingDocument } from './application/recordingService'
import { executeUiApplicationCapability } from '@/features/application-control'

function RecordingSourceOption({ source, active, onSelect }: { source: CaptureSource; active: boolean; onSelect: () => void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const titleRef = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)
  useEffect(() => {
    const title = titleRef.current
    if (!title) return
    const update = (): void => setTruncated(title.scrollWidth > title.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(title)
    return () => observer.disconnect()
  }, [source.name])
  return <UiOptionButton variant="grid" tooltip={truncated ? source.name : undefined} aria-label={source.name} active={active} className="min-w-0" onClick={onSelect}>
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="aspect-video w-full overflow-hidden bg-media">{source.thumbnailUrl && <img src={source.thumbnailUrl} alt="" className="h-full w-full object-contain" data-observation-sensitive />}</div>
      <div className="flex min-w-0 flex-col gap-1" data-recording-source-caption>
        <span ref={titleRef} className="block w-full truncate text-13" data-recording-source-title data-observation-sensitive>{source.name}</span>
        <span className="text-xs text-text2">{t(source.kind === 'screen' ? 'recording.displaySource' : 'recording.windowSource')}</span>
      </div>
    </div>
  </UiOptionButton>
}

export default function ScreenRecordingApp({ onBack }: { onBack: () => void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const state = useSyncExternalStore(subscribeRecording, recordingView)
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof recordingDevices>>>([])
  const [sourceId, setSourceId] = useState('')
  const [name, setName] = useState('')
  const [microphone, setMicrophone] = useState(true)
  const [systemAudio, setSystemAudio] = useState(false)
  const [camera, setCamera] = useState(false)
  const [microphoneId, setMicrophoneId] = useState('')
  const [cameraId, setCameraId] = useState('')
  const [region, setRegion] = useState(false)
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 100, height: 100 })
  const [insert, setInsert] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  const [recipe, setRecipe] = useState<RecordingMovieRecipe>(RECORDING_MOVIE_RECIPES.tutorial)
  const [moviePhase, setMoviePhase] = useState('')
  const movieController = useRef<AbortController | null>(null)
  const movieTarget = useRef<{ sessionId: string; documentId: string } | null>(null)
  useEffect(() => () => movieController.current?.abort(), [])
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
    try { const values = await getPlatform().screenRecording.sources(); setSources(values); setSourceId(current => values.some(item => item.id === current) ? current : values[0]?.id ?? ''); setDevices(await recordingDevices()) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh().catch(error => setError(String(error))) }, [refresh])
  const selected = sources.find(source => source.id === sourceId)
  const active = Boolean(state.snapshot)
  const finished = !active && Boolean(state.content?.sessionId)
  const media = state.content?.media.filter(item => item.durationUs > 0) ?? []
  const begin = async (): Promise<void> => {
    const options = captureOptionsSchema.parse({ sourceId, width: 1920, height: 1080, fps: 30, bitrate: 12_000_000, ...(region && selected?.kind === 'screen' ? { region: Object.fromEntries(Object.entries(crop).map(([key, value]) => [key, value / 100])) } : {}) })
    const destination = state.destination ? { documentId: state.destination.documentId, ...(insert ? { sequenceId: state.destination.sequenceId, frame: state.destination.frame } : {}) } : null
    await startRecording(options, { name: name.trim() || `${t('recording.title')} ${new Date().toLocaleString().replace(/[/:]/g, '-')}`, tracks: { systemAudio, ...(microphone ? { microphone: microphoneId ? { deviceId: microphoneId } : {} } : {}), ...(camera ? { camera: { ...(cameraId ? { deviceId: cameraId } : {}), width: 1280, height: 720, frameRate: 30 } } : {}) } }, destination)
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
  return <div className="flex h-full min-h-0 flex-col" data-application-surface="tool.screen_recording" data-testid="screen-recording-page">
    <UiToolbar variant="command" trailing={active ? <>
      {state.snapshot?.phase === 'recording' || state.snapshot?.phase === 'paused' ? <UiButton disabled={state.snapshot.busy} disabledReason={t('screenRecording.toggleUnavailable')} onClick={() => run(() => controlRecording(state.snapshot!.sessionId, state.snapshot!.phase === 'paused' ? 'resume' : 'pause'))}>{state.snapshot.phase === 'paused' ? <Play /> : <Pause />}{t(state.snapshot.phase === 'paused' ? 'recording.resume' : 'recording.pause')}</UiButton> : null}
      <UiButton variant="danger" disabled={state.busy} disabledReason={t('screenRecording.toggleUnavailable')} onClick={() => run(() => controlRecording(state.snapshot!.sessionId, 'cancel'))}>{t('recording.cancel')}</UiButton>
      <UiButton variant="primary" disabled={state.busy} disabledReason={t('recording.saving')} onClick={() => run(() => controlRecording(state.snapshot!.sessionId, state.snapshot!.phase === 'failed' ? 'cancel' : 'stop'))}><Square />{t('recording.stop')}</UiButton>
    </> : finished ? <>
      <UiButton disabled={!media.length || state.busy || Boolean(moviePhase)} disabledReason={t('recording.movieBusy')} onClick={() => run(sendToEditor)}>{t('recording.import')}</UiButton>
      <UiButton disabled={state.busy || Boolean(moviePhase)} disabledReason={t('recording.movieBusy')} onClick={() => { setRecordingDestination(state.destination); setName('') }}>{t('recording.new')}</UiButton>
      {moviePhase ? <UiButton onClick={() => movieController.current?.abort()}>{t('recording.cancelMovie')}</UiButton> : null}
      <UiButton variant="primary" disabled={!media.length || state.busy || Boolean(moviePhase)} disabledReason={moviePhase ? t('recording.movieBusy') : t('recording.noMedia')} onClick={() => run(generateMovie)}>{t('recording.createMovie')}</UiButton></> : <UiButton variant="primary" disabled={!sourceId || state.busy} disabledReason={state.busy ? t('recording.saving') : t('recording.selectSource')} onClick={() => run(begin)}><ICON_TOOL_SCREEN_RECORDING />{t('recording.start')}</UiButton>}>
      <UiIconButton aria-label={t('recording.back')} onClick={back}><ChevronLeft /></UiIconButton><span className="text-sm font-medium">{t('recording.title')}</span>
      {state.snapshot && <span className="text-xs tabular-nums text-text2">{state.snapshot.phase === 'countdown' ? t('recording.countdown', { count: state.snapshot.countdown }) : `${Math.floor(state.snapshot.elapsedMs / 1000)} s`}</span>}
    </UiToolbar>
    <div className="min-h-0 flex-1 overflow-auto">
      <UiRegion maxWidthClassName="max-w-5xl" className="mx-auto px-3 py-6">
        {(error || state.error || state.snapshot?.error) && <UiError message={error || state.error || state.snapshot?.error || ''} />}
        {state.busy && <UiLoading message={t('recording.saving')} />}
        {moviePhase && <UiLoading message={t(`recording.movie_${moviePhase}`)} />}
        {active ? <UiGroup title={t('recording.inProgress')} labelWidth={120}>
          <UiFormRow label={t('recording.marker')}><div className="flex min-w-0 items-center gap-2"><UiInput size="sm" className="min-w-0 flex-1" value={note} onChange={event => setNote(event.target.value)} maxLength={4000} /><UiButton size="sm" disabled={state.snapshot?.phase !== 'recording' || state.snapshot?.busy} disabledReason={t('recording.markDuringRecording')} onClick={() => run(async () => { await controlRecording(state.snapshot!.sessionId, 'mark', note); setNote('') })}><Flag />{t('recording.mark')}</UiButton></div></UiFormRow>
        </UiGroup> : finished ? <><RecordingMovieOptions value={recipe} onChange={setRecipe} disabled={Boolean(moviePhase)} /><UiGroup title={t('recording.preview')}>
          {state.content && <RecordingSessionPreview key={state.content.sessionId} recording={state.content} />}
          {state.content?.status !== 'stopped' && <UiButton onClick={() => run(() => recoverRecording(state.documentId!))}><RefreshCw />{t('recording.recover')}</UiButton>}
          {state.content?.source?.cursorEmbedded && <p className="text-xs text-text2">{t('recording.cursorEmbedded')}</p>}
        </UiGroup></> : <div className="grid gap-6 lg:grid-cols-2">
          <UiGroup title={t('recording.selectSource')} actions={<UiButton disabled={loading} disabledReason={t('recording.refreshing')} onClick={() => run(refresh)}><RefreshCw />{t('recording.refresh')}</UiButton>}>
            {loading ? <UiLoading /> : sources.length ? <div className="grid grid-cols-2 gap-2">{sources.map(source => <RecordingSourceOption key={source.id} source={source} active={source.id === sourceId} onSelect={() => setSourceId(source.id)} />)}</div> : <UiEmpty title={t('recording.noSources')} />}
          </UiGroup>
          <div><UiGroup title={t('recording.options')} labelWidth={120}>
            <UiFormRow label={t('recording.name')}><UiInput size="sm" value={name} onChange={event => setName(event.target.value)} placeholder={t('recording.title')} /></UiFormRow>
            <UiFormRow label={t('recording.microphone')}><UiSwitch checked={microphone} onCheckedChange={setMicrophone} /></UiFormRow>
            {microphone && <UiFormRow label={t('recording.microphoneDevice')}><Dropdown size="sm" value={microphoneId} options={[{ value: '', label: t('recording.defaultDevice') }, ...devices.filter(device => device.kind === 'microphone' && device.id).map(device => ({ value: device.id, label: device.label || t('recording.microphone') }))]} onSelect={setMicrophoneId} /></UiFormRow>}
            <UiFormRow label={t('recording.systemAudio')}><UiSwitch checked={systemAudio} onCheckedChange={setSystemAudio} /></UiFormRow>
            <UiFormRow label={t('recording.camera')}><UiSwitch checked={camera} onCheckedChange={setCamera} /></UiFormRow>
            {camera && <UiFormRow label={t('recording.cameraDevice')}><Dropdown size="sm" value={cameraId} options={[{ value: '', label: t('recording.defaultDevice') }, ...devices.filter(device => device.kind === 'camera' && device.id).map(device => ({ value: device.id, label: device.label || t('recording.camera') }))]} onSelect={setCameraId} /></UiFormRow>}
            {selected?.kind === 'screen' && <UiFormRow label={t('recording.region')}><UiSwitch checked={region} onCheckedChange={setRegion} /></UiFormRow>}
            {region && selected?.kind === 'screen' && (['x', 'y', 'width', 'height'] as const).map(key => <UiFormRow key={key} label={t(`recording.region_${key}`)}><NumberInput size="sm" value={crop[key]} min={key === 'x' || key === 'y' ? 0 : 1} max={100} step={1} onChange={value => setCrop(current => ({ ...current, [key]: value }))} /></UiFormRow>)}
            {state.destination && <UiFormRow label={t('recording.insert')}><UiSwitch checked={insert} onCheckedChange={setInsert} /></UiFormRow>}
          </UiGroup></div>
        </div>}
      </UiRegion>
    </div>
  </div>
}
