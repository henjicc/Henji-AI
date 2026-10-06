import { useCallback, useMemo, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { UiEmpty, UiGroup, UiIconButton, UiInput } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { timelineTimecode } from '../timeline/timelineGeometry'
import { editVideoSequence, getActiveVideoEditSequence, type VideoEditInstance } from '../application/videoEditService'
import { CodeParameterPanel } from './CodeParameterPanel'
import { VideoEditGraphicPanel } from './VideoEditGraphicPanel'
import { VideoEditEffectChainPanel } from './VideoEditEffectChainPanel'
import { VideoEditTransitionPanel } from './VideoEditTransitionPanel'

type ClipNumberKey = keyof Pick<VideoEditClip, 'start' | 'duration' | 'sourceInUs' | 'track' | 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume' | 'brightness'>
/** `precision` 只决定读数与拖动的取整，保证显示不丢掉已有数据的有效位（如由助手写入的四位小数）。 */
const clipNumbers: Array<{ key: ClipNumberKey; label: string; step: number; precision: number }> = [
  { key: 'start', label: '开始帧', step: 1, precision: 0 }, { key: 'duration', label: '时长帧', step: 1, precision: 0 }, { key: 'sourceInUs', label: '源入点（秒）', step: 0.001, precision: 6 }, { key: 'track', label: '轨道', step: 1, precision: 0 },
  { key: 'x', label: '水平位置', step: 0.01, precision: 4 }, { key: 'y', label: '垂直位置', step: 0.01, precision: 4 }, { key: 'scale', label: '缩放', step: 0.05, precision: 4 }, { key: 'rotation', label: '旋转', step: 1, precision: 2 },
  { key: 'opacity', label: '不透明度', step: 0.05, precision: 4 }, { key: 'volume', label: '音量', step: 0.05, precision: 4 }, { key: 'brightness', label: '亮度效果', step: 0.05, precision: 4 },
]
const TIME_KEYS: readonly ClipNumberKey[] = ['start', 'duration', 'sourceInUs', 'track']

/**
 * 片段数值行（设计稿 VideoEdit 效果控件）：名称在左、数值拖动字段在右（2.2 `NumberInput`：拖动改值、单击编辑）。
 * 只有与当前值不同的数值才写入，聚焦后失焦不会把读数取整写回剪辑。
 */
function ClipNumberRow({ label, value, step, precision, onCommit }: { label: string; value: number | undefined; step: number; precision: number; onCommit: (next: number) => void }): React.ReactElement {
  const factor = 10 ** precision
  const current = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return <div className="flex min-h-8 items-center gap-2 pl-1">
    <span className="min-w-0 flex-1 truncate text-xs text-text2">{label}</span>
    <NumberInput ariaLabel={label} size="sm" value={value} step={step} precision={precision} widthClassName="w-24" align="right" commitOnChange onChange={next => { if (Math.round(next * factor) !== Math.round(current * factor)) onCommit(next) }} />
  </div>
}

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
  const track = selected ? sequence.tracks.find(value => value.index === selected.track) : undefined
  // 效果控件（界面重设计 3.5）：片段名称与位置读数 → 时间/画面/声音分组（紧凑分组标题）→ 代码参数、图形、效果链、转场、标注。
  return <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto px-3 py-2.5" aria-label="效果控件">
    {selected ? <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <UiInput aria-label="片段名称" size="sm" value={selected.name} onChange={event => updateClip('name', event.target.value)} />
        <span className="truncate px-1 font-mono text-2xs tabular-nums text-text3">{track?.name ?? `轨道 ${selected.track}`} · {timelineTimecode(selected.start, sequence.fps)} – {timelineTimecode(selected.start + selected.duration, sequence.fps)}</span>
        {selected.kind === 'text' && <UiInput aria-label="画面文字" size="sm" value={selected.text} onChange={event => updateClip('text', event.target.value)} />}
      </div>
      {(['时间', '画面', '声音'] as const).map(group => {
        const numbers = clipNumbers.filter(({ key }) => group === '时间' ? TIME_KEYS.includes(key) : group === '声音' ? key === 'volume' && ['video', 'audio'].includes(selected.kind) : selected.kind === 'adjustment' ? key === 'opacity' : !TIME_KEYS.includes(key) && key !== 'volume' && selected.kind !== 'audio')
        return numbers.length ? <UiGroup key={group} title={group} titleTone="compact" gap="none">{numbers.map(({ key, label, step, precision }) => <ClipNumberRow key={key} label={label} step={step} precision={precision}
          value={key === 'sourceInUs' ? selected[key] / 1e6 : selected[key]} onCommit={next => updateClip(key, key === 'sourceInUs' ? Math.round(next * 1e6) : next)} />)}</UiGroup> : null
      })}
    </div> : <UiEmpty size="sm" title="选择片段以编辑" />}
    {visible && selected?.kind === 'code' && selected.code && <CodeParameterPanel key={JSON.stringify(['source-code', instance.document.id, sequence.id, selected.id])} projectId={instance.document.id} sequenceId={sequence.id} clipId={selected.id} onError={onError} />}
    {visible && selected?.kind === 'graphic' && selected.graphic && <VideoEditGraphicPanel key={JSON.stringify(['graphic', instance.document.id, sequence.id, selected.id])} projectId={instance.document.id} sequenceId={sequence.id} clipId={selected.id} onError={onError} />}
    {visible && selected && selected.kind !== 'audio' && <VideoEditEffectChainPanel key={JSON.stringify(['effects', instance.document.id, sequence.id, selected.id])} instance={instance} sequence={sequence} clip={selected} onError={reportError} />}
    {visible && selected && !['audio', 'adjustment'].includes(selected.kind) && <VideoEditTransitionPanel key={JSON.stringify(['transition', instance.document.id, sequence.id, selected.id])} instance={instance} sequence={sequence} clip={selected} onError={reportError} />}
    {sequence.annotations.length > 0 && <UiGroup title="标注" titleTone="compact" divided>
      {sequence.annotations.map(mark => <div key={mark.id} className="flex items-center gap-1 py-0.5"><UiInput aria-label="编辑标注文字" size="sm" className="min-w-0 flex-1" value={mark.text} onChange={event => run(() => editVideoSequence(instance.document.id, sequence.id, draft => ({ ...draft, annotations: draft.annotations.map(item => item.id === mark.id ? { ...item, text: event.target.value } : item) })))} />
        <UiIconButton tone="danger" aria-label="删除标注" title="删除标注" onClick={() => run(() => editVideoSequence(instance.document.id, sequence.id, draft => ({ ...draft, annotations: draft.annotations.filter(item => item.id !== mark.id) })))}><Trash2 size={14} /></UiIconButton></div>)}
    </UiGroup>}
  </div>
}
