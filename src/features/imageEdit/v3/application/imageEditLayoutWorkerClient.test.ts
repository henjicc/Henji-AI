import { afterEach, expect, it, vi } from 'vitest'
import { ImageLayoutComputer, type ImageLayoutComputeInput } from './imageEditLayoutWorkerClient'
import type { LayoutCandidate } from '@/core/creativeIntent/layout'

const workers:FakeWorker[]=[]
class FakeWorker {
  onmessage:((event:{data:{candidates:LayoutCandidate[]}|{error:string}})=>void)|null=null
  onerror:((event:{message:string})=>void)|null=null
  postMessage=vi.fn();terminate=vi.fn()
  constructor(){workers.push(this)}
}
afterEach(()=>{workers.length=0;vi.unstubAllGlobals()})
const digest=`sha256:${'a'.repeat(64)}`
const input:ImageLayoutComputeInput={items:[],constraints:[],fidelity:0,identity:{sourceDraftDigest:digest,ownerRef:{kind:'image_edit.document',id:'v3:a'},targetBases:[],algorithmVersion:'image-layout/1',requestKey:'layout:0'}}
it('同实例复用 Worker，取消终止计算，下一次创建独立 Worker；关闭释放',async()=>{
  vi.stubGlobal('Worker',FakeWorker)
  const computer=new ImageLayoutComputer(),first=computer.compute(input,new AbortController().signal)
  workers[0].onmessage!({data:{candidates:[]}});await expect(first).resolves.toEqual([])
  const abort=new AbortController(),pending=computer.compute(input,abort.signal)
  expect(workers).toHaveLength(1);abort.abort();await expect(pending).rejects.toThrow();expect(workers[0].terminate).toHaveBeenCalledOnce()
  const next=computer.compute(input,new AbortController().signal);expect(workers).toHaveLength(2)
  workers[1].onmessage!({data:{candidates:[]}});await next;computer.dispose();expect(workers[1].terminate).toHaveBeenCalledOnce()
})
it('Worker 失败拒绝候选，不静默返回未经验证的布局',async()=>{
  vi.stubGlobal('Worker',FakeWorker);const computer=new ImageLayoutComputer()
  const next=computer.compute(input,new AbortController().signal);workers[0].onmessage!({data:{error:'硬约束冲突'}})
  await expect(next).rejects.toThrow('硬约束冲突');computer.dispose()
})
