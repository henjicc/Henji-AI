import { creativeIntentsSchema, type CreativeIntents, type StoredCreativeIntentResource } from '../../../../src/core/creativeIntent/persistence'
import { collectImageEditCommandResourceReferencesV3, mergeImageEditHistoryResourceReferencesV3, type ImageEditCommandV3 } from '../../../../src/core/imageEdit/v3/commandTypes'
import type { ImageEditHistoryEntrySnapshotV3 } from '../../../../src/core/imageEdit/v3/commandHistoryCodec'
import { collectImageEditJsonResourceIdsV3, isImageEditDocumentResourceContainerV3 } from '../../../../src/core/imageEdit/v3/resourceReferences'
import type { ContentAddressedResourceStore } from './resource-store'
import type { ImageEditDocumentEnvelope, ResourceId, ResourceLease } from './contracts'
import { ImageEditHistoryPageStoreV3 } from './history-pages/store'
import { readImageLayoutResource, IMAGE_LAYOUT_RESOURCE_MAX_BYTES } from './layout-resources'

const record=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v))
/** Fork/import rewrite immutable pages and both history directions; pixels remain shared.
 * Caller holds the returned publication lease until the new document/package is durable. */
export async function rebindImageLayoutDocument(envelope:ImageEditDocumentEnvelope,id:string,store:ContentAddressedResourceStore,signal?:AbortSignal):Promise<{envelope:ImageEditDocumentEnvelope;release:()=>Promise<void>}> {
  const leases:ResourceLease[]=[],releases:(()=>Promise<void>)[]=[]
  const release=async():Promise<void>=>{for(const lease of leases)await lease.release();for(const free of releases)await free()}
  if(id===envelope.documentId)return {envelope,release}
  const prefix=`v3:${encodeURIComponent(envelope.documentId)}`,next=`v3:${encodeURIComponent(id)}`
  const cache=new Map<string,StoredCreativeIntentResource>()
  const rewriteRef=(value:Record<string,unknown>):Record<string,unknown>=>typeof value.kind==='string'&&value.kind.startsWith('image_edit.')&&typeof value.id==='string'&&(value.id===prefix||value.id.startsWith(`${prefix}:`))?{...value,id:next+value.id.slice(prefix.length)}:value
  const head=async(value:unknown):Promise<CreativeIntents>=>{
    const current=creativeIntentsSchema.parse(value)
    for(const resource of current.resources) {
      signal?.throwIfAborted()
      if(cache.has(resource.resourceId))continue
      if(!['page','recipe','candidate'].includes(resource.kind)){cache.set(resource.resourceId,resource);continue}
      const parsed=await readImageLayoutResource(store,resource.resourceId as ResourceId)
      const rebound=await walk(parsed,false)
      const publication=await store.putBufferLeased(Buffer.from(JSON.stringify(rebound)),{mediaType:'application/vnd.henji.layout+json',maxBytes:IMAGE_LAYOUT_RESOURCE_MAX_BYTES,signal})
      leases.push(publication.lease)
      const mapped={...resource,resourceId:publication.resource.id,digest:publication.resource.id,bytes:publication.resource.byteLength,path:`resources/${publication.resource.sha256}`}
      cache.set(resource.resourceId,mapped);cache.set(mapped.resourceId,mapped)
    }
    return creativeIntentsSchema.parse(await walk(current,false))
  }
  const walk=async(value:unknown,heads=true):Promise<unknown>=>{
    signal?.throwIfAborted()
    if(Array.isArray(value)){const result:unknown[]=[];for(const child of value)result.push(await walk(child,heads));return result}
    if(!record(value))return value
    const source=rewriteRef(value),result:Record<string,unknown>={}
    const mapped=typeof source.resourceId==='string'?cache.get(source.resourceId):undefined
    for(const [key,child]of Object.entries(source)) {
      if(heads&&(key==='creativeIntents'&&isImageEditDocumentResourceContainerV3(source)||key==='intents'&&source.type==='document.set-creative-intents')&&child)result[key]=await head(child)
      else if(mapped&&['resourceId','digest','bytes','byteSize','path'].includes(key))result[key]=key==='byteSize'?mapped.bytes:mapped[key as 'resourceId'|'digest'|'bytes'|'path']
      else if((key==='candidateRef'||key==='selectedCandidateRef')&&typeof child==='string')result[key]=cache.get(child)?.resourceId??child
      else {
        const rewritten=await walk(child,heads)
        if(key==='resources'&&Array.isArray(rewritten)&&rewritten.every(r=>record(r)&&typeof r.resourceId==='string'&&'byteSize'in r)) {
          result[key]=mergeImageEditHistoryResourceReferencesV3(rewritten as {resourceId:string;byteSize:number|null}[])
        }else result[key]=rewritten
      }
    }
    return result
  }
  try {
    const document=await walk(envelope.document)
    if(!record(document))throw new Error('图片文档内容无效')
    document.id=id
    const pages=new ImageEditHistoryPageStoreV3(store)
    const snapshot=envelope.history??(envelope.historyCheckpoint?await pages.open(envelope.historyCheckpoint,signal):undefined)
    let historyCheckpoint=envelope.historyCheckpoint
    if(snapshot) {
      const mapEntry=async(entry:ImageEditHistoryEntrySnapshotV3):Promise<ImageEditHistoryEntrySnapshotV3>=>{
        const forward=await walk(entry.forward) as ImageEditCommandV3,inverse=await walk(entry.inverse) as ImageEditCommandV3
        // Both head directories must be known before translating shared structural descriptors.
        const f=await walk(forward) as ImageEditCommandV3,r=await walk(inverse) as ImageEditCommandV3
        return {forward:f,inverse:r,metadataBytes:Buffer.byteLength(JSON.stringify([f,r])),resources:mergeImageEditHistoryResourceReferencesV3([...collectImageEditCommandResourceReferencesV3(f),...collectImageEditCommandResourceReferencesV3(r)])}
      }
      const prepared=await pages.prepare(snapshot,signal,mapEntry)
      releases.push(prepared.release);historyCheckpoint={...prepared.checkpoint,documentId:id}
    }
    const oldPages=new Set(envelope.historyCheckpoint?.pages.map(p=>p.resourceId))
    const extra=envelope.resourceRefs.filter(ref=>!cache.has(ref)&&!oldPages.has(ref)).map(ref=>ref as ResourceId)
    const resourceRefs=collectImageEditJsonResourceIdsV3(document,[...extra,...historyCheckpoint?.resources.map(r=>r.resourceId)??[],...historyCheckpoint?.pages.map(r=>r.resourceId)??[],...envelope.previewRef?[envelope.previewRef]:[]]) as ResourceId[]
    return {envelope:{...envelope,documentId:id,document,history:undefined,historyCheckpoint,resourceRefs},release}
  }catch(error){await release();throw error}
}
