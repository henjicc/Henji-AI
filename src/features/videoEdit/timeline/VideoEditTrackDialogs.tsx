import { useState } from 'react'
import { UiButton, UiError, UiFormRow, UiGroup, UiModal, UiSelect } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { VIDEO_EDIT_TRACK_LIMIT, videoEditEmptyTrackIds, videoEditTrackCodes, videoEditTracksOfKind, type VideoEditTrackKind } from '@/core/videoEdit/tracks'

const KINDS = [{ kind: 'video', label: '视频轨道' }, { kind: 'audio', label: '音频轨道' }] as const
const SELECT_WIDTH = 'w-48'

/**
 * PR“添加轨道”：视频轨与音频轨各填要加几条、放在哪里（第一条之前、某条之后、最后一条之后）。确定后一步编辑。
 * `kind` 是右键的轨道类型，默认只加这一类一条。
 */
export function VideoEditAddTracksDialog({ sequence, kind, onSubmit, onClose }: { sequence: VideoEditSequence; kind: VideoEditTrackKind; onSubmit: (requests: Array<{ kind: VideoEditTrackKind; count: number; slot: number }>) => void; onClose: () => void }): React.ReactElement {
  const codes = videoEditTrackCodes(sequence)
  const lanes = { video: videoEditTracksOfKind(sequence, 'video'), audio: videoEditTracksOfKind(sequence, 'audio') }
  const [counts, setCounts] = useState<Record<VideoEditTrackKind, number>>({ video: kind === 'video' ? 1 : 0, audio: kind === 'audio' ? 1 : 0 })
  const [slots, setSlots] = useState<Record<VideoEditTrackKind, number>>({ video: lanes.video.length, audio: lanes.audio.length })
  const [error, setError] = useState('')
  const room = VIDEO_EDIT_TRACK_LIMIT - sequence.tracks.length
  const submit = (): void => {
    try {
      onSubmit(KINDS.filter(({ kind }) => counts[kind] > 0).map(({ kind }) => ({ kind, count: counts[kind], slot: slots[kind] })))
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const total = counts.video + counts.audio
  return <UiModal isOpen title="添加轨道" onClose={onClose} footer={<><UiButton onClick={onClose}>取消</UiButton><UiButton variant="primary" disabled={!total || total > room} onClick={submit}>确定</UiButton></>}>
    <div className="space-y-4" data-video-edit-add-tracks>
      {KINDS.map(({ kind, label }, index) => <UiGroup key={kind} title={label} titleTone="overline" divided={index > 0}>
        <UiFormRow label="添加" inline><NumberInput ariaLabel={`添加${label}数量`} value={counts[kind]} min={0} max={Math.max(0, room - counts[kind === 'video' ? 'audio' : 'video'])} onChange={value => setCounts(previous => ({ ...previous, [kind]: Math.max(0, Math.round(value)) }))} /></UiFormRow>
        <UiFormRow label="放置" inline><div className={SELECT_WIDTH}><UiSelect aria-label={`${label}放置位置`} value={slots[kind]} disabled={!counts[kind]} onChange={event => setSlots(previous => ({ ...previous, [kind]: Number(event.target.value) }))}>
          <option value={0}>第一条轨道之前</option>
          {lanes[kind].map((track, rank) => <option key={track.id} value={rank + 1}>{rank === lanes[kind].length - 1 ? '最后一条轨道之后' : `${codes.get(track.id)} 之后`}</option>)}
        </UiSelect></div></UiFormRow>
      </UiGroup>)}
      {total > room && <UiError size="xs" align="start" title="轨道数量超出整数范围。" message="" />}
      {error && <UiError size="xs" align="start" title={error} message="" />}
    </div>
  </UiModal>
}

type DeleteChoice = 'none' | 'empty' | 'targeted' | string
/**
 * PR“删除轨道”：视频轨与音频轨各选删除全部空轨道、目标轨道或某一条（或不删）。轨道上的片段一并删除，每类至少保留一条。
 */
export function VideoEditDeleteTracksDialog({ sequence, kind, targetTrackIds, onSubmit, onClose }: { sequence: VideoEditSequence; kind: VideoEditTrackKind; targetTrackIds: readonly string[]; onSubmit: (trackIds: string[]) => void; onClose: () => void }): React.ReactElement {
  const codes = videoEditTrackCodes(sequence)
  const [choice, setChoice] = useState<Record<VideoEditTrackKind, DeleteChoice>>({ video: kind === 'video' ? 'empty' : 'none', audio: kind === 'audio' ? 'empty' : 'none' })
  const [error, setError] = useState('')
  const chosen = (value: VideoEditTrackKind): string[] => {
    const lanes = videoEditTracksOfKind(sequence, value)
    if (choice[value] === 'none') return []
    if (choice[value] === 'empty') return videoEditEmptyTrackIds(sequence, value)
    if (choice[value] === 'targeted') return lanes.filter(track => targetTrackIds.includes(track.id)).map(track => track.id)
    return lanes.some(track => track.id === choice[value]) ? [choice[value]] : []
  }
  const ids = [...chosen('video'), ...chosen('audio')]
  const submit = (): void => {
    try { onSubmit(ids); onClose() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  return <UiModal isOpen title="删除轨道" onClose={onClose} footer={<><UiButton onClick={onClose}>取消</UiButton><UiButton variant="dangerSolid" disabled={!ids.length} onClick={submit}>{ids.length ? `删除 ${ids.length} 条轨道` : '删除'}</UiButton></>}>
    <div className="space-y-4" data-video-edit-delete-tracks>
      {KINDS.map(({ kind: value, label }) => <UiFormRow key={value} label={label} inline>
        <div className={SELECT_WIDTH}><UiSelect aria-label={`删除哪些${label}`} value={choice[value]} onChange={event => setChoice(previous => ({ ...previous, [value]: event.target.value }))}>
          <option value="none">不删除</option>
          <option value="empty">所有空轨道</option>
          <option value="targeted">目标轨道</option>
          {videoEditTracksOfKind(sequence, value).map(track => <option key={track.id} value={track.id}>{`${codes.get(track.id)} ${track.name}`}</option>)}
        </UiSelect></div>
      </UiFormRow>)}
      <p className="text-xs text-text3">轨道上的片段会一并删除，可撤销。</p>
      {error && <UiError size="xs" align="start" title={error} message="" />}
    </div>
  </UiModal>
}
