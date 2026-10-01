import { useRef, useState, type ReactNode } from 'react'
import { elementOfEventTarget } from '@/utils/crossRealmDom'
import { Plus, Trash2 } from 'lucide-react'
import { Dropdown, UiButton, UiFormRow, UiGroup, UiIconButton } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { CodeParameterDeclaration } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialKeyframe } from '@/core/videoEdit/codeMaterialAnimation'
import { videoEditSourceSeconds } from '@/core/videoEdit/time'
import { addVideoEditCodeKeyframe, deleteVideoEditCodeKeyframe, updateVideoEditCodeKeyframe, type VideoEditParameterEditorState } from '../application/videoEditCodeParameters'
import { useCodeParameterGesture } from './useCodeParameterGesture'

type ScalarParameter = Exclude<CodeParameterDeclaration, { type: 'image' }>
interface Props {
  editor: VideoEditParameterEditorState
  parameter: ScalarParameter
  onError: (reason: unknown) => void
  renderValue: (point: CodeMaterialKeyframe, label: string) => ReactNode
}
const interpolationOptions = [{ value: 'linear', label: '线性' }, { value: 'hold', label: '保持' }, { value: 'ease', label: '缓动' }] as const

function KeyframeTime({ editor, parameter, point, index, onError }: Omit<Props, 'renderValue'> & { point: CodeMaterialKeyframe; index: number }): React.ReactElement {
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

export function CodeKeyframePanel({ editor, parameter, onError, renderValue }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const points = editor.curves[parameter.key] ?? []
  const discrete = !['number', 'color'].includes(parameter.type)
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  const addLabel = `为${parameter.title}添加关键帧`
  return <UiGroup title={points.length ? <UiButton variant="plain" size="sm" className="!p-0" aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}${parameter.title}关键帧`} onClick={() => setExpanded(value => !value)}>关键帧（{points.length}）</UiButton> : '关键帧'} gap="row" data-video-edit-code-keyframes={parameter.key} actions={<UiIconButton appearance="hover-only" showBorder={false} title={addLabel} aria-label={addLabel} onClick={() => run(() => { addVideoEditCodeKeyframe(editor.target, parameter.key, editor.sourceTime); setExpanded(true) })}><Plus className="h-3.5 w-3.5" /></UiIconButton>}>
    {expanded && points.map((point, index) => <UiGroup key={point.id} gap="row" data-video-edit-code-keyframe={point.id}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1"><KeyframeTime editor={editor} parameter={parameter} point={point} index={index} onError={onError} /></div>
        <UiIconButton appearance="hover-only" showBorder={false} title={`删除${parameter.title}关键帧${index + 1}`} aria-label={`删除${parameter.title}关键帧${index + 1}`} onClick={() => run(() => deleteVideoEditCodeKeyframe(editor.target, parameter.key, point.id))}><Trash2 className="h-3.5 w-3.5" /></UiIconButton>
      </div>
      <UiFormRow label="值">{renderValue(point, `${parameter.title}关键帧${index + 1}值`)}</UiFormRow>
      {discrete ? <span className="text-2xs text-text-muted">保持</span> : <Dropdown ariaLabel={`${parameter.title}关键帧${index + 1}插值`} value={point.interpolation} options={[...interpolationOptions]} onSelect={interpolation => run(() => updateVideoEditCodeKeyframe(editor.target, parameter.key, point.id, { interpolation }))} />}
    </UiGroup>)}
  </UiGroup>
}
