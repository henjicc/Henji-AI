import { AudioCaptureSettingsForm } from '@/features/audioCapture'
import { PanelTrigger, UiTooltipText } from '@/components/ui'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { ExplanationSendConfirmation } from './ExplanationSendConfirmation'
import type { ExplanationSendRequest } from '../application/explanationGeneration'
import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dropdown, UiButton, UiChipButton, UiDisclosurePanel, UiGroup, UiFormRow, UiIconButton, UiSegmented, UiOptionButton, UiRangeInput, UiError, UiLoading, UiSwitch, UI_TEXT_META_CLASS } from '@/components/ui'
import { Check, ChevronDown, PinOff, Play, Square, Pause, Trash2 } from 'lucide-react'

/** 剪辑录制面板；图片随手摆与 3D 镜头仍保留各自原有工作流。 */
export function SuperKeyframeRecordingControls(props: {
  status: 'idle' | 'recording' | 'paused' | 'reviewing' | 'optimizing'; busy: boolean; message?: string
  microphone: boolean
  takes: { id: string; label: string }[]
  onMicrophone: (enabled: boolean) => void; onRemove: (id: string) => void
  onStart: () => void; onPause: () => void; onResume: () => void; onFinish: () => void; onHandoff: () => void
}): React.ReactElement {
  const recording = props.status === 'recording', paused = props.status === 'paused'
  return <div className="flex flex-col gap-3">
    <UiGroup labelWidth={72}>
      <UiFormRow label="麦克风" density="compact"><UiSwitch aria-label="麦克风" checked={props.microphone} disabled={props.busy} onCheckedChange={props.onMicrophone} /></UiFormRow>
      <UiFormRow label={<UiTooltipText tooltip="与录屏和音频编辑共用录音设置；请暂停录制后修改。">输入设备</UiTooltipText>} density="compact"><PanelTrigger display="录音设置" size="sm" panelSize="compact" panelPadding="content" disabled={props.busy || recording} renderPanel={() => <AudioCaptureSettingsForm />} /></UiFormRow>
    </UiGroup>
    {!!props.takes.length && <UiGroup title="本组段落" titleTone="compact" labelWidth={72}>
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">{props.takes.map(take => <div key={take.id} className="flex items-center justify-between gap-2">
        <span className={UI_TEXT_META_CLASS}>{take.label}</span><UiIconButton size="xs" tooltip={`删除${take.label}`} aria-label={`删除${take.label}`} disabled={props.busy || recording || paused} onClick={() => props.onRemove(take.id)}><Trash2 /></UiIconButton>
      </div>)}</div>
    </UiGroup>}
    {props.message && <UiError size="xs" message={props.message} />}
    <div className="flex items-center justify-end gap-2">
      {recording || paused ? <><UiButton variant="quiet" size="sm" disabled={props.busy} onClick={recording ? props.onPause : props.onResume}>{recording ? <Pause /> : <Play />}{recording ? '暂停' : '继续录制'}</UiButton><UiButton variant="primary" size="sm" disabled={props.busy} onClick={props.onFinish}><Square />{props.busy ? '正在处理' : '完成'}</UiButton></> : <>
        <UiButton variant={props.takes.length ? 'quiet' : 'primary'} size="sm" disabled={props.busy} onClick={props.onStart}><Play />{props.takes.length ? '再录一段' : '开始录制'}</UiButton>
        {!!props.takes.length && <UiButton variant="primary" size="sm" disabled={props.busy} onClick={props.onHandoff}>{props.busy ? '正在处理' : '交给 AI'}</UiButton>}
      </>}
    </div>
  </div>
}

