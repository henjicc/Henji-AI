import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { createImageEditDocumentV3, createImageEditRasterLayerV3, createImageEditGroupLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { decodeImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences'
import { createImageLayoutCandidates } from '@/core/imageEdit/v3/layoutCandidates'
import type { StoredCreativeIntentResource } from '@/core/creativeIntent/persistence'
import { imageLayoutDigest } from './imageEditLayoutResources'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { ImageEditLayoutDraft } from './imageEditLayoutDraft'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { captureImageLayoutEntries, type LayoutMeasure } from './imageEditLayoutGeometry'

beforeEach(()=>{vi.stubGlobal('crypto',webcrypto)})
const measure:LayoutMeasure=async(_document,layer)=>{const w=layer.id==='a'?120:layer.id==='b'?70:35;return [[0,0],[w,0],[w,40],[0,40]]}
function document():ImageEditDocumentV3 {
  const doc=createImageEditDocumentV3({documentId:'layout-test',width:1000,height:600})
  doc.layers=['a','b','c'].map((id,i)=>({...createImageEditRasterLayerV3(id,id),transform:[1,0,0,1,[15,240,480][i],[60,83,47][i]]}))
  return doc
}
function setup(doc=document()) {
  const values=new Map<string,unknown>(),confirmed=vi.fn(async()=>undefined),released=vi.fn(async()=>undefined)
  const bus=new ImageEditCommandBusV3(doc)
  const adapter=new ImageEditLayoutDraft(bus,{measure,compute:async input=>createImageLayoutCandidates(input.items,input.constraints,input.identity,input.fidelity),confirm:confirmed,release:released,
    store:async(value,kind)=>{const id=await imageLayoutDigest(value);values.set(id,structuredClone(value));return {resourceId:id,digest:id,path:`resources/${id.slice(7)}`,bytes:new TextEncoder().encode(JSON.stringify(value)).byteLength,kind,...(value&&typeof value==='object'&&'sourceDigest'in value?{sourceDigest:String(value.sourceDigest)}:{})}},
    read:async(resource:StoredCreativeIntentResource)=>{if(!values.has(resource.resourceId))throw new Error('missing');return values.get(resource.resourceId)}})
  return {bus,adapter,values,confirmed,released}
}
describe('随手摆正式文档适配',()=>{
  it('S13 合成先验：边缘等距、完整预览隔离、原子应用一次撤销、原稿与资源存活',async()=>{
    const ordinary=`sha256:${'f'.repeat(64)}`
    expect(collectImageEditJsonResourceIdsV3({params:{intents:[ordinary]}})).toEqual([ordinary])
    expect(collectImageEditJsonResourceIdsV3({params:{creativeIntents:[ordinary]}})).toEqual([ordinary])
    const {bus,adapter,confirmed}=setup();const initial=structuredClone(bus.getSnapshot().document)
    await adapter.organize(['a','b','c'])
    expect(adapter.snapshot().candidates.length).toBeGreaterThanOrEqual(2)
    const candidates=adapter.snapshot().candidates,spacing=candidates.find(c=>c.id==='distribute')!
    const entries=adapter.snapshot().entries
    const edges=spacing.changes.map((c,i)=>({left:Math.min(...entries[i].item.worldCorners.map(p=>p[0]))+c.delta[0],right:Math.max(...entries[i].item.worldCorners.map(p=>p[0]))+c.delta[0]}))
    expect(edges[1].left-edges[0].right).toBeCloseTo(edges[2].left-edges[1].right,7)
    const before=bus.getSnapshot().document,history=bus.getSnapshot().history.undoCount
    adapter.preview('distribute');adapter.preview('align');adapter.preview('distribute')
    expect(bus.getSnapshot().document).toBe(before)
    expect(Object.keys(bus.getSnapshot().previewOverrides).length).toBeLessThanOrEqual(3)
    await adapter.apply()
    expect(bus.getSnapshot().history.undoCount).toBe(history+1)
    expect(bus.getPersistenceSnapshot().history.undo.at(-1)?.forward.type).toBe('document.atomic')
    const applied=structuredClone(bus.getSnapshot().document.layers)
    expect(applied).not.toEqual(initial.layers)
    expect(confirmed).toHaveBeenCalledTimes(2)
    expect(bus.undo()).toBe(true);expect(bus.getSnapshot().document.layers).toEqual(initial.layers)
    expect(bus.redo()).toBe(true);expect(bus.getSnapshot().document.layers).toEqual(applied)
    const snapshot=bus.getPersistenceSnapshot()
    expect(()=>decodeImageEditCommandHistorySnapshotV3(snapshot.history)).not.toThrow()
    const refs=collectImageEditJsonResourceIdsV3(snapshot)
    expect(refs).toContain(snapshot.document.creativeIntents!.drafts[0].recipeRefs[0].resourceId)
    expect(refs).not.toContain(snapshot.document.creativeIntents!.drafts[0].sourceDigest)
  })
  it('嵌套祖先、非均匀仿射、裁剪/镜像、组与子图层去重及锁层',async()=>{
    const doc=document(),group=createImageEditGroupLayerV3('g','组')
    group.transform=[2,.2,.5,.7,31,29];group.children=[doc.layers[0]];doc.layers=[group,...doc.layers.slice(1)]
    doc.layers[1].locked=true;doc.layers[2].transform=[-1,.3,.2,2,480,47]
    doc.geometry.orientation={rotate:90,mirrored:true};doc.geometry.crop={x:7,y:15,width:400,height:650}
    const {bus,adapter}=setup(doc);await adapter.organize(['a','b','c'])
    const linear=doc.layers[2].transform.slice(0,4)
    await adapter.apply()
    expect(bus.getSnapshot().document.layers[2].transform.slice(0,4)).toEqual(linear)
    expect(bus.getSnapshot().document.layers[1]).toEqual(doc.layers[1])
    expect(bus.getSnapshot().document.layers[0].type).toBe('group')
    expect(bus.undo()).toBe(true);expect(bus.getSnapshot().document.layers).toEqual(doc.layers)
    const dedup=await captureImageLayoutEntries(doc,['g','a','b','c'],new AbortController().signal,measure)
    expect(dedup.map(e=>e.layerId)).toEqual(['g','b','c'])
    group.mask={kind:'sparse-mask',storage:'mask-float32',maskId:'ancestor-mask',tileSize:512,defaultValue:1,tiles:{},inverted:false}
    await expect(captureImageLayoutEntries(doc,['a','b','c'],new AbortController().signal,measure)).rejects.toThrow('蒙版')
    group.mask=null;doc.layers[1].clipping=true
    await expect(captureImageLayoutEntries(doc,['a','b','c'],new AbortController().signal,measure)).rejects.toThrow('剪贴')
  })
  it('锁定原稿位置、资源页重开并且 A/B 不叠加',async()=>{
    const {bus,adapter,values,confirmed,released}=setup()
    await adapter.organize(['a','b','c']);await adapter.configure({pinIds:['b']})
    expect(adapter.snapshot().candidates.every(c=>c.changes.find(v=>v.targetRef.id.endsWith(':b'))!.delta.every(n=>n===0))).toBe(true)
    const id=adapter.snapshot().draft!.id
    const reopened=new ImageEditLayoutDraft(bus,{measure,compute:async input=>createImageLayoutCandidates(input.items,input.constraints,input.identity,input.fidelity),confirm:confirmed,release:released,store:async()=>{throw new Error('not writing')},read:async r=>values.get(r.resourceId)})
    await reopened.reopen(id)
    expect(reopened.snapshot().entries).toEqual(adapter.snapshot().entries)
    expect(reopened.snapshot().draft!.pins).toEqual(adapter.snapshot().draft!.pins)
    const resource=adapter.snapshot().draft!.recipeRefs[0].resourceId;values.set(resource,{broken:true})
    await expect(reopened.reopen(id)).rejects.toThrow()
  })
  it('重开已应用原稿后切换零位移候选，预览与应用仍恢复其绝对原稿位置',async()=>{
    const doc=document();doc.layers.forEach(layer=>{const m=layer.transform;layer.transform=[m[0],m[1],m[2],m[3],m[4],60]})
    const {bus,adapter,values,confirmed,released}=setup(doc)
    await adapter.organize(['a','b','c']);adapter.preview('distribute');await adapter.apply()
    const applied=structuredClone(bus.getSnapshot().document.layers)
    expect(applied).not.toEqual(doc.layers)
    const reopened=new ImageEditLayoutDraft(bus,{measure,compute:async input=>createImageLayoutCandidates(input.items,input.constraints,input.identity,input.fidelity),confirm:confirmed,release:released,store:async()=>{throw new Error('not writing')},read:async r=>values.get(r.resourceId)})
    await reopened.reopen(bus.getSnapshot().document.creativeIntents!.drafts[0].id)
    const aligned=reopened.snapshot().candidates.find(c=>c.id==='align')!
    expect(aligned.changes.every(c=>c.delta.every(v=>v===0))).toBe(true)
    reopened.preview('align')
    for(const layer of doc.layers){const preview=Object.values(bus.getSnapshot().previewOverrides).find(p=>p.targetId===layer.id);expect(preview?.value??applied.find(l=>l.id===layer.id)!.transform).toEqual(layer.transform)}
    expect(bus.getSnapshot().document.layers).toEqual(applied)
    await reopened.apply();expect(bus.getSnapshot().document.layers).toEqual(doc.layers)
    expect(bus.undo()).toBe(true);expect(bus.getSnapshot().document.layers).toEqual(applied)
  })
  it('保存失败保留资源，重试只保存，不重做应用；过期和奇异矩阵拒绝',async()=>{
    const {bus,adapter,confirmed,released}=setup();await adapter.organize(['a','b','c'])
    confirmed.mockRejectedValueOnce(new Error('disk full'))
    await expect(adapter.apply()).rejects.toThrow('disk full')
    const revision=bus.getSnapshot().document.revision
    await adapter.apply();expect(bus.getSnapshot().document.revision).toBe(revision)
    expect(released).toHaveBeenCalled()
    bus.dispatch({type:'layer.update-common',layerId:'a',commandId:'manual',expectedRevision:revision,patch:{transform:[1,0,0,1,22,15]}})
    await expect(adapter.apply()).rejects.toThrow()
    const singular=document();singular.layers[0].transform=[1,2,2,4,0,0]
    await expect(setup(singular).adapter.organize(['a','b','c'])).rejects.toThrow()
  })
  it('S18：1000 层分页不设产品上限，覆盖最后一个目标',async()=>{
    const doc=document();doc.layers=Array.from({length:1000},(_,i)=>({...createImageEditRasterLayerV3(`l${i}`,`层${i}`),transform:[1,0,0,1,i*200,(i%3)*18]}))
    const {adapter,bus}=setup(doc)
    await adapter.organize(doc.layers.map(l=>l.id))
    expect(adapter.snapshot().draft!.takes[0].samplePages).toHaveLength(16)
    expect(adapter.snapshot().entries).toHaveLength(1000)
    expect(adapter.snapshot().candidates.every(c=>c.changes.at(-1)?.targetRef.id.endsWith(':l999'))).toBe(true)
    adapter.cancel();expect(Object.keys(bus.getSnapshot().previewOverrides)).toHaveLength(0)
  })
  it('S14：不同位置硬钉点与硬对齐冲突拒绝，移除冲突后可恢复且不丢原稿',async()=>{
    const doc=document();doc.layers[0].locked=true;doc.layers[1].locked=true
    const {bus,adapter}=setup(doc);await adapter.organize(['a','b','c'])
    const original=adapter.snapshot().draft!,head=structuredClone(bus.getSnapshot().document.creativeIntents!)
    head.drafts[0].constraints=[{id:'conflicting-pins',kind:'align',strength:'hard',sourceRefs:[],axis:'y',edge:'start',targets:original.targets.map(t=>t.ref),reference:original.targets[0].ref}]
    const resources=head.resources.map(r=>({resourceId:r.resourceId,byteSize:r.bytes})).sort((a,b)=>a.resourceId.localeCompare(b.resourceId))
    bus.dispatch({type:'document.set-creative-intents',commandId:'hard-constraints',expectedRevision:bus.getSnapshot().document.revision,intents:head,resources})
    const poses=structuredClone(bus.getSnapshot().document.layers)
    await expect(adapter.organize([])).rejects.toThrow('硬')
    expect(bus.getSnapshot().document.layers).toEqual(poses)
    expect(bus.getSnapshot().document.creativeIntents!.drafts[0].recipeRefs).toEqual(original.recipeRefs)
    head.drafts[0].constraints=[]
    bus.dispatch({type:'document.set-creative-intents',commandId:'clear-conflict',expectedRevision:bus.getSnapshot().document.revision,intents:head,resources})
    await adapter.organize([]);expect(adapter.snapshot().candidates.length).toBeGreaterThan(0)
  })
})
