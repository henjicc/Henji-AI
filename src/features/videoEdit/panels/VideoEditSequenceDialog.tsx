import { useId, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Link, Unlink } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { videoEditSequenceDefaultsSchema } from '@/core/videoEdit/sequenceDefaults'
import { VIDEO_EDIT_SEQUENCE_LIMITS, isVideoEditSequenceSize, type VideoEditSequenceSize } from '@/core/videoEdit/sequenceSize'
import {
  VIDEO_EDIT_SEQUENCE_RATIOS, VIDEO_EDIT_SEQUENCE_TIERS, inferVideoEditSequencePreset,
  videoEditSequenceRatioLabel, videoEditSequenceRatioValue, videoEditSequenceSizeForPixels,
  videoEditSequenceTierSize, type VideoEditSequencePreset,
} from '@/core/videoEdit/sequencePresets'
import NumberInput from '@/components/ui/NumberInput'
import { Dropdown, UiButton, UiError, UiFormRow, UiGroup, UiIconButton, UiInput, UiModal, UiPanel, UiSegmented, UiSelect, UiSwitch } from '@/components/ui'
import { VIDEO_EDIT_DEFAULT_BLOOM_RADIUS, VIDEO_EDIT_DEFAULT_BLOOM_THRESHOLD, VIDEO_EDIT_DEFAULT_PATH_TRACE_SAMPLES, VIDEO_EDIT_SPACE_ENVIRONMENTS, type VideoEditSpaceEnvironment, type VideoEditBin, type VideoEditSequence, type VideoEditSpaceRender } from '@/core/videoEdit/document'
import { videoEditCompositionHasSpace } from '@/core/videoEdit/spaceDisplay'
import { VIDEO_EDIT_FRAME_RATES, videoEditFps } from '@/core/videoEdit/time'
import { formatFrameRate } from '@/core/format/specFormat'
import type { VideoEditSequenceSettings } from '../application/videoEditProjectItems'

const PREVIEW_HINT = '预览可能较吃力，可在节目监视器降低回放分辨率'
const PIXEL_ASPECT_RATIOS = [
  { label: '方形像素', numerator: 1, denominator: 1 },
  { label: 'HD 变形宽银幕 1.33', numerator: 4, denominator: 3 },
  { label: '变形宽银幕 2.0', numerator: 2, denominator: 1 },
]
function FrameShape({ size, custom }: { size: VideoEditSequenceSize; custom: boolean }): React.ReactElement {
  const width = Math.max(1, Number.isFinite(size.width) ? size.width : 1); const height = Math.max(1, Number.isFinite(size.height) ? size.height : 1)
  const edge = Math.max(width, height)
  return <div aria-hidden className="flex items-center justify-center bg-control text-text2" style={{ width: `${width / edge * 100}%`, height: `${height / edge * 100}%` }}>
    {custom && <span className="text-xs tabular-nums">{videoEditSequenceRatioLabel(size)}</span>}
  </div>
}
const SPACE_ENVIRONMENT_LABELS: Record<VideoEditSpaceEnvironment, string> = { none: '无', studioNeutral: '摄影棚 · 中性', studioWarm: '摄影棚 · 暖', studioCool: '摄影棚 · 冷', rim: '黑棚轮廓光', sky: '天光' }

