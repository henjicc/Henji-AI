import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { PanelTrigger, UiButton, UiError } from '@/components/ui'
import { LayoutGrid } from 'lucide-react'
import { CreativeIntentControls } from '@/features/creativeIntent'
import { imageEditLayoutDraft } from '../application/imageEditLayoutDraft'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { useImageEditorSessionStoreV3 } from '../store'
import type { ImageEditorV3Controller } from './types'
import { findImageEditLayerLocationV3 } from './layerTreeV3'

const EMPTY: string[] = []
/** Both writable hosts use the document adapter and the existing shared candidate presentation. */
export function ImageEditorLayoutControlsV3({ bus, controller }: { bus:ImageEditCommandBusV3; controller:ImageEditorV3Controller }): JSX.Element | null {
  const adapter=useMemo(()=>imageEditLayoutDraft(bus),[bus])
  const state=useSyncExternalStore(adapter.subscribe,adapter.snapshot)
  const selected=useImageEditorSessionStoreV3(s=>s.sessions[controller.sessionId]?.selectedLayerIds??EMPTY)
  const [error,setError]=useState<string>()
  const [open,setOpen]=useState(false)
  const writable=controller.profile.id==='full'||controller.profile.id==='canvas-edit'
  const run=(work:()=>void|Promise<void>):void=>{setError(undefined);void Promise.resolve().then(work).catch(reason=>setError(reason instanceof Error?reason.message:String(reason)))}
  const draftId=controller.document.creativeIntents?.drafts.filter(d=>d.mode==='static').at(-1)?.id
  useEffect(()=>{if(open&&!state.draft&&draftId) run(()=>adapter.reopen(draftId))},[adapter,draftId,open,state.draft])
  if(!writable) return null
  return <PanelTrigger open={open} onOpenChange={value=>{setOpen(value);if(!value)adapter.cancel()}} alignment="bottomRight" surface="glass" panelPadding="content" panelWidth="content"
    renderPanel={()=> <div className="flex flex-col gap-3" data-image-layout-controls>
      <div className="text-xs text-text2">选中至少三个独立图层随手摆，再整理位置。字体、组和图层顺序保持原样。</div>
      <CreativeIntentControls profile="layout" status={state.status==='idle'&&selected.length>=3?'reviewing':state.status}
        candidates={state.candidates} selected={state.selected} fidelity={state.draft?.fidelity??0} needsSave={state.needsSave}
        pins={state.draft?.pins.map(p=>{
          const entry=state.entries.find(e=>e.sample.sampleId===p.sampleId)
          const layer=entry&&findImageEditLayerLocationV3(controller.document.layers,entry.layerId)?.layer
          return {id:p.id,label:layer?.name||'原稿位置'}
        })??[]}
        pinLabel="钉住所选图层的原稿位置" canPin={Boolean(state.draft&&selected.some(id=>state.entries.some(e=>e.layerId===id)))} message={state.message}
        onCancel={()=>adapter.cancel()} onOptimize={()=>run(()=>adapter.organize(selected.length>=3?selected:[]))} onApply={()=>run(()=>adapter.apply())}
        onPreview={id=>run(()=>adapter.preview(id))} onFidelity={fidelity=>run(()=>adapter.configure({fidelity}))}
        onPin={()=>run(()=>adapter.configure({pinIds:selected}))} onUnpin={unpin=>run(()=>adapter.configure({unpin}))}/>
      {error&&<UiError title="布局未完成" message={error} size="sm"/>}
    </div>}>
    {controls=><UiButton size="sm" onClick={controls.togglePanel} aria-expanded={controls.open}><LayoutGrid size={14}/>随手摆</UiButton>}
  </PanelTrigger>
}
