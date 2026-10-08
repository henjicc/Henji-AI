import { useRef, useState } from 'react'
import { elementOfEventTarget } from '@/utils/crossRealmDom'
import { ChevronDown, ChevronRight, Diamond, Trash2 } from 'lucide-react'
import { Dropdown, UiButton, UiFormRow, UiGroup, UiIconButton } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { CodeParameterDeclaration } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialKeyframe } from '@/core/videoEdit/codeMaterialAnimation'
import { videoEditSourceSeconds } from '@/core/videoEdit/time'
import { addVideoEditCodeKeyframe, deleteVideoEditCodeKeyframe, updateVideoEditCodeKeyframe, type VideoEditParameterEditorState } from '../application/videoEditCodeParameters'
import { useCodeParameterGesture } from './useCodeParameterGesture'
import { codeParameterSupportsInterpolation } from '@/core/videoEdit/codeMaterial/parameterInterpolation'
import { CodeParamField } from './params/CodeParamField'
import type { ParamFieldSpec } from './params/fieldSpec'

type ScalarParameter = Exclude<CodeParameterDeclaration, { type: 'image' }>
interface Props {
  editor: VideoEditParameterEditorState
  parameter: ScalarParameter
  onError: (reason: unknown) => void
  field: ParamFieldSpec
}
const interpolationOptions = [{ value: 'linear', label: '线性' }, { value: 'hold', label: '保持' }, { value: 'ease', label: '缓动' }] as const

function KeyframeTime({ editor, parameter, point, index, onError }: Omit<Props, 'field'> & { point: CodeMaterialKeyframe; index: number }): React.ReactElement {
  const gesture = useCodeParameterGesture(editor.target, onError)
  const touched = useRef(false)
  const label = `${parameter.title}关键帧${index + 1}时间（秒）`
  return <div
    onFocusCapture={() => { touched.current = false; gesture.begin() }}
    onChangeCapture={() => { touched.current = true }}
    onClickCapture={event => { if (elementOfEventTarget(event.target)?.closest('[data-ui-compact-stepper-button]')) touched.current = true }}
    onKeyDownCapture={event => {
      if (['ArrowUp', 'ArrowDown'].includes(event.key)) touched.current = true
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); touched.current = false; gesture.cancel() }
    }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) gesture.finish() }}
  >
    <NumberInput key={gesture.epoch} ariaLabel={label} value={videoEditSourceSeconds(point)} min={0} step={0.000001} precision={6} widthClassName="w-full" onChange={value => {
      // NumberInput normalizes its display on blur. An untouched NTSC fraction is not an edit.
      if (!touched.current) return
      const operation: Parameters<typeof gesture.write>[0] = handle => updateVideoEditCodeKeyframe(editor.target, parameter.key, point.id, { sourceInUs: Math.round(value * 1e6), sourceRemainder: { numerator: 0, denominator: 1 } }, handle)
      if (gesture.active()) gesture.write(operation)
      else gesture.atomic(operation)
    }} />
  </div>
}

export function CodeKeyframePanel({ editor, parameter, onError, field }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const points = editor.curves[parameter.key] ?? []
  const discrete = !codeParameterSupportsInterpolation(parameter)
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  const addLabel = `为${parameter.title}添加关键帧`
  // 关键帧（设计稿 VideoEdit 效果控件）：菱形按钮添加关键帧，已有关键帧时菱形实心强调色；标题行可展开逐帧编辑。
  return <UiGroup title={points.length ? <UiButton size="sm" className="-ml-2 gap-1" aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}${parameter.title}关键帧`} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}关键帧（{points.length}）</UiButton> : '关键帧'} titleTone="compact" gap="row" data-video-edit-code-keyframes={parameter.key} actions={<UiIconButton size="sm" title={addLabel} aria-label={addLabel} onClick={() => run(() => { addVideoEditCodeKeyframe(editor.target, parameter.key, editor.sourceTime); setExpanded(true) })}><Diamond size={12} strokeWidth={2.2} className={points.length ? 'text-accent-text' : undefined} fill={points.length ? 'currentColor' : 'none'} /></UiIconButton>}>
    {expanded && points.map((point, index) => <UiGroup key={point.id} gap="row" data-video-edit-code-keyframe={point.id}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1"><KeyframeTime editor={editor} parameter={parameter} point={point} index={index} onError={onError} /></div>
        <UiIconButton size="sm" tone="danger" title={`删除${parameter.title}关键帧${index + 1}`} aria-label={`删除${parameter.title}关键帧${index + 1}`} onClick={() => run(() => deleteVideoEditCodeKeyframe(editor.target, parameter.key, point.id))}><Trash2 className="h-3.5 w-3.5" /></UiIconButton>
      </div>
      <UiFormRow density="compact" label="值"><CodeParamField target={editor.target} field={field} value={point.value} pointId={point.id} label={`${parameter.title}关键帧${index + 1}值`} onError={onError} onWrite={(value, gesture) => updateVideoEditCodeKeyframe(editor.target, parameter.key, point.id, { value: value as typeof point.value }, gesture)} /></UiFormRow>
      {discrete ? <span className="text-2xs text-text3">保持</span> : <Dropdown ariaLabel={`${parameter.title}关键帧${index + 1}插值`} value={point.interpolation} options={[...interpolationOptions]} onSelect={interpolation => run(() => updateVideoEditCodeKeyframe(editor.target, parameter.key, point.id, { interpolation }))} />}
    </UiGroup>)}
  </UiGroup>
}
