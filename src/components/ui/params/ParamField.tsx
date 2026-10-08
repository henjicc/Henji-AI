import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dropdown, UiAngleDial, UiColorInput, UiCurveEditor, UiEasingEditor, UiFontPicker, UiGradeWheel, UiGradientEditor, UiOptionButton, UiPointPad, UiRangeInput, UiRangeSlider, UiSeedInput, UiSwitch, UiTextAreaField, UiTooltipText } from '@/components/ui'
import { colorGradeSpline } from '@/core/imaging/adjustments/curves'
import NumberInput from '@/components/ui/NumberInput'
import { UI_SEGMENTED_TRACK_CLASS, uiParameterHex } from '@/components/ui/styleTokens'
import { elementOfEventTarget } from '@/utils/crossRealmDom'
import type { CodeColor, CodeGrade, CodeGradientStop, CodeParameterObject, CodeParameterValue, CodePoint, CodeRange } from '@/core/imaging/parameterTypes'
import { PARAM_EASE_NAMES as CODE_EASE_NAMES } from '@/core/imaging/easing'
import { hexColor, type ParamFieldSpec } from './fieldSpec'

export interface ParamGesture {
  begin: () => void
  finish: () => void
  cancel: () => void
  active: () => boolean
  write: (value: CodeParameterValue) => void
  atomic: (value: CodeParameterValue) => void
  epoch?: number
}
export interface ParamFontOptions {
  projectFonts: React.ComponentProps<typeof UiFontPicker>['projectFonts']
  onPreview: (name: string | null, path?: readonly string[]) => void
}
export interface ParamFieldProps { field: ParamFieldSpec; value: CodeParameterValue; gesture: ParamGesture; label?: string; font?: ParamFontOptions; image?: ReactNode; resource?: ReactNode; disabled?: boolean }

function Numeric({ value, min, max, step = 1, label, gesture, unit }: { value: number; min?: number; max?: number; step?: number; label: string; gesture: ParamGesture; unit?: string }) {
  const touched = useRef(false)
  return <div className="flex items-center gap-1" onFocusCapture={() => { touched.current = false; gesture.begin() }} onChangeCapture={() => { touched.current = true }}
    onClickCapture={event => { if (elementOfEventTarget(event.target)?.closest('[data-ui-compact-stepper-button]')) touched.current = true }}
    onKeyDownCapture={event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) touched.current = true }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) gesture.finish() }}>
    <NumberInput key={gesture.epoch} size="sm" value={value} min={min} max={max} step={step} ariaLabel={label} increaseLabel={`增加${label}`} decreaseLabel={`减少${label}`} widthClassName="w-full" commitOnChange
      onScrubStart={() => { touched.current = true; gesture.begin() }} onScrubEnd={cancelled => { if (cancelled) { touched.current = false; gesture.cancel() } else gesture.finish() }}
      onChange={next => { if (touched.current) { if (gesture.active()) gesture.write(next); else gesture.atomic(next) } }} />
    {unit && <span className="text-2xs text-text3">{unit}</span>}
  </div>
}
function Color({ field, value, label, gesture }: { field: ParamFieldSpec & { type: 'color' }; value: CodeColor; label: string; gesture: ParamGesture }) {
  const input = useRef<HTMLInputElement>(null)
  const finish = useRef(gesture.finish); finish.current = gesture.finish
  useEffect(() => { const element = input.current; if (!element) return; const done = () => finish.current(); element.addEventListener('change', done); return () => element.removeEventListener('change', done) }, [])
  return <div className="flex items-center gap-2"><UiColorInput ref={input} aria-label={field.source === 'code' ? `${label}颜色` : label} value={uiParameterHex(value)} onFocus={gesture.begin} onBlur={gesture.finish} onChange={event => { gesture.begin(); gesture.write([...hexColor(event.target.value).slice(0, 3), value[3]] as CodeColor) }} />
    {field.alpha !== false && <Numeric label={`${label}透明度`} value={value[3]} min={0} max={1} step={0.01} gesture={{ ...gesture, write: alpha => gesture.write([value[0], value[1], value[2], alpha as number]), atomic: alpha => gesture.atomic([value[0], value[1], value[2], alpha as number]) }} />}</div>
}

