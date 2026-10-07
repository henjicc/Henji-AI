import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '@/core/videoEdit/time'
import { memo, useSyncExternalStore } from 'react'
import { Trash2 } from 'lucide-react'
import { UiButton, UiFormRow, UiGroup } from '@/components/ui'
import Dropdown from '@/components/ui/Dropdown'
import NumberInput from '@/components/ui/NumberInput'
import { ICON_VIDEO_EDIT_TRANSITION } from '@/core/theme/icons'
import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'
import { VIDEO_EDIT_TRANSITION_PRESETS, videoEditTransitionAlignmentFields, videoEditTransitionAlignmentOf, videoEditTransitionFramesBeforeCut, videoEditTransitionPreset, videoEditTransitionWindow, type VideoEditTransitionAlignment, type VideoEditTransitionKind } from '@/core/videoEdit/transitions'
import { deleteVideoEditTransition, updateVideoEditTransition } from '../application/videoEditCompositing'
import { selectVideoEditTransition, selectedVideoEditTransitionId, subscribeVideoEditTransitionSelection, updateVideoEditTransitionParams, videoEditTransitionSelectionVersion } from '../application/videoEditTransitions'
import { resolveVideoEditTransitionParams, videoEditTransitionParamDefinitions } from '@/core/videoEdit/transitionParams'
import { VideoEditBuiltinParamRows } from './VideoEditBuiltinEffectControls'
import { useVideoEditBuiltinParamGesture } from './useVideoEditBuiltinParamGesture'
import type { VideoEditInstance } from '../application/videoEditService'
import { timelineTimecode } from '../timeline/timelineGeometry'
import { useVideoEditCompositeAction } from './useVideoEditCompositeAction'

/**
 * 效果控件里的过渡属性（PR）：在时间线上点选过渡块后显示——种类（换成同媒介的其他过渡，参数回到新种类默认值，一步撤销）、
 * 持续时间、对齐（中心切点／起点切点／终点切点／自定义起点）、
 * 带参数过渡（擦除、推动……4.7）的各项参数（拖动实时预览、松手一步撤销）与删除。
 * 没有选中过渡时不渲染；效果控件始终挂载本组件（`clip` 为当前片段，可空），选中过渡时它自己出现。
 */
interface Props { instance: VideoEditInstance; sequence: VideoEditSequence; clip?: VideoEditClip; onError: (reason: unknown) => void }
const ALIGNMENTS: Array<{ value: VideoEditTransitionAlignment; label: string }> = [
  { value: 'center', label: '中心切点' }, { value: 'start', label: '起点切点' }, { value: 'end', label: '终点切点' }, { value: 'custom', label: '自定义起点' },
]
export const VideoEditTransitionPanel = memo(function VideoEditTransitionPanel({ instance, sequence, onError }: Props): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditTransitionSelection, videoEditTransitionSelectionVersion)
  const projectId = instance.document.id
  const transitionId = selectedVideoEditTransitionId(instance)
  const transition = sequence.transitions?.find(value => value.id === transitionId)
  const action = useVideoEditCompositeAction(instance, JSON.stringify([projectId, sequence.id, transitionId ?? null]), onError)
  const gesture = useVideoEditBuiltinParamGesture(projectId, JSON.stringify([sequence.id, transitionId ?? null]), (changes, handle) => { if (transitionId && changes.params) updateVideoEditTransitionParams(projectId, sequence.id, transitionId, changes.params, handle) }, onError)
  if (!transition) return null
  const params = videoEditTransitionParamDefinitions(transition.kind)
  let window: ReturnType<typeof videoEditTransitionWindow> | undefined
  try { window = videoEditTransitionWindow(sequence, transition) } catch { window = undefined }
  const preset = videoEditTransitionPreset(transition.kind)
  const fps = videoEditFps(sequence.frameRate)
  const before = videoEditTransitionFramesBeforeCut(transition)
  const update = (changes: Parameters<typeof updateVideoEditTransition>[3]): void => { void action.run(signal => updateVideoEditTransition(projectId, sequence.id, transition.id, changes, signal), undefined, false) }
  const Icon = ICON_VIDEO_EDIT_TRANSITION
  return <UiGroup title="过渡" titleTone="compact" divided data-video-edit-transition-panel={transition.id}>
    <div className="flex min-w-0 items-center gap-2 px-1">
      <Icon size={14} aria-hidden="true" className="shrink-0 text-text3" />
      <span className="min-w-0 flex-1 truncate text-xs text-text1">{preset.name}</span>
      {window && <span className="shrink-0 truncate text-2xs text-text3" data-user-content>{window.side ? `${window.left.name} ${window.side === 'in' ? '开头' : '结尾'}` : `${window.left.name} → ${window.right.name}`}</span>}
    </div>
    <UiFormRow density="compact" label="种类" info="换成同一媒介的其他过渡；参数回到新种类的默认值。">
      <Dropdown<VideoEditTransitionKind> ariaLabel="过渡种类" value={transition.kind} disabled={action.busy}
        options={VIDEO_EDIT_TRANSITION_PRESETS.filter(option => option.medium === preset.medium).map(option => ({ value: option.kind, label: option.name }))}
        onSelect={kind => { if (kind !== transition.kind) update({ kind }) }} />
    </UiFormRow>
    <UiFormRow density="compact" label="持续时间（帧）" hint={`${timelineTimecode(transition.durationFrames, fps)}`}>
      <NumberInput ariaLabel="过渡持续时间帧" size="sm" min={2} max={VIDEO_EDIT_MAX_SEQUENCE_FRAMES} step={1} precision={0} value={transition.durationFrames} disabled={action.busy}
        onChange={durationFrames => { if (durationFrames !== transition.durationFrames) update(transition.alignment === 'custom' ? { durationFrames, framesBeforeCut: Math.min(durationFrames, before) } : { durationFrames }) }} />
    </UiFormRow>
    {/* 单侧过渡整段在片段内，没有对齐可选（PR 只列出它所在的一端） */}
    {!window?.side && <UiFormRow density="compact" label="对齐">
      <Dropdown ariaLabel="过渡对齐" value={videoEditTransitionAlignmentOf(transition)} disabled={action.busy}
        options={ALIGNMENTS.filter(option => option.value !== 'custom' || transition.alignment === 'custom').map(option => ({ value: option.value, label: option.label }))}
        onSelect={alignment => {
          if (alignment === videoEditTransitionAlignmentOf(transition)) return
          const framesBeforeCut = alignment === 'start' ? 0 : alignment === 'end' ? transition.durationFrames : Math.floor(transition.durationFrames / 2)
          update({ alignment: videoEditTransitionAlignmentFields(transition.durationFrames, framesBeforeCut).alignment ?? 'center' })
        }} />
    </UiFormRow>}
    {params.length > 0 && <div className="flex flex-col" data-video-edit-transition-params={transition.kind}>
      <VideoEditBuiltinParamRows params={params} values={resolveVideoEditTransitionParams(transition.kind, transition.parameters)} gesture={gesture} />
    </div>}
    <div className="flex items-center gap-2">
      <UiButton variant="danger" size="sm" disabled={action.busy} onClick={() => { void action.run(signal => deleteVideoEditTransition(projectId, sequence.id, transition.id, signal), () => selectVideoEditTransition(projectId, null), false) }}><Trash2 size={14} aria-hidden="true" />删除过渡</UiButton>
    </div>
  </UiGroup>
})
