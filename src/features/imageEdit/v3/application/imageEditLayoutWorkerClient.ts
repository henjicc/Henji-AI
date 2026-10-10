import type { LayoutCandidate, LayoutItem } from '@/core/creativeIntent/layout'
import type { CandidateIdentity, LayoutConstraint } from '@/core/creativeIntent/contracts'

export interface ImageLayoutComputeInput {items:LayoutItem[];constraints:LayoutConstraint[];identity:CandidateIdentity;fidelity:number}
export class ImageLayoutComputer {
  private worker?:Worker
  private busy=false
  private idleTimer?:ReturnType<typeof setTimeout>
  warm():void {if(this.idleTimer)clearTimeout(this.idleTimer);this.idleTimer=undefined;this.worker??=new Worker(new URL('./imageEditLayoutWorker.ts',import.meta.url),{type:'module'})}
  dispose():void {if(this.idleTimer)clearTimeout(this.idleTimer);this.idleTimer=undefined;this.worker?.terminate();this.worker=undefined}
  async compute(input:ImageLayoutComputeInput,signal:AbortSignal):Promise<LayoutCandidate[]> {
    signal.throwIfAborted();if(this.busy)throw new Error('上一次整理尚未结束，请重试')
    this.warm();this.busy=true
    const worker=this.worker!
    return new Promise((resolve,reject)=>{
      const finish=():void=>{worker.onmessage=null;worker.onerror=null;signal.removeEventListener('abort',abort);this.busy=false;this.idleTimer=setTimeout(()=>this.dispose(),10000)}
      const abort=():void=>{finish();this.dispose();reject(signal.reason??new Error('整理已取消'))}
      worker.onmessage=(event:MessageEvent<{candidates:LayoutCandidate[]}|{error:string}>):void=>{finish();if('error'in event.data)reject(new Error(event.data.error));else resolve(event.data.candidates)}
      worker.onerror=event=>{finish();this.dispose();reject(new Error(event.message))}
      signal.addEventListener('abort',abort,{once:true})
      if(signal.aborted){abort();return}
      try{worker.postMessage(input)}catch(error){finish();this.dispose();reject(error)}
    })
  }
}
