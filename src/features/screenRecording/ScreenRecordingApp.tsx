import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
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
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { openApplicationSurface } from '@/features/navigation'

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
  const [preview, setPreview] = useState('')
  const [note, setNote] = useState('')
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
  const current = media.find(item => item.id === preview) ?? media.find(item => item.kind === 'screen') ?? media[0]
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
      {state.snapshot?.phase === 'recording' || state.snapshot?.phase === 'paused' ? <UiButton disabled={state.snapshot.busy} onClick={() => run(() => controlRecording(state.snapshot!.sessionId, state.snapshot!.phase === 'paused' ? 'resume' : 'pause'))}>{state.snapshot.phase === 'paused' ? <Play /> : <Pause />}{t(state.snapshot.phase === 'paused' ? 'recording.resume' : 'recording.pause')}</UiButton> : null}
      <UiButton variant="primary" disabled={state.busy} onClick={() => run(() => controlRecording(state.snapshot!.sessionId, state.snapshot!.phase === 'failed' ? 'cancel' : 'stop'))}><Square />{t('recording.stop')}</UiButton>
    </> : finished ? <UiButton variant="primary" disabled={state.busy} onClick={() => { setRecordingDestination(state.destination); setName(''); setPreview('') }}>{t('recording.new')}</UiButton> : <UiButton variant="primary" disabled={!sourceId || state.busy} disabledReason={!sourceId ? t('recording.selectSource') : undefined} onClick={() => run(begin)}><ICON_TOOL_SCREEN_RECORDING />{t('recording.start')}</UiButton>}>
      <UiIconButton aria-label={t('recording.back')} onClick={back}><ChevronLeft /></UiIconButton><span className="text-sm font-medium">{t('recording.title')}</span>
      {state.snapshot && <span className="text-xs tabular-nums text-text2">{state.snapshot.phase === 'countdown' ? t('recording.countdown', { count: state.snapshot.countdown }) : `${Math.floor(state.snapshot.elapsedMs / 1000)} s`}</span>}
    </UiToolbar>
    <div className="min-h-0 flex-1 overflow-auto">
      <UiRegion maxWidthClassName="max-w-5xl" className="mx-auto p-6">
        {(error || state.error || state.snapshot?.error) && <UiError message={error || state.error || state.snapshot?.error || ''} />}
        {state.busy && <UiLoading message={t('recording.saving')} />}
        {active ? <UiGroup title={t('recording.inProgress')}>
          <UiFormRow label={t('recording.marker')} inline><UiInput value={note} onChange={event => setNote(event.target.value)} maxLength={4000} /><UiButton disabled={state.snapshot?.phase !== 'recording' || state.snapshot?.busy} disabledReason={t('recording.markDuringRecording')} onClick={() => run(async () => { await controlRecording(state.snapshot!.sessionId, 'mark', note); setNote('') })}><Flag />{t('recording.mark')}</UiButton></UiFormRow>
          <UiButton onClick={() => run(() => controlRecording(state.snapshot!.sessionId, 'cancel'))}>{t('recording.cancel')}</UiButton>
        </UiGroup> : finished ? <UiGroup title={t('recording.preview')}>
          {current ? <>
            <UiFormRow label={t('recording.track')}><Dropdown value={current.id} options={media.map((item, index) => ({ value: item.id, label: `${t(`recording.${item.kind}`)} ${index + 1}` }))} onSelect={setPreview} /></UiFormRow>
            {current.kind === 'microphone' || current.kind === 'systemAudio' ? <audio controls src={resolveImageDisplayUrl(current.path)} className="w-full" /> : <video controls src={resolveImageDisplayUrl(current.path)} className="aspect-video w-full bg-media" data-testid="recording-preview" data-observation-sensitive />}
          </> : <UiEmpty title={t('recording.noMedia')} />}
          {state.content?.status !== 'stopped' && <UiButton onClick={() => run(() => recoverRecording(state.documentId!))}><RefreshCw />{t('recording.recover')}</UiButton>}
          {state.content?.source?.cursorEmbedded && <p className="text-xs text-text2">{t('recording.cursorEmbedded')}</p>}
          <UiButton disabled={!media.length || state.busy} onClick={() => run(sendToEditor)}>{t('recording.import')}</UiButton>
          <UiButton disabled disabledReason={t('recording.createLater')}>{t('recording.createMovie')}</UiButton>
          <UiGroup title={t('recording.markers')}>
            {state.content?.markers.map(marker => <div key={marker.id} className="border-b border-line py-2 text-13">{(marker.monoUs / 1e6).toFixed(1)} s · {marker.note || t('recording.marker')}</div>)}
          </UiGroup>
        </UiGroup> : <div className="grid gap-6 lg:grid-cols-2">
          <UiGroup title={t('recording.selectSource')}>
            <UiButton onClick={() => run(refresh)}><RefreshCw />{t('recording.refresh')}</UiButton>
            {loading ? <UiLoading /> : sources.length ? <div className="grid grid-cols-2 gap-2">{sources.map(source => <UiOptionButton key={source.id} variant="grid" tooltip={source.name} active={source.id === sourceId} className="flex min-w-0 flex-col gap-2" onClick={() => setSourceId(source.id)}>
              {source.thumbnailUrl && <img src={source.thumbnailUrl} alt="" className="aspect-video w-full object-contain" data-observation-sensitive />}<span className="w-full truncate text-13" data-observation-sensitive>{source.name}</span>
            </UiOptionButton>)}</div> : <UiEmpty title={t('recording.noSources')} />}
          </UiGroup>
          <div><UiGroup title={t('recording.options')}>
            <UiFormRow label={t('recording.name')}><UiInput value={name} onChange={event => setName(event.target.value)} placeholder={t('recording.title')} /></UiFormRow>
            <UiFormRow label={t('recording.microphone')}><UiSwitch checked={microphone} onCheckedChange={setMicrophone} /></UiFormRow>
            {microphone && <UiFormRow label={t('recording.microphoneDevice')}><Dropdown value={microphoneId} options={[{ value: '', label: t('recording.defaultDevice') }, ...devices.filter(device => device.kind === 'microphone' && device.id).map(device => ({ value: device.id, label: device.label || t('recording.microphone') }))]} onSelect={setMicrophoneId} /></UiFormRow>}
            <UiFormRow label={t('recording.systemAudio')}><UiSwitch checked={systemAudio} onCheckedChange={setSystemAudio} /></UiFormRow>
            <UiFormRow label={t('recording.camera')}><UiSwitch checked={camera} onCheckedChange={setCamera} /></UiFormRow>
            {camera && <UiFormRow label={t('recording.cameraDevice')}><Dropdown value={cameraId} options={[{ value: '', label: t('recording.defaultDevice') }, ...devices.filter(device => device.kind === 'camera' && device.id).map(device => ({ value: device.id, label: device.label || t('recording.camera') }))]} onSelect={setCameraId} /></UiFormRow>}
            {selected?.kind === 'screen' && <UiFormRow label={t('recording.region')}><UiSwitch checked={region} onCheckedChange={setRegion} /></UiFormRow>}
            {region && selected?.kind === 'screen' && (['x', 'y', 'width', 'height'] as const).map(key => <UiFormRow key={key} label={t(`recording.region_${key}`)}><NumberInput value={crop[key]} min={key === 'x' || key === 'y' ? 0 : 1} max={100} step={1} onChange={value => setCrop(current => ({ ...current, [key]: value }))} /></UiFormRow>)}
            {state.destination && <UiFormRow label={t('recording.insert')}><UiSwitch checked={insert} onCheckedChange={setInsert} /></UiFormRow>}
          </UiGroup></div>
        </div>}
      </UiRegion>
    </div>
  </div>
}
