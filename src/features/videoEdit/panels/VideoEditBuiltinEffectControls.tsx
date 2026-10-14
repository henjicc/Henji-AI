import { RECORDING_CURSOR_EFFECT } from '@/core/videoEdit/recordingCursor'
import { videoEditClipMedia } from '@/core/videoEdit/document'
import { useEffect, useRef } from 'react'
import { requireVideoEditBuiltinEffect, resolveVideoEditBuiltinParams, type VideoEditBuiltinParam } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
import { updateVideoEditBuiltinEffect, type VideoEditCompositeTarget } from '../application/videoEditCompositing'
import { useVideoEditBuiltinParamGesture, type VideoEditBuiltinParamGesture } from './useVideoEditBuiltinParamGesture'
import { VideoEditSmartRegionControls } from './VideoEditSmartRegionControls'
import { evaluateVideoEditEffect } from '@/core/videoEdit/keyframes'
import { requireVideoEditInstance, setVideoEditView } from '../application/videoEditService'
import { VideoEditKeyframeControls } from './VideoEditKeyframeControls'
import type { CodeParameterValue } from '@/core/videoEdit/codeMaterial/contract'
import { builtinParameterFields, readBuiltinField, writeBuiltinField, type ParamFieldSpec } from './params/fieldSpec'
import { ParamField, type ParamGesture } from './params/ParamField'
import { ParamList } from './params/ParamList'
import type { VideoEditCurves } from '@/core/videoEdit/keyframes'

function builtinFieldGesture(field: ParamFieldSpec, gesture: VideoEditBuiltinParamGesture): ParamGesture {
  const write = (value: CodeParameterValue): void => gesture.commit({ params: writeBuiltinField(field, value) })
  return { begin: gesture.begin, finish: gesture.finish, cancel: gesture.cancel, active: gesture.active, write, atomic: value => { gesture.begin(); write(value); gesture.finish() } }
}

/**
 * 效果控件里一项内置效果的参数（PR“效果控件”里展开一项效果后的各行）：效果强度与每个参数一行，
 * 名称悬停说明作用，行尾重置为默认值。数值拖动一步撤销，其余每次修改一步撤销。
 */
