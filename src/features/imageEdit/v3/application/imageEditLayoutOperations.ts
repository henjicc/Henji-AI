import type { ImageEditLayoutDraft } from './imageEditLayoutDraft'
import { requireImageEditDocumentInstanceV3 } from './imageEditDocumentInstances'

/** Lightweight public feature entry. P1-5 resolves the normal document entity first, then consumes this same adapter. */
export async function getImageEditLayoutDraftV3(documentId:string):Promise<ImageEditLayoutDraft> {
  const instance=requireImageEditDocumentInstanceV3(documentId)
  const {imageEditLayoutDraft}=await import('./imageEditLayoutDraft')
  if(instance.bus.getLifecycleSignal().aborted)throw new Error('图片文档已关闭，请重新打开')
  return imageEditLayoutDraft(instance.bus)
}
