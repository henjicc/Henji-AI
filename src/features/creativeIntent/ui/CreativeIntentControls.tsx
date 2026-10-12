import { ExplanationSendConfirmation } from './ExplanationSendConfirmation'
import type { ExplanationSendRequest } from '../application/explanationGeneration'
import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dropdown, UiButton, UiGroup, UiFormRow, UiSegmented, UiOptionButton, UiRangeInput, UiError, UiLoading } from '@/components/ui'
import { PinOff, Play, Square, Pause, RotateCcw } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'

interface SharedCreativeIntentControlsProps {
  status: 'idle' | 'recording' | 'paused' | 'reviewing' | 'optimizing'
  candidates: { id: string; label: string }[]; selected: string; fidelity: number
  pins: { id: string; label: string }[]; canPin: boolean; message?: string; needsSave?: boolean; pinLabel?: string
  referenceControls?: ReactNode;
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
  const optimize = (confirmation?: ExplanationSendRequest, project = false): void => {
    if (pendingGeneration.current) return
    if (!props.prepareGeneration && !confirmation) { try { void Promise.resolve(props.onOptimize()).catch(error => props.onError?.(error)) } catch (error) { props.onError?.(error) } return }
    pendingGeneration.current = true; setGenerating(true)
    const key = props.contextKey
    void (async () => {
      if (confirmation) await confirmation.confirm(project)
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
  const row = (label: ReactNode, control: ReactNode): ReactNode => <UiFormRow label={label} density="compact" labelColumn="panel">{control}</UiFormRow>
  return <div className="flex w-72 max-w-full flex-col gap-3" data-creative-intent-controls>
    {props.referenceControls}
    {demonstration && <UiGroup title={t('creativeIntent.demonstration', { defaultValue: '示范' })} titleTone="compact" divided={Boolean(props.referenceControls)}>
      {motion && row(t('creativeIntent.captureLabel', { defaultValue: '方式' }), <UiSegmented ariaLabel={t('creativeIntent.captureAria', { defaultValue: '示范方式' })} size="sm" fullWidth value={motion.capture} disabled={recording || busy}
        options={[{ value: 'place', label: t('creativeIntent.place', { defaultValue: '分时摆放' }) }, { value: 'record', label: t('creativeIntent.record', { defaultValue: '录制轨迹' }) }]} onChange={motion.onCapture} />)}
      {motion && row(t('creativeIntent.pointerLabel', { defaultValue: '指针用途' }), <UiSegmented ariaLabel={t('creativeIntent.pointerAria', { defaultValue: '时间指针用途' })} size="sm" fullWidth value={motion.mode} disabled={busy}
        options={[{ value: 'navigate', label: t('creativeIntent.navigate', { defaultValue: '找位置' }), title: t('creativeIntent.altHint', { defaultValue: '按住 Alt 临时切换' }) }, { value: 'demonstrate', label: t('creativeIntent.demonstrate', { defaultValue: '示范运动' }), title: t('creativeIntent.demonstrateHint', { defaultValue: '摆放或拖动元素后，再拖时间指针示范；按住 Alt 临时切换' }) }]} onChange={motion.onMode} />)}
      {motion && row(t('creativeIntent.propertyLabel', { defaultValue: '属性' }), <Dropdown size="sm" appearance="field" className="w-full" buttonClassName="w-full" minWidthStrategy="none" ariaLabel={t('creativeIntent.propertyAria', { defaultValue: '示范属性' })} value={motion.property} disabled={busy}
        options={[{ value: 'position', label: t('creativeIntent.position', { defaultValue: '位置' }) }, { value: 'rotationTurns', label: t('creativeIntent.rotation', { defaultValue: '旋转' }) }, { value: 'scaleXY', label: t('creativeIntent.scale', { defaultValue: '缩放' }) }]} onSelect={motion.onProperty} />)}
      {camera && row(t('creativeIntent.propertyLabel', { defaultValue: '属性' }), <Dropdown size="sm" appearance="field" className="w-full" buttonClassName="w-full" minWidthStrategy="none" ariaLabel={t('creativeIntent.propertyAria', { defaultValue: '示范属性' })} value={camera.property} disabled={busy}
        options={[{ value: 'position', label: t('creativeIntent.cameraPosition', { defaultValue: '机位' }) }, { value: 'gaze', label: t('creativeIntent.gaze', { defaultValue: '视线' }) }, { value: 'focalLength', label: t('creativeIntent.focalLength', { defaultValue: '焦距' }) }]} onSelect={camera.onProperty} />)}
      {motion?.capture === 'record' && row(t('creativeIntent.speedLabel', { defaultValue: '速度' }), <Dropdown size="sm" appearance="field" className="w-full" buttonClassName="w-full" minWidthStrategy="none" ariaLabel={t('creativeIntent.speedAria', { defaultValue: '录制速度' })} value={motion.speed} disabled={busy}
        options={[{ value: 1, label: t('creativeIntent.normalSpeed', { defaultValue: '正常速' }) }, { value: .5, label: t('creativeIntent.halfSpeed', { defaultValue: '0.5x 慢录' }) }, { value: .25, label: t('creativeIntent.quarterSpeed', { defaultValue: '0.25x 慢录' }) }]} onSelect={motion.onSpeed} />)}
      {row('', <div className="flex flex-col gap-1">
        {(props.status === 'idle' || props.status === 'reviewing') && <UiButton variant="quiet" size="sm" className="w-full" disabled={busy} onClick={demonstration.onStart}><Play size={14} />{t('creativeIntent.start', { defaultValue: '开始示范' })}</UiButton>}
        {recording && <UiButton variant="quiet" size="sm" className="w-full" onClick={demonstration.onPause}><Pause size={14} />{t('creativeIntent.pause', { defaultValue: '暂停示范' })}</UiButton>}
        {props.status === 'paused' && <UiButton variant="quiet" size="sm" className="w-full" onClick={demonstration.onResume}><Play size={14} />{t('creativeIntent.resume', { defaultValue: '继续示范' })}</UiButton>}
        {(recording || props.status === 'paused') && <UiButton variant="quiet" size="sm" className="w-full" onClick={demonstration.onStop}><Square size={14} />{t('creativeIntent.stop', { defaultValue: '结束示范' })}</UiButton>}
      </div>)}
    </UiGroup>}
    {!camera && <UiGroup title={t('creativeIntent.organize', { defaultValue: '整理' })} titleTone="compact" divided={Boolean(demonstration || props.referenceControls)}>
      {row(t('creativeIntent.style', { defaultValue: '风格' }), <div className="flex flex-col gap-1">
        <span className="flex min-h-control-sm items-center justify-end text-xs text-text2">{t('creativeIntent.fidelityValue', { defaultValue: '保真 {{value}}%', value: Math.round((fidelity ?? props.fidelity) * 100) })}</span>
        <UiRangeInput aria-label={t('creativeIntent.fidelityAria', { defaultValue: '保真度' })} min={0} max={1} step={.01} value={fidelity ?? props.fidelity} disabled={recording || busy}
          onChange={event => { pending.current = Number(event.target.value); setFidelity(pending.current) }}
          onPointerUp={() => finishFidelity(true)} onPointerCancel={() => finishFidelity(false)} onBlur={() => finishFidelity(true)}
          onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); finishFidelity(false) } }}
          onKeyUp={event => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') finishFidelity(true) }} />
        <div className="flex justify-between text-2xs text-text3"><span>{t('creativeIntent.beautify', { defaultValue: '美化' })}</span><span>{t('creativeIntent.fidelity', { defaultValue: '保真' })}</span></div>
      </div>)}
      {motion && row(t('creativeIntent.intentLabel', { defaultValue: '动作' }), <Dropdown size="sm" appearance="field" className="w-full" buttonClassName="w-full" minWidthStrategy="none" ariaLabel={t('creativeIntent.intentAria', { defaultValue: '整理动作' })} value={motion.intent} disabled={recording || busy}
        options={[{ value: 'path', label: t('creativeIntent.path', { defaultValue: '沿示范路径' }) }, { value: 'overshoot', label: t('creativeIntent.overshoot', { defaultValue: '轻回弹' }) }, { value: 'spring', label: t('creativeIntent.spring', { defaultValue: '弹性回落' }) }, { value: 'bounce', label: t('creativeIntent.bounce', { defaultValue: '弹跳' }) }, { value: 'orbit', label: t('creativeIntent.orbit', { defaultValue: '环绕' }) }, { value: 'pingpong', label: t('creativeIntent.pingpong', { defaultValue: '平缓往返' }) }]} onSelect={motion.onIntent} />)}
    </UiGroup>}
    {motion && motion.takes.length > 1 && <UiGroup title={t('creativeIntent.takes', { defaultValue: '采用示范' })} titleTone="compact" divided>
      {row(t('creativeIntent.demonstration', { defaultValue: '示范' }), <div className="h-24"><Virtuoso data={motion.takes} itemContent={(_, take) => <UiOptionButton variant="menu" size="sm" className="w-full" active={take.selected} onClick={() => motion.onTake(take.id)}>{take.label}</UiOptionButton>} /></div>)}
    </UiGroup>}
    {(props.canPin || props.pins.length > 0) && <UiGroup title={t('creativeIntent.pins', { defaultValue: '钉住姿态' })} titleTone="compact" divided>
      {row('', <div className="flex gap-1">
        <UiButton variant="quiet" size="sm" className="min-w-0 flex-1" disabled={!props.canPin || busy} onClick={props.onPin}>{props.pinLabel ?? (camera ? t('creativeIntent.pinCamera', { defaultValue: '钉住当前机位' }) : motion ? t('creativeIntent.pinPosition', { defaultValue: '钉住当前位置' }) : t('creativeIntent.pinLayer', { defaultValue: '钉住所选图层' }))}</UiButton>
        {motion?.onPinEnd && <UiButton variant="quiet" size="sm" className="min-w-0 flex-1" disabled={recording || busy || props.status === 'idle'} onClick={motion.onPinEnd}>{t('creativeIntent.pinEnd', { defaultValue: '钉住终点' })}</UiButton>}
      </div>)}
      {props.pins.length > 0 && row(t('creativeIntent.pinned', { defaultValue: '已钉住' }), <div className="h-24"><Virtuoso data={props.pins} itemContent={(_, pin) => <UiOptionButton variant="menu" size="sm" className="w-full" disabled={busy} onClick={() => props.onUnpin(pin.id)}><PinOff size={14} />{t('creativeIntent.unpin', { defaultValue: '解钉 · {{label}}', label: pin.label })}</UiOptionButton>} /></div>)}
    </UiGroup>}
    {props.candidates.length > 0 && <UiGroup title={t('creativeIntent.comparison', { defaultValue: '候选对照' })} titleTone="compact" divided>
      {row(t('creativeIntent.candidates', { defaultValue: '候选' }), <div className="flex flex-col gap-1">
        <UiOptionButton variant="menu" size="sm" className="w-full" active={props.selected === 'original'} onClick={() => props.onPreview('original')}><RotateCcw size={14} />{camera ? t('creativeIntent.original', { defaultValue: '原稿' }) : t('creativeIntent.originalA', { defaultValue: '原稿 A' })}</UiOptionButton>
        {props.candidates.map(candidate => <UiOptionButton key={candidate.id} variant="menu" size="sm" className="w-full" active={props.selected === candidate.id} onClick={() => props.onPreview(candidate.id)}>{candidate.label}{camera ? '' : ' B'}</UiOptionButton>)}
      </div>)}
      {demonstration && row('', <UiButton variant="quiet" size="sm" className="w-full" onClick={demonstration.onPlay}><Play size={14} />{t('creativeIntent.play', { defaultValue: '正常速预览' })}</UiButton>)}
    </UiGroup>}
    {props.message && row('', <UiError size="sm" title={demonstration ? t('creativeIntent.demonstrationError', { defaultValue: '请调整示范' }) : t('creativeIntent.layoutError', { defaultValue: '请调整布局' })} message={props.message} />)}
    {busy ? row('', <><UiLoading size="sm" message={camera ? t('creativeIntent.cameraLoading', { defaultValue: '正在整理机位…' }) : motion ? t('creativeIntent.motionLoading', { defaultValue: '正在整理动作…' }) : t('creativeIntent.layoutLoading', { defaultValue: '正在整理布局…' })} /><UiButton variant="quiet" size="sm" className="w-full" onClick={props.onCancel}>{t('creativeIntent.cancel', { defaultValue: '取消整理' })}</UiButton></>) : <UiGroup divided>
      <div className="flex items-center justify-end gap-2">
        {apply && !props.needsSave && <UiButton variant="quiet" size="sm" onClick={() => optimize()}>{t('creativeIntent.reorganize', { defaultValue: '重新整理' })}</UiButton>}
        <UiButton variant="primary" size="sm" disabled={props.status === 'idle'} title={props.status === 'idle' ? t('creativeIntent.idleHint', { defaultValue: '先示范一次运动' }) : undefined} onClick={apply || props.needsSave ? props.onApply : () => optimize()}>{props.needsSave ? t('creativeIntent.retrySave', { defaultValue: '重试保存' }) : apply ? t('creativeIntent.apply', { defaultValue: '应用' }) : t('creativeIntent.organize', { defaultValue: '整理' })}</UiButton>
      </div>
    </UiGroup>}
    <ExplanationSendConfirmation request={request?.key === props.contextKey ? request?.value : undefined} generating={generating} onCancel={() => { if (!pendingGeneration.current) { void request?.value.cancel().catch(props.onError); setRequest(undefined) } }} onSend={project => { if (request?.key === props.contextKey) optimize(request?.value, project) }} />
  </div>
}