function Gradient({ field, value, gesture, label }: ParamFieldProps & { field: ParamFieldSpec & { type: 'gradient' }; label: string }) {
  const [draft, setDraft] = useState<CodeGradientStop[]>()
  return <UiGradientEditor aria-label={label} size="sm" value={draft ?? value as CodeGradientStop[]} defaultValue={field.default} maxStops={field.maxStops}
    onBegin={() => { setDraft(value as CodeGradientStop[]); gesture.begin() }}
    onChange={next => { setDraft(next); gesture.write([...next].sort((a, b) => a.at - b.at)) }}
    onFinish={() => { gesture.finish(); setDraft(undefined) }} onCancel={() => { gesture.cancel(); setDraft(undefined) }} />
}

function Point({ field, value, gesture, label }: ParamFieldProps & { field: ParamFieldSpec & { type: 'point' }; label: string }) {
  const point = value as CodePoint
  if (field.space === 'frame') return <UiPointPad aria-label={label} size="sm" min={field.min} max={field.max} step={field.step} value={point} defaultValue={field.default} onChange={gesture.write} onBegin={gesture.begin} onFinish={gesture.finish} onCancel={gesture.cancel} />
  const extent = { x: field.max.x - field.min.x, y: field.max.y - field.min.y }
  const normalize = (p: CodePoint): CodePoint => ({ x: extent.x ? (p.x - field.min.x) / extent.x : 0, y: extent.y ? (p.y - field.min.y) / extent.y : 0 })
  return <div className="flex flex-col gap-2"><UiPointPad aria-label={`${label}相对位置`} size="sm" value={normalize(point)} defaultValue={normalize(field.default)} onChange={p => gesture.write({ x: field.min.x + p.x * extent.x, y: field.min.y + p.y * extent.y })} onBegin={gesture.begin} onFinish={gesture.finish} onCancel={gesture.cancel} />
    <div className="flex gap-2">{(['x', 'y'] as const).map(axis => <Numeric key={axis} label={`${label} ${axis.toUpperCase()}（像素）`} value={point[axis]} min={field.min[axis]} max={field.max[axis]} gesture={{ ...gesture, write: next => gesture.write({ ...point, [axis]: next }), atomic: next => gesture.atomic({ ...point, [axis]: next }) }} />)}</div></div>
}

const easeFamily: Record<string, string> = { sine: '正弦', quad: '二次', cubic: '三次', quart: '四次', quint: '五次', expo: '指数', circ: '圆形' }
const easeOptions = CODE_EASE_NAMES.map(value => {
  const special: Record<string, string> = { linear: '线性', backOut: '回弹', elasticOut: '弹性', bounceOut: '弹跳' }
  const suffix = value.endsWith('InOut') ? 'InOut' : value.endsWith('Out') ? 'Out' : 'In'
  return { value, label: special[value] ?? `${easeFamily[value.slice(0, -suffix.length)]}${suffix === 'InOut' ? '缓入缓出' : suffix === 'Out' ? '缓出' : '缓入'}` }
})

