import { useTranslation } from 'react-i18next'
import { Flag } from 'lucide-react'
import { UiIconButton, UiTextToken } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import type { RecordingDocument } from '@/core/screenRecording/document'
import { formatRecordingTime } from './recordingSetupModel'

export type RecordingLaneKind = 'steps' | 'speech' | 'privacy' | 'markers' | 'speedup'
interface LaneItem { id: string; startUs: number; endUs?: number; label: string; flagged?: boolean; excluded?: boolean }


/**
 * Everything the analysis found, laid on the same clock as the player: one lane per kind of result.
 * Clicking any block (or empty lane space) seeks the player there; privacy blocks also open their review.
 */
export function RecordingLanes({ recording, originUs, durationUs, currentSeconds, onSeek, onOpen }: {
  recording: RecordingDocument; originUs: number; durationUs: number; currentSeconds: number
  onSeek(seconds: number): void; onOpen(kind: RecordingLaneKind, id: string): void
}): React.ReactElement {
  const { t } = useTranslation('ui')
  const understanding = recording.understanding
  const lanes: Array<{ kind: RecordingLaneKind; items: LaneItem[] }> = ([
    { kind: 'steps', items: understanding.steps.map((step, index) => ({ id: step.id, startUs: step.startUs, endUs: step.endUs, label: `${index + 1} ${step.title}` })) },
    { kind: 'speech', items: understanding.transcript.map(line => ({ id: line.id, startUs: line.startUs, endUs: line.endUs, label: line.text })) },
    { kind: 'privacy', items: understanding.privacy.candidates.map(candidate => ({ id: candidate.id, startUs: candidate.startUs, endUs: candidate.endUs, label: t(`recordingPrivacy.kind.${candidate.kind}`), flagged: candidate.status === 'pending', excluded: candidate.status === 'rejected' })) },
    { kind: 'markers', items: recording.markers.map(marker => ({ id: marker.id, startUs: marker.monoUs, label: marker.note || t('recording.marker') })) },
    { kind: 'speedup', items: understanding.candidates.map(candidate => ({ id: candidate.id, startUs: candidate.startUs, endUs: candidate.endUs, label: t(`recording.speedup_${candidate.kind}`, { seconds: Math.round((candidate.endUs - candidate.startUs) / 1e6) }), flagged: candidate.status === 'pending', excluded: candidate.status === 'rejected' })) },
  ] as const).filter(lane => lane.items.length > 0)
  const duration = Math.max(1, durationUs / 1e6)
  const at = (us: number): number => Math.min(100, Math.max(0, (us - originUs) / 1e6 / duration * 100))
  const ticks = Array.from({ length: 5 }, (_, index) => duration * index / 4)
  const seekFromLane = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    onSeek((event.clientX - box.left) / box.width * duration)
  }
  return <div className="shrink-0 border-t border-gap bg-panel pb-2" data-recording-lanes>
    <div className="flex h-7 items-center">
      <span className="w-24 shrink-0" />
      <div className={`${UI_TEXT_TIMECODE_CLASS} relative mr-4 h-full flex-1 text-2xs text-text3`}>
        {ticks.map((seconds, index) => <span key={index} className="absolute top-1/2" style={{ left: `${seconds / duration * 100}%`, transform: `translate(${seconds === 0 ? 0 : seconds === duration ? -100 : -50}%, -50%)` }}>{formatRecordingTime(seconds)}</span>)}
      </div>
    </div>
    <div className="relative">
      {lanes.map(lane => <div key={lane.kind} className="flex h-8 items-stretch" data-recording-lane={lane.kind}>
        <span className="flex w-24 shrink-0 items-center gap-1.5 pl-4 text-xs text-text2">{t(`recording.lane_${lane.kind}`)}{lane.kind === 'privacy' && lane.items.some(item => item.flagged) && <span className="rounded-full bg-warning-tint px-1.5 text-2xs text-warning-text">{lane.items.filter(item => item.flagged).length}</span>}</span>
        <div className="relative mr-4 flex-1 border-t border-line/60" onClick={seekFromLane}>
          {lane.items.map(item => lane.kind === 'markers'
            ? <UiIconButton key={item.id} size="2xs" className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${at(item.startUs)}%` }} aria-label={`${formatRecordingTime((item.startUs - originUs) / 1e6)} ${item.label}`} tooltip={item.label} onClick={() => onSeek((item.startUs - originUs) / 1e6)}><Flag /></UiIconButton>
            : <UiTextToken key={item.id} appearance="chip" className="absolute bottom-1 top-1 min-w-2 truncate text-left"
              style={{ left: `${at(item.startUs)}%`, width: `${Math.max(0, at(item.endUs ?? item.startUs) - at(item.startUs))}%` }}
              current={currentSeconds * 1e6 + originUs >= item.startUs && currentSeconds * 1e6 + originUs < (item.endUs ?? item.startUs)}
              flagged={item.flagged} excluded={item.excluded} aria-label={`${formatRecordingTime((item.startUs - originUs) / 1e6)} ${item.label}`}
              onClick={() => { onSeek((item.startUs - originUs) / 1e6); onOpen(lane.kind, item.id) }}>{item.label}</UiTextToken>)}
        </div>
      </div>)}
      {lanes.length > 0 && <div className="pointer-events-none absolute inset-0 ml-24 mr-4" aria-hidden>
        <span className="absolute bottom-0 top-0 w-px bg-accent" style={{ left: `${Math.min(100, currentSeconds / duration * 100)}%` }} />
      </div>}
    </div>
  </div>
}
