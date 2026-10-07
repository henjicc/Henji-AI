import { useState, useSyncExternalStore } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Plus, Square, Trash2, Eye, MousePointer2 } from 'lucide-react'
import { Dropdown, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiIconButton, UiInput, UiLoading, UiOptionButton, UiSwitch } from '@/components/ui'
import { VIDEO_EDIT_MAX_TRACKERS, VIDEO_EDIT_TRACK_METHOD_LABELS } from '@/core/videoEdit/tracking'
import { isShapesMask, videoEditMaskShapeName } from '@/core/videoEdit/effectMasks'
import { getActiveVideoEditSequence, subscribeVideoEditDomain, subscribeVideoEditView, videoEditDomainRevision, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { bindVideoEditTracking, editVideoEditTracker } from '../application/videoEditTrackingEdits'
import { getVideoEditTrackingEditing, setVideoEditTrackingEditing, subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision } from '../application/videoEditTrackingEditing'
import { runVideoEditTracking, stopVideoEditTracking, subscribeVideoEditTracking, videoEditTrackingFailureText, videoEditTrackingRequest, videoEditTrackingRevision, videoEditTrackingStatus, videoEditTrackingStatusText } from '../application/videoEditTracking'
import { updateVideoEditBuiltinEffect } from '../application/videoEditCompositing'

export function VideoEditTrackingPanel({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  useSyncExternalStore(subscribeVideoEditTracking, videoEditTrackingRevision)
  useSyncExternalStore(subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision)
  const [creation, setCreation] = useState('shape-point')
  const [destination, setDestination] = useState('')
  const [scale, setScale] = useState(false)
  const [pointCount, setPointCount] = useState('1')
  const sequence = getActiveVideoEditSequence(instance)
  const clip = sequence.clips.find(clip => clip.id === instance.selection)
  if (!clip || !['video', 'image', 'sequence'].includes(clip.kind)) return <UiEmpty title="选择视频、图片或嵌套片段" description="在节目画面上点选或框住要跟踪的物体。" />
  const projectId = instance.document.id; const sequenceId = sequence.id
  const editing = getVideoEditTrackingEditing()
  const selectedEditing = editing?.projectId === projectId && editing.sequenceId === sequenceId && editing.clipId === clip.id ? editing : null
  const tracker = clip.trackers?.find(tracker => tracker.id === selectedEditing?.trackerId) ?? clip.trackers?.[0]
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
    ...(tracker?.method === 'planar' ? sequence.clips.filter(entry => entry.id !== clip.id && (entry.kind === 'image' || entry.kind === 'video' || entry.kind === 'sequence')).map(entry => ({value:`pin:${entry.id}`,label:`角点贴合 · ${entry.name}`})) : []),
  ]
  const apply = (): void => {
    if (!tracker) return
    const [kind, id, shapeId] = destination.split(':')
    try {
      if (kind === 'effect') updateVideoEditBuiltinEffect(target, id, { mask: { regionId: 'tracker', trackerId: tracker.id } })
      else void bindVideoEditTracking(projectId, sequenceId, clip.id, tracker.id, kind === 'clip' || kind === 'pin' ? { clipId: id, scale, ...(kind === 'pin' ? {cornerPin:true} : {}) } : { effectId: id, shapeId }).catch(onError)
    } catch (error) { onError(error) }
  }
  return <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3" data-video-edit-tracking-panel>
    <div className="flex flex-wrap items-center gap-1">
      <Dropdown ariaLabel="新建跟踪方式" size="sm" value={creation} options={[{ value: 'shape-point', label: '形状 · 点选' }, { value: 'shape-box', label: '形状 · 框选' }, { value: 'box', label: '物体框 · 框选' }, {value:'point',label:'点 · 特征跟踪'}, {value:'planar',label:'平面 · 四角'}]} onSelect={setCreation} />
      <UiButton size="sm" variant="secondary" disabled={locked || (clip.trackers?.length ?? 0) >= VIDEO_EDIT_MAX_TRACKERS} onClick={() => setVideoEditTrackingEditing({ ...target, method: creation === 'point' ? 'point' : creation === 'planar' ? 'planar' : creation === 'box' ? 'box' : 'shape', mode: creation === 'planar' ? 'quad' : creation === 'point' || creation === 'shape-point' ? 'point' : 'box', pointCount:Number(pointCount) })}><Plus size={14} />新建</UiButton>
    </div>
    {creation === 'point' && <Dropdown ariaLabel="跟踪点数量" size="sm" value={pointCount} options={[1,2,3,4].map(n=>({value:String(n),label:`${n} 个点`}))} onSelect={setPointCount} />}
    {selectedEditing && selectedEditing.mode !== 'show' && <p className="text-xs text-text2" role="status">{selectedEditing.method === 'point' ? '依次点击要跟踪的特征点。' : selectedEditing.mode === 'quad' ? '沿屏幕或平面的边缘依次点击四角。' : selectedEditing.mode === 'point' ? '在节目画面上点击物体，选择合适的候选。' : '在节目画面上拖框选中物体。'}<UiButton size="sm" onClick={() => setVideoEditTrackingEditing(null)}>取消</UiButton></p>}
    {!clip.trackers?.length && !selectedEditing && <UiEmpty size="xs" title="尚无跟踪" description="新建跟踪后，在节目画面中选择物体。" />}
    <div className="flex flex-col gap-1" role="list" aria-label="片段跟踪器">
      {(clip.trackers ?? []).map(entry => <div key={entry.id} className="flex items-center gap-1" role="listitem">
        <UiOptionButton variant="menu" size="sm" className="min-w-0 flex-1" active={tracker?.id === entry.id} onClick={() => setVideoEditTrackingEditing({ ...target, trackerId: entry.id, method: entry.method, mode: 'show' })}><span className="truncate" title={entry.name}>{entry.name}</span></UiOptionButton>
        <UiIconButton size="xs" tone="danger" aria-label={`删除${entry.name}`} disabled={locked} onClick={() => { try { editVideoEditTracker(projectId, sequenceId, clip.id, { remove: entry.id }); setVideoEditTrackingEditing(null) } catch (error) { onError(error) } }}><Trash2 size={12} /></UiIconButton>
      </div>)}
    </div>
    {tracker && <>
      <UiInput key={tracker.id + tracker.name} size="sm" aria-label="跟踪名称" defaultValue={tracker.name} disabled={locked} onBlur={event => { if (event.target.value.trim() === tracker.name) return; try { editVideoEditTracker(projectId, sequenceId, clip.id, { ...tracker, name: event.target.value }) } catch (error) { onError(error) } }} />
      <p className="text-xs text-text3">{VIDEO_EDIT_TRACK_METHOD_LABELS[tracker.method]}</p>
      {status?.state === 'failed' ? <UiError size="xs" title="跟踪失败" message={videoEditTrackingFailureText(status.reason)} /> : status?.state === 'tracking' ? <UiLoading size="xs" message={`正在跟踪 ${Math.round(status.progress * 100)}%`} /> : <p role="status" className="text-xs text-text2">{status?.state === 'ready' ? `${status.stopped ? '已停止，' : ''}已覆盖 ${videoEditTrackingStatusText(status, request?.range).split(':')[1]}` : '等待跟踪'}</p>}
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="执行跟踪">
        <UiIconButton size="sm" aria-label="向后一帧" disabled={locked || status?.state === 'tracking'} onClick={() => run('backward', 1)}><ChevronLeft size={14} /></UiIconButton>
        <UiIconButton size="sm" aria-label="向后跟踪" disabled={locked || status?.state === 'tracking'} onClick={() => run('backward')}><ChevronsLeft size={14} /></UiIconButton>
        <UiIconButton size="sm" aria-label="停止跟踪" disabled={status?.state !== 'tracking'} onClick={() => { if (request) stopVideoEditTracking(request.definition) }}><Square size={14} /></UiIconButton>
        <UiIconButton size="sm" aria-label="向前跟踪" disabled={locked || status?.state === 'tracking'} onClick={() => run('forward')}><ChevronsRight size={14} /></UiIconButton>
        <UiIconButton size="sm" aria-label="向前一帧" disabled={locked || status?.state === 'tracking'} onClick={() => run('forward', 1)}><ChevronRight size={14} /></UiIconButton>
        <UiIconButton size="sm" aria-label="显示跟踪框" aria-pressed={selectedEditing?.mode === 'show'} on={selectedEditing?.mode === 'show'} onClick={() => selectedEditing?.mode === 'show' ? setVideoEditTrackingEditing(null) : show()}><Eye size={14} /></UiIconButton>
        {tracker.method === 'shape' && <UiIconButton size="sm" aria-label="补点纠错" disabled={locked} onClick={() => setVideoEditTrackingEditing({ ...target, trackerId: tracker.id, method: tracker.method, mode: 'point' })}><MousePointer2 size={14} /></UiIconButton>}
      </div>
      <UiGroup title="应用到" titleTone="compact">
        <Dropdown ariaLabel="跟踪应用目标" size="sm" value={destination} options={[{ value: '', label: '选择效果、遮罩或片段' }, ...destinations]} onSelect={setDestination} />
        {destination.startsWith('clip:') && <UiFormRow label="跟随缩放" inline density="compact"><UiSwitch checked={scale} onCheckedChange={setScale} /></UiFormRow>}
        <UiButton size="sm" variant="secondary" disabled={locked || !destinations.some(entry => entry.value === destination)} onClick={apply}>应用跟踪</UiButton>
      </UiGroup>
    </>}
  </div>
}