interface SharedCreativeIntentControlsProps {
  status: 'idle' | 'recording' | 'paused' | 'reviewing' | 'optimizing'
  candidates: { id: string; label: string }[]; selected: string; fidelity: number
  pins: { id: string; label: string }[]; canPin: boolean; message?: string; needsSave?: boolean; pinLabel?: string
  referenceControls?: ReactNode
  /** 有生效中的参照或约束时，“参照与约束”区默认展开。 */
  referenceActive?: boolean
  /** 放在最上方的入口（如“继续上次原稿”）。 */
  leadingControls?: ReactNode;
  contextKey?: string; prepareGeneration?: () => Promise<ExplanationSendRequest | undefined>; onError?: (error: unknown) => void
  onCancel: () => void
  onOptimize: () => void | Promise<void>; onApply: () => void; onPreview: (id: string) => void
  onFidelity: (value: number) => void; onPin: () => void; onUnpin: (id: string) => void
}
interface MotionCreativeIntentControlsProps {
  profile?: 'motion'
  intent: 'path' | 'overshoot' | 'spring' | 'bounce' | 'orbit' | 'pingpong'
  mode: 'navigate' | 'demonstrate'; speed: 1 | 0.5 | 0.25; property: 'position' | 'rotationTurns' | 'scaleXY'; capture: 'place' | 'record'
  takes: { id: string; label: string; selected: boolean }[]
  onStart: () => void; onStop: () => void; onPause: () => void; onResume: () => void
  onPinEnd?: () => void; onTake: (id: string) => void
  onMode: (value: 'navigate' | 'demonstrate') => void; onSpeed: (value: 1 | 0.5 | 0.25) => void
  onProperty: (value: 'position' | 'rotationTurns' | 'scaleXY') => void; onCapture: (value: 'place' | 'record') => void
  onIntent: (value: 'path' | 'overshoot' | 'spring' | 'bounce' | 'orbit' | 'pingpong') => void; onPlay: () => void
}
/** Camera hosts retain native recording and optical properties. */
interface CameraCreativeIntentControlsProps {
  profile: 'camera'
  property: 'position' | 'gaze' | 'focalLength'
  onProperty: (value: 'position' | 'gaze' | 'focalLength') => void
  onStart: () => void; onStop: () => void; onPause: () => void; onResume: () => void; onPlay: () => void
}
export type CreativeIntentControlsProps = SharedCreativeIntentControlsProps & (MotionCreativeIntentControlsProps | CameraCreativeIntentControlsProps | { profile: 'layout' })
/** Presentation only; all operations and data stay in the owning document adapter. */
export function CreativeIntentControls(props: CreativeIntentControlsProps): React.ReactElement {
  const { t } = useTranslation('ui')
  const [fidelity, setFidelity] = useState<number | null>(null); const pending = useRef<number | null>(null)
  const finishFidelity = (commit: boolean): void => { if (commit && pending.current !== null && pending.current !== props.fidelity) props.onFidelity(pending.current); pending.current = null; setFidelity(null) }
  const [request, setRequest] = useState<{ key?: string; value: ExplanationSendRequest }>(), [generating, setGenerating] = useState(false)
  const pendingGeneration = useRef(false), currentKey = useRef(props.contextKey); currentKey.current = props.contextKey
  const optimize = (confirmation?: ExplanationSendRequest): void => {
    if (pendingGeneration.current) return
    if (!props.prepareGeneration && !confirmation) { try { void Promise.resolve(props.onOptimize()).catch(error => props.onError?.(error)) } catch (error) { props.onError?.(error) } return }
    pendingGeneration.current = true; setGenerating(true)
    const key = props.contextKey
    void (async () => {
      if (confirmation) await confirmation.confirm()
      else { const prepared = await props.prepareGeneration?.(); if (currentKey.current !== key) { await prepared?.cancel(); return } if (prepared) { setRequest({ key, value: prepared }); return } }
      if (currentKey.current !== key) return
      setRequest(undefined); await props.onOptimize()
    })().catch(error => props.onError?.(error)).finally(() => { pendingGeneration.current = false; setGenerating(false) })
  }
  const motion = props.profile === undefined || props.profile === 'motion' ? props : undefined
  const camera = props.profile === 'camera' ? props : undefined
  const recording = Boolean((motion || camera) && props.status === 'recording'); const busy = props.status === 'optimizing' || generating
  const apply = props.candidates.some(candidate => candidate.id === props.selected)
  const demonstration = motion ?? camera
  const row = (label: ReactNode, control: ReactNode): ReactNode => <UiFormRow label={label} density="compact">{control}</UiFormRow>
  const [referenceOpen, setReferenceOpen] = useState(Boolean(props.referenceActive))
  const reviewing = props.candidates.length > 0
  const fidelityPercent = Math.round((fidelity ?? props.fidelity) * 100)
  const startLabel = reviewing ? t('creativeIntent.restart', { defaultValue: '再示范一次' }) : t('creativeIntent.start', { defaultValue: '开始示范' })
  const options = [{ id: 'original', label: camera ? t('creativeIntent.original', { defaultValue: '原稿' }) : t('creativeIntent.originalA', { defaultValue: '原稿 A' }) }, ...props.candidates.map(candidate => ({ id: candidate.id, label: camera ? candidate.label : `${candidate.label} B` }))]
  const demonstrationGroup = demonstration && !recording && props.status !== 'paused' && <UiGroup title={t('creativeIntent.demonstration', { defaultValue: '示范' })} titleTone="compact" labelWidth={72}>
        {motion && row(t('creativeIntent.captureLabel', { defaultValue: '方式' }), <UiSegmented ariaLabel={t('creativeIntent.captureAria', { defaultValue: '示范方式' })} size="sm" fullWidth value={motion.capture} disabled={busy}
          options={[{ value: 'place', label: t('creativeIntent.place', { defaultValue: '分时摆放' }) }, { value: 'record', label: t('creativeIntent.record', { defaultValue: '录制轨迹' }) }]} onChange={motion.onCapture} />)}
        {motion && row(t('creativeIntent.pointerLabel', { defaultValue: '指针' }), <UiSegmented ariaLabel={t('creativeIntent.pointerAria', { defaultValue: '时间指针用途' })} size="sm" fullWidth value={motion.mode} disabled={busy}
          options={[{ value: 'navigate', label: t('creativeIntent.navigate', { defaultValue: '找位置' }), title: t('creativeIntent.altHint', { defaultValue: '按住 Alt 临时切换' }) }, { value: 'demonstrate', label: t('creativeIntent.demonstrate', { defaultValue: '示范运动' }), title: t('creativeIntent.demonstrateHint', { defaultValue: '摆放或拖动元素后，再拖时间指针示范；按住 Alt 临时切换' }) }]} onChange={motion.onMode} />)}
        {motion && row(t('creativeIntent.propertyLabel', { defaultValue: '属性' }), <Dropdown size="sm" appearance="field" className="w-full" buttonClassName="w-full" minWidthStrategy="none" ariaLabel={t('creativeIntent.propertyAria', { defaultValue: '示范属性' })} value={motion.property} disabled={busy}
          options={[{ value: 'position', label: t('creativeIntent.position', { defaultValue: '位置' }) }, { value: 'rotationTurns', label: t('creativeIntent.rotation', { defaultValue: '旋转' }) }, { value: 'scaleXY', label: t('creativeIntent.scale', { defaultValue: '缩放' }) }]} onSelect={motion.onProperty} />)}
        {camera && row(t('creativeIntent.propertyLabel', { defaultValue: '属性' }), <Dropdown size="sm" appearance="field" className="w-full" buttonClassName="w-full" minWidthStrategy="none" ariaLabel={t('creativeIntent.propertyAria', { defaultValue: '示范属性' })} value={camera.property} disabled={busy}
          options={[{ value: 'position', label: t('creativeIntent.cameraPosition', { defaultValue: '机位' }) }, { value: 'gaze', label: t('creativeIntent.gaze', { defaultValue: '视线' }) }, { value: 'focalLength', label: t('creativeIntent.focalLength', { defaultValue: '焦距' }) }]} onSelect={camera.onProperty} />)}
        {motion?.capture === 'record' && row(t('creativeIntent.speedLabel', { defaultValue: '速度' }), <Dropdown size="sm" appearance="field" className="w-full" buttonClassName="w-full" minWidthStrategy="none" ariaLabel={t('creativeIntent.speedAria', { defaultValue: '录制速度' })} value={motion.speed} disabled={busy}
          options={[{ value: 1, label: t('creativeIntent.normalSpeed', { defaultValue: '正常速' }) }, { value: .5, label: t('creativeIntent.halfSpeed', { defaultValue: '0.5x 慢录' }) }, { value: .25, label: t('creativeIntent.quarterSpeed', { defaultValue: '0.25x 慢录' }) }]} onSelect={motion.onSpeed} />)}
      <UiButton variant={reviewing ? 'secondary' : 'primary'} size="sm" className="w-full" disabled={busy} onClick={demonstration.onStart}><Play />{startLabel}</UiButton>
      {motion && motion.takes.length > 1 && <div role="group" aria-label={t('creativeIntent.takes', { defaultValue: '采用示范' })} className="flex max-h-24 flex-col gap-0.5 overflow-y-auto">
        {motion.takes.map(take => <UiOptionButton key={take.id} variant="menu" size="sm" className="w-full" active={take.selected} onClick={() => motion.onTake(take.id)}>{take.label}</UiOptionButton>)}
      </div>}
    </UiGroup>
  /*
   * 按进行到哪一步排版（2026-10-22 重设计）：示范完成后候选对照放最上面，整理参数其次，钉住再次；
   * 参照与约束收进默认折叠的区域；底部固定“重新整理 / 应用”。标签列 72，数值与滑杆同一行。
   */
  // 有示范功能时，还没示范的阶段主动作就是“开始示范”，不再挂一个灰掉的“整理”。
  const showFooter = busy || props.needsSave || !demonstration || props.status !== 'idle' || reviewing
  // 分组之间只靠一档 16px 留白和分组标题区分（浮层底上发丝线看不见，留着只会显得空）；分组自带的兄弟间距清零，不叠加。
  return <div className="flex w-72 max-w-full flex-col gap-4 [&>[data-ui-group]]:!mt-0" data-creative-intent-controls>
    {props.leadingControls}
    {(recording || props.status === 'paused') && demonstration && <div className="flex flex-col gap-2" role="status">
      <span className="text-xs text-text2">{recording ? t('creativeIntent.recordingHint', { defaultValue: '正在示范：拖动元素或时间指针' }) : t('creativeIntent.pausedHint', { defaultValue: '示范已暂停' })}</span>
      <div className="flex gap-1.5">
        {recording && <UiButton variant="secondary" size="sm" className="min-w-0 flex-1" onClick={demonstration.onPause}><Pause />{t('creativeIntent.pause', { defaultValue: '暂停示范' })}</UiButton>}
        {props.status === 'paused' && <UiButton variant="secondary" size="sm" className="min-w-0 flex-1" onClick={demonstration.onResume}><Play />{t('creativeIntent.resume', { defaultValue: '继续示范' })}</UiButton>}
        <UiButton variant="secondary" size="sm" className="min-w-0 flex-1" onClick={demonstration.onStop}><Square />{t('creativeIntent.stop', { defaultValue: '结束示范' })}</UiButton>
      </div>
    </div>}
    {reviewing && <UiGroup title={t('creativeIntent.comparison', { defaultValue: '候选对照' })} titleTone="compact" labelWidth={72}
      actions={demonstration ? <UiIconButton size="xs" aria-label={t('creativeIntent.play', { defaultValue: '正常速预览' })} tooltip={t('creativeIntent.play', { defaultValue: '正常速预览' })} onClick={demonstration.onPlay}><Play /></UiIconButton> : undefined}>
      <div role="group" aria-label={t('creativeIntent.candidates', { defaultValue: '候选' })} className="flex flex-col gap-0.5">
        {options.map(option => <UiOptionButton key={option.id} variant="menu" size="sm" className="w-full gap-2" active={props.selected === option.id} onClick={() => props.onPreview(option.id)}>
          <span aria-hidden="true" className="flex w-3.5 shrink-0 justify-center">{props.selected === option.id ? <Check size={UI_ICON_SIZE.sm} /> : null}</span>
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
        </UiOptionButton>)}
      </div>
    </UiGroup>}
    {!reviewing && demonstrationGroup}
    {!camera && <UiGroup title={t('creativeIntent.organize', { defaultValue: '整理' })} titleTone="compact" labelWidth={72}>
      {motion && row(t('creativeIntent.intentLabel', { defaultValue: '动作' }), <Dropdown size="sm" appearance="field" className="w-full" buttonClassName="w-full" minWidthStrategy="none" ariaLabel={t('creativeIntent.intentAria', { defaultValue: '整理动作' })} value={motion.intent} disabled={recording || busy}
        options={[{ value: 'path', label: t('creativeIntent.path', { defaultValue: '沿示范路径' }) }, { value: 'overshoot', label: t('creativeIntent.overshoot', { defaultValue: '轻回弹' }) }, { value: 'spring', label: t('creativeIntent.spring', { defaultValue: '弹性回落' }) }, { value: 'bounce', label: t('creativeIntent.bounce', { defaultValue: '弹跳' }) }, { value: 'orbit', label: t('creativeIntent.orbit', { defaultValue: '环绕' }) }, { value: 'pingpong', label: t('creativeIntent.pingpong', { defaultValue: '平缓往返' }) }]} onSelect={motion.onIntent} />)}
      {row(t('creativeIntent.style', { defaultValue: '风格' }), <div className="flex min-h-control-sm items-center gap-2">
        <span className="shrink-0 text-xs text-text3">{t('creativeIntent.beautify', { defaultValue: '美化' })}</span>
        <UiRangeInput className="min-w-0 flex-1" aria-label={t('creativeIntent.fidelityAria', { defaultValue: '保真度' })} aria-valuetext={t('creativeIntent.fidelityValue', { defaultValue: '保真 {{value}}%', value: fidelityPercent })} min={0} max={1} step={.01} value={fidelity ?? props.fidelity} disabled={recording || busy}
          onChange={event => { pending.current = Number(event.target.value); setFidelity(pending.current) }}
          onPointerUp={() => finishFidelity(true)} onPointerCancel={() => finishFidelity(false)} onBlur={() => finishFidelity(true)}
          onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); finishFidelity(false) } }}
          onKeyUp={event => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') finishFidelity(true) }} />
        <span className="shrink-0 text-xs text-text3">{t('creativeIntent.fidelity', { defaultValue: '保真' })}</span>
        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-text2">{fidelityPercent}%</span>
      </div>)}
    </UiGroup>}
    {(props.canPin || props.pins.length > 0) && <UiGroup title={t('creativeIntent.pins', { defaultValue: '钉住姿态' })} titleTone="compact" labelWidth={72}>
      <div className="flex gap-1.5">
        <UiButton variant="secondary" size="sm" className="min-w-0 flex-1" disabled={!props.canPin || busy} disabledReason={busy ? t('creativeIntent.busyReason', { defaultValue: '正在整理，请稍候' }) : t('creativeIntent.pinReason', { defaultValue: '先示范一次，再钉住姿态' })} onClick={props.onPin}>{props.pinLabel ?? (camera ? t('creativeIntent.pinCamera', { defaultValue: '钉住当前机位' }) : motion ? t('creativeIntent.pinPosition', { defaultValue: '钉住当前位置' }) : t('creativeIntent.pinLayer', { defaultValue: '钉住所选图层' }))}</UiButton>
        {motion?.onPinEnd && <UiButton variant="secondary" size="sm" className="min-w-0 flex-1" disabled={recording || busy || props.status === 'idle'} disabledReason={busy ? t('creativeIntent.busyReason', { defaultValue: '正在整理，请稍候' }) : recording ? t('creativeIntent.recordingReason', { defaultValue: '结束示范后再钉住终点' }) : t('creativeIntent.pinReason', { defaultValue: '先示范一次，再钉住姿态' })} onClick={motion.onPinEnd}>{t('creativeIntent.pinEnd', { defaultValue: '钉住终点' })}</UiButton>}
      </div>
      {props.pins.length > 0 && <div className="flex flex-wrap gap-1" role="group" aria-label={t('creativeIntent.pinned', { defaultValue: '已钉住' })}>
        {props.pins.map(pin => <UiChipButton key={pin.id} size="sm" disabled={busy} aria-label={t('creativeIntent.unpin', { defaultValue: '解钉 · {{label}}', label: pin.label })} onClick={() => props.onUnpin(pin.id)}><PinOff size={UI_ICON_SIZE.xs} />{pin.label}</UiChipButton>)}
      </div>}
    </UiGroup>}
    {reviewing && demonstrationGroup}
    {props.referenceControls && <div className="flex flex-col border-t border-line pt-2">
      <UiButton variant="quiet" size="sm" className="w-full justify-between" aria-expanded={referenceOpen} onClick={() => setReferenceOpen(open => !open)}>
        <span>{t('creativeIntent.referenceSection', { defaultValue: '参照与约束' })}</span><ChevronDown className={referenceOpen ? 'rotate-180' : ''} />
      </UiButton>
      <UiDisclosurePanel open={referenceOpen} className="flex flex-col gap-3 pt-2">{props.referenceControls}</UiDisclosurePanel>
    </div>}
    {props.message && <UiError size="sm" title={demonstration ? t('creativeIntent.demonstrationError', { defaultValue: '请调整示范' }) : t('creativeIntent.layoutError', { defaultValue: '请调整布局' })} message={props.message} />}
    {showFooter && <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
      {busy ? <>
        <span className="mr-auto min-w-0"><UiLoading size="sm" message={camera ? t('creativeIntent.cameraLoading', { defaultValue: '正在整理机位…' }) : motion ? t('creativeIntent.motionLoading', { defaultValue: '正在整理动作…' }) : t('creativeIntent.layoutLoading', { defaultValue: '正在整理布局…' })} /></span>
        <UiButton variant="quiet" size="sm" onClick={props.onCancel}>{t('creativeIntent.cancel', { defaultValue: '取消整理' })}</UiButton>
      </> : <>
        {apply && !props.needsSave && <UiButton variant="quiet" size="sm" onClick={() => optimize()}>{t('creativeIntent.reorganize', { defaultValue: '重新整理' })}</UiButton>}
        <UiButton variant={demonstration && !reviewing && !props.needsSave ? 'secondary' : 'primary'} size="sm" disabled={props.status === 'idle'} disabledReason={t('creativeIntent.idleHint', { defaultValue: '先示范一次运动' })} onClick={apply || props.needsSave ? props.onApply : () => optimize()}>{props.needsSave ? t('creativeIntent.retrySave', { defaultValue: '重试保存' }) : apply ? t('creativeIntent.apply', { defaultValue: '应用' }) : t('creativeIntent.organize', { defaultValue: '整理' })}</UiButton>
      </>}
    </div>}
    <ExplanationSendConfirmation request={request?.key === props.contextKey ? request?.value : undefined} generating={generating} onCancel={() => { if (!pendingGeneration.current) { void request?.value.cancel().catch(props.onError); setRequest(undefined) } }} onSend={() => { if (request?.key === props.contextKey) optimize(request?.value) }} />
  </div>
}
