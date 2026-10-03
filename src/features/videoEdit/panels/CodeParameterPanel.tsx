import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { elementOfEventTarget } from '@/utils/crossRealmDom'
import { RotateCcw } from 'lucide-react'
import { Dropdown, UiButton, UiColorInput, UiError, UiFormRow, UiGroup, UiIconButton, UiRangeInput, UiSwitch, UiTextAreaField } from '@/components/ui'
import { ICON_ASSET_LIBRARY } from '@/core/theme/icons'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { openAssetLibrary } from '@/stores/navigationStore'
import { collectVideoEditCodeAsset } from '../application/videoEditCodeAssets'
import NumberInput from '@/components/ui/NumberInput'
import type { CodeColor, CodeImageReference, CodeParameterDeclaration, CodeParameterValue } from '@/core/videoEdit/codeMaterial/contract'
import type { VideoEditSourceTime } from '@/core/videoEdit/time'
import { readVideoEditCodeEditor, resetVideoEditCodeParameter, setVideoEditCodeParameter, updateVideoEditCodeKeyframe, type VideoEditParameterTarget, type VideoEditCodeEditorState, type VideoEditParameterEditorState } from '../application/videoEditCodeParameters'
import { activeVideoEditInstance, requireVideoEditInstance, subscribeVideoEditView, videoEditViewRevision, type VideoEditGesture } from '../application/videoEditService'
import { CodeKeyframePanel } from './CodeKeyframePanel'
import { useCodeParameterGesture, videoEditParameterTargetIdentity } from './useCodeParameterGesture'
import { CodeImageParameterControl } from './CodeImageParameterControl'
import { CodeSourceEditor } from './CodeSourceEditor'

type ScalarParameter = Exclude<CodeParameterDeclaration, { type: 'image' }>
interface ScalarProps {
  target: VideoEditParameterTarget
  parameter: ScalarParameter
  value: CodeParameterValue
  label: string
  time?: VideoEditSourceTime
  onError: (reason: unknown) => void
  onWrite: (value: CodeParameterValue, gesture?: VideoEditGesture, at?: VideoEditSourceTime) => void
}
function colorHex(color: CodeColor): string { return `#${color.slice(0, 3).map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}` }
function colorFromHex(hex: string, alpha: number): CodeColor { return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, alpha] }

/** Only author-declared scalar values; both instance and keyframe controls use this view. */
function CodeScalarControl({ target, parameter, value, label, time, onError, onWrite }: ScalarProps): React.ReactElement {
  const gesture = useCodeParameterGesture(target, onError, time)
  const touched = useRef(false)
  const write = (next: CodeParameterValue): void => gesture.write((handle, at) => onWrite(next, handle, at))
  const writeAtomic = (next: CodeParameterValue): void => gesture.atomic((handle, at) => onWrite(next, handle, at))
  const numeric = (current: number, min: number, max: number, step: number, ariaLabel: string, change: (next: number) => void): React.ReactElement => <div
    onFocusCapture={() => { touched.current = false; gesture.begin() }}
    onChangeCapture={() => { touched.current = true }}
    onClickCapture={event => { if (elementOfEventTarget(event.target)?.closest('[data-ui-compact-stepper-button]')) touched.current = true }}
    onKeyDownCapture={event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) touched.current = true }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) gesture.finish() }}
  ><NumberInput key={gesture.epoch} value={current} min={min} max={max} step={step} ariaLabel={ariaLabel} widthClassName="w-full" commitOnChange onChange={next => {
    if (!touched.current) return
    if (gesture.active()) change(next)
    else { gesture.begin(); change(next); gesture.finish() }
  }} /></div>

  let control: React.ReactElement
  switch (parameter.type) {
    case 'number':
      control = <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2"><div className="min-w-0 flex-1">{numeric(value as number, parameter.min, parameter.max, parameter.step, label, write)}</div>{parameter.unit && <span className="text-2xs text-text3">{parameter.unit}</span>}</div>
        <UiRangeInput key={gesture.epoch} aria-label={`${label}滑杆`} min={parameter.min} max={parameter.max} step={parameter.step} value={value as number}
          onFocus={gesture.begin} onBlur={gesture.finish}
          onPointerDown={event => { gesture.begin(); event.currentTarget.setPointerCapture?.(event.pointerId) }}
          onPointerUp={gesture.finish} onPointerCancel={gesture.cancel} onLostPointerCapture={gesture.finish}
          onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) gesture.begin() }}
          onKeyUp={event => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) gesture.finish() }}
          onChange={event => write(Number(event.target.value))} />
      </div>
      break
    case 'color': {
      const color = value as CodeColor
      control = <div className="flex items-center gap-2"><UiColorInput key={gesture.epoch} aria-label={`${label}颜色`} value={colorHex(color)} onFocus={gesture.begin} onBlur={gesture.finish} onPointerDown={gesture.begin} onChange={event => write(colorFromHex(event.target.value, color[3]))} /><div className="min-w-0 flex-1">{numeric(color[3], 0, 1, 0.01, `${label}透明度`, alpha => write([color[0], color[1], color[2], alpha]))}</div></div>
      break
    }
    case 'boolean': control = <UiSwitch aria-label={label} checked={value as boolean} onCheckedChange={writeAtomic} />; break
    case 'choice': control = <Dropdown ariaLabel={label} value={value as string} options={parameter.options.map(option => ({ label: option, value: option }))} onSelect={writeAtomic} />; break
    case 'text': control = <UiTextAreaField key={gesture.epoch} aria-label={label} rows={2} maxLength={parameter.maxLength} value={value as string} onChange={event => write(event.target.value)} textHistory={{ onValueChange: write, onEditStart: gesture.begin, onEditEnd: gesture.finish }} />; break
  }
  return <div onKeyDownCapture={event => { if (event.key === 'Escape' && gesture.active()) { event.preventDefault(); event.stopPropagation(); touched.current = false; gesture.cancel() } }}>{control}</div>
}

