import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, RotateCcw, WandSparkles, Upload } from 'lucide-react'
import { Dropdown, UiButton, UiEmpty, UiGroup, UiIconButton, UiLoading, UiOptionButton } from '@/components/ui'
import { UI_SEGMENTED_TRACK_CLASS } from '@/components/ui/styleTokens'
import { resolveVideoEditBuiltinParams, videoEditBuiltinDefaults } from '@/core/videoEdit/builtinEffects'
import { COLOR_GRADE_BASIC_PARAMS, COLOR_GRADE_CREATIVE_PARAMS, COLOR_GRADE_CURVE_CHANNELS, COLOR_GRADE_HSL_PARAMS, COLOR_GRADE_HUE_CURVES, COLOR_GRADE_HUE_CURVE_NAMES, COLOR_GRADE_LUT_PARAMS, COLOR_GRADE_POINT_PARAMS, COLOR_GRADE_VIGNETTE_PARAMS, COLOR_GRADE_WHEEL_PARAMS, COLOR_GRADE_WHEEL_REGIONS, VIDEO_EDIT_COLOR_GRADE } from '@/core/videoEdit/colorGrade'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { getActiveVideoEditSequence, requireVideoEditInstance, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { evaluateVideoEditEffect } from '@/core/videoEdit/keyframes'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
import { analyzeVideoEditColorGrade, editVideoEditColorGrade } from '../application/videoEditColorGrade'
import type { VideoEditCompositeTarget } from '../application/videoEditCompositing'
import { useVideoEditBuiltinParamGesture } from './useVideoEditBuiltinParamGesture'
import { VideoEditBuiltinParamRows } from './VideoEditBuiltinEffectControls'

import { importVideoEditColorLut } from '../application/videoEditColorLuts'

function Section({ title, children }: { title: string; children: ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(title === '基本校正')
  return <UiGroup titleTone="compact" gap="none" title={<UiButton size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{title}</UiButton>}>
    {open && children}
  </UiGroup>
}

function ColorGradeEditor({ target, clip, selectedId, onError }: { target: VideoEditCompositeTarget; clip: VideoEditClip; selectedId: string; onError: (reason: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const effect = selectedId ? clip.effects?.find(effect => effect.id === selectedId) : clip.effects?.find(effect => effect.builtin?.id === VIDEO_EDIT_COLOR_GRADE.id)
  const frame = requireVideoEditInstance(target.projectId).frame
  const values = effect?.builtin ? resolveVideoEditBuiltinParams(evaluateVideoEditEffect(effect, frame - clip.start).builtin!) : videoEditBuiltinDefaults(VIDEO_EDIT_COLOR_GRADE)
  const animation = effect?.builtin ? { target, effect: effect as VideoEditBuiltinEffect, start: clip.start, duration: clip.duration, frame } : undefined
  const gesture = useVideoEditBuiltinParamGesture(target.projectId, `${target.sequenceId}:${target.clipId}:${selectedId}`, (changes, handle) => editVideoEditColorGrade(target, changes, handle, selectedId || undefined), onError)
  const request = useRef<AbortController>(); const [busy, setBusy] = useState(false)
  useEffect(() => () => { request.current?.abort() }, [])
  const [reference, setReference] = useState('')
  const [matchMethod, setMatchMethod] = useState<'moments' | 'histogram'>('moments')
  const [hueCurve, setHueCurve] = useState('hue_sat')
  const luts = requireVideoEditInstance(target.projectId).document.colorLuts ?? []
  const upload = async (stage: string): Promise<void> => {
    if (busy || gesture.active()) return
    const controller = new AbortController(); request.current = controller; setBusy(true)
    try { const asset = await importVideoEditColorLut(target.projectId, controller.signal); controller.signal.throwIfAborted(); if (asset) gesture.commit({ params: { [`${stage}_lut`]: asset.id } }) }
    catch (error) { if (!controller.signal.aborted) onError(error) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const lutControl = (stage: string): ReactNode => <div className="flex items-center gap-1"><div className="min-w-0 flex-1"><Dropdown size="sm" ariaLabel={stage === 'input' ? '输入 LUT' : '创意 Look'} value={values[`${stage}_lut`] as string} options={[{ value: '', label: '无' }, ...luts.map(asset => ({ value: asset.id, label: asset.name }))]} onSelect={id => gesture.commit({ params: { [`${stage}_lut`]: id } })} /></div><UiIconButton size="sm" aria-label="导入 LUT" title="导入 .cube 颜色查找表" disabled={busy} onClick={() => { void upload(stage) }}><Upload size={14} /></UiIconButton></div>
  const automatic = async (): Promise<void> => {
    if (busy || gesture.active()) return
    const controller = new AbortController(); request.current = controller; setBusy(true)
    try {
      const result = await analyzeVideoEditColorGrade(target, undefined, controller.signal, selectedId || undefined, reference ? { referenceClipId: reference, matchMethod } : {})
      controller.signal.throwIfAborted()
      gesture.commit({ params: result.parameters, ...(reference ? { curves: {} } : {}) })
    } catch (error) { if (!controller.signal.aborted) onError(error) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const [channel, setChannel] = useState('master')
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center justify-end gap-1">
      <UiButton size="sm" disabled={busy} onClick={() => { void automatic() }} title="在片段内均匀采样，分析白平衡与明暗；选择参考后匹配其颜色"><WandSparkles size={14} />{busy ? '分析中…' : reference ? '匹配颜色' : '自动'}</UiButton>
      <UiIconButton size="sm" title="重置全能调色" aria-label="重置全能调色" disabled={busy || !effect} onClick={() => gesture.commit({ curves: {}, params: videoEditBuiltinDefaults(VIDEO_EDIT_COLOR_GRADE) })}><RotateCcw size={14} /></UiIconButton>
    </div>
    <Dropdown ariaLabel="校色参考片段" value={reference} options={[{ value: '', label: '自动校色' }, ...getActiveVideoEditSequence(requireVideoEditInstance(target.projectId)).clips.filter(value => value.id !== clip.id && value.kind !== 'audio' && value.kind !== 'adjustment').map(value => ({ value: value.id, label: value.name }))]} onSelect={setReference} />
    {reference && <Dropdown ariaLabel="颜色匹配方式" value={matchMethod} options={[{ value: 'moments', label: '均值与反差' }, { value: 'histogram', label: '颜色分布' }]} onSelect={value => setMatchMethod(value as 'moments' | 'histogram')} />}
    {busy && <UiLoading size="xs" message="正在处理颜色…" />}
    <Section title="基本校正">{lutControl('input')}<VideoEditBuiltinParamRows params={COLOR_GRADE_LUT_PARAMS.filter(param => param.key === 'input_lut_strength')} values={values} gesture={gesture} animation={animation} /><VideoEditBuiltinParamRows params={COLOR_GRADE_BASIC_PARAMS} values={values} gesture={gesture} animation={animation} /></Section>
    <Section title="创意">{lutControl('look')}<VideoEditBuiltinParamRows params={COLOR_GRADE_LUT_PARAMS.filter(param => param.key === 'look_lut_strength')} values={values} gesture={gesture} animation={animation} /><VideoEditBuiltinParamRows params={COLOR_GRADE_CREATIVE_PARAMS} values={values} gesture={gesture} animation={animation} /></Section>
    <Section title="曲线">
      <div className={UI_SEGMENTED_TRACK_CLASS} role="group" aria-label="曲线通道">{COLOR_GRADE_CURVE_CHANNELS.map((value, i) => <UiOptionButton key={value} variant="segment" size="sm" active={value === channel} onClick={() => setChannel(value)}>{['RGB 主', '红', '绿', '蓝'][i]}</UiOptionButton>)}</div>
      <VideoEditBuiltinParamRows params={COLOR_GRADE_POINT_PARAMS.filter(param => param.key === `curve_${channel}_points`)} values={values} gesture={gesture} animation={animation} />
      <div className={`${UI_SEGMENTED_TRACK_CLASS} max-w-full flex-wrap`} role="group" aria-label="色相饱和度曲线类型">{COLOR_GRADE_HUE_CURVES.map((value, i) => <UiOptionButton key={value} variant="segment" size="sm" active={value === hueCurve} onClick={() => setHueCurve(value)}>{COLOR_GRADE_HUE_CURVE_NAMES[i]}</UiOptionButton>)}</div>
      <VideoEditBuiltinParamRows params={COLOR_GRADE_POINT_PARAMS.filter(param => param.key === `curve_${hueCurve}_points`)} values={values} gesture={gesture} animation={animation} />
    </Section>
    <Section title="色轮">
      <div className="flex flex-wrap gap-2">{COLOR_GRADE_WHEEL_REGIONS.map(region => <div key={region} className="min-w-0 basis-40 flex-1"><VideoEditBuiltinParamRows params={COLOR_GRADE_WHEEL_PARAMS.filter(param => param.key.startsWith(`${region}_`))} values={values} gesture={gesture} animation={animation} /></div>)}</div>
    </Section>
    <Section title="HSL 辅助"><VideoEditBuiltinParamRows params={COLOR_GRADE_HSL_PARAMS} values={values} gesture={gesture} animation={animation} /></Section>
    <Section title="晕影"><VideoEditBuiltinParamRows params={COLOR_GRADE_VIGNETTE_PARAMS} values={values} gesture={gesture} animation={animation} /></Section>
  </div>
}

/** Dock and native popout use this same body. Selection follows the existing primary selected clip. */
function VideoEditColorGradePanelContent({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean }): React.ReactElement {
  const sequence = getActiveVideoEditSequence(instance); const clip = sequence.clips.find(value => value.id === instance.selection)
  const [choice, setChoice] = useState<{ clipId: string; effectId: string }>()
  const effects = clip?.effects?.filter(effect => effect.builtin?.id === VIDEO_EDIT_COLOR_GRADE.id) ?? []
  const selectedId = choice && choice.clipId === clip?.id && effects.some(effect => effect.id === choice.effectId) ? choice.effectId : ''
  if (!clip || clip.kind === 'audio') return <UiEmpty size="sm" title="选择画面片段以调色" />
  return <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto px-3 py-2.5" aria-label="全能调色">
    <span className="truncate text-xs font-semibold text-text1" title={clip.name}>{clip.name}</span>
    {effects.length > 1 && <Dropdown ariaLabel="编辑全能调色效果" value={selectedId || effects[0].id} options={effects.map((effect, i) => ({ value: effect.id, label: `${effect.name} ${i + 1}` }))} onSelect={effectId => setChoice({ clipId: clip.id, effectId })} />}
    {visible && <ColorGradeEditor key={`${instance.document.id}:${sequence.id}:${clip.id}:${selectedId}`} target={{ projectId: instance.document.id, sequenceId: sequence.id, clipId: clip.id }} clip={clip} selectedId={selectedId} onError={onError} />}
  </div>
}

export function VideoEditColorGradePanel(props: Parameters<typeof VideoEditColorGradePanelContent>[0]): React.ReactElement {
  return props.instance.activeSequenceId ? <VideoEditColorGradePanelContent {...props} /> : <UiEmpty className="h-full" title="没有序列" />
}
