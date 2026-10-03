import { memo, useLayoutEffect, useMemo, useState } from 'react'
import { UiButton, UiEmpty, UiFormRow, UiGroup, UiInput, UiLoading, UiOptionButton } from '@/components/ui'
import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditTransitionWindow, type VideoEditTransition } from '@/core/videoEdit/transitions'
import { createVideoEditTransition, deleteVideoEditTransition, updateVideoEditTransition } from '../application/videoEditCompositing'
import type { VideoEditInstance } from '../application/videoEditService'
import { useVideoEditCompositeAction } from './useVideoEditCompositeAction'

interface Props { instance: VideoEditInstance; sequence: VideoEditSequence; clip: VideoEditClip; onError: (reason: unknown) => void }
interface TransitionEntry { key: string; left: VideoEditClip; right: VideoEditClip; transition?: VideoEditTransition }
type CompositeAction = ReturnType<typeof useVideoEditCompositeAction>

function TransitionControls({ projectId, sequence, entry, action, owner }: { projectId: string; sequence: VideoEditSequence; entry: TransitionEntry; action: CompositeAction; owner: VideoEditInstance }): React.ReactElement {
  const transition = entry.transition
  const initial = transition?.durationFrames ?? Math.max(2, Math.min(Math.round(sequence.frameRate.numerator / sequence.frameRate.denominator / 2), entry.left.duration * 2, entry.right.duration * 2))
  const [draft, setDraft] = useState(String(initial))
  useLayoutEffect(() => setDraft(String(initial)), [initial, owner])
  const durationFrames = Number(draft)
  const valid = draft.trim() !== '' && Number.isInteger(durationFrames) && durationFrames >= 2 && durationFrames <= 108_000
  const window = useMemo(() => transition ? videoEditTransitionWindow(sequence, transition) : undefined, [sequence, transition])
  return <UiGroup gap="row" data-video-edit-transition-id={transition?.id}>
    <UiFormRow label="转场时长（帧）"><UiInput aria-label="交叉溶解时长帧" type="number" min={2} max={108_000} step={1} value={draft} disabled={action.busy} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(String(initial)) } }} /></UiFormRow>
    {window && <p className="text-2xs text-text-muted">作用帧：{window.start} 至 {window.end - 1}；剪切点：{window.cut}。</p>}
    <p className="text-2xs text-text-muted">使用两侧真实源画面完成溶解；源余量不足时会保留原剪辑并提示调整。</p>
    <div className="flex flex-wrap items-center gap-2">
      {transition ? <><UiButton variant="secondary" disabled={action.busy || !valid || durationFrames === transition.durationFrames} onClick={() => { void action.run(signal => updateVideoEditTransition(projectId, sequence.id, transition.id, durationFrames, signal)) }}>应用转场时长</UiButton><UiButton disabled={action.busy} onClick={() => { void action.run(signal => deleteVideoEditTransition(projectId, sequence.id, transition.id, signal)) }}>移除交叉溶解</UiButton></> : <UiButton variant="secondary" disabled={action.busy || !valid} onClick={() => { void action.run(signal => createVideoEditTransition(projectId, sequence.id, { leftClipId: entry.left.id, rightClipId: entry.right.id, durationFrames }, signal)) }}>添加交叉溶解</UiButton>}
    </div>
  </UiGroup>
}

export const VideoEditTransitionPanel = memo(function VideoEditTransitionPanel({ instance, sequence, clip, onError }: Props): React.ReactElement {
  const projectId = instance.document.id
  const action = useVideoEditCompositeAction(instance, JSON.stringify([projectId, sequence.id, clip.id]), onError)
  const entries = useMemo(() => {
    if (['audio', 'adjustment'].includes(clip.kind)) return []
    const result: TransitionEntry[] = []
    for (const other of sequence.clips) {
      if (other.id === clip.id || other.track !== clip.track || ['audio', 'adjustment'].includes(other.kind)) continue
      let left: VideoEditClip; let right: VideoEditClip
      if (other.start + other.duration === clip.start) { left = other; right = clip }
      else if (clip.start + clip.duration === other.start) { left = clip; right = other }
      else continue
      result.push({ key: JSON.stringify([left.id, right.id]), left, right, transition: sequence.transitions?.find(value => value.leftClipId === left.id && value.rightClipId === right.id) })
    }
    return result.sort((a, b) => a.right.start - b.right.start)
  }, [sequence, clip])
  const [selectedKey, setSelectedKey] = useState(entries[0]?.key ?? '')
  useLayoutEffect(() => setSelectedKey(''), [instance])
  const selected = entries.find(value => value.key === selectedKey) ?? entries[0]
  return <UiGroup title="交叉溶解" divided data-video-edit-transition-panel={clip.id}>
    {entries.length ? <>
      <div className="flex flex-col gap-1">{entries.map(entry => <UiOptionButton key={entry.key} variant="menu" size="sm" className="w-full min-w-0 justify-between gap-2" active={entry.key === selected?.key} disabled={action.busy} aria-label={`选择转场${entry.left.name}到${entry.right.name}`} aria-pressed={entry.key === selected?.key} data-video-edit-transition-pair={entry.key} onClick={() => setSelectedKey(entry.key)}><span className="truncate">{entry.left.name} → {entry.right.name}</span><span className="shrink-0 text-2xs text-text-muted">{entry.transition ? '已添加' : entry.right.id === clip.id ? '入点' : '出点'}</span></UiOptionButton>)}</div>
      {selected && <TransitionControls key={JSON.stringify([selected.key, selected.transition?.id ?? null])} projectId={projectId} sequence={sequence} entry={selected} action={action} owner={instance} />}
    </> : <UiEmpty title="没有紧邻的画面片段" description="交叉溶解用于同一画面轨道上紧邻的两个片段。" />}
    {action.busy && <div className="flex items-center gap-2"><UiLoading size="xs" message="正在检查转场画面" /><UiButton onClick={action.cancel}>取消检查</UiButton></div>}
  </UiGroup>
})
