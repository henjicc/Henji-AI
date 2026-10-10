import { createImageLayoutCandidates } from '@/core/imageEdit/v3/layoutCandidates'
import type { ImageLayoutComputeInput } from './imageEditLayoutWorkerClient'

self.onmessage=(event:MessageEvent<ImageLayoutComputeInput>):void=>{
  try {self.postMessage({candidates:createImageLayoutCandidates(event.data.items,event.data.constraints,event.data.identity,event.data.fidelity)})}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)})}
}