type CustomParent = Pick<ParamFieldProps, 'value' | 'gesture' | 'font'>
const CustomMember = memo(function CustomMember({ field, value, parent }: { field: ParamFieldSpec; value: CodeParameterValue; parent: React.MutableRefObject<CustomParent> }) {
  const write = (next: CodeParameterValue) => ({ ...(parent.current.value as CodeParameterObject), [field.key]: next }) as CodeParameterObject
  const gesture: ParamGesture = {
    begin: () => parent.current.gesture.begin(), finish: () => parent.current.gesture.finish(), cancel: () => parent.current.gesture.cancel(), active: () => parent.current.gesture.active(),
    write: next => parent.current.gesture.write(write(next)), atomic: next => parent.current.gesture.atomic(write(next)), epoch: parent.current.gesture.epoch,
  }
  const font = parent.current.font
  return <div className="min-w-0 flex-1"><span className="text-2xs text-text2"><UiTooltipText tooltip={field.tooltip}>{field.title}</UiTooltipText></span><ParamField field={field} value={value} gesture={gesture} font={font && { ...font, onPreview: name => parent.current.font?.onPreview(name, [field.key]) }} /></div>
}, (previous, next) => previous.field === next.field && previous.parent === next.parent && JSON.stringify(previous.value) === JSON.stringify(next.value))

function Custom({ field, value, gesture, font }: ParamFieldProps & { field: ParamFieldSpec & { type: 'custom' } }) {
  const parent = useRef<CustomParent>({ value, gesture, font }); parent.current = { value, gesture, font }
  const ordered = useMemo(() => {
    const children = field.children ?? []
    return field.layout === 'wheel' ? [...children.filter(child => child.type === 'grade').map(child => ({ ...child, layout: 'wheel' as const })), ...children.filter(child => child.type !== 'grade')] : children
  }, [field.children, field.layout])
  const layoutClass = field.layout === 'row' ? 'flex flex-wrap gap-2' : field.layout === 'grid' ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2'
  return <div className={layoutClass} data-param-layout={field.layout}>{ordered.map(child => <CustomMember key={child.key} field={child} value={(value as CodeParameterObject)[child.key]} parent={parent} />)}</div>
}

