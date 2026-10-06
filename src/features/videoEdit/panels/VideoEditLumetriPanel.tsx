import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, RotateCcw, WandSparkles } from 'lucide-react'
import { Dropdown, UiButton, UiColorWheel, UiEmpty, UiGroup, UiIconButton, UiToneCurve } from '@/components/ui'
import { resolveVideoEditBuiltinParams, videoEditBuiltinDefaults } from '@/core/videoEdit/builtinEffects'
import { LUMETRI_BASIC_PARAMS, LUMETRI_CREATIVE_PARAMS, LUMETRI_CURVE_CHANNELS, LUMETRI_CURVE_PARAMS, LUMETRI_VIGNETTE_PARAMS, LUMETRI_WHEEL_PARAMS, LUMETRI_WHEEL_REGIONS, VIDEO_EDIT_LUMETRI } from '@/core/videoEdit/lumetri'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { getActiveVideoEditSequence, requireVideoEditInstance, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { evaluateVideoEditEffect } from '@/core/videoEdit/keyframes'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
import { analyzeVideoEditLumetri, editVideoEditLumetri } from '../application/videoEditLumetri'
import type { VideoEditCompositeTarget } from '../application/videoEditCompositing'
import { useVideoEditBuiltinParamGesture } from './useVideoEditBuiltinParamGesture'
import { VideoEditBuiltinParamRows } from './VideoEditBuiltinEffectControls'

function Section({ title, children }: { title: string; children: ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(title === '基本校正')
  return <UiGroup titleTone="compact" gap="none" title={<UiButton size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{title}</UiButton>}>
    {open && children}
  </UiGroup>
}

function LumetriEditor({ target, clip, selectedId, onError }: { target: VideoEditCompositeTarget; clip: VideoEditClip; selectedId: string; onError: (reason: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const effect = selectedId ? clip.effects?.find(effect => effect.id === selectedId) : clip.effects?.find(effect => effect.builtin?.id === VIDEO_EDIT_LUMETRI.id)
  const frame = requireVideoEditInstance(target.projectId).frame
  const values = effect?.builtin ? resolveVideoEditBuiltinParams(evaluateVideoEditEffect(effect, frame - clip.start).builtin!) : videoEditBuiltinDefaults(VIDEO_EDIT_LUMETRI)
  const animation = effect?.builtin ? { target, effect: effect as VideoEditBuiltinEffect, start: clip.start, duration: clip.duration, frame } : undefined
  const gesture = useVideoEditBuiltinParamGesture(target.projectId, `${target.sequenceId}:${target.clipId}:${selectedId}`, (changes, handle) => editVideoEditLumetri(target, changes, handle, selectedId || undefined), onError)
  const request = useRef<AbortController>(); const [busy, setBusy] = useState(false)
  useEffect(() => () => { request.current?.abort() }, [])
  const automatic = async (): Promise<void> => {
    if (busy || gesture.active()) return
    const controller = new AbortController(); request.current = controller; setBusy(true)
    try {
      const result = await analyzeVideoEditLumetri(target, undefined, controller.signal, selectedId || undefined)
      controller.signal.throwIfAborted()
      gesture.commit({ params: result.parameters })
    } catch (error) { if (!controller.signal.aborted) onError(error) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const events = { onBegin: gesture.begin, onFinish: gesture.finish, onCancel: gesture.cancel, disabled: busy }
  const [channel, setChannel] = useState('master')
  return <div className="flex flex-col gap-2">
    <div className="flex items-center justify-end gap-1">
      <UiButton size="sm" disabled={busy} onClick={() => { void automatic() }} title="分析选中片段的白平衡与明暗；播放头不在片段内时取中间帧。艺术偏色或纯色画面请手动调整"><WandSparkles size={14} />{busy ? '分析中…' : '自动'}</UiButton>
      <UiIconButton size="xs" title="重置 Lumetri 颜色" aria-label="重置 Lumetri 颜色" disabled={busy || !effect} onClick={() => gesture.commit({ curves: {}, params: videoEditBuiltinDefaults(VIDEO_EDIT_LUMETRI) })}><RotateCcw size={14} /></UiIconButton>
    </div>
    <Section title="基本校正"><VideoEditBuiltinParamRows params={LUMETRI_BASIC_PARAMS} values={values} gesture={gesture} animation={animation} /></Section>
    <Section title="创意"><VideoEditBuiltinParamRows params={LUMETRI_CREATIVE_PARAMS} values={values} gesture={gesture} animation={animation} /></Section>
    <Section title="曲线">
      <Dropdown ariaLabel="曲线通道" value={channel} options={LUMETRI_CURVE_CHANNELS.map((value, i) => ({ value, label: ['RGB 主曲线', '红曲线', '绿曲线', '蓝曲线'][i] }))} onSelect={setChannel} />
      <UiToneCurve label="RGB 曲线" values={Array.from({ length: 5 }, (_, i) => values[`curve_${channel}_${i}`] as number)} {...events} onChange={(i, value) => gesture.commit({ params: { [`curve_${channel}_${i}`]: value } })} />
      <VideoEditBuiltinParamRows params={LUMETRI_CURVE_PARAMS.filter(param => param.key.startsWith(`curve_${channel}_`))} values={values} gesture={gesture} animation={animation} />
    </Section>
    <Section title="色轮">
      {LUMETRI_WHEEL_REGIONS.map((region, i) => <UiGroup key={region} title={['阴影', '中间调', '高光'][i]} titleTone="compact" gap="none">
        <div className="mx-auto w-32"><UiColorWheel label={`${['阴影', '中间调', '高光'][i]}色轮`} hue={values[`${region}_hue`] as number} strength={values[`${region}_strength`] as number} {...events} onChange={(hue, strength) => gesture.commit({ params: { [`${region}_hue`]: hue, [`${region}_strength`]: strength } })} /></div>
        <VideoEditBuiltinParamRows params={LUMETRI_WHEEL_PARAMS.filter(param => param.key.startsWith(`${region}_`))} values={values} gesture={gesture} animation={animation} />
      </UiGroup>)}
    </Section>
    <Section title="晕影"><VideoEditBuiltinParamRows params={LUMETRI_VIGNETTE_PARAMS} values={values} gesture={gesture} animation={animation} /></Section>
  </div>
}

/** Dock and native popout use this same body. Selection follows the existing primary selected clip. */
export function VideoEditLumetriPanel({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean }): React.ReactElement {
  const sequence = getActiveVideoEditSequence(instance); const clip = sequence.clips.find(value => value.id === instance.selection)
  const [choice, setChoice] = useState<{ clipId: string; effectId: string }>()
  const effects = clip?.effects?.filter(effect => effect.builtin?.id === VIDEO_EDIT_LUMETRI.id) ?? []
  const selectedId = choice && choice.clipId === clip?.id && effects.some(effect => effect.id === choice.effectId) ? choice.effectId : ''
  if (!clip || clip.kind === 'audio') return <UiEmpty size="sm" title="选择画面片段以调色" />
  return <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto px-3 py-2.5" aria-label="Lumetri 颜色">
    <span className="truncate text-xs font-semibold text-text1" title={clip.name}>{clip.name}</span>
    {effects.length > 1 && <Dropdown ariaLabel="编辑 Lumetri 效果" value={selectedId || effects[0].id} options={effects.map((effect, i) => ({ value: effect.id, label: `${effect.name} ${i + 1}` }))} onSelect={effectId => setChoice({ clipId: clip.id, effectId })} />}
    {visible && <LumetriEditor key={`${instance.document.id}:${sequence.id}:${clip.id}:${selectedId}`} target={{ projectId: instance.document.id, sequenceId: sequence.id, clipId: clip.id }} clip={clip} selectedId={selectedId} onError={onError} />}
  </div>
}
