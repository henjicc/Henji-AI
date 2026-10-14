import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dropdown, UiEmpty, UiFormRow, UiGroup, UiOptionButton } from '@/components/ui'
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal'
import type { VideoViewerSeek, VideoViewerTimeline } from '@/components/mediaViewer/useVideoViewerTimeline'
import type { RecordingDocument, RecordingMedia } from '@/core/screenRecording/document'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { recordingTimeline } from './application/recordingTimeline'

const keepOpen = (): void => {}

export function RecordingSessionPreview({ recording }: { recording: RecordingDocument }): React.ReactElement {
  const { t } = useTranslation('ui')
  const [kind, setKind] = useState<RecordingMedia['kind']>('screen')
  const [seekRequest, setSeekRequest] = useState<VideoViewerSeek>({ seconds: 0, request: 0 })
  const session = useMemo(() => recordingTimeline(recording), [recording])
  const current = session.tracks.find(track => track.kind === kind) ?? session.tracks[0]
  const timeline = useMemo<VideoViewerTimeline>(() => ({ duration: session.durationUs / 1e6, segments: current?.spans.map(span => ({
    videoUrl: resolveImageDisplayUrl(span.media.path), filePath: span.media.path,
    start: (span.startUs - session.originUs) / 1e6, end: (span.endUs - session.originUs) / 1e6, sourceStart: (span.startUs - span.media.monoUs) / 1e6,
  })) ?? [] }), [current, session.durationUs, session.originUs])
  return <>
    {current ? <>
      <UiFormRow label={t('recording.track')} labelWidth={120}>
        <Dropdown size="sm" value={current.kind} options={session.tracks.map(track => ({ value: track.kind, label: t(`recording.${track.kind}`) }))} onSelect={value => setKind(value)} />
      </UiFormRow>
      <VideoViewerModal open presentation="inline" videoUrl={timeline.segments[0].videoUrl} filePath={timeline.segments[0].filePath} timeline={timeline} seekRequest={seekRequest} onClose={keepOpen} mediaTestId="recording-preview" />
    </> : <UiEmpty title={t('recording.noMedia')} />}
    <UiGroup title={t('recording.markers')}>
      {recording.markers.map(marker => <div key={marker.id} className="border-b border-line py-2">
        <UiOptionButton variant="menu" className="w-full min-w-0 gap-3" disabled={!current} disabledReason={t('recording.noMedia')} onClick={() => setSeekRequest(previous => ({ seconds: Math.max(0, (marker.monoUs - session.originUs) / 1e6), request: previous.request + 1 }))}>
          <span className="shrink-0 text-13 tabular-nums">{(Math.max(0, marker.monoUs - session.originUs) / 1e6).toFixed(1)} s</span>
          <span className="min-w-0 truncate text-13">{marker.note || t('recording.marker')}</span>
        </UiOptionButton>
      </div>)}
    </UiGroup>
    {recording.understanding.steps.length > 0 && <UiGroup title={t('recording.steps')}>
      {recording.understanding.steps.map(step => <div key={step.id} className="border-b border-line py-2">
        <UiOptionButton variant="menu" className="w-full min-w-0 gap-3" disabled={!current} disabledReason={t('recording.noMedia')} onClick={() => setSeekRequest(previous => ({ seconds: Math.max(0, (step.startUs - session.originUs) / 1e6), request: previous.request + 1 }))}>
          <span className="shrink-0 text-13 tabular-nums">{(Math.max(0, step.startUs - session.originUs) / 1e6).toFixed(1)} s</span>
          <span className="min-w-0 text-13">{step.title}</span>
        </UiOptionButton>
        {step.description && <p className="text-xs text-text2">{step.description}</p>}
      </div>)}
    </UiGroup>}
  </>
}