export function VideoEditSequenceDialog({ title, initial, bins, requireFrameRate = false, mode = 'create', onClose, onSubmit }: {
  title: string; initial: VideoEditSequenceSettings; bins: VideoEditBin[]; requireFrameRate?: boolean; mode?: 'create' | 'edit'; onClose: () => void; onSubmit: (settings: VideoEditSequenceSettings) => void | Promise<unknown>
}): React.ReactElement {
  const defaults = useSettingsStore(state => state.videoEditSequenceDefaults)
  const [values, updateValues] = useState(() => ({ name: initial.name ?? '新序列', binId: initial.binId ?? '', width: String(initial.width ?? defaults.width), height: String(initial.height ?? defaults.height),
    frameRate: requireFrameRate ? { numerator: 60, denominator: 1 } : initial.frameRate ?? defaults.frameRate, pixelAspectRatio: initial.pixelAspectRatio ?? defaults.pixelAspectRatio, sampleRate: initial.sampleRate ?? defaults.sampleRate, channels: initial.channels ?? defaults.channels,
    // 运动模糊总开关不进“默认值”：新建序列一律先开着
    motionBlur: initial.motionBlur ?? true, spaceRender: initial.spaceRender ?? {} as VideoEditSpaceRender }))
  // 三维设置只给已经有三维内容的序列看：新建序列和纯二维序列不出现这一组。
  const hasSpace = mode === 'edit' && 'clips' in initial && videoEditCompositionHasSpace(initial as VideoEditSequence)
  const space = values.spaceRender
  const setSpace = (change: Partial<VideoEditSpaceRender>): void => setValues({ ...values, spaceRender: { ...space, ...change } })
  const size = { width: Number(values.width), height: Number(values.height) }
  const [preset, setPreset] = useState(() => inferVideoEditSequencePreset(size))
  const [locked, setLocked] = useState(true)
  const lockedAspect = useRef(size.width > 0 && size.height > 0 ? size.width / size.height : 16 / 9)
  const widthRef = useRef<HTMLInputElement>(null)
  const sizeErrorId = useId()
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [defaultsSaved, setDefaultsSaved] = useState(false)
  const sizeError = size.width < VIDEO_EDIT_SEQUENCE_LIMITS.minDimension || size.height < VIDEO_EDIT_SEQUENCE_LIMITS.minDimension
    ? '宽高至少 16'
    : size.width > VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension || size.height > VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension || size.width * size.height > VIDEO_EDIT_SEQUENCE_LIMITS.maxPixels ? '超过 8K 上限' : ''
  const setValues = (next: typeof values): void => {
    setError('')
    if (JSON.stringify(next) === JSON.stringify(values)) return
    updateValues(next); setDefaultsSaved(false)
  }
  const specification = (): ReturnType<typeof videoEditSequenceDefaultsSchema.parse> => {
    if (sizeError) throw new Error(sizeError)
    const { name: _name, binId: _binId, motionBlur: _motionBlur, spaceRender: _spaceRender, ...settings } = values
    return videoEditSequenceDefaultsSchema.parse({ ...settings, ...size })
  }
  const saveAsDefaults = (): void => {
    try { useSettingsStore.getState().setVideoEditSequenceDefaults(specification()); setDefaultsSaved(true); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const submit = async (): Promise<void> => {
    if (!values.name.trim()) { setError('请输入序列名称。'); return }
    setBusy(true); setError('')
    try { const settings = specification(); await onSubmit({ ...settings, name: values.name.trim(), binId: values.binId || null, motionBlur: values.motionBlur, ...(hasSpace ? { spaceRender: values.spaceRender } : {}) }); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const applySize = (next: VideoEditSequenceSize, nextPreset = inferVideoEditSequencePreset(next)): void => {
    setPreset(nextPreset)
    setValues({ ...values, width: String(next.width), height: String(next.height) })
  }
  const currentAspect = Number.isFinite(size.width / size.height) && size.width > 0 && size.height > 0 ? size.width / size.height : lockedAspect.current
  const chooseRatio = (ratio: VideoEditSequencePreset['ratio']): void => {
    if (ratio === '自定义') { setPreset({ ...preset, ratio }); widthRef.current?.focus(); return }
    const aspect = videoEditSequenceRatioValue(ratio)
    const pixels = size.width > 0 && size.height > 0 && Number.isFinite(size.width * size.height) ? size.width * size.height : VIDEO_EDIT_SEQUENCE_LIMITS.minDimension ** 2
    const next = preset.tier === '自定义'
      ? videoEditSequenceSizeForPixels(pixels, aspect)
      : videoEditSequenceTierSize(aspect, preset.tier)
    lockedAspect.current = next.width / next.height
    applySize(next, { ...preset, ratio })
  }
  const chooseTier = (tier: VideoEditSequencePreset['tier']): void => {
    if (tier === '自定义') { setPreset({ ...preset, tier }); widthRef.current?.focus(); return }
    const aspect = preset.ratio === '自定义' ? currentAspect : videoEditSequenceRatioValue(preset.ratio)
    const next = videoEditSequenceTierSize(aspect, tier)
    if (!isVideoEditSequenceSize(next)) return
    lockedAspect.current = next.width / next.height
    applySize(next, { ...preset, tier })
  }
  const editSize = (key: 'width' | 'height', text: string, commit = false): void => {
    const number = Number(text)
    // 保留空值和正在输入的非法值用于即时校验，失焦才取偶数。
    const dimension = commit && text !== '' && Number.isFinite(number) ? Math.round(number / 2) * 2 : number
    const next = { ...size, [key]: dimension }
    const other = key === 'width' ? 'height' : 'width'
    if (locked && dimension > 0 && Number.isFinite(dimension)) {
      next[other] = Math.round((key === 'width' ? dimension / lockedAspect.current : dimension * lockedAspect.current) / 2) * 2
    }
    if (commit && String(dimension) === values[key] && String(next[other]) === values[other]) return
    setPreset(inferVideoEditSequencePreset(next))
    setValues({ ...values, [key]: commit && text !== '' ? String(dimension) : text, [other]: locked && dimension > 0 ? String(next[other]) : values[other] })
  }
  const matchedRate = VIDEO_EDIT_FRAME_RATES.find(rate => rate.numerator * values.frameRate.denominator === values.frameRate.numerator * rate.denominator) ?? values.frameRate
  const rateKey = `${matchedRate.numerator}/${matchedRate.denominator}`
  const parKey = `${values.pixelAspectRatio.numerator}/${values.pixelAspectRatio.denominator}`
  const par = PIXEL_ASPECT_RATIOS.find(value => value.numerator * values.pixelAspectRatio.denominator === values.pixelAspectRatio.numerator * value.denominator)
  const tierAspect = preset.ratio === '自定义' ? currentAspect : videoEditSequenceRatioValue(preset.ratio)
  return <UiModal isOpen size="form" title={title} contentPadding="default" contentScroll="auto" onClose={() => { if (!busy) onClose() }} footer={<>
    <UiButton variant="quiet" className="mr-auto" disabled={busy || defaultsSaved || Boolean(sizeError)} onClick={saveAsDefaults}>{defaultsSaved ? '已保存为默认值' : '保存为默认值'}</UiButton>
    <UiButton disabled={busy} onClick={onClose}>取消</UiButton>
    <UiButton variant="primary" disabled={busy || Boolean(sizeError)} onClick={() => { void submit() }}>{mode === 'edit' ? '保存' : '新建'}</UiButton>
  </>}>
    <UiGroup labelWidth={96} gap="stack">
      <UiGroup>
        <UiFormRow label="名称" inline><UiInput aria-label="序列名称" className="w-full" disabled={busy} value={values.name} maxLength={200} onChange={event => setValues({ ...values, name: event.target.value })} /></UiFormRow>
        <UiFormRow label="素材箱" inline><UiSelect aria-label="序列素材箱" className="w-full" disabled={busy} value={values.binId} onChange={event => setValues({ ...values, binId: event.target.value })}><option value="">素材根目录</option>{bins.map(bin => <option key={bin.id} value={bin.id}>{bin.name}</option>)}</UiSelect></UiFormRow>
      </UiGroup>
      <div className="flex justify-center">
        <UiPanel variant="inset" className="flex h-40 w-40 shrink-0 items-center justify-center p-3" aria-label="序列预览"><div className="flex h-full w-full items-center justify-center"><FrameShape size={size} custom={preset.ratio === '自定义'} /></div></UiPanel>
      </div>
        <UiGroup className="min-w-0 w-full">
          <UiFormRow label="比例" inline><Dropdown ariaLabel="画面比例" className="w-full" disabled={busy} value={preset.ratio} options={[...VIDEO_EDIT_SEQUENCE_RATIOS, '自定义' as const].map(value => ({ label: value, value }))} onSelect={chooseRatio} /></UiFormRow>
          <UiFormRow label="分辨率" inline><Dropdown ariaLabel="分辨率" className="w-full" disabled={busy} value={preset.tier} options={[
            ...VIDEO_EDIT_SEQUENCE_TIERS.map(({ label }) => {
              const enabled = isVideoEditSequenceSize(videoEditSequenceTierSize(tierAspect, label))
              return { label, value: label, disabled: !enabled, tooltip: !enabled ? '超过 8K 上限' : label === '8K' ? PREVIEW_HINT : undefined }
            }), { label: '自定义', value: '自定义' as const },
          ]} onSelect={chooseTier} /></UiFormRow>
          <UiFormRow label="尺寸" inline><div className="w-full">
            <div className="flex items-center gap-1">
              <UiInput ref={widthRef} type="number" aria-label="宽度" className="min-w-0 w-full" disabled={busy} min={VIDEO_EDIT_SEQUENCE_LIMITS.minDimension} max={VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension} step={2} value={values.width} aria-invalid={Boolean(sizeError)} aria-describedby={sizeError ? sizeErrorId : undefined} onChange={event => editSize('width', event.target.value)} onBlur={event => editSize('width', event.target.value, true)} />
              <UiIconButton tone="bare" on={locked} size="md" aria-label="锁定比例" disabled={busy} onClick={() => { if (!locked) lockedAspect.current = currentAspect; setLocked(value => !value) }}>{locked ? <Link /> : <Unlink />}</UiIconButton>
              <UiInput type="number" aria-label="高度" className="min-w-0 w-full" disabled={busy} min={VIDEO_EDIT_SEQUENCE_LIMITS.minDimension} max={VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension} step={2} value={values.height} aria-invalid={Boolean(sizeError)} aria-describedby={sizeError ? sizeErrorId : undefined} onChange={event => editSize('height', event.target.value)} onBlur={event => editSize('height', event.target.value, true)} />
            </div>
            {sizeError && <div id={sizeErrorId} className="mt-1"><UiError size="xs" align="start" title={sizeError} message="" /></div>}
          </div></UiFormRow>
          <UiFormRow label="帧率" inline><Dropdown ariaLabel="帧率" className="w-full" disabled={busy} value={rateKey} display={formatFrameRate(videoEditFps(values.frameRate))} options={VIDEO_EDIT_FRAME_RATES.map(rate => {
            const fps = videoEditFps(rate)
            return { label: formatFrameRate(fps), value: `${rate.numerator}/${rate.denominator}`, tooltip: fps > 60 ? PREVIEW_HINT : undefined }
          })} onSelect={value => { const [numerator, denominator] = value.split('/').map(Number); setValues({ ...values, frameRate: { numerator, denominator } }) }} /></UiFormRow>
          <UiFormRow label="运动模糊" inline info="整条序列的总开关：在动的片段与图层沿运动方向模糊。关掉后默认都不模糊，单独打开的片段或元素除外。"><UiSwitch aria-label="运动模糊" disabled={busy} checked={values.motionBlur} onCheckedChange={checked => setValues({ ...values, motionBlur: checked })} /></UiFormRow>
        </UiGroup>
      {hasSpace && <UiGroup title="三维" divided>
        <UiFormRow label="成片渲染" inline info="导出、选帧和封面用哪种渲染。路径追踪有真实的光影、反射和景深，1080P 每帧要几秒到几十秒，不做运动模糊；节目监视器看片另在“更多 → 三维”里切换。">
          <UiSegmented ariaLabel="成片渲染" disabled={busy} value={space.finalRenderer ?? 'realtime'} options={[{ value: 'realtime', label: '实时' }, { value: 'pathTrace', label: '路径追踪' }]} onChange={finalRenderer => setSpace({ finalRenderer })} />
        </UiFormRow>
        {space.finalRenderer === 'pathTrace' && <UiFormRow label="采样数" inline info="每像素采样数。越多噪点越少，渲染时间大致与它成正比。">
          <NumberInput ariaLabel="路径追踪采样数" disabled={busy} value={space.pathTraceSamples ?? VIDEO_EDIT_DEFAULT_PATH_TRACE_SAMPLES} min={16} max={4096} step={16} widthClassName="w-full" onChange={pathTraceSamples => setSpace({ pathTraceSamples })} />
        </UiFormRow>}
        <UiFormRow label="泛光" inline info="亮处向四周发光：发光粒子、灯和高光更有光感。0 为不开。">
          <NumberInput ariaLabel="泛光强度" disabled={busy} value={space.bloom ?? 0} min={0} max={3} step={.05} precision={2} widthClassName="w-full" onChange={bloom => setSpace({ bloom })} />
        </UiFormRow>
        {(space.bloom ?? 0) > 0 && <UiFormRow label="泛光阈值" inline info="亮度超过它的部分才发光：调低连较暗的面也泛光，调高只有灯与强高光泛光。">
          <NumberInput ariaLabel="泛光阈值" disabled={busy} value={space.bloomThreshold ?? VIDEO_EDIT_DEFAULT_BLOOM_THRESHOLD} min={0} max={2} step={.05} precision={2} widthClassName="w-full" onChange={bloomThreshold => setSpace({ bloomThreshold })} />
        </UiFormRow>}
        {(space.bloom ?? 0) > 0 && <UiFormRow label="泛光范围" inline info="光晕扩散多远，越大越朦胧。">
          <NumberInput ariaLabel="泛光范围" disabled={busy} value={space.bloomRadius ?? VIDEO_EDIT_DEFAULT_BLOOM_RADIUS} min={0} max={1} step={.05} precision={2} widthClassName="w-full" onChange={bloomRadius => setSpace({ bloomRadius })} />
        </UiFormRow>}
        <UiFormRow label="环境光遮蔽" inline info="物体相接处和凹处变暗，体积更实。只作用于三维物体，卡片画面不变。0 为不开。">
          <NumberInput ariaLabel="环境光遮蔽强度" disabled={busy} value={space.ambientOcclusion ?? 0} min={0} max={1} step={.05} precision={2} widthClassName="w-full" onChange={ambientOcclusion => setSpace({ ambientOcclusion })} />
        </UiFormRow>
        <UiFormRow label="全局光照" inline info="亮面把自身颜色反弹到周围物体上，墙角有色溢、背光面被照亮，更接近路径追踪。只作用于三维物体。0 为不开。">
          <NumberInput ariaLabel="全局光照强度" disabled={busy} value={space.globalIllumination ?? 0} min={0} max={1} step={.05} precision={2} widthClassName="w-full" onChange={globalIllumination => setSpace({ globalIllumination })} />
        </UiFormRow>
        <UiFormRow label="屏幕反射" inline info="光滑、金属表面反射画面里看得到的东西。只作用于三维物体。0 为不开。">
          <NumberInput ariaLabel="屏幕反射强度" disabled={busy} value={space.reflections ?? 0} min={0} max={1} step={.05} precision={2} widthClassName="w-full" onChange={reflections => setSpace({ reflections })} />
        </UiFormRow>
        <UiFormRow label="曝光" inline info="三维物体整体提亮或压暗，每加 1 亮一倍。卡片画面不变。">
          <NumberInput ariaLabel="三维曝光" disabled={busy} value={space.exposure ?? 0} min={-5} max={5} step={.1} precision={1} widthClassName="w-full" onChange={exposure => setSpace({ exposure })} />
        </UiFormRow>
        <UiFormRow label="色调" inline info="中性：颜色最接近原样。胶片：高光柔和地过渡到白，玻璃和发光更自然。电影：对比更强。只作用于三维物体。">
          <UiSegmented ariaLabel="三维色调映射" disabled={busy} value={space.toneMapping ?? 'neutral'} options={[{ value: 'neutral', label: '中性' }, { value: 'agx', label: '胶片' }, { value: 'aces', label: '电影' }]} onChange={toneMapping => setSpace({ toneMapping })} />
        </UiFormRow>
        <UiFormRow label="环境光" inline info="照亮三维物体，出现在金属反射和玻璃里，不当背景显示。代码场景自己设了环境时以代码为准。">
          <Dropdown ariaLabel="三维环境光" className="w-full" disabled={busy} value={space.environment ?? 'none'} display={SPACE_ENVIRONMENT_LABELS[space.environment ?? 'none']} options={VIDEO_EDIT_SPACE_ENVIRONMENTS.map(value => ({ value, label: SPACE_ENVIRONMENT_LABELS[value] }))} onSelect={environment => setSpace({ environment: environment as VideoEditSpaceEnvironment })} />
        </UiFormRow>
        {(space.environment ?? 'none') !== 'none' && <>
          <UiFormRow label="环境光强度" inline>
            <NumberInput ariaLabel="三维环境光强度" disabled={busy} value={space.environmentIntensity ?? 1} min={0} max={4} step={.05} precision={2} widthClassName="w-full" onChange={environmentIntensity => setSpace({ environmentIntensity })} />
          </UiFormRow>
          <UiFormRow label="环境光旋转" inline info="转动灯位，换高光与反射落在物体哪里。">
            <NumberInput ariaLabel="三维环境光旋转" disabled={busy} value={space.environmentRotation ?? 0} min={-180} max={180} step={5} precision={0} widthClassName="w-full" onChange={environmentRotation => setSpace({ environmentRotation })} />
          </UiFormRow>
        <UiFormRow label="缺省布光" inline info="有受光的片段、却没有灯光片段与环境光时，自动加摄影棚环境与一盏主光；加入第一盏灯或设了环境光后自动不加。">
          <UiSwitch aria-label="缺省布光" disabled={busy} checked={space.defaultLighting !== 'off'} onCheckedChange={checked => setSpace({ defaultLighting: checked ? undefined : 'off' })} />
        </UiFormRow>
        </>}
      </UiGroup>}
      <div>
        <UiButton aria-expanded={advanced} disabled={busy} onClick={() => setAdvanced(value => !value)}>{advanced ? <ChevronDown /> : <ChevronRight />}更多设置</UiButton>
        {advanced && <UiGroup className="mt-3">
          <UiFormRow label="像素长宽比" inline><UiSelect aria-label="像素长宽比" className="w-full" disabled={busy} value={par ? `${par.numerator}/${par.denominator}` : parKey} onChange={event => { const [numerator, denominator] = event.target.value.split('/').map(Number); setValues({ ...values, pixelAspectRatio: { numerator, denominator } }) }}>
            {PIXEL_ASPECT_RATIOS.map(value => <option key={value.label} value={`${value.numerator}/${value.denominator}`}>{value.label}</option>)}
            {!par && <option value={parKey}>素材像素 {Number((values.pixelAspectRatio.numerator / values.pixelAspectRatio.denominator).toFixed(3))}</option>}
          </UiSelect></UiFormRow>
          <UiFormRow label="音频采样率" inline><UiSelect aria-label="音频采样率" className="w-full" disabled={busy} value={values.sampleRate} onChange={event => setValues({ ...values, sampleRate: Number(event.target.value) as 44100 | 48000 })}><option value={48000}>48000 Hz</option><option value={44100}>44100 Hz</option></UiSelect></UiFormRow>
          <UiFormRow label="声道" inline><UiSelect aria-label="声道" className="w-full" disabled={busy} value={values.channels} onChange={event => setValues({ ...values, channels: Number(event.target.value) as 1 | 2 })}><option value={2}>立体声</option><option value={1}>单声道</option></UiSelect></UiFormRow>
        </UiGroup>}
      </div>
      {error && <UiError size="xs" align="start" title={error} message="" />}
    </UiGroup>
  </UiModal>
}