export function VideoEditParameterFields({ editor, onError }: { editor: VideoEditParameterEditorState; onError: (reason: unknown) => void }): React.ReactElement {
  const identity = videoEditParameterTargetIdentity(editor.target)
  const title = 'code' in editor ? editor.target.effectId ? '效果参数' : '代码参数' : '对象参数'
  return <UiGroup title={title} titleTone="compact" divided data-video-edit-code-parameters={editor.target.clipId}>
    {editor.metadata.parameters.map(parameter => parameter.type === 'image' ? 'code' in editor ? <UiFormRow density="compact" key={`${identity}:${parameter.key}`} label={parameter.title} info={parameter.description || undefined} data-video-edit-code-parameter={parameter.key}><CodeImageParameterControl target={editor.target} parameterKey={parameter.key} title={parameter.title} value={editor.parameters[parameter.key] as CodeImageReference | null} /></UiFormRow> : null : <UiGroup key={`${identity}:${parameter.key}`} gap="row" data-video-edit-code-parameter={parameter.key}>
      <UiFormRow density="compact" label={<span className="flex items-center gap-2"><span>{parameter.title}</span><UiIconButton size="sm" title={`重置${parameter.title}${editor.curves[parameter.key]?.length ? '（含关键帧）' : ''}`} aria-label={`重置${parameter.title}`} onClick={() => { try { resetVideoEditCodeParameter(editor.target, parameter.key) } catch (error) { onError(error) } }}><RotateCcw className="h-3.5 w-3.5" /></UiIconButton></span>} info={parameter.description || undefined}>
        <CodeScalarControl target={editor.target} parameter={parameter} value={editor.parameters[parameter.key]} label={parameter.title} time={editor.sourceTime} onError={onError} onWrite={(value, gesture, at) => setVideoEditCodeParameter(editor.target, parameter.key, value, { gesture, time: at })} />
      </UiFormRow>
      {parameter.animatable && <CodeKeyframePanel editor={editor} parameter={parameter} onError={onError} renderValue={(point, label) => <CodeScalarControl target={editor.target} parameter={parameter} value={point.value} label={label} onError={onError} onWrite={(value, gesture) => updateVideoEditCodeKeyframe(editor.target, parameter.key, point.id, { value: value as typeof point.value }, gesture)} />} />}
    </UiGroup>)}
  </UiGroup>
}

function CollectCodeAsset({ editor, onError }: { editor: VideoEditCodeEditorState; onError: (reason: unknown) => void }): React.ReactElement {
  const pending = useRef<AbortController>()
  const [busy, setBusy] = useState(false)
  useEffect(() => () => { pending.current?.abort(); pending.current = undefined }, [])
  const collect = async (): Promise<void> => {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller; setBusy(true)
    try {
      const target = editor.target
      const owner = requireVideoEditInstance(target.projectId)
      const libraryId = useAssetLibraryStore.getState().libraryId
      const asset = await collectVideoEditCodeAsset(target.projectId, { kind: 'clip', sequenceId: target.sequenceId, clipId: target.clipId, ...(target.effectId ? { effectId: target.effectId } : {}) }, libraryId ? { libraryId } : {}, controller.signal)
      if (asset && !controller.signal.aborted && activeVideoEditInstance() === owner) {
        useAssetLibraryStore.getState().setSelectedAsset(asset); openAssetLibrary('floating')
      }
    } catch (error) { if (!controller.signal.aborted) onError(error) }
    finally { if (pending.current === controller) { pending.current = undefined; setBusy(false) } }
  }
  const AssetIcon = ICON_ASSET_LIBRARY
  return <UiButton variant="secondary" disabled={busy} onClick={() => { void collect() }}><AssetIcon className="h-3.5 w-3.5" />{busy ? '正在加入资产库' : '代码素材加入资产库'}</UiButton>
}

export function CodeParameterPanel({ projectId, sequenceId, clipId, effectId, onError }: { projectId: string; sequenceId: string; clipId: string; effectId?: string; onError: (reason: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  let editor: VideoEditCodeEditorState
  try { editor = readVideoEditCodeEditor(projectId, sequenceId, clipId, effectId) } catch (error) { return <UiError title="代码参数暂不可用" message={error instanceof Error ? error.message : '请重新选择代码片段。'} /> }
  return <div key={videoEditParameterTargetIdentity(editor.target)}><VideoEditParameterFields editor={editor} onError={onError} /><CodeSourceEditor editor={editor} /><CollectCodeAsset editor={editor} onError={onError} /></div>
}
