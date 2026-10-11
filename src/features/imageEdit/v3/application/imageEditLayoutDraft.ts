import type { LayoutCandidate } from '@/core/creativeIntent/layout'
import { creativeIntentsSchema, creativeIntentLiveResources, type CreativeIntents, type StoredCreativeIntentResource } from '@/core/creativeIntent/persistence'
import { creativeIntentPageSchema } from '@/core/creativeIntent/pages'
import { motionDraftSchema, refKey, sameCandidateInput, type MotionDraft, type LayoutConstraint } from '@/core/creativeIntent/contracts'
import { imageLayoutPageSchema, imageLayoutCandidateSchema, imageLayoutIdentity, imageLayoutLocalChanges, type ImageLayoutEntry } from '@/core/imageEdit/v3/layoutDraft'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditLeafCommandV3 } from '@/core/imageEdit/v3/commandTypes'
import { createLogger } from '@/core/logging'
import type { ImageEditCommandBusV3, ImageEditPreviewOverrideV3 } from './imageEditCommandBus'
import { imageEditV3DocumentRef } from './imageEditDocumentRefs'
import { captureImageLayoutEntries, measureImageLayoutLayer, resolveImageLayoutParentAffine, type LayoutMeasure } from './imageEditLayoutGeometry'
import { ImageLayoutComputer, type ImageLayoutComputeInput } from './imageEditLayoutWorkerClient'
import { imageLayoutDigest, storeImageLayoutResource, readImageLayoutResource, releaseImageLayoutResources } from './imageEditLayoutResources'
import { findImageEditDocumentInstanceV3, leaseImageEditDocumentInstanceV3 } from './imageEditDocumentInstances'
import { findImageEditLayerLocationV3 } from '../editor/layerTreeV3'
import type { Affine } from '@/core/imaging/transforms'