/** A single controlled renderer for instance and keyframe values, from either source. */
export const ParamField = memo(function ParamField({ field, value, gesture, label = field.title, font, image, resource, disabled }: ParamFieldProps): React.ReactElement {
  const [cancelEpoch, setCancelEpoch] = useState(0)
  const cancel = (): void => { gesture.cancel(); setCancelEpoch(epoch => epoch + 1) }
  const shared = { 'aria-label': label, size: 'sm' as const, onBegin: gesture.begin, onFinish: gesture.finish, onCancel: cancel }
  const curveSample = useMemo(() => field.type === 'curve' && field.curveFormat === 'color_grade' ? colorGradeSpline(value as CodePoint[]) : undefined, [field, value])
  let control: ReactNode
  switch (field.type) {
    case 'number': control = <div className="flex flex-col gap-1"><Numeric label={label} value={value as number} min={field.min} max={field.max} step={field.step} unit={field.unit} gesture={gesture} />{field.control !== 'input' && field.control !== 'knob' && <UiRangeInput aria-label={`${label}滑杆`} min={field.min} max={field.max} step={field.step} value={value as number} onFocus={gesture.begin} onBlur={gesture.finish}
      onPointerDown={event => { gesture.begin(); event.currentTarget.setPointerCapture?.(event.pointerId) }} onPointerUp={gesture.finish} onPointerCancel={cancel} onLostPointerCapture={() => { if (gesture.active()) cancel() }}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) gesture.begin() }} onKeyUp={event => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) gesture.finish() }} onChange={event => gesture.write(Number(event.target.value))} />}{field.control === 'knob' && <UiAngleDial {...shared} min={field.min} max={field.max} step={field.step} wrap={false} value={value as number} defaultValue={field.default} onChange={gesture.write} />}</div>; break
    case 'angle': control = <UiAngleDial {...shared} min={field.min} max={field.max} step={field.step} wrap={false} value={value as number} defaultValue={field.default} onChange={gesture.write} />; break
    case 'point': control = <Point field={field} label={label} value={value} gesture={gesture} />; break
    case 'range': control = <div className="flex items-center gap-1"><UiRangeSlider {...shared} min={field.min} max={field.max} step={field.step} track={field.rangeTrack} wrap={field.rangeWrap} value={value as CodeRange} defaultValue={field.default} onChange={gesture.write} />{field.unit && <span className="text-2xs text-text3">{field.unit}</span>}</div>; break
    case 'color': control = <Color field={field} value={value as CodeColor} label={label} gesture={gesture} />; break
    case 'gradient': control = <Gradient field={field} value={value} gesture={gesture} label={label} />; break
    case 'curve': control = <UiCurveEditor {...shared} kind={field.kind} value={value as CodePoint[]} defaultValue={field.default.length ? field.default : field.kind === 'hue' || field.key.startsWith('curve_luma_') || field.key.startsWith('curve_sat_') ? [{ x: 0, y: .5 }, { x: 1, y: .5 }] : [{ x: 0, y: 0 }, { x: 1, y: 1 }]} sample={curveSample} channelColor={field.curveFormat === 'color_grade' && ['red', 'green', 'blue'].includes(field.key.slice(6, -7)) ? field.key.slice(6, -7) as 'red' | 'green' | 'blue' : 'master'} onChange={gesture.write} />; break
    case 'grade': control = <UiGradeWheel {...shared} size={field.layout === 'wheel' ? 'md' : 'sm'} value={value as CodeGrade} defaultValue={field.default} onChange={gesture.write} />; break
    case 'seed': control = <UiSeedInput {...shared} min={0} max={4294967295} value={value as number} defaultValue={field.default} onChange={gesture.write} />; break
    case 'easing': control = <div className="flex flex-col gap-2"><Dropdown size="sm" ariaLabel={label} value={Array.isArray(value) ? 'custom' : value as string} options={[...easeOptions, { value: 'custom', label: '自定义' }]} onSelect={next => gesture.atomic(next === 'custom' ? [0, 0, 1, 1] : next)} />{Array.isArray(value) && <UiEasingEditor {...shared} presets={[]} value={value as CodeColor} onChange={gesture.write} />}</div>; break
    case 'boolean': control = <UiSwitch aria-label={label} checked={value as boolean} onCheckedChange={gesture.atomic} />; break
    case 'choice': control = field.control === 'segmented' ? <div className={UI_SEGMENTED_TRACK_CLASS}>{field.options.map(option => <UiOptionButton key={option} variant="segment" size="sm" active={value === option} onClick={() => gesture.atomic(option)}>{field.optionLabels?.[option] ?? option}</UiOptionButton>)}</div> : <Dropdown size="sm" ariaLabel={label} value={value as string} options={field.options.map(option => ({ label: field.optionLabels?.[option] ?? option, value: option }))} onSelect={gesture.atomic} />; break
    case 'text': control = <UiTextAreaField aria-label={label} rows={field.multiline ? 3 : 2} maxLength={field.maxLength} value={value as string} onChange={event => gesture.write(event.target.value)} textHistory={{ onValueChange: gesture.write, onEditStart: gesture.begin, onEditEnd: gesture.finish }} />; break
    case 'font': control = <UiFontPicker ariaLabel={label} value={value as string} projectFonts={font?.projectFonts} onPreview={face => font?.onPreview(face?.fullName ?? null)} onSelect={gesture.atomic} />; break
    case 'image': control = image; break
    case 'custom': control = <Custom field={field} value={value} gesture={gesture} font={font} />; break
    case 'lut': control = resource ?? <span className="text-xs text-text3">在 全能调色面板选择</span>; break
  }
  return <fieldset disabled={disabled} className="min-w-0" onPointerDownCapture={event => { if (disabled) { event.preventDefault(); event.stopPropagation() } }}><div key={`${gesture.epoch ?? 0}:${cancelEpoch}`} className="min-w-0" data-param-control={field.type} onKeyDownCapture={event => { if (event.key === 'Escape' && gesture.active()) { event.preventDefault(); event.stopPropagation(); cancel() } }}>{control}</div></fieldset>
})
