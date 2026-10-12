import { ExplanationSendConfirmation } from './ExplanationSendConfirmation'
import type { ExplanationSendRequest } from '../application/explanationGeneration'
import { useRef, useState } from 'react'
import { Dropdown, UiButton, UiGroup, UiOptionButton, UiRangeInput, UiError, UiLoading } from '@/components/ui'
import { Pin, PinOff, Play, Square, Pause, RotateCcw } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'

interface SharedCreativeIntentControlsProps {
  status: 'idle' | 'recording' | 'paused' | 'reviewing' | 'optimizing'
  candidates: { id: string; label: string }[]; selected: string; fidelity: number
  pins: { id: string; label: string }[]; canPin: boolean; message?: string; needsSave?: boolean; pinLabel?: string
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
      else { const prepared = await props.prepareGeneration?.(); if (currentKey.current !== key) { await prepared?.cancel(); return }; if (prepared) { setRequest({ key, value: prepared }); return } }
      if (currentKey.current !== key) return
      setRequest(undefined); await props.onOptimize()
    })().catch(error => props.onError?.(error)).finally(() => { pendingGeneration.current = false; setGenerating(false) })
  }
  const motion = props.profile === undefined || props.profile === 'motion' ? props : undefined
  const camera = props.profile === 'camera' ? props : undefined
  const recording = Boolean((motion || camera) && props.status === 'recording'); const busy = props.status === 'optimizing' || generating
  const apply = props.candidates.some(candidate => candidate.id === props.selected)
  return <div className="flex w-72 max-w-full flex-col gap-3" data-creative-intent-controls>
    {camera && <UiGroup title="超级关键帧" titleTone="compact">
      <Dropdown ariaLabel="示范属性" value={camera.property} options={[{ value: 'position', label: '机位' }, { value: 'gaze', label: '视线' }, { value: 'focalLength', label: '焦距' }]} disabled={busy} onSelect={camera.onProperty} />
      <div className="flex items-center gap-1">
        {(props.status === 'idle' || props.status === 'reviewing') && <UiButton size="sm" onClick={camera.onStart}><Play size={14} />开始示范</UiButton>}
        {recording && <UiButton size="sm" onClick={camera.onPause}><Pause size={14} />暂停示范</UiButton>}
        {props.status === 'paused' && <UiButton size="sm" onClick={camera.onResume}><Play size={14} />继续示范</UiButton>}
        {(recording || props.status === 'paused') && <UiButton size="sm" onClick={camera.onStop}><Square size={14} />结束示范</UiButton>}
      </div>
    </UiGroup>}
    {motion && <UiGroup title="超级关键帧" titleTone="compact">
      <div className="flex items-center gap-1" role="group" aria-label="示范方式">
        <UiOptionButton variant="segment" active={motion.capture === 'place'} disabled={recording || busy} onClick={() => motion.onCapture('place')}>分时摆放</UiOptionButton>
        <UiOptionButton variant="segment" active={motion.capture === 'record'} disabled={recording || busy} onClick={() => motion.onCapture('record')}>录制轨迹</UiOptionButton>
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="时间指针用途">
        <UiOptionButton variant="segment" active={motion.mode === 'navigate'} onClick={() => motion.onMode('navigate')}>找位置</UiOptionButton>
        <UiOptionButton variant="segment" active={motion.mode === 'demonstrate'} title="摆放或拖动元素后，再拖时间指针示范；按住 Alt 临时切换" onClick={() => motion.onMode('demonstrate')}>示范运动</UiOptionButton>
      </div>
      <Dropdown ariaLabel="录制速度" value={motion.speed} options={[{ value: 1, label: '正常速' }, { value: .5, label: '0.5x 慢录' }, { value: .25, label: '0.25x 慢录' }]} onSelect={motion.onSpeed} />
      <Dropdown ariaLabel="示范属性" value={motion.property} options={[{ value: 'position', label: '位置' }, { value: 'rotationTurns', label: '旋转' }, { value: 'scaleXY', label: '缩放' }]} onSelect={motion.onProperty} />
      <div className="flex items-center gap-1">
        {props.status === 'idle' || props.status === 'reviewing' ? <UiButton size="sm" onClick={motion.onStart}><Play size={14} />开始示范</UiButton> : null}
        {recording && <UiButton size="sm" onClick={motion.onPause}><Pause size={14} />暂停示范</UiButton>}
        {props.status === 'paused' && <UiButton size="sm" onClick={motion.onResume}><Play size={14} />继续示范</UiButton>}
        {(recording || props.status === 'paused') && <UiButton size="sm" onClick={motion.onStop}><Square size={14} />结束示范</UiButton>}
      </div>
    </UiGroup>}
    {!camera && <UiGroup title="保真与美化" titleTone="compact">
      <div className="flex justify-between text-xs text-text2"><span>美化</span><span>保真 {Math.round((fidelity ?? props.fidelity) * 100)}%</span></div>
      <UiRangeInput aria-label="保真度" min={0} max={1} step={.01} value={fidelity ?? props.fidelity} disabled={recording || busy}
        onChange={event => { pending.current = Number(event.target.value); setFidelity(pending.current) }}
        onPointerUp={() => finishFidelity(true)} onPointerCancel={() => finishFidelity(false)} onBlur={() => finishFidelity(true)}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); finishFidelity(false) } }}
        onKeyUp={event => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') finishFidelity(true) }} />
      {motion && <Dropdown ariaLabel="整理动作" value={motion.intent} options={[{ value: 'path', label: '沿示范路径' }, { value: 'overshoot', label: '轻回弹' }, { value: 'spring', label: '弹性回落' }, { value: 'bounce', label: '弹跳' }, { value: 'orbit', label: '环绕' }, { value: 'pingpong', label: '平缓往返' }]} onSelect={motion.onIntent} />}
    </UiGroup>}
    {motion && motion.takes.length > 1 && <UiGroup title="采用示范" titleTone="compact"><div className="h-24"><Virtuoso data={motion.takes} itemContent={(_, t) => <UiOptionButton variant="menu" active={t.selected} onClick={() => motion.onTake(t.id)}>{t.label}</UiOptionButton>} /></div></UiGroup>}
    <UiGroup title="钉住姿态" titleTone="compact">
      <UiButton size="sm" disabled={!props.canPin || busy} onClick={props.onPin}><Pin size={14} />{props.pinLabel ?? (camera ? '钉住当前机位' : motion ? '钉住当前位置' : '钉住所选图层')}</UiButton>
      {motion?.onPinEnd && <UiButton size="sm" disabled={recording || busy || props.status === 'idle'} onClick={motion.onPinEnd}><Pin size={14} />钉住终点</UiButton>}
      {props.pins.length > 0 && <div className="h-24"><Virtuoso data={props.pins} itemContent={(_, pin) => <UiButton size="sm" onClick={() => props.onUnpin(pin.id)}><PinOff size={14} />解钉 · {pin.label}</UiButton>} /></div>}
    </UiGroup>
    {props.candidates.length > 0 && <UiGroup title={motion ? '正常速对照' : '候选对照'} titleTone="compact">
      <UiOptionButton variant="menu" active={props.selected === 'original'} onClick={() => props.onPreview('original')}><RotateCcw size={14} />{camera ? '原稿' : '原稿 A'}</UiOptionButton>
      {props.candidates.map(c => <UiOptionButton key={c.id} variant="menu" active={props.selected === c.id} onClick={() => props.onPreview(c.id)}>{c.label}{camera ? '' : ' B'}</UiOptionButton>)}
      {motion && <UiButton size="sm" onClick={motion.onPlay}><Play size={14} />正常速预览</UiButton>}
      {camera && <UiButton size="sm" onClick={camera.onPlay}><Play size={14} />正常速预览</UiButton>}
    </UiGroup>}
    {props.message && <UiError size="sm" title={motion || camera ? '请调整示范' : '请调整布局'} message={props.message} />}
    {busy ? <><UiLoading size="sm" message={camera ? '正在整理机位…' : motion ? '正在整理动作…' : '正在整理布局…'} /><UiButton onClick={props.onCancel}>取消整理</UiButton></> : <div className="flex items-center justify-end gap-2">
      {apply && !props.needsSave && <UiButton onClick={() => optimize()}>重新整理</UiButton>}
      <UiButton variant="primary" disabled={props.status === 'idle'} onClick={apply || props.needsSave ? props.onApply : () => optimize()}>{props.needsSave ? '重试保存' : apply ? '应用' : '整理'}</UiButton>
    </div>}
    <ExplanationSendConfirmation request={request?.key === props.contextKey ? request?.value : undefined} generating={generating} onCancel={() => { if (!pendingGeneration.current) { void request?.value.cancel().catch(props.onError); setRequest(undefined) } }} onSend={project => { if (request?.key === props.contextKey) optimize(request?.value, project) }} />
  </div>
}