const logger = createLogger('features.imageEdit.v3.layout')
const PAGE_ENTRIES = 64 // Per-page I/O/scheduling budget; the whole selection is processed.
export interface ImageLayoutState {
  status:'idle'|'reviewing'|'optimizing'; draft?:MotionDraft; entries:ImageLayoutEntry[];
  candidates:LayoutCandidate[]; selected:string; baseDigest:string; revision:number; message?:string; messageTone?:'status'|'error'; needsSave:boolean;
}
interface LayoutPorts {
  measure?:LayoutMeasure
  compute?:(input:ImageLayoutComputeInput,signal:AbortSignal)=>Promise<LayoutCandidate[]>
  store:typeof storeImageLayoutResource; read:typeof readImageLayoutResource
  confirm:()=>Promise<unknown>; release:(id:string)=>Promise<void>
}
function baseOf(document:ImageEditDocumentV3): unknown { return { geometry:document.geometry,color:document.color,layers:document.layers } }
/** Document-owned adapter. UI and the future P1-5 executor consume this same entry, never a second layout implementation. */
export class ImageEditLayoutDraft {
  private state:ImageLayoutState = { status:'idle',entries:[],candidates:[],selected:'original',baseDigest:'',revision:0,needsSave:false }
  private listeners = new Set<()=>void>()
  private abort?:AbortController
  private generation = 0
  private ownWrite = false
  private previews:string[] = []
  private resources:StoredCreativeIntentResource[] = []
  private pendingLeases = new Set<string>()
  constructor(private readonly bus:ImageEditCommandBusV3, private readonly ports:LayoutPorts) {
    const unsubscribe = bus.subscribe(snapshot => {
      if (this.ownWrite || snapshot.document.revision === this.state.revision || this.state.status === 'idle') return
      this.abort?.abort()
      const draft = snapshot.document.creativeIntents?.drafts.find(d => d.id === this.state.draft?.id)
      const samePages=draft&&JSON.stringify(draft.recipeRefs)===JSON.stringify(this.state.draft?.recipeRefs)
      const previousApplications=this.state.draft?.applications.length??0, applications=draft?.applications.length??0
      const message=applications<previousApplications?'已撤销布局':applications>previousApplications?'已重做布局':'图片已变化，请重新整理'
      this.update({ draft, status:draft?'reviewing':'idle', revision:snapshot.document.revision,selected:'original',candidates:[],baseDigest:samePages?this.state.baseDigest:'',message,messageTone:'status' })
      this.clearPreviews()
    })
    bus.getLifecycleSignal().addEventListener('abort',()=>{ this.abort?.abort(); unsubscribe(); this.clearPreviews(); this.listeners.clear(); void this.releasePending().catch(error => logger.warn('随手摆资源释放失败',{event:'image_edit.layout.release.failed',error})) },{once:true})
  }
  readonly snapshot = ():ImageLayoutState => this.state
  readonly subscribe = (listener:()=>void):(()=>void) => { this.listeners.add(listener); return ()=>this.listeners.delete(listener) }
  private update(patch:Partial<ImageLayoutState>):void { this.state={...this.state,...patch}; this.listeners.forEach(l=>l()) }
  private clearPreviews():void { const ids=this.previews; this.previews=[]; this.bus.replacePreviews(ids,[]) }
  cancel():void {
    const optimizing=this.state.status==='optimizing'
    this.abort?.abort();this.generation++;this.clearPreviews()
    const draft=this.bus.getSnapshot().document.creativeIntents?.drafts.find(d=>d.id===this.state.draft?.id)
    this.update({draft,status:draft?'reviewing':'idle',selected:'original',...(optimizing?{message:'已取消整理，原稿保留',messageTone:'status' as const}:{}),...(!draft?{entries:[],candidates:[],baseDigest:''}:{})})
  }
  private command(head:CreativeIntents, id:string):ImageEditLeafCommandV3 {
    const document=this.bus.getSnapshot().document
    const resources=creativeIntentLiveResources([document.creativeIntents,head]).map(r=>({resourceId:r.resourceId,byteSize:r.bytes})).sort((a,b)=>a.resourceId.localeCompare(b.resourceId))
    return { type:'document.set-creative-intents',commandId:id,expectedRevision:document.revision,intents:head,resources }
  }
  private head(draft:MotionDraft):CreativeIntents {
    const current=this.bus.getSnapshot().document.creativeIntents ?? {drafts:[],sessions:[],resources:[]}
    const byId=new Map([...current.resources,...this.resources].map(r=>[r.resourceId,r]))
    const next={...current,drafts:[...current.drafts.filter(d=>d.id!==draft.id),draft],resources:[...byId.values()]}
    next.resources=creativeIntentLiveResources([next])
    return creativeIntentsSchema.parse(next)
  }
  private persist(draft:MotionDraft):void {
    this.ownWrite=true
    try { const document=this.bus.dispatch(this.command(this.head(draft),createImageEditIdV3('layout-draft'))); this.update({draft,revision:document.revision,needsSave:true}) }
    finally {this.ownWrite=false}
  }
  private async confirm():Promise<void> {
    await this.ports.confirm(); this.update({needsSave:false}); await this.releasePending()
  }
  private async releasePending():Promise<void> { for (const lease of this.pendingLeases) { await this.ports.release(lease); this.pendingLeases.delete(lease) } }
  private async store(value:unknown,kind:StoredCreativeIntentResource['kind'],lease:string):Promise<StoredCreativeIntentResource> {
    const resource=await this.ports.store(value,kind,lease); this.resources.push(resource); return resource
  }
  async organize(ids:readonly string[],preferred=this.state.selected):Promise<void> {
    await this.organizeDraft(ids,preferred)
  }
  private async organizeDraft(ids:readonly string[],preferred:string,configured?:MotionDraft):Promise<void> {
    if(this.state.needsSave)throw new Error('请先重试保存，再继续整理')
    const previous=this.state,baseDocument=this.bus.getSnapshot().document
    this.cancel(); const abort=new AbortController(); this.abort=abort; const generation=++this.generation
    const releaseInstance=findImageEditDocumentInstanceV3(this.bus.getSnapshot().document.id)?.bus===this.bus ? leaseImageEditDocumentInstanceV3(this.bus.getSnapshot().document.id):()=>undefined
    const lease=createImageEditIdV3('layout-resources'), started=performance.now()
    this.pendingLeases.add(lease)
    let persisted = false
    this.update({status:'optimizing',message:undefined,messageTone:undefined})
    logger.info('开始整理图片布局',{event:'image_edit.layout.optimize.start'})
    try {
      let draft=configured??this.state.draft
      const document=baseDocument
      const digest=await imageLayoutDigest(baseOf(document))
      if (!draft || this.state.baseDigest!==digest || ids.length && ids.map(id=>id).sort().join('\0')!==this.state.entries.map(e=>e.layerId).sort().join('\0')) {
        const captured=await captureImageLayoutEntries(document,ids.length ? ids : this.state.entries.map(e=>e.layerId),abort.signal,this.ports.measure)
        const sourceDigest=await imageLayoutDigest(captured), take=createImageEditIdV3('layout-take')
        const ownerRef=imageEditV3DocumentRef(document.id)
        const entries:ImageLayoutEntry[]=captured.map((e,i)=>({...e,sample:{seq:i,monoUs:i,timeline:null,unavailableReason:'static',clockSegmentRef:'static',sampleId:`${take}:${i}`,takeRef:take,targetRef:e.item.targetRef,
          pose:{position:[e.item.affine[4]/document.geometry.width,e.item.affine[5]/document.geometry.height],rotationTurns:Math.atan2(e.item.affine[1],e.item.affine[0])/(2*Math.PI),scaleXY:[Math.hypot(e.item.affine[0],e.item.affine[1]),Math.hypot(e.item.affine[2],e.item.affine[3])],pivot:[.5,.5]},gestureKind:'place',quality:'presented',confirmed:true,event:'up'}}))
        this.resources=[]; const samplePages:MotionDraft['takes'][number]['samplePages']=[], recipeRefs:MotionDraft['recipeRefs']=[]
        for(let start=0;start<entries.length;start+=PAGE_ENTRIES) {
          abort.signal.throwIfAborted(); const pageEntries=entries.slice(start,start+PAGE_ENTRIES)
          const resource=await this.store(imageLayoutPageSchema.parse({version:1,kind:'image-layout',ownerRef,sourceDigest,baseDigest:digest,entries:pageEntries}),'recipe',lease)
          recipeRefs.push({resourceId:resource.resourceId,digest:resource.digest,bytes:resource.bytes})
          const page=creativeIntentPageSchema.parse({version:1,kind:'samples',ownerRef,sourceDigest,count:pageEntries.length,monoSpanUs:[start,start+pageEntries.length-1],seqSpan:[start,start+pageEntries.length-1],entries:pageEntries.map(e=>e.sample)})
          const sample=await this.store(page,'page',lease)
          samplePages.push({resourceId:sample.resourceId,digest:sample.digest,bytes:sample.bytes,kind:'samples',count:page.count,monoSpanUs:page.monoSpanUs,seqSpan:page.seqSpan})
        }
        const targets=await Promise.all(entries.map(async e=>({ref:e.item.targetRef,ownerRef,editable:['position','rotationTurns','scaleXY','pivot'] as const,basePose:e.sample.pose,
          baseDigest:await imageLayoutDigest(e.localAffine),geometryDigest:await imageLayoutDigest([e.parentAffine,e.item.worldCorners]),compositionSize:[document.geometry.width,document.geometry.height]})))
        // 0 means fully arrange positions; 1 preserves the original placement. Pixel quality is unchanged.
        draft=motionDraftSchema.parse({id:createImageEditIdV3('layout'),version:1,ownerRef,mode:'static',label:'随手摆',fidelity:0,sourceDigest,targets,
          clockSegments:[{id:'static',monoSpanUs:[0,Math.max(1,entries.length)],mode:'hold',start:null,end:null,anchors:[]}],
          takes:[{id:take,intent:'demonstrate',pathDemonstration:false,placement:true,monoSpanUs:[0,entries.length],direction:0,visitRef:null,timelineRange:null,samplePages,geometryDigest:sourceDigest}],pins:[],constraints:[],recipeRefs,candidateRefs:[],applications:[]})
        this.update({entries,baseDigest:digest,draft})
      }
      abort.signal.throwIfAborted()
      if(generation!==this.generation || this.bus.getSnapshot().document!==document) throw new Error('图片已变化，请重新整理')
      const pinned=new Set(draft.pins.filter(p=>p.valueLocked).map(p=>p.sampleId))
      const items=this.state.entries.map(e=>({...e.item,translationLocked:e.item.translationLocked||pinned.has(e.sample.sampleId)}))
      const bounds=items.map(i=>({x:Math.min(...i.worldCorners.map(p=>p[0])),y:Math.min(...i.worldCorners.map(p=>p[1]))}))
      const extent=bounds.reduce((box,b)=>[Math.min(box[0],b.x),Math.min(box[1],b.y),Math.max(box[2],b.x),Math.max(box[3],b.y)],[Infinity,Infinity,-Infinity,-Infinity])
      const horizontal=extent[2]-extent[0]>=extent[3]-extent[1]
      const order=items.map((_,i)=>i).sort((a,b)=>horizontal?bounds[a].x-bounds[b].x:bounds[a].y-bounds[b].y)
      const targets=order.map(i=>items[i].targetRef), reference=items.find(i=>i.translationLocked)?.targetRef ?? targets[0]
      const constraints:LayoutConstraint[]=[...draft.constraints,{kind:'align',id:'edge',strength:'soft',sourceRefs:[],axis:horizontal?'y':'x',edge:'start',targets,reference},
        {kind:'distribute',id:'spacing',strength:'soft',sourceRefs:[],axis:horizontal?'x':'y',targets}]
      const identity=imageLayoutIdentity(draft.sourceDigest,draft.ownerRef,draft.targets.map(t=>({targetRef:t.ref,baseDigest:t.baseDigest,geometryDigest:t.geometryDigest})),draft.fidelity)
      if(!this.ports.compute) throw new Error('暂时无法整理布局，请重新打开图片后重试')
      const candidates=await this.ports.compute({items,constraints,identity,fidelity:draft.fidelity},abort.signal)
      for(const candidate of candidates) {imageLayoutCandidateSchema.parse({...candidate,version:1});imageLayoutLocalChanges(this.lockedEntries(),candidate)}
      abort.signal.throwIfAborted()
      const refs:MotionDraft['candidateRefs']=[]
      for(const candidate of candidates) {const resource=await this.store(imageLayoutCandidateSchema.parse({...candidate,version:1}),'candidate',lease); refs.push({resourceId:resource.resourceId,digest:resource.digest,bytes:resource.bytes})}
      if(generation!==this.generation || this.bus.getSnapshot().document!==document) throw new Error('图片已变化，请重新整理')
      const chosen=candidates.findIndex(c=>c.id===preferred),selected=Math.max(0,chosen)
      draft={...draft,candidateRefs:refs,selectedCandidateRef:refs[selected]?.resourceId}
      this.persist(draft); persisted = true; this.update({candidates,status:'reviewing',selected:candidates[selected]?.id??'original',message:candidates.length<2?'当前设置下只有一种布局':undefined,messageTone:'status'})
      this.preview(this.state.selected)
      performance.measure('image-layout-candidate-generation', { start: started, end: performance.now() })
      performance.clearMeasures('image-layout-candidate-generation')
      await this.confirm()
      logger.info('图片布局候选已完成',{event:'image_edit.layout.optimize.completed',context:{layers:items.length,candidateMs:performance.now()-started,candidates:candidates.length}})
    } catch(error) {
      if(generation===this.generation) this.update({...(!persisted?{...previous,candidates:[],selected:'original',baseDigest:this.bus.getSnapshot().document===baseDocument?previous.baseDigest:''}:{}),status:(persisted?this.state.draft:previous.draft)?'reviewing':'idle',message:abort.signal.aborted?'已取消整理，原稿保留':error instanceof Error?error.message:String(error),messageTone:abort.signal.aborted?'status':'error'})
      logger.warn('图片布局整理未完成',{event:'image_edit.layout.optimize.failed',error}); throw error
    } finally { try {if(!persisted || !this.state.needsSave) {await this.ports.release(lease);this.pendingLeases.delete(lease)}} finally {releaseInstance()} }
  }
  preview(id:string):void {
    const candidate=this.state.candidates.find(c=>c.id===id)
    if(id!=='original'&&!candidate) throw new Error('布局候选不存在，请重新整理')
    const document=this.bus.getSnapshot().document
    const previews:ImageEditPreviewOverrideV3[]=[]
    if(id==='original'&&this.state.entries.length) {
      for(const entry of this.state.entries) {
        const location=findImageEditLayerLocationV3(document.layers,entry.layerId)
        if(location&&location.layer.transform.some((v,i)=>v!==entry.localAffine[i])) {
          const preview=createImageEditIdV3('layout-original')
          previews.push({id:preview,kind:'transform',targetId:entry.layerId,baseRevision:document.revision,value:entry.localAffine,quality:'stable'})
        }
      }
    }
    if(candidate) {
      if(document.revision!==this.state.revision) throw new Error('布局候选已过期，请重新整理')
      for(const change of this.candidateChanges(candidate)) {const preview=createImageEditIdV3('layout-preview'); previews.push({id:preview,kind:'transform',targetId:change.layerId,baseRevision:document.revision,value:change.transform,quality:'stable'})}
    }
    this.bus.replacePreviews(this.previews,previews);this.previews=previews.map(preview=>preview.id)
    this.update({selected:id})
  }
  private lockedEntries():ImageLayoutEntry[] {
    const pinned=new Set(this.state.draft?.pins.filter(p=>p.valueLocked).map(p=>p.sampleId))
    return this.state.entries.map(e=>({...e,item:{...e.item,translationLocked:e.item.translationLocked||pinned.has(e.sample.sampleId)}}))
  }
  private candidateChanges(candidate:LayoutCandidate):{layerId:string;transform:Affine}[] {
    const desired=new Map(imageLayoutLocalChanges(this.lockedEntries(),candidate).map(change=>[change.layerId,change.transform]))
    const document=this.bus.getSnapshot().document
    // A reopened applied draft compares every absolute pose with the live work, including zero original deltas.
    return this.state.entries.flatMap(entry=>{
      const transform=desired.get(entry.layerId)??entry.localAffine,live=findImageEditLayerLocationV3(document.layers,entry.layerId)
      if(!live)throw new Error('布局目标已删除，请重新整理')
      return live.layer.transform.some((v,i)=>v!==transform[i])?[{layerId:entry.layerId,transform}]:[]
    })
  }
  async configure(options:{fidelity?:number;pinIds?:readonly string[];unpin?:string}):Promise<void> {
    if(this.state.needsSave)throw new Error('请先重试保存，再调整布局')
    const draft=this.state.draft
    if(!draft) throw new Error('请先整理随手摆原稿')
    const preferred=this.state.selected
    this.cancel()
    const pins=draft.pins.filter(p=>p.id!==options.unpin)
    for(const id of options.pinIds??[]) {
      const entry=this.state.entries.find(e=>e.layerId===id)
      if(entry&&!pins.some(p=>p.sampleId===entry.sample.sampleId)) pins.push({id:createImageEditIdV3('layout-pin'),sampleId:entry.sample.sampleId,targetRef:entry.item.targetRef,properties:['position','rotationTurns','scaleXY','pivot'],valueLocked:true,timeLocked:false})
    }
    const updated=motionDraftSchema.parse({...draft,pins,fidelity:options.fidelity??draft.fidelity,candidateRefs:[],selectedCandidateRef:undefined})
    updated.sourceDigest=await imageLayoutDigest({pages:updated.takes.flatMap(t=>t.samplePages),recipes:updated.recipeRefs,pins,fidelity:updated.fidelity})
    // 一次停手只保存完整的新候选，避免先落盘空候选，再为同一设置保存第二遍。
    await this.organizeDraft([],preferred,updated)
  }
  async apply():Promise<void> {
    if(this.state.needsSave) {await this.confirm();this.update({message:'布局已保存',messageTone:'status'}); return}
    const draft=this.state.draft,candidate=this.state.candidates.find(c=>c.id===this.state.selected)
    if(!draft||!candidate) throw new Error('请先选择整理候选')
    const document=this.bus.getSnapshot().document
    if(await imageLayoutDigest(baseOf(document))!==this.state.baseDigest) throw new Error('图片已变化，请重新整理')
    const identity=imageLayoutIdentity(draft.sourceDigest,draft.ownerRef,draft.targets.map(t=>({targetRef:t.ref,baseDigest:t.baseDigest,geometryDigest:t.geometryDigest})),draft.fidelity)
    if(!sameCandidateInput(candidate.identity,identity)||document!==this.bus.getSnapshot().document) throw new Error('布局候选已过期，请重新整理')
    const changes=this.candidateChanges(candidate), commandId=createImageEditIdV3('layout-apply')
    const index=this.state.candidates.findIndex(c=>c.id===candidate.id), candidateRef=draft.candidateRefs[index]?.resourceId
    if(!candidateRef) throw new Error('候选资源缺失，请重新整理')
    const applied={...draft,selectedCandidateRef:candidateRef,applications:[...draft.applications,{candidateRef,operationRef:{kind:'creative_intent.application',id:commandId},receiptRef:draft.ownerRef,saved:false}]}
    const commands:ImageEditLeafCommandV3[]=changes.map(change=>({type:'layer.update-common',commandId:createImageEditIdV3('layout-layer'),expectedRevision:document.revision,layerId:change.layerId,patch:{transform:[...change.transform]}}))
    commands.push(this.command(this.head(applied),createImageEditIdV3('layout-result')))
    this.clearPreviews(); this.ownWrite=true
    try {const next=this.bus.dispatch({type:'document.atomic',commandId,expectedRevision:document.revision,commands}); this.update({draft:applied,revision:next.revision,candidates:[],selected:'original',needsSave:true})}
    finally {this.ownWrite=false}
    await this.confirm()
    this.update({message:'已应用，可撤销',messageTone:'status'})
    logger.info('图片布局已应用',{event:'image_edit.layout.apply.completed',context:{commandId,layers:changes.length}})
  }
  async reopen(draftId:string):Promise<void> {
    this.cancel(); const document=this.bus.getSnapshot().document,head=document.creativeIntents
    const draft=head?.drafts.find(d=>d.id===draftId)
    if(!draft||draft.mode!=='static') throw new Error('随手摆原稿不存在')
    const entries:ImageLayoutEntry[]=[]
    let originalBase:string|undefined
    for(const ref of draft.recipeRefs) {
      const resource=head!.resources.find(r=>r.resourceId===ref.resourceId)
      if(!resource||resource.digest!==ref.digest||resource.bytes!==ref.bytes) throw new Error('原稿几何页目录损坏')
      const page=imageLayoutPageSchema.parse(await this.ports.read(resource))
      if(refKey(page.ownerRef)!==refKey(draft.ownerRef)||page.sourceDigest!==resource.sourceDigest) throw new Error('原稿几何页归属不符')
      entries.push(...page.entries)
      if(originalBase&&originalBase!==page.baseDigest)throw new Error('原稿几何页基态不一致')
      originalBase=page.baseDigest
    }
    if(new Set(entries.map(e=>e.layerId)).size!==entries.length||entries.length!==draft.targets.length) throw new Error('原稿几何页目标重复或缺失')
    for(const pin of draft.pins) if(!entries.some(e=>e.sample.sampleId===pin.sampleId&&refKey(e.item.targetRef)===refKey(pin.targetRef))) throw new Error('钉住点与原稿不符')
    const original=structuredClone(document)
    for(const entry of entries) {
      const location=findImageEditLayerLocationV3(original.layers,entry.layerId),target=draft.targets.find(t=>refKey(t.ref)===refKey(entry.item.targetRef))
      if(!location||!target||await imageLayoutDigest(entry.localAffine)!==target.baseDigest||await imageLayoutDigest([entry.parentAffine,entry.item.worldCorners])!==target.geometryDigest)throw new Error('原稿目标或完整几何损坏')
      if(resolveImageLayoutParentAffine(original,location.ancestors).some((v,i)=>Math.abs(v-entry.parentAffine[i])>1e-8))throw new Error('原稿父坐标与图片裁剪或祖先变换不符')
      location.layer.transform=[...entry.localAffine]
    }
    if(await imageLayoutDigest(baseOf(original))!==originalBase)throw new Error('图片内容已变化，原稿仍保留，请重新选择图层整理')
    const samples=entries.map(e=>e.sample)
    let offset=0
    for(const take of draft.takes)for(const ref of take.samplePages) {
      const resource=head!.resources.find(r=>r.resourceId===ref.resourceId)
      if(!resource)throw new Error('原稿样本页缺失')
      const page=creativeIntentPageSchema.parse(await this.ports.read(resource))
      if(page.kind!=='samples'||refKey(page.ownerRef)!==refKey(draft.ownerRef)||page.sourceDigest!==resource.sourceDigest||page.count!==ref.count||JSON.stringify(page.entries)!==JSON.stringify(samples.slice(offset,offset+ref.count)))throw new Error('原稿样本页乱序、缺失或与几何页不符')
      offset+=ref.count
    }
    if(offset!==entries.length)throw new Error('原稿样本页数量不符')
    const identity=imageLayoutIdentity(draft.sourceDigest,draft.ownerRef,draft.targets.map(t=>({targetRef:t.ref,baseDigest:t.baseDigest,geometryDigest:t.geometryDigest})),draft.fidelity)
    const candidates:LayoutCandidate[]=[]
    const locked=new Set(draft.pins.filter(p=>p.valueLocked).map(p=>p.sampleId))
    for(const ref of draft.candidateRefs) {
      const resource=head!.resources.find(r=>r.resourceId===ref.resourceId)
      if(!resource)throw new Error('候选资源缺失，请恢复原文件')
      const candidate=imageLayoutCandidateSchema.parse(await this.ports.read(resource))
      if(!sameCandidateInput(candidate.identity,identity)||candidates.some(c=>c.id===candidate.id))throw new Error('候选身份过期或重复，请重新整理')
      imageLayoutLocalChanges(entries.map(e=>({...e,item:{...e.item,translationLocked:e.item.translationLocked||locked.has(e.sample.sampleId)}})),candidate)
      candidates.push(candidate)
    }
    const index=draft.candidateRefs.findIndex(r=>r.resourceId===draft.selectedCandidateRef)
    const baseDigest=await imageLayoutDigest(baseOf(document))
    if(document!==this.bus.getSnapshot().document) throw new Error('图片已变化，请重试读取原稿')
    this.resources=[];this.update({draft,entries,candidates,selected:candidates[index]?.id??'original',status:'reviewing',baseDigest,revision:document.revision,message:undefined,needsSave:false})
    this.preview(this.state.selected)
  }
}
const adapters=new WeakMap<ImageEditCommandBusV3,ImageEditLayoutDraft>()
export function imageEditLayoutDraft(bus:ImageEditCommandBusV3):ImageEditLayoutDraft {
  let adapter=adapters.get(bus)
  if(!adapter) {const computer=new ImageLayoutComputer();bus.getLifecycleSignal().addEventListener('abort',()=>computer.dispose(),{once:true})
    adapter=new ImageEditLayoutDraft(bus,{store:storeImageLayoutResource,read:readImageLayoutResource,
    measure:(document,layer,signal,matrix)=>measureImageLayoutLayer(document,layer,signal,matrix,bus.getResourceByteSizes()),
    compute:(input,signal)=>computer.compute(input,signal),
    confirm:async()=>{const owner=findImageEditDocumentInstanceV3(bus.getSnapshot().document.id)?.persistenceOwner;if(!owner) throw new Error('图片暂时无法保存，请重试保存');return owner.confirm(true)},
    release:releaseImageLayoutResources});adapters.set(bus,adapter)}
  return adapter
}
