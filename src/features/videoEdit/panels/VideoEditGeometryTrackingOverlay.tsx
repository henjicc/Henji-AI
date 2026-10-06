import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { videoEditClipPictureSize, videoEditClipToFrame, videoEditFrameToClip } from '@/core/videoEdit/clipGeometry'
import { VIDEO_EDIT_TRACK_METHOD_LABELS, videoEditCornerPinMatrix, invertVideoEditTrackMatrix, videoEditTrackProject, type VideoEditTrackGeometryRecord, type VideoEditTrackPrompt, type VideoEditTrackQuad } from '@/core/videoEdit/tracking'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { correctVideoEditTracker, editVideoEditTracker, readVideoEditTrackingGeometry, readVideoEditTrackingPlacement } from '../application/videoEditTrackingEdits'
import { getVideoEditTrackingEditing, setVideoEditTrackingEditing, subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision, type VideoEditTrackingEditing } from '../application/videoEditTrackingEditing'
import { getActiveVideoEditSequence, subscribeVideoEditDomain, subscribeVideoEditView, videoEditDomainRevision, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { subscribeVideoEditTracking, videoEditTrackingRevision } from '../application/videoEditTracking'
import { videoEditClipSourceTimeUs, videoEditClipTrackingQuad } from '../engine/videoEditTrackResults'

type Point = [number,number]
interface Drag { index:number; start:Point; points:Point[]; window?:'feature'|'search'; document:object; frame:number; editing:VideoEditTrackingEditing }

/** Point handles and AE feature/search boxes; planar corners share the same correction transaction. */
export function VideoEditGeometryTrackingOverlay({instance,onError}:{instance:VideoEditInstance;onError:(error:unknown)=>void}):React.ReactElement|null {
  useSyncExternalStore(subscribeVideoEditDomain,videoEditDomainRevision)
  useSyncExternalStore(subscribeVideoEditView,videoEditViewRevision)
  useSyncExternalStore(subscribeVideoEditTrackingEditing,videoEditTrackingEditingRevision)
  const revision=useSyncExternalStore(subscribeVideoEditTracking,videoEditTrackingRevision)
  const editing=getVideoEditTrackingEditing();const sequence=getActiveVideoEditSequence(instance)
  const clip=editing?.projectId===instance.document.id && editing.sequenceId===sequence.id && editing.clipId===instance.selection ? sequence.clips.find(c=>c.id===editing.clipId) : undefined
  const tracker=clip?.trackers?.find(t=>t.id===editing?.trackerId)
  const document=instance.document;const frame=instance.frame
  const [geometry,setGeometry]=useState<VideoEditTrackGeometryRecord>()
  const [placement,setPlacement]=useState<VideoEditClip>()
  const [draft,setDraft]=useState<Point[]>()
  const [windowDraft,setWindowDraft]=useState<VideoEditTrackPrompt['window']>()
  const [seeds,setSeeds]=useState<Point[]>([])
  const drag=useRef<Drag>()
  useEffect(()=> {
    setGeometry(undefined);setDraft(undefined);setSeeds([]);setWindowDraft(undefined)
    if(!clip || !editing) return
    let live=true
    void Promise.all([editing.trackerId ? readVideoEditTrackingGeometry(document.id,sequence.id,clip.id,editing.trackerId,frame) : undefined,readVideoEditTrackingPlacement(document.id,sequence.id,clip.id,frame)]).then(([value,position])=>{if(live){setGeometry(value);setPlacement(position)}},error=>{if(live)onError(error)})
    return ()=>{live=false}
  },[document,sequence.id,clip,editing,frame,revision,onError])
  if(!clip || !editing || instance.playing || frame<clip.start || frame>=clip.start+clip.duration) return null
  const picture=videoEditClipPictureSize(sequence,clip);const displayed=placement?.id===clip.id ? placement : clip
  const locked=sequence.tracks.find(t=>t.index===clip.track)?.locked
  const prompt=[...tracker?.prompts ?? []].sort((a,b)=>a.timeUs-b.timeUs).filter(p=>p.timeUs<=videoEditClipSourceTimeUs(sequence,clip,frame)).at(-1) ?? tracker?.prompts[0]
  const window=windowDraft ?? prompt?.window ?? {feature:.04,search:.2}
  const tracked=geometry?.quad ?? geometry?.points?.map(p=>[p[0],p[1]] as Point)
  const points=draft ?? tracked ?? (editing.mode==='show' ? prompt?.quad ?? prompt?.points?.map(p=>[p[0],p[1]] as Point) : seeds) ?? []
  const pinned=videoEditClipTrackingQuad(displayed);const matrix=pinned && videoEditCornerPinMatrix(pinned);const inverse=matrix && invertVideoEditTrackMatrix(matrix)
  const toFrame=(p:Point)=>{if(matrix){const [x,y]=videoEditTrackProject(matrix,p[0],p[1]);return {x,y}}return videoEditClipToFrame(displayed,picture,sequence,p[0],p[1])}
  const local=(event:PointerEvent<SVGSVGElement>):Point=> {
    const bounds=event.currentTarget.getBoundingClientRect();const x=(event.clientX-bounds.left)/bounds.width;const y=(event.clientY-bounds.top)/bounds.height
    const [u,v]=inverse ? videoEditTrackProject(inverse,x,y) : [undefined,undefined];const p=inverse ? {u:u!,v:v!} : videoEditFrameToClip(displayed,picture,sequence,x,y)
    return [Math.max(0,Math.min(1,p.u)),Math.max(0,Math.min(1,p.v))]
  }
  const commit=(next:Point[],nextWindow=window):void=> {
    const timeUs=videoEditClipSourceTimeUs(sequence,clip,frame)
    const value:VideoEditTrackPrompt={timeUs,...(editing.method==='point' ? {points:next.map(p=>[p[0],p[1],1] as [number,number,0|1]),window:nextWindow} : {quad:next as VideoEditTrackQuad})}
    try {
      let trackerId=editing.trackerId
      if(trackerId) correctVideoEditTracker(document.id,sequence.id,clip.id,trackerId,value)
      else {trackerId=crypto.randomUUID();editVideoEditTracker(document.id,sequence.id,clip.id,{id:trackerId,name:`${VIDEO_EDIT_TRACK_METHOD_LABELS[editing.method]} ${(clip.trackers?.length ?? 0)+1}`,method:editing.method,prompts:[value]})}
      setVideoEditTrackingEditing({...editing,trackerId,mode:'show'});setSeeds([])
    } catch(error){onError(error)}
  }
  const down=(event:PointerEvent<SVGSVGElement>):void=> {
    if(locked || event.button!==0) return
    const target=event.target as Element;const handle=target.closest('[data-tracking-handle]')
    if(editing.mode==='show' && !handle) return
    event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId)
    drag.current={index:Number(handle?.getAttribute('data-tracking-handle') ?? -1),start:local(event),points:points.map(p=>[...p]),window:handle?.getAttribute('data-tracking-window') as Drag['window'],document,frame,editing}
  }
  const updated=(active:Drag,end:Point):{points:Point[];window:NonNullable<VideoEditTrackPrompt['window']>}=> {
    const next=active.points.map(p=>[...p] as Point)
    if(active.window){const center=next[active.index];const value=Math.max(.01,Math.min(active.window==='feature'?.3:.8,Math.abs(end[0]-center[0])*2*picture.width/picture.height));return {points:next,window:active.window==='feature'?{feature:value,search:Math.max(window.search,value)}:{feature:window.feature,search:Math.max(window.feature,.02,value)}}}
    if(active.index>=0) next[active.index]=end
    return {points:next,window}
  }
  const move=(event:PointerEvent<SVGSVGElement>):void=>{const active=drag.current;if(!active || active.index<0)return;const next=updated(active,local(event));setDraft(next.points);setWindowDraft(next.window)}
  const up=(event:PointerEvent<SVGSVGElement>):void=> {
    const active=drag.current;drag.current=undefined;setDraft(undefined);setWindowDraft(undefined)
    if(!active || instance.document!==active.document || instance.frame!==active.frame || getVideoEditTrackingEditing()!==active.editing)return
    const end=local(event)
    if(active.index>=0){if(Math.hypot(end[0]-active.start[0],end[1]-active.start[1])<.001)return;const next=updated(active,end);commit(next.points,next.window);return}
    const next=[...seeds,end];const count=editing.method==='planar'?4:editing.pointCount ?? 1
    if(next.length===count)commit(next);else setSeeds(next)
  }
  const polygon=(vertices:Point[]):string=>vertices.map(p=>{const v=toFrame(p);return `${v.x*1000},${v.y*1000}`}).join(' ')
  const square=(center:Point,size:number):Point[]=>{const x=size*picture.height/picture.width/2;const y=size/2;return [[center[0]-x,center[1]-y],[center[0]+x,center[1]-y],[center[0]+x,center[1]+y],[center[0]-x,center[1]+y]]}
  return <div className="pointer-events-none absolute inset-0 z-raised" data-video-edit-tracking-overlay>
    {/* icon-token-allow 跟踪四角、特征内框与搜索框由画面坐标计算，是可编辑图形。 */}
    <svg className="h-full w-full text-accent-text" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="节目跟踪选择" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{drag.current=undefined;setDraft(undefined);setWindowDraft(undefined)}}>
      {editing.mode!=='show' && <rect width="1000" height="1000" fill="transparent" className="pointer-events-auto cursor-crosshair" />}
      {editing.method==='planar' && points.length>1 && <polyline points={polygon(points.length===4?[...points,points[0]]:points)} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      {points.map((p,index)=>{const v=toFrame(p);return <g key={index}>
        {editing.method==='point' && (['feature','search'] as const).map(kind=>{const corners=square(p,window[kind]);const handle=toFrame(corners[1]);return <g key={kind}>
          <polygon points={polygon(corners)} fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray={kind==='search'?'4 3':undefined} vectorEffect="non-scaling-stroke" />
          <circle cx={handle.x*1000} cy={handle.y*1000} r="4" fill="currentColor" className="pointer-events-auto cursor-ew-resize" data-tracking-handle={index} data-tracking-window={kind} aria-label={`跟踪点 ${index+1} ${kind==='feature'?'特征框':'搜索框'}`} />
        </g>})}
        <circle cx={v.x*1000} cy={v.y*1000} r="6" fill="currentColor" className="pointer-events-auto cursor-move" data-tracking-handle={index} aria-label={`${editing.method==='point'?'跟踪点':'平面角点'} ${index+1}`} />
      </g>})}
    </svg>
  </div>
}
