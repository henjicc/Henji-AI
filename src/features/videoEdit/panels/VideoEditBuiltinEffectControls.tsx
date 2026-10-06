import { useEffect, useRef, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { Dropdown, UiColorInput, UiIconButton, UiSwitch, UiTooltipText } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { requireVideoEditBuiltinEffect, resolveVideoEditBuiltinParams, VIDEO_EDIT_BUILTIN_UNIT_LABELS, type VideoEditBuiltinParam } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
import { updateVideoEditBuiltinEffect, type VideoEditCompositeTarget } from '../application/videoEditCompositing'
import { useVideoEditBuiltinParamGesture, type VideoEditBuiltinParamGesture } from './useVideoEditBuiltinParamGesture'
import { VideoEditSmartRegionControls } from './VideoEditSmartRegionControls'
import { evaluateVideoEditEffect } from '@/core/videoEdit/keyframes'
import { requireVideoEditInstance, setVideoEditView } from '../application/videoEditService'
import { VideoEditKeyframeControls } from './VideoEditKeyframeControls'
import { UiToneCurve } from '@/components/ui'
import { encodeLumetriCurve, lumetriCurvePoints, parseLumetriCurve } from '@/core/videoEdit/lumetriCurves'

type Gesture = VideoEditBuiltinParamGesture

function Row({ label, tooltip, children, resetLabel, resetDisabled, onReset, param, animation }: { label: string; tooltip: string; children: ReactNode; resetLabel: string; resetDisabled: boolean; onReset: () => void; param?: string; animation?: ReactNode }): React.ReactElement {
  return <div className="flex min-h-8 items-center gap-1.5" data-video-edit-builtin-param={param}>
    {animation}<span className="min-w-0 flex-1 truncate text-xs text-text2"><UiTooltipText tooltip={tooltip}>{label}</UiTooltipText></span>
    {children}
    <UiIconButton size="xs" aria-label={resetLabel} title={resetLabel} disabled={resetDisabled} onClick={onReset}><RotateCcw size={12} /></UiIconButton>
  </div>
}

/** 数值读数：拖动期间实时预览，松手只记一步撤销，Esc 回到拖动前；输入与步进各算一步。 */
function ScrubNumber({ label, value, min, max, step, precision, unit, gesture, onChange }: { label: string; value: number; min: number; max: number; step: number; precision: number; unit: string; gesture: Gesture; onChange: (value: number) => void }): React.ReactElement {
  const factor = 10 ** precision
  return <span className="flex shrink-0 items-center gap-1">
    <NumberInput ariaLabel={label} increaseLabel={`增加${label}`} decreaseLabel={`减少${label}`} size="sm" value={value} min={min} max={max} step={step} precision={precision} widthClassName="w-20" align="right"
      onScrubStart={gesture.begin} onScrubEnd={cancelled => { if (cancelled) gesture.cancel(); else gesture.finish() }}
      onChange={next => { if (gesture.active() || Math.round(next * factor) !== Math.round(value * factor)) onChange(next) }} />
    <span className="w-6 text-2xs text-text3" aria-hidden={!unit}>{unit}</span>
  </span>
}

function ParamControl({ param, value, values, gesture }: { param: VideoEditBuiltinParam; value: unknown; values: Readonly<Record<string, unknown>>; gesture: Gesture }): React.ReactElement {
  const set = (next: unknown): void => gesture.commit({ params: { [param.key]: next } })
  switch (param.type) {
    case 'number': return <ScrubNumber label={param.name} value={value as number} min={param.min} max={param.max} step={param.step} precision={param.step < 1 ? 1 : 0} unit={VIDEO_EDIT_BUILTIN_UNIT_LABELS[param.unit]} gesture={gesture} onChange={set} />
    case 'boolean': return <span className="flex shrink-0 items-center pr-4"><UiSwitch aria-label={param.name} checked={value as boolean} onCheckedChange={set} /></span>
    case 'enum': return <span className="w-32 shrink-0 pr-4"><Dropdown ariaLabel={param.name} value={value as string} options={param.options.map(option => ({ value: option.value, label: option.label }))} onSelect={set} buttonClassName="w-full" /></span>
    case 'color': return <ColorControl label={param.name} value={value as string} gesture={gesture} onChange={set} />
    case 'curve': return <span className="w-32 shrink-0"><UiToneCurve label={param.name} points={['master', 'red', 'green', 'blue'].includes(param.key.slice(6, -7)) ? lumetriCurvePoints(values, param.key.slice(6, -7)) : parseLumetriCurve(value || '').length ? parseLumetriCurve(value) : [{ x: 0, y: 50 }, { x: 100, y: 50 }]} onPointsChange={points => { if (param.key.startsWith('curve_hue_')) { const before = parseLumetriCurve(value || ''); const y = !before.length || points[0].y !== before[0].y ? points[0].y : points[points.length - 1].y; points = points.map((point, i) => i === 0 ? { x: 0, y } : i === points.length - 1 ? { x: 100, y } : point) } set(encodeLumetriCurve(points)) }} onBegin={gesture.begin} onFinish={gesture.finish} onCancel={gesture.cancel} /></span>
    case 'lut': return <span className="text-xs text-text3">在 Lumetri 面板选择</span>
  }
}

/** 取色：拖动取色器期间实时预览（React 的 onChange 是逐次 input），取色器关闭（原生 change）或失焦时提交一步撤销。 */
function ColorControl({ label, value, gesture, onChange }: { label: string; value: string; gesture: Gesture; onChange: (value: string) => void }): React.ReactElement {
  const input = useRef<HTMLInputElement>(null)
  const finish = useRef(gesture.finish); finish.current = gesture.finish
  useEffect(() => {
    const element = input.current; if (!element) return
    const done = (): void => finish.current()
    element.addEventListener('change', done)
    return () => element.removeEventListener('change', done)
  }, [])
  return <span className="flex shrink-0 items-center pr-4" onKeyDownCapture={event => { if (event.key === 'Escape' && gesture.active()) { event.preventDefault(); event.stopPropagation(); gesture.cancel() } }}>
    <UiColorInput ref={input} aria-label={label} value={value} onBlur={gesture.finish} onChange={event => { gesture.begin(); onChange(event.target.value) }} />
  </span>
}

/**
 * 效果控件里一项内置效果的参数（PR“效果控件”里展开一项效果后的各行）：效果强度与每个参数一行，
 * 名称悬停说明作用，行尾重置为默认值。数值拖动一步撤销，其余每次修改一步撤销。
 */
export function VideoEditBuiltinEffectControls({ target, effect, onError }: { target: VideoEditCompositeTarget; effect: VideoEditBuiltinEffect; onError: (reason: unknown) => void }): React.ReactElement {
  const gesture = useVideoEditBuiltinParamGesture(target.projectId, JSON.stringify([target.sequenceId, target.clipId, effect.id]), (changes, handle) => updateVideoEditBuiltinEffect(target, effect.id, changes, handle), onError)
  let definition
  try { definition = requireVideoEditBuiltinEffect(effect.builtin.id) } catch { return <span className="text-2xs text-text3">此版本不认识这个效果，保留原样不渲染修改。</span> }
  const owner = requireVideoEditInstance(target.projectId)
  const clip = owner.document.sequences.find(sequence => sequence.id === target.sequenceId)!.clips.find(clip => clip.id === target.clipId)!
  const values = resolveVideoEditBuiltinParams(evaluateVideoEditEffect(effect, owner.frame - clip.start).builtin!)
  return <div className="flex flex-col" data-video-edit-builtin-effect={effect.builtin.id}>
    <Row label="效果强度" tooltip={definition.media === 'audio' ? '与原声混合的比例，100% 为完全应用' : '与原画面混合的比例，100% 为完全应用'} resetLabel="重置效果强度" resetDisabled={effect.amount === 1} onReset={() => gesture.commit({ amount: 1 })} param="amount">
      <ScrubNumber label="效果强度" value={effect.amount * 100} min={0} max={100} step={1} precision={0} unit="%" gesture={gesture} onChange={next => gesture.commit({ amount: next / 100 })} />
    </Row>
    <VideoEditBuiltinParamRows params={definition.params} values={values} gesture={gesture} animation={{ target, effect, start: clip.start, duration: clip.duration, frame: owner.frame }} />
    {definition.media !== 'audio' && <VideoEditSmartRegionControls target={target} effect={effect} gesture={gesture} />}
  </div>
}
/** 一组登记参数的各行（名称悬停说明作用，行尾重置为默认值）；内置效果与带参数的过渡共用。 */
export interface VideoEditBuiltinAnimation { target: VideoEditCompositeTarget; effect: VideoEditBuiltinEffect; start: number; duration: number; frame: number }
export function VideoEditBuiltinParamRows({ params, values, gesture, animation }: { params: readonly VideoEditBuiltinParam[]; values: Readonly<Record<string, unknown>>; gesture: VideoEditBuiltinParamGesture; animation?: VideoEditBuiltinAnimation }): React.ReactElement {
  return <>{params.map(param => <Row key={param.key} param={param.key} label={param.name} tooltip={param.tooltip} resetLabel={`重置${param.name}`} resetDisabled={values[param.key] === param.default} onReset={() => gesture.commit({ params: { [param.key]: param.default } })}
    animation={animation && <VideoEditKeyframeControls label={param.name} value={values[param.key] as number | string | boolean} points={animation.effect.builtin.curves?.[param.key]} time={animation.frame - animation.start} duration={animation.duration} discrete={param.type === 'boolean' || param.type === 'enum' || param.type === 'curve' || param.type === 'lut'}
      onChange={points => { const curves = { ...animation.effect.builtin.curves }; if (points.length) curves[param.key] = points; else delete curves[param.key]; gesture.commit({ curves }) }}
      onSeek={time => setVideoEditView(animation.target.projectId, { frame: animation.start + time, playing: false })}
      onDisable={() => { gesture.begin(); const curves = { ...animation.effect.builtin.curves }; delete curves[param.key]; gesture.commit({ curves }); gesture.commit({ params: { [param.key]: values[param.key] } }); gesture.finish() }} />}>
    <ParamControl param={param} value={values[param.key]} values={values} gesture={gesture} />
  </Row>)}</>
}
