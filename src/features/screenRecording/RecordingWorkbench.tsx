import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScanSearch } from 'lucide-react'
import { UiButton, UiChipButton, UiEmpty, UiError, UiLoading, UiRecordItem, UiRecordList, UiSegmented, UiTextToken } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal'
import type { VideoViewerSeek, VideoViewerTimeline } from '@/components/mediaViewer/useVideoViewerTimeline'
import type { RecordingDocument, RecordingMedia } from '@/core/screenRecording/document'
import type { RecordingMovieRecipe } from '@/core/screenRecording/movie'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { executeUiApplicationCapability } from '@/features/application-control'
import { recordingTimeline } from './application/recordingTimeline'
import { showRecordingDocument } from './application/recordingService'
import { RecordingLanes, type RecordingLaneKind } from './RecordingLanes'
import { formatRecordingTime } from './recordingSetupModel'
import { RecordingMovieOptions } from './RecordingMovieOptions'
import { RecordingSessionPrivacy } from './RecordingSessionPrivacy'
import { RecordingRedubPanel } from './RecordingRedubPanel'
import { RecordingScriptPanel } from './RecordingScriptPanel'

type InspectorTab = 'movie' | 'privacy' | 'speech' | 'steps'
const keepOpen = (): void => {}

/** After recording: player in the middle, analysis on a shared timeline below, one inspector on the right. */
export function RecordingWorkbench({ sessionId, recording, recipe, onRecipeChange, busy, moviePhase, onBusyChange }: {
  sessionId: string; recording: RecordingDocument; recipe: RecordingMovieRecipe; onRecipeChange(recipe: RecordingMovieRecipe): void
  busy: boolean; moviePhase: string; onBusyChange(kind: 'privacy', value: boolean): void
}): React.ReactElement {
  const { t } = useTranslation('ui')
  const session = useMemo(() => recordingTimeline(recording), [recording])
  const [kind, setKind] = useState<RecordingMedia['kind']>('screen')
  const [seekRequest, setSeekRequest] = useState<VideoViewerSeek>({ seconds: 0, request: 0 })
  const [current, setCurrent] = useState(0)
  const [tab, setTab] = useState<InspectorTab>(recording.understanding.director ? 'speech' : 'movie')
  const [focused, setFocused] = useState<string>()
  const directed = Boolean(recording.understanding.director)
  // A director session's next step is its narration; follow it when the open session becomes one.
  useEffect(() => { if (directed) setTab('speech') }, [directed, sessionId])
  const [analyzing, setAnalyzing] = useState(false), [error, setError] = useState('')
  const visual = session.tracks.filter(track => track.kind === 'screen' || track.kind === 'camera')
  const track = visual.find(item => item.kind === kind) ?? visual[0]
  const timeline = useMemo<VideoViewerTimeline>(() => ({ duration: session.durationUs / 1e6, segments: track?.spans.map(span => ({
    videoUrl: resolveImageDisplayUrl(span.media.path), filePath: span.media.path,
    start: (span.startUs - session.originUs) / 1e6, end: (span.endUs - session.originUs) / 1e6, sourceStart: (span.startUs - span.media.monoUs) / 1e6,
  })) ?? [] }), [track, session.durationUs, session.originUs])
  const seek = useCallback((seconds: number): void => setSeekRequest(previous => ({ seconds: Math.max(0, seconds), request: previous.request + 1 })), [])
  const open = (lane: RecordingLaneKind, id: string): void => {
    if (lane === 'privacy') { setKind('screen'); setFocused(id); setTab('privacy') }
    else if (lane === 'speech') setTab('speech')
    else if (lane === 'steps') setTab('steps')
  }
  const analyze = async (transcribe: boolean): Promise<void> => {
    setAnalyzing(true); setError('')
    try {
      const result = await executeUiApplicationCapability({ id: 'understand_screen_recording', version: 1, input: { sessionRef: { kind: 'screen_recording.session', id: sessionId }, transcribe, detectVisuals: true } }, new AbortController().signal)
      if (!result.ok) throw new Error(result.error.message)
      await showRecordingDocument(sessionId)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setAnalyzing(false) }
  }
  const understanding = recording.understanding
  const analyzed = understanding.steps.length > 0 || understanding.transcript.length > 0 || understanding.candidates.length > 0
  const hasLanes = analyzed || understanding.privacy.candidates.length > 0 || recording.markers.length > 0
  const pendingPrivacy = understanding.privacy.candidates.filter(candidate => candidate.status === 'pending').length
  const disabled = busy || analyzing
  return <div className="flex min-h-0 flex-1" data-recording-workbench>
    <div className="flex min-w-0 flex-1 flex-col">
      {error && <div className="px-4 pt-3"><UiError message={error} /></div>}
      <div className="flex min-h-0 flex-1 items-center justify-center bg-gap p-4" style={{ containerType: 'size' }}>
        {track ? <div style={{ width: `min(100cqw, 100cqh * ${16 / 9})` }}>
          <VideoViewerModal open presentation="inline" videoUrl={timeline.segments[0].videoUrl} filePath={timeline.segments[0].filePath} timeline={timeline} seekRequest={seekRequest} onClose={keepOpen} onTimeChange={setCurrent} mediaTestId="recording-preview" />
        </div> : <UiEmpty title={t('recording.noMedia')} />}
      </div>
      <div className="flex h-10 shrink-0 items-center gap-3 border-t border-gap bg-panel px-4">
        {visual.length > 1 && <UiSegmented ariaLabel={t('recording.track')} size="sm" value={track?.kind ?? 'screen'} onChange={setKind} options={visual.map(item => ({ value: item.kind, label: t(`recording.${item.kind}`) }))} />}
        <span className="flex-1" />
        {analyzing ? <UiLoading size="sm" message={t('recording.analyzing')} /> : <UiButton size="sm" disabled={disabled} disabledReason={t('recording.movieBusy')} onClick={() => { void analyze(false) }}><ScanSearch />{t(analyzed ? 'recording.reanalyze' : 'recording.analyze')}</UiButton>}
      </div>
      {hasLanes
        ? <RecordingLanes recording={recording} originUs={session.originUs} durationUs={session.durationUs} currentSeconds={current} onSeek={seek} onOpen={open} />
        : <p className="shrink-0 border-t border-gap bg-panel px-4 pb-4 text-xs text-text3">{t('recording.lanesEmpty')}</p>}
    </div>
    <aside className="flex w-80 shrink-0 flex-col border-l border-gap bg-panel" aria-label={t('recording.inspector')}>
      <div className="flex shrink-0 items-center gap-1 border-b border-gap px-3" role="tablist" aria-label={t('recording.inspector')}>
        {(['movie', 'privacy', 'speech', 'steps'] as const).map(value => <UiChipButton key={value} role="tab" aria-selected={tab === value} selectionRole="navigation" selectionAppearance="subtle" size="sm" active={tab === value} onClick={() => setTab(value)}>
          {t(`recording.tab_${value}`)}{value === 'privacy' && pendingPrivacy > 0 && <span className="ml-1 rounded-full bg-warning-tint px-1.5 text-2xs text-warning-text">{pendingPrivacy}</span>}
        </UiChipButton>)}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-4" role="tabpanel">
        {tab === 'movie' && <>
          {moviePhase && <UiLoading message={t(`recording.movie_${moviePhase}`)} />}
          <RecordingMovieOptions value={recipe} onChange={onRecipeChange} disabled={disabled || Boolean(moviePhase)} speedups={understanding.candidates.filter(candidate => candidate.status === 'accepted').length} />
          {pendingPrivacy > 0 && <p className="text-xs text-warning-text">{t('recording.privacyPendingWarning', { count: pendingPrivacy })}</p>}
          {recording.source?.cursorEmbedded && <p className="text-xs text-text3">{t('recording.cursorEmbedded')}</p>}
        </>}
        {tab === 'privacy' && <RecordingSessionPrivacy recording={recording} originUs={session.originUs} disabled={disabled} focusedId={focused}
          onBusyChange={value => onBusyChange('privacy', value)} onSeek={candidate => { setKind('screen'); seek((candidate.startUs - session.originUs) / 1e6) }} />}
        {tab === 'speech' && <>
          {understanding.transcript.length ? <UiRecordList>
            {understanding.transcript.map((line, index) => <UiRecordItem key={line.id} index={index} density="compact" meta={[<span key="time" className={UI_TEXT_TIMECODE_CLASS}>{formatRecordingTime((line.startUs - session.originUs) / 1e6)}</span>]}>
              <UiTextToken className="text-left" current={current * 1e6 + session.originUs >= line.startUs && current * 1e6 + session.originUs < line.endUs} onClick={() => seek((line.startUs - session.originUs) / 1e6)}>{line.text}</UiTextToken>
            </UiRecordItem>)}
          </UiRecordList> : !understanding.director && <UiEmpty size="sm" title={t('recording.speechEmpty')} description={t('recording.speechEmptyHint')} action={<UiButton variant="secondary" size="sm" disabled={disabled} disabledReason={t('recording.movieBusy')} onClick={() => { void analyze(true) }}>{t('recording.transcribe')}</UiButton>} />}
          {understanding.director && <RecordingRedubPanel key={`redub:${sessionId}`} sessionId={sessionId} recording={recording} />}
        </>}
        {tab === 'steps' && <>
          {understanding.steps.length > 0 && <UiRecordList>
            {understanding.steps.map((step, index) => <UiRecordItem key={step.id} index={index} density="compact" meta={[<span key="time" className={UI_TEXT_TIMECODE_CLASS}>{formatRecordingTime((step.startUs - session.originUs) / 1e6)}</span>]}>
              <UiTextToken className="text-left" current={current * 1e6 + session.originUs >= step.startUs && current * 1e6 + session.originUs < step.endUs} onClick={() => seek((step.startUs - session.originUs) / 1e6)}>{index + 1}. {step.title}</UiTextToken>
              {step.description && step.description !== step.title && <p className="text-xs text-text2">{step.description}</p>}
            </UiRecordItem>)}
          </UiRecordList>}
          {!understanding.director && <RecordingScriptPanel key={`script:${sessionId}`} sessionId={sessionId} recording={recording} disabled={disabled} />}
        </>}
      </div>
    </aside>
  </div>
}

