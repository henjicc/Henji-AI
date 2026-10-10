import { useMemo, useSyncExternalStore } from 'react'
import { CreativeIntentOverlay } from '@/features/creativeIntent'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { imageEditLayoutDraft } from '../application/imageEditLayoutDraft'
import { resolveAnnotationOutputGeometryV3 } from './annotationGeometryV3'

/** Static A/B uses the shared non-interactive overlay in output coordinates, after crop and orientation. */
export function ImageEditorLayoutOverlayV3({bus}:{bus:ImageEditCommandBusV3}):JSX.Element|null {
  const adapter=useMemo(()=>imageEditLayoutDraft(bus),[bus]),state=useSyncExternalStore(adapter.subscribe,adapter.snapshot)
  const {width,height}=resolveAnnotationOutputGeometryV3(bus.getSnapshot().document)
  if(state.selected==='original'||!state.candidates.length)return null
  const pins=new Set(state.draft?.pins.map(p=>p.sampleId))
  const ghosts=state.entries.map(entry=>{
    // Alpha support points preserve axis edges, and can repeat; they are not polygon vertices.
    const [left,top,right,bottom]=entry.item.worldCorners.reduce((box,p)=>[Math.min(box[0],p[0]),Math.min(box[1],p[1]),Math.max(box[2],p[0]),Math.max(box[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity])
    const center:[number,number]=[(left+right)/2,(top+bottom)/2]
    const corners=([[left,top],[right,top],[right,bottom],[left,bottom]] as const).map(p=>[p[0]/width,p[1]/height] as const)
    return {position:[center[0]/width,center[1]/height] as const,turns:0,scale:1,pinned:pins.has(entry.sample.sampleId),breakBefore:true,corners}
  })
  return <CreativeIntentOverlay ghosts={ghosts}/>
}
