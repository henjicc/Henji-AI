import { useCallback, useMemo, useRef } from 'react'
import { UiButton, UiEmpty, UiGroup, UiInput } from '@/components/ui'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { editVideoSequence, getActiveVideoEditSequence, type VideoEditInstance } from '../application/videoEditService'
import { CodeParameterPanel } from './CodeParameterPanel'
import { VideoEditGraphicPanel } from './VideoEditGraphicPanel'
import { VideoEditEffectChainPanel } from './VideoEditEffectChainPanel'
import { VideoEditTransitionPanel } from './VideoEditTransitionPanel'

const clipNumbers: Array<{ key: keyof Pick<VideoEditClip, 'start' | 'duration' | 'sourceInUs' | 'track' | 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume' | 'brightness'>; label: string; step: number }> = [
  { key: 'start', label: '开始帧', step: 1 }, { key: 'duration', label: '时长帧', step: 1 }, { key: 'sourceInUs', label: '源入点（秒）', step: 0.001 }, { key: 'track', label: '轨道', step: 1 },
  { key: 'x', label: '水平位置', step: 0.01 }, { key: 'y', label: '垂直位置', step: 0.01 }, { key: 'scale', label: '缩放', step: 0.05 }, { key: 'rotation', label: '旋转', step: 1 },
  { key: 'opacity', label: '不透明度', step: 0.05 }, { key: 'volume', label: '音量', step: 0.05 }, { key: 'brightness', label: '亮度效果', step: 0.05 },
]

export function VideoEditEffectsPanel({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean }): React.ReactElement {
  const errorHandler = useRef(onError); errorHandler.current = onError
  const reportError = useCallback((reason: unknown): void => errorHandler.current(reason), [])
  const sequence = getActiveVideoEditSequence(instance)
  const selection = instance.selection
  const selected = useMemo(() => sequence.clips.find(clip => clip.id === selection), [sequence, selection])
  const run = (operation: () => unknown): void => { try { operation() } catch (error) { onError(error) } }
  const updateClip = (key: keyof VideoEditClip, value: string | number): void => {
    if (selected) run(() => editVideoSequence(instance.document.id, sequence.id, draft => ({ ...draft, clips: draft.clips.map(clip => clip.id === selected.id ? { ...clip, [key]: value, ...(key === 'sourceInUs' ? { sourceRemainder: { numerator: 0, denominator: 1 } } : {}) } : clip) })))
  }
  return <div className="h-full min-h-0 overflow-auto p-3" aria-label="效果控件">
    {selected ? <UiGroup title="片段属性">
      <UiInput aria-label="片段名称" value={selected.name} onChange={event => updateClip('name', event.target.value)} />
      {selected.kind === 'text' && <UiInput aria-label="画面文字" value={selected.text} onChange={event => updateClip('text', event.target.value)} />}
      {(['时间', '画面', '声音'] as const).map(group => {
        const numbers = clipNumbers.filter(({ key }) => group === '时间' ? ['start', 'duration', 'sourceInUs', 'track'].includes(key) : group === '声音' ? key === 'volume' && ['video', 'audio'].includes(selected.kind) : selected.kind === 'adjustment' ? key === 'opacity' : !['start', 'duration', 'sourceInUs', 'track', 'volume'].includes(key) && selected.kind !== 'audio')
        return numbers.length ? <UiGroup key={group} title={group}><div className="grid grid-cols-2 gap-2">{numbers.map(({ key, label, step }) => <label key={key} className="flex min-w-0 flex-col gap-1 text-2xs text-text-muted"><span>{label}</span><UiInput aria-label={label} type="number" className="min-w-0 tabular-nums" step={step} value={key === 'sourceInUs' ? selected[key] / 1e6 : selected[key]} onChange={event => { if (event.target.value !== '') updateClip(key, key === 'sourceInUs' ? Math.round(Number(event.target.value) * 1e6) : Number(event.target.value)) }} /></label>)}</div></UiGroup> : null
      })}
    </UiGroup> : <UiEmpty title="选择片段以编辑" />}
    {visible && selected?.kind === 'code' && selected.code && <CodeParameterPanel key={JSON.stringify(['source-code', instance.document.id, sequence.id, selected.id])} projectId={instance.document.id} sequenceId={sequence.id} clipId={selected.id} onError={onError} />}
    {visible && selected?.kind === 'graphic' && selected.graphic && <VideoEditGraphicPanel key={JSON.stringify(['graphic', instance.document.id, sequence.id, selected.id])} projectId={instance.document.id} sequenceId={sequence.id} clipId={selected.id} onError={onError} />}
    {visible && selected && selected.kind !== 'audio' && <VideoEditEffectChainPanel key={JSON.stringify(['effects', instance.document.id, sequence.id, selected.id])} instance={instance} sequence={sequence} clip={selected} onError={reportError} />}
    {visible && selected && !['audio', 'adjustment'].includes(selected.kind) && <VideoEditTransitionPanel key={JSON.stringify(['transition', instance.document.id, sequence.id, selected.id])} instance={instance} sequence={sequence} clip={selected} onError={reportError} />}
    {sequence.annotations.length > 0 && <UiGroup title="标注">
      {sequence.annotations.map(mark => <div key={mark.id} className="py-1 text-xs"><UiInput aria-label="编辑标注文字" value={mark.text} onChange={event => run(() => editVideoSequence(instance.document.id, sequence.id, draft => ({ ...draft, annotations: draft.annotations.map(item => item.id === mark.id ? { ...item, text: event.target.value } : item) })))} /><UiButton onClick={() => run(() => editVideoSequence(instance.document.id, sequence.id, draft => ({ ...draft, annotations: draft.annotations.filter(item => item.id !== mark.id) })))}>删除标注</UiButton></div>)}
    </UiGroup>}
  </div>
}
