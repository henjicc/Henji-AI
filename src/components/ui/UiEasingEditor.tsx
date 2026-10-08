import { useRef } from 'react'
import { ParameterNumber } from './ParameterNumber'
import { UiSelect } from './primitives'
import { clampParameter, parameterKeyStep, parameterPosition, useParameterGesture, type ParameterControlProps } from './parameterControl'
import { UI_PARAMETER_HANDLE_CLASS, UI_PARAMETER_HANDLE_RADIUS, UI_PARAMETER_SURFACE_CLASS } from './styleTokens'

export type UiCubicBezier = [number, number, number, number]
export interface UiEasingPreset { value: string; label: string; curve: UiCubicBezier }
export interface UiEasingEditorProps extends ParameterControlProps<string | UiCubicBezier> { presets: readonly UiEasingPreset[]; customLabel?: string }

export function UiEasingEditor(props: UiEasingEditorProps) {
  const { value, onChange, defaultValue, presets, customLabel = '自定义', disabled, size = 'sm' } = props
  const label = props['aria-label'] ?? props.label ?? '缓动'
  const gesture = useParameterGesture(props)
  const handle = useRef<0 | 2>(0)
  const draft = useRef<UiCubicBezier>([0, 0, 1, 1])
  const custom = Array.isArray(value)
  const presetIndex = custom ? -1 : presets.findIndex(preset => preset.value === value)
  const curve: UiCubicBezier = custom ? value : presets[presetIndex]?.curve ?? [0, 0, 1, 1]
  const low = Math.min(-.1, 1 - curve[1] - .1, 1 - curve[3] - .1)
  const high = Math.max(1.1, 1 - curve[1] + .1, 1 - curve[3] + .1)
  const normalize = (next: UiCubicBezier): UiCubicBezier => [clampParameter(next[0]), next[1], clampParameter(next[2]), next[3]]
  const write = (index: number, next: number) => { const result = [...curve] as UiCubicBezier; result[index] = next; onChange(normalize(result)) }
  return <div className="w-full space-y-2">
    <UiSelect aria-label={label} value={custom ? 'custom' : `preset-${presetIndex}`} size={size} disabled={disabled} className="w-full" onChange={event => {
      const selected = event.target.value
      gesture.atomic(() => onChange(selected === 'custom' ? normalize(curve) : presets[Number(selected.slice(7))].value))
    }}>
      {presetIndex < 0 && !custom && <option value="preset--1" disabled>{value}</option>}
      {presets.map((preset, index) => <option key={preset.value} value={`preset-${index}`}>{preset.label}</option>)}
      <option value="custom">{customLabel}</option>
    </UiSelect>
    {/* icon-token-allow 用户控制点生成的三次贝塞尔预览与编辑图形。 */}
    <svg viewBox={`-.08 ${low} 1.16 ${high - low}`} preserveAspectRatio="none" className={`${UI_PARAMETER_SURFACE_CLASS} ${size === 'sm' ? 'aspect-video' : 'aspect-square'}`} role="group" aria-label={`${label}曲线`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      {...gesture.handlers} onPointerDown={event => {
        const index = (event.target as SVGElement).getAttribute('data-easing-handle')
        if (!custom || index === null || !gesture.begin(event)) return
        handle.current = Number(index) as 0 | 2; draft.current = [...curve]
        event.currentTarget.querySelector<SVGElement>(`[data-easing-handle="${index}"]`)?.focus()
      }} onPointerMove={event => {
        if (!gesture.active(event)) return
        const point = parameterPosition(event)
        const next = [...draft.current] as UiCubicBezier
        next[handle.current] = clampParameter(point.x * 1.16 - .08)
        next[handle.current + 1] = 1 - (low + point.y * (high - low))
        draft.current = next; onChange(next)
      }} onDoubleClick={() => { if (defaultValue !== undefined) gesture.atomic(() => onChange(Array.isArray(defaultValue) ? normalize(defaultValue) : defaultValue)) }}
      onKeyDown={event => { if (event.key === 'Home' && defaultValue !== undefined) { event.preventDefault(); gesture.atomic(() => onChange(Array.isArray(defaultValue) ? normalize(defaultValue) : defaultValue)) } }}>
      <path d="M0 1L1 0M0 0V1H1" className="stroke-line" fill="none" strokeWidth=".005" pointerEvents="none" />
      <path d={`M0 1C${curve[0]} ${1 - curve[1]},${curve[2]} ${1 - curve[3]},1 0`} className="stroke-accent" fill="none" strokeWidth=".015" pointerEvents="none" />
      {custom && <>
        <path d={`M0 1L${curve[0]} ${1 - curve[1]}M1 0L${curve[2]} ${1 - curve[3]}`} className="stroke-line-strong" fill="none" strokeWidth=".008" pointerEvents="none" />
        {([0, 2] as const).map(index => <circle key={index} data-easing-handle={index} cx={curve[index]} cy={1 - curve[index + 1]} r={UI_PARAMETER_HANDLE_RADIUS[size] / 100} className={UI_PARAMETER_HANDLE_CLASS} strokeWidth=".01" role="slider" aria-label={`${label}手柄${index / 2 + 1}`} aria-valuemin={0} aria-valuemax={1} aria-valuenow={curve[index]} aria-valuetext={`X ${curve[index]}，Y ${curve[index + 1]}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
          onKeyDown={event => {
            const delta = parameterKeyStep(event.key, event.shiftKey, .01)
            if (!delta) return
            event.preventDefault(); event.stopPropagation(); gesture.atomic(() => write(event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? index : index + 1, curve[event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? index : index + 1] + delta))
          }} />)}
      </>}
    </svg>
    {custom && <div className="grid grid-cols-2 gap-2">{curve.map((number, index) => <ParameterNumber key={index} {...props} value={number} defaultValue={Array.isArray(defaultValue) ? defaultValue[index] : undefined} label={`${label} ${index < 2 ? '1' : '2'}${index % 2 ? 'Y' : 'X'}`} size={size} min={index % 2 ? undefined : 0} max={index % 2 ? undefined : 1} step={.01} onChange={next => write(index, next)} />)}</div>}
  </div>
}
