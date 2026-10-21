import { useTranslation } from 'react-i18next'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Plus, Square, Trash2, Eye, MousePointer2 } from 'lucide-react'
import { Dropdown, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiIconButton, UiInput, UiLoading, UiOptionButton, UiSegmented, UiSwitch } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { VIDEO_EDIT_MAX_TRACKERS, VIDEO_EDIT_TRACK_METHOD_LABELS, videoEditTrackerFollowAbilities } from '@/core/videoEdit/tracking'
import { VIDEO_EDIT_STABILIZATION_DEFAULTS, VIDEO_EDIT_STABILIZATION_SMOOTHNESS, VIDEO_EDIT_STABILIZATION_SMOOTHNESS_LABELS, type VideoEditClipStabilization } from '@/core/videoEdit/stabilization'
import { videoEditClipMedia } from '@/core/videoEdit/document'
import { isShapesMask, videoEditMaskShapeName } from '@/core/videoEdit/effectMasks'
import { getActiveVideoEditSequence, subscribeVideoEditDomain, subscribeVideoEditView, videoEditDomainRevision, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { bakeVideoEditClipFollow, bindVideoEditTracking, createVideoEditRecordingTracker, editVideoEditTracker } from '../application/videoEditTrackingEdits'
import { readVideoEditStabilization, setVideoEditClipStabilization, type VideoEditStabilizationReadout } from '../application/videoEditStabilization'
import { getVideoEditTrackingEditing, setVideoEditTrackingEditing, subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision } from '../application/videoEditTrackingEditing'
import { runVideoEditTracking, stopVideoEditTracking, subscribeVideoEditTracking, videoEditTrackingFailureText, videoEditTrackingRequest, videoEditTrackingRevision, videoEditTrackingStatus, videoEditTrackingStatusText } from '../application/videoEditTracking'
import { updateVideoEditBuiltinEffect } from '../application/videoEditCompositing'

function VideoEditTrackingPanelContent({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  const { t: surfaceText } = useTranslation('ui')
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  useSyncExternalStore(subscribeVideoEditTracking, videoEditTrackingRevision)
  useSyncExternalStore(subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision)
  const [creation, setCreation] = useState('shape-point')
  const [destination, setDestination] = useState('')
  const [scale, setScale] = useState(false)
  const [rotation, setRotation] = useState(false)
  const [applyMode, setApplyMode] = useState<'live' | 'keyframes'>('live')
  const [pointCount, setPointCount] = useState('1')
  const sequence = getActiveVideoEditSequence(instance)
  const clip = sequence.clips.find(clip => clip.id === instance.selection)
  if (!clip || !['video', 'image', 'sequence'].includes(clip.kind)) return <UiEmpty title="选择视频、图片或嵌套片段" description="在节目画面上点选或框住要跟踪的物体。" />
  const projectId = instance.document.id; const sequenceId = sequence.id
  const editing = getVideoEditTrackingEditing()
  const selectedEditing = editing?.projectId === projectId && editing.sequenceId === sequenceId && editing.clipId === clip.id ? editing : null
  const tracker = clip.trackers?.find(tracker => tracker.id === selectedEditing?.trackerId) ?? clip.trackers?.[0]
  const recordable = clip.kind === 'video' && Boolean(videoEditClipMedia(instance.document, clip)?.recordingCursor)
  const abilities = tracker ? videoEditTrackerFollowAbilities(tracker) : undefined
  const request = tracker && videoEditTrackingRequest(instance.document, sequence.frameRate, clip, tracker)
  const status = videoEditTrackingStatus(request?.definition)
  const locked = sequence.tracks.find(track => track.index === clip.track)?.locked
  const target = { projectId, sequenceId, clipId: clip.id }
  const show = (): void => { if (tracker) setVideoEditTrackingEditing({ ...target, trackerId: tracker.id, method: tracker.method, mode: 'show' }) }
  const run = (direction: 'forward' | 'backward', limit?: number): void => { if (request) runVideoEditTracking(request.definition, request.range, { direction, ...(limit ? { limit } : {}) }) }
  const destinations = [
    ...(clip.effects ?? []).filter(effect => effect.builtin && effect.enabled).map(effect => ({ value: `effect:${effect.id}`, label: `作用区域 · ${effect.name}` })),
    ...(clip.effects ?? []).flatMap(effect => isShapesMask(effect.mask) ? effect.mask.shapes.map(shape => ({ value: `mask:${effect.id}:${shape.id}`, label: `${effect.name} · ${videoEditMaskShapeName(effect.mask!.regionId === 'shapes' ? effect.mask!.shapes : [], shape)}` })) : []),
    ...sequence.clips.filter(entry => entry.id !== clip.id && entry.kind !== 'audio' && entry.kind !== 'adjustment').map(entry => ({ value: `clip:${entry.id}`, label: `片段跟随 · ${entry.name}` })),
    ...(abilities?.cornerPin ? sequence.clips.filter(entry => entry.id !== clip.id && (entry.kind === 'image' || entry.kind === 'video' || entry.kind === 'sequence')).map(entry => ({value:`pin:${entry.id}`,label:`角点贴合 · ${entry.name}`})) : []),
  ]
  const apply = (): void => {
    if (!tracker) return
    const [kind, id, shapeId] = destination.split(':')
    try {
      if (kind === 'effect') updateVideoEditBuiltinEffect(target, id, { mask: { regionId: 'tracker', trackerId: tracker.id } })
      else void bindVideoEditTracking(projectId, sequenceId, clip.id, tracker.id, kind === 'clip' || kind === 'pin' ? { clipId: id, scale: scale && Boolean(abilities?.scale), rotation: rotation && Boolean(abilities?.rotation), ...(kind === 'pin' ? {cornerPin:true} : {}) } : { effectId: id, shapeId })
        // 写成关键帧：先在当前帧建立跟随，再逐帧换算成位置、缩放、旋转关键帧（AE 的“应用”）。
        .then(() => kind === 'clip' && applyMode === 'keyframes' ? bakeVideoEditClipFollow(projectId, sequenceId, id).then(() => undefined) : undefined).catch(onError)
    } catch (error) { onError(error) }
  }
  return <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3" data-video-edit-tracking-panel>
    <div className="flex flex-wrap items-center gap-1">
      <Dropdown ariaLabel="新建跟踪方式" size="sm" value={creation} options={[{ value: 'shape-point', label: '形状 · 点选' }, { value: 'shape-box', label: '形状 · 框选' }, { value: 'box', label: '物体框 · 框选' }, {value:'point',label:'点 · 特征跟踪'}, {value:'planar',label:'平面 · 四角'}, ...(recordable ? [{ value: 'recording-cursor', label: '录屏 · 光标' }, { value: 'recording-window', label: '录屏 · 窗口' }] : [])]} onSelect={setCreation} />
      <UiButton size="sm" variant="secondary" disabled={locked || (clip.trackers?.length ?? 0) >= VIDEO_EDIT_MAX_TRACKERS} onClick={() => {
        // 录屏光标与窗口直接由录制事件建立，不用在画面上点选。
        if (creation.startsWith('recording-')) { void createVideoEditRecordingTracker(projectId, sequenceId, clip.id, { kind: creation === 'recording-cursor' ? 'cursor' : 'window' }).then(created => setVideoEditTrackingEditing({ ...target, trackerId: created.id, method: created.method, mode: 'show' }), onError); return }
        setVideoEditTrackingEditing({ ...target, method: creation === 'point' ? 'point' : creation === 'planar' ? 'planar' : creation === 'box' ? 'box' : 'shape', mode: creation === 'planar' ? 'quad' : creation === 'point' || creation === 'shape-point' ? 'point' : 'box', pointCount:Number(pointCount) })
      }}><Plus  />新建</UiButton>
    </div>
    {creation === 'point' && <Dropdown ariaLabel="跟踪点数量" size="sm" value={pointCount} options={[1,2,3,4].map(n=>({value:String(n),label:`${n} 个点`}))} onSelect={setPointCount} />}
    {selectedEditing && selectedEditing.mode !== 'show' && <p className="text-xs text-text2" role="status">{selectedEditing.method === 'point' ? '依次点击要跟踪的特征点。' : selectedEditing.mode === 'quad' ? '沿屏幕或平面的边缘依次点击四角。' : selectedEditing.mode === 'point' ? '在节目画面上点击物体，选择合适的候选。' : '在节目画面上拖框选中物体。'}<UiButton size="sm" onClick={() => setVideoEditTrackingEditing(null)}>取消</UiButton></p>}
    {!clip.trackers?.length && !selectedEditing && <UiEmpty size="xs" title="尚无跟踪" description="新建跟踪后，在节目画面中选择物体。" />}
    <div className="flex flex-col gap-1" role="list" aria-label="片段跟踪器">
      {(clip.trackers ?? []).map(entry => <div key={entry.id} className="flex items-center gap-1" role="listitem">
        <UiOptionButton variant="menu" size="sm" className="min-w-0 flex-1" active={tracker?.id === entry.id} onClick={() => setVideoEditTrackingEditing({ ...target, trackerId: entry.id, method: entry.method, mode: 'show' })}><span className="truncate" title={entry.name}>{entry.name}</span></UiOptionButton>
        <UiIconButton size="2xs" tone="danger" aria-label={`删除${entry.name}`} disabled={locked} onClick={() => { try { editVideoEditTracker(projectId, sequenceId, clip.id, { remove: entry.id }); setVideoEditTrackingEditing(null) } catch (error) { onError(error) } }}><Trash2  /></UiIconButton>
      </div>)}
    </div>
    {tracker && <>
      <UiInput key={tracker.id + tracker.name} size="sm" aria-label="跟踪名称" defaultValue={tracker.name} disabled={locked} onBlur={event => { if (event.target.value.trim() === tracker.name) return; try { editVideoEditTracker(projectId, sequenceId, clip.id, { ...tracker, name: event.target.value }) } catch (error) { onError(error) } }} />
      <p className="text-xs text-text3">{tracker.recording ? tracker.recording.kind === 'cursor' ? '录屏光标（录制事件）' : '录屏窗口（录制事件）' : VIDEO_EDIT_TRACK_METHOD_LABELS[tracker.method]}</p>
      {status?.state === 'failed' ? <UiError size="xs" title="跟踪失败" message={videoEditTrackingFailureText(status.reason)} /> : status?.state === 'tracking' ? <UiLoading size="xs" message={`正在跟踪 ${Math.round(status.progress * 100)}%`} /> : <p role="status" className="text-xs text-text2">{status?.state === 'ready' ? `${status.stopped ? '已停止，' : ''}已覆盖 ${videoEditTrackingStatusText(status, request?.range).split(':')[1]}` : '等待跟踪'}</p>}
      {!tracker.recording && <div className="flex flex-wrap items-center gap-1" role="group" aria-label="执行跟踪">
        <UiIconButton size="xs" aria-label="向后一帧" disabled={locked || status?.state === 'tracking'} onClick={() => run('backward', 1)}><ChevronLeft  /></UiIconButton>
        <UiIconButton size="xs" aria-label="向后跟踪" disabled={locked || status?.state === 'tracking'} onClick={() => run('backward')}><ChevronsLeft  /></UiIconButton>
        <UiIconButton size="xs" aria-label="停止跟踪" disabled={status?.state !== 'tracking'} onClick={() => { if (request) stopVideoEditTracking(request.definition) }}><Square  /></UiIconButton>
        <UiIconButton size="xs" aria-label="向前跟踪" disabled={locked || status?.state === 'tracking'} onClick={() => run('forward')}><ChevronsRight  /></UiIconButton>
        <UiIconButton size="xs" aria-label="向前一帧" disabled={locked || status?.state === 'tracking'} onClick={() => run('forward', 1)}><ChevronRight  /></UiIconButton>
        <UiIconButton size="xs" aria-label="显示跟踪框" aria-pressed={selectedEditing?.mode === 'show'} on={selectedEditing?.mode === 'show'} onClick={() => selectedEditing?.mode === 'show' ? setVideoEditTrackingEditing(null) : show()}><Eye  /></UiIconButton>
        {tracker.method === 'shape' && <UiIconButton size="xs" aria-label="补点纠错" disabled={locked} onClick={() => setVideoEditTrackingEditing({ ...target, trackerId: tracker.id, method: tracker.method, mode: 'point' })}><MousePointer2  /></UiIconButton>}
      </div>}
      <UiGroup labelWidth={96} title="应用到" titleTone="compact">
        <UiFormRow label={surfaceText('surfaceGrammar.trackingTarget')} density="compact" labelColumn="panel"><Dropdown ariaLabel="跟踪应用目标" size="sm" value={destination} options={[{ value: '', label: '选择效果、遮罩或片段' }, ...destinations]} onSelect={setDestination} /></UiFormRow>
        {destination.startsWith('clip:') && abilities?.scale && <UiFormRow label="跟随缩放" inline density="compact"><UiSwitch checked={scale} onCheckedChange={setScale} /></UiFormRow>}
        {destination.startsWith('clip:') && abilities?.rotation && <UiFormRow label="跟随旋转" inline density="compact"><UiSwitch checked={rotation} onCheckedChange={setRotation} /></UiFormRow>}
        {destination.startsWith('clip:') && <UiFormRow label="应用方式" density="compact"><UiSegmented ariaLabel="跟踪应用方式" size="sm" value={applyMode} onChange={setApplyMode} options={[{ value: 'live', label: '实时跟随' }, { value: 'keyframes', label: '关键帧' }]} /></UiFormRow>}
        <UiButton size="sm" variant="secondary" disabled={locked || !destinations.some(entry => entry.value === destination)} onClick={apply}>应用跟踪</UiButton>
      </UiGroup>
    </>}
    {(clip.kind === 'video' || clip.kind === 'sequence') && <VideoEditStabilizationControls projectId={projectId} sequenceId={sequenceId} clipId={clip.id} value={clip.stabilization} locked={Boolean(locked)} onError={onError} />}
  </div>
}

/** 防抖（PR 变形稳定器）：参数写在片段上，相机运动在后台分析，读回实际裁切比例。 */
function VideoEditStabilizationControls({ projectId, sequenceId, clipId, value, locked, onError }: { projectId: string; sequenceId: string; clipId: string; value: VideoEditClipStabilization | undefined; locked: boolean; onError: (error: unknown) => void }): React.ReactElement {
  const domain = useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const tracking = useSyncExternalStore(subscribeVideoEditTracking, videoEditTrackingRevision)
  const [readout, setReadout] = useState<VideoEditStabilizationReadout>({ state: 'off' })
  useEffect(() => {
    let current = true
    void readVideoEditStabilization(projectId, sequenceId, clipId).then(next => { if (current) setReadout(next) }, error => { if (current) onError(error) })
    return () => { current = false }
  }, [projectId, sequenceId, clipId, value, domain, tracking, onError])
  const write = (next: VideoEditClipStabilization | null): void => { try { setVideoEditClipStabilization(projectId, sequenceId, clipId, next) } catch (error) { onError(error) } }
  const params = value ?? VIDEO_EDIT_STABILIZATION_DEFAULTS
  return <UiGroup title="防抖" titleTone="compact" labelWidth={96} divided>
    <UiFormRow label="稳定画面" inline density="compact"><UiSwitch checked={Boolean(value)} disabled={locked} onCheckedChange={on => write(on ? { ...VIDEO_EDIT_STABILIZATION_DEFAULTS } : null)} /></UiFormRow>
    {value && <>
      <UiFormRow label="平滑程度" density="compact"><UiSegmented ariaLabel="平滑程度" size="sm" disabled={locked} value={params.smoothness} onChange={smoothness => write({ ...params, smoothness })} options={VIDEO_EDIT_STABILIZATION_SMOOTHNESS.map(option => ({ value: option, label: VIDEO_EDIT_STABILIZATION_SMOOTHNESS_LABELS[option].replace('（无运动）', '') }))} /></UiFormRow>
      <UiFormRow label="最大裁切 %" density="compact"><NumberInput ariaLabel="最大裁切百分比" value={Math.round(params.maxCrop * 100)} min={2} max={50} step={1} precision={0} disabled={locked} onChange={percent => write({ ...params, maxCrop: Math.max(2, Math.min(50, Math.round(percent))) / 100 })} /></UiFormRow>
      <UiFormRow label="校正旋转" inline density="compact"><UiSwitch checked={params.rotation} disabled={locked} onCheckedChange={rotation => write({ ...params, rotation })} /></UiFormRow>
      <UiFormRow label="校正缩放" inline density="compact"><UiSwitch checked={params.scale} disabled={locked} onCheckedChange={scale => write({ ...params, scale })} /></UiFormRow>
      {readout.state === 'failed' ? <UiError size="xs" title="防抖未完成" message={readout.message} /> : readout.state === 'analyzing' ? <UiLoading size="xs" message={`正在分析镜头运动 ${Math.round(readout.progress * 100)}%`} /> : readout.state === 'ready' ? <p role="status" className="text-xs text-text2">{`实际裁切 ${Math.round(readout.crop * 1000) / 10}%`}</p> : null}
    </>}
  </UiGroup>
}

export function VideoEditTrackingPanel(props: Parameters<typeof VideoEditTrackingPanelContent>[0]): React.ReactElement {
  return props.instance.activeSequenceId ? <VideoEditTrackingPanelContent {...props} /> : <UiEmpty className="h-full" title="没有序列" />
}