export function VideoEditBuiltinEffectControls({ target, effect, onError }: { target: VideoEditCompositeTarget; effect: VideoEditBuiltinEffect; onError: (reason: unknown) => void }): React.ReactElement {
  const gesture = useVideoEditBuiltinParamGesture(target.projectId, JSON.stringify([target.sequenceId, target.clipId, effect.id]), (changes, handle) => updateVideoEditBuiltinEffect(target, effect.id, changes, handle), onError)
  let definition
  try { definition = requireVideoEditBuiltinEffect(effect.builtin.id) } catch { return <span className="text-2xs text-text3">暂不支持此效果，已保留原设置。</span> }
  const owner = requireVideoEditInstance(target.projectId)
  const clip = owner.document.sequences.find(sequence => sequence.id === target.sequenceId)!.clips.find(clip => clip.id === target.clipId)!
  const cursorSource = effect.builtin.id === RECORDING_CURSOR_EFFECT ? videoEditClipMedia(owner.document, clip)?.recordingCursor : undefined
  const cursorEffect = effect.builtin.id === RECORDING_CURSOR_EFFECT
  const params = cursorEffect && cursorSource?.cursorBakedIn ? definition.params.filter(param => ['size', 'click_style', 'distinguish_buttons'].includes(param.key)).map(param => param.key === 'size' ? { ...param, name: '点击提示大小' } : param) : definition.params
  const values = resolveVideoEditBuiltinParams(evaluateVideoEditEffect(effect, owner.frame - clip.start).builtin!)
  return <div className="flex flex-col" data-video-edit-builtin-effect={effect.builtin.id}>
    {cursorEffect && <p className="text-xs text-text3">{!cursorSource ? '此素材没有光标事件日志，请从录制会话创建屏幕片段。' : cursorSource.cursorBakedIn ? '原片已包含光标，仅可调整点击提示。' : '光标与点击提示跟随屏幕片段的剪切、移动和变速。'}</p>}
    <VideoEditBuiltinParamRows params={params} values={values} gesture={gesture} animation={{ target, effect, start: clip.start, duration: clip.duration, frame: owner.frame }} />
    {!cursorEffect && definition.media !== 'audio' && <VideoEditSmartRegionControls target={target} effect={effect} gesture={gesture} />}
    <ParamList key={gesture.identity} fields={[{ source: 'builtin', bindingKeys: ['amount'], key: 'amount', title: '效果强度', tooltip: definition.media === 'audio' ? '与原声混合的比例，100% 为完全应用' : '与原画面混合的比例，100% 为完全应用', type: 'number', min: 0, max: 100, step: 1, unit: '%', control: 'input', default: 100, animatable: false }]} values={{ amount: effect.amount * 100 }}
      onReset={() => gesture.commit({ amount: 1 })} resetDisabled={(_, value) => value === 100}
      renderControl={(field, value) => <ParamField field={field} value={value} gesture={{ begin: gesture.begin, finish: gesture.finish, cancel: gesture.cancel, active: gesture.active, write: next => gesture.commit({ amount: Number(next) / 100 }), atomic: next => gesture.commit({ amount: Number(next) / 100 }) }} />} />
  </div>
}
/** 一组登记参数的各行（名称悬停说明作用，行尾重置为默认值）；内置效果与带参数的过渡共用。 */
export type VideoEditBuiltinAnimation = { target: VideoEditCompositeTarget; effect: VideoEditBuiltinEffect; start: number; duration: number; frame: number } | { projectId: string; curves?: VideoEditCurves; start: number; duration: number; frame: number }
export function VideoEditBuiltinParamRows({ params, values, gesture, animation }: { params: readonly VideoEditBuiltinParam[]; values: Readonly<Record<string, unknown>>; gesture: VideoEditBuiltinParamGesture; animation?: VideoEditBuiltinAnimation }): React.ReactElement {
  const fields = builtinParameterFields(params)
  const curves = animation && ('effect' in animation ? animation.effect.builtin.curves : animation.curves)
  const projectId = animation && ('target' in animation ? animation.target.projectId : animation.projectId)
  const displayValues = Object.fromEntries(fields.map(field => [field.key, readBuiltinField(field, values)]))
  const extras = Object.fromEntries(fields.map(field => [field.key, field.bindingKeys.map(key => curves?.[key])]))
  return <ParamList key={gesture.identity} fields={fields} values={displayValues} extras={extras} contextKey={animation && JSON.stringify([animation.frame, animation.start, animation.duration])}
    renderControl={(field, value) => <BuiltinField field={field} value={value} gesture={gesture} />}
    onReset={field => gesture.commit({ params: Object.fromEntries(field.bindingKeys.map(key => [key, params.find(param => param.key === key)!.default])) })}
    resetDisabled={field => field.bindingKeys.every(key => values[key] === params.find(param => param.key === key)!.default)}
    renderAnimation={animation && ((field) => <div className="flex flex-wrap gap-1">{field.bindingKeys.map((key, index) => <VideoEditKeyframeControls key={key} label={field.bindingKeys.length > 1 ? field.type === 'point' ? `${field.title}${index === 0 ? '水平' : '垂直'}` : params.find(param => param.key === key)!.name : field.title} value={values[key] as number | string | boolean} points={curves?.[key]} time={animation.frame - animation.start} duration={animation.duration} discrete={['boolean', 'choice', 'curve', 'lut'].includes(field.type)}
      onBegin={gesture.begin} onFinish={gesture.finish} onCancel={gesture.cancel}
      onChange={points => { const next = { ...curves }; if (points.length) next[key] = points; else delete next[key]; gesture.commit({ curves: next }) }}
      onSeek={time => setVideoEditView(projectId!, { frame: animation.start + time, playing: false })}
      onDisable={() => { gesture.begin(); const next = { ...curves }; delete next[key]; gesture.commit({ curves: next }); gesture.commit({ params: { [key]: values[key] } }); gesture.finish() }} />)}</div>)} />
}

function BuiltinField({ field, value, gesture }: { field: ParamFieldSpec; value: CodeParameterValue; gesture: VideoEditBuiltinParamGesture }): React.ReactElement {
  const current = useRef(gesture); current.current = gesture
  const owns = useRef(false)
  useEffect(() => () => { if (owns.current && current.current.active()) current.current.cancel() }, [])
  const adapter = builtinFieldGesture(field, gesture)
  return <ParamField field={field} value={value} gesture={{ ...adapter, begin: () => { owns.current = true; adapter.begin() }, finish: () => { owns.current = false; adapter.finish() }, cancel: () => { owns.current = false; adapter.cancel() } }} />
}
