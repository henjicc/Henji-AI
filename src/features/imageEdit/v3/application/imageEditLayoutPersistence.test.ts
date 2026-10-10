import { afterEach, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { webcrypto } from 'node:crypto'
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { createImageLayoutCandidates } from '@/core/imageEdit/v3/layoutCandidates'
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { ImageEditLayoutDraft } from './imageEditLayoutDraft'
import { ContentAddressedResourceStore } from '../../../../../electron/main/services/image-editor-v3/resource-store'
import { ImageEditDocumentRepository } from '../../../../../electron/main/services/image-editor-v3/document-repository'
import { HenjiImagePackageCodec } from '../../../../../electron/main/services/image-editor-v3/package-codec'
import { rewriteImageDocumentPackageHeader } from '../../../../../electron/main/services/image-editor-v3/image-document/package-file'
import { readImageLayoutResource } from '../../../../../electron/main/services/image-editor-v3/layout-resources'
import type { ResourceId, ResourceLease } from '../../../../../electron/main/services/image-editor-v3/contracts'
import { CanvasLayerPackageService } from '../../../../../electron/main/services/image-editor-v3/canvas-layers/canvas-layer-packages'
import { createMainLogger } from '../../../../../electron/main/services/logging'

const directories:string[]=[]
afterEach(async()=>{for(const directory of directories.splice(0))await fsp.rm(directory,{recursive:true,force:true})})
it('原稿头与页经真实存储、undo/redo、fork、包复制、移动、导出重开和 GC 完整存活并重绑',async()=>{
  vi.stubGlobal('crypto',webcrypto)
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'henji-layout-persistence-'));directories.push(root)
  const resources=new ContentAddressedResourceStore(path.join(root,'resources')),documents=new ImageEditDocumentRepository(path.join(root,'documents'),{resources})
  const document=createImageEditDocumentV3({width:1000,height:600,documentId:'layout'})
  document.layers=['a','b','c'].map((id,i)=>({...createImageEditRasterLayerV3(id,id),transform:[1,0,0,1,i*230,[60,83,47][i]]}))
  const parameterResource=await resources.putBuffer(Buffer.from('ordinary effect parameter resource'))
  document.layers.push(createImageEditEffectLayerV3('ordinary-params','参数资源','custom-layout-regression',{creativeIntents:[parameterResource.id],intents:[parameterResource.id]},false))
  let saved=await documents.create({documentId:document.id,document})
  const bus=new ImageEditCommandBusV3(document),leases=new Map<string,ResourceLease[]>()
  const adapter=new ImageEditLayoutDraft(bus,{measure:async()=>[[0,0],[100,0],[100,50],[0,50]],compute:async input=>createImageLayoutCandidates(input.items,input.constraints,input.identity,input.fidelity),
    store:async(value,kind,leaseId)=>{
      const publication=await resources.putBufferLeased(Buffer.from(JSON.stringify(value)),{mediaType:'application/vnd.henji.layout+json'})
      leases.set(leaseId,[...leases.get(leaseId)??[],publication.lease]);const r=publication.resource
      return {resourceId:r.id,digest:r.id,bytes:r.byteLength,path:`resources/${r.sha256}`,kind,...(value&&typeof value==='object'&&'sourceDigest'in value?{sourceDigest:String(value.sourceDigest)}:{})}
    },read:async r=>readImageLayoutResource(resources,r.resourceId as ResourceId),release:async id=>{for(const lease of leases.get(id)??[])await lease.release();leases.delete(id)},
    confirm:async()=>{const snapshot=bus.getPersistenceSnapshot();saved=await documents.save({documentId:document.id,expectedRevision:saved.revision,nextRevision:snapshot.document.revision,document:snapshot.document,history:snapshot.history,resourceRefs:collectImageEditJsonResourceIdsV3(snapshot) as ResourceId[]})}})
  await adapter.organize(['a','b','c']);await adapter.configure({pinIds:['a']});await adapter.apply()
  const originalRecipe=bus.getSnapshot().document.creativeIntents!.drafts[0].recipeRefs[0]
  bus.undo()
  const snapshot=bus.getPersistenceSnapshot()
  saved=await documents.save({documentId:document.id,expectedRevision:saved.revision,nextRevision:snapshot.document.revision,document:snapshot.document,history:snapshot.history,resourceRefs:collectImageEditJsonResourceIdsV3(snapshot) as ResourceId[]})
  const checkpoint=await documents.loadCheckpoint(document.id)
  expect(checkpoint.resourceRefs).toContain(originalRecipe.resourceId)
  const fork=await documents.fork({sourceDocumentRef:`image-edit-v3:${document.id}`,expectedRevision:saved.revision,targetDocumentId:'fork'})
  expect((fork.document as ImageEditDocumentV3).creativeIntents!.drafts[0].ownerRef.id).toBe('v3:fork')
  expect((fork.document as ImageEditDocumentV3).layers.at(-1)).toMatchObject({params:{creativeIntents:[parameterResource.id],intents:[parameterResource.id]}})
  expect(fork.resourceRefs).toContain(parameterResource.id)
  const canvasPackages=new CanvasLayerPackageService({documents,packages:new HenjiImagePackageCodec(resources),linksDirectory:path.join(root,'canvas-links'),logger:createMainLogger('test.layout.canvas'),validateDocument:()=>undefined,
    resolveInternalFolder:async()=>{const folder=path.join(root,'canvas-internal');await fsp.mkdir(folder,{recursive:true});return folder}})
  const committed=await canvasPackages.commit({canvasId:'canvas-a',container:{kind:'user'},documentIds:['fork']})
  const canvasCopy=await canvasPackages.prepare({canvasId:'canvas-b',layers:[{documentId:'fork',packagePath:committed.packages.fork}]})
  expect(canvasCopy.missing).toEqual([])
  const canvasDocument=await documents.load(canvasCopy.rewrites.fork),canvasDraft=(canvasDocument.document as ImageEditDocumentV3).creativeIntents!.drafts[0]
  expect(canvasDraft.ownerRef.id).toBe(`v3:${canvasCopy.rewrites.fork}`)
  expect(await readImageLayoutResource(resources,canvasDraft.recipeRefs[0].resourceId as ResourceId)).toMatchObject({ownerRef:{id:`v3:${canvasCopy.rewrites.fork}`},entries:[{layerId:'a',localAffine:document.layers[0].transform},{layerId:'b'},{layerId:'c'}]})
  expect(await documents.deleteIfRevision(document.id,saved.revision)).toBe(true)
  const packagePath=path.join(root,'layout.henjiimg')
  await new HenjiImagePackageCodec(resources).export({targetPath:packagePath,document:fork})
  await rewriteImageDocumentPackageHeader(packagePath,{id:'copy'})
  const moved=path.join(root,'moved.henjiimg');await fsp.rename(packagePath,moved)
  const importedStore=new ContentAddressedResourceStore(path.join(root,'imported-resources')),importedDocuments=new ImageEditDocumentRepository(path.join(root,'imported-documents'),{resources:importedStore})
  const imported=await new HenjiImagePackageCodec(importedStore).import(moved,{restoreHistory:false})
  try {await importedDocuments.replace(imported.manifest.document)}finally{await imported.resourceLease.release()}
  expect((await importedStore.garbageCollect(new Set((await importedDocuments.list()).flatMap(d=>d.resourceRefs)),{minimumAgeMs:0})).deleted).toEqual([])
  const reopened=await importedDocuments.load('copy'),body=reopened.document as ImageEditDocumentV3,draft=body.creativeIntents!.drafts[0]
  expect(reopened.resourceRefs).toContain(parameterResource.id)
  expect(body.layers.at(-1)).toMatchObject({params:{creativeIntents:[parameterResource.id],intents:[parameterResource.id]}})
  expect(draft.ownerRef.id).toBe('v3:copy');expect(draft.pins[0].targetRef.id).toBe('v3:copy:a')
  const page=await readImageLayoutResource(importedStore,draft.recipeRefs[0].resourceId as ResourceId)
  expect(page).toMatchObject({ownerRef:{id:'v3:copy'},entries:[{layerId:'a',localAffine:document.layers[0].transform},{layerId:'b'},{layerId:'c'}]})
  const history=new ImageEditCommandHistoryV3();history.restore(body,reopened.history)
  const redo=history.redo(body);expect(redo.document.revision).toBe(body.revision+1)
  expect(redo.document.creativeIntents!.drafts[0].applications[0].candidateRef).toMatch(/^sha256:/)
  const roundtrip=history.undo(redo.document);expect(roundtrip.document.layers).toEqual(body.layers)
})
