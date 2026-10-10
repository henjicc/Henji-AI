import { expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'
import { build } from 'vite'

/** Explicit CPU/transport benchmark; default test runs do not impose machine timing gates. */
it.runIf(process.env.HENJI_LAYOUT_BENCHMARK==='1')('100 层实际 Worker：5 次预热 / 30 次测量',async()=>{
  const code=`import {parentPort} from 'node:worker_threads';
  import {createImageLayoutCandidates} from './src/core/imageEdit/v3/layoutCandidates';
  const owner={kind:'image_edit.document',id:'v3:bench'},digest='sha256:'+'a'.repeat(64);
  const items=Array.from({length:100},(_,i)=>{const x=i*150+(i%4)*13,y=(i%7)*11,w=45+i%31,h=40+i%13;return {targetRef:{kind:'image_edit.layer',id:'v3:bench:l'+i},affine:[1,0,0,1,x,y],worldCorners:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],translationLocked:i===0}});
  const targets=items.map(i=>i.targetRef),constraints=[{id:'align',kind:'align',strength:'soft',sourceRefs:[],axis:'y',edge:'start',targets,reference:targets[0]},{id:'spacing',kind:'distribute',strength:'soft',sourceRefs:[],axis:'x',targets}];
  const identity={sourceDraftDigest:digest,ownerRef:owner,targetBases:targets.map(targetRef=>({targetRef,baseDigest:digest,geometryDigest:digest})),algorithmVersion:'image-layout/1',requestKey:'layout:0'};
  let n=0;parentPort.on('message',()=>{const started=performance.now(),before=process.memoryUsage();const result=createImageLayoutCandidates(items,constraints,identity,0);const after=process.memoryUsage();parentPort.postMessage({ms:performance.now()-started,heap:after.heapUsed-before.heapUsed,rss:after.rss-before.rss,count:result.length,n:n++});});`
  const entry='\0image-layout-benchmark'
  const result=await build({configFile:false,logLevel:'silent',plugins:[{name:'image-layout-benchmark',resolveId:id=>id===entry?entry:null,load:id=>id===entry?code:null}],build:{ssr:true,write:false,rollupOptions:{input:entry,output:{format:'cjs',inlineDynamicImports:true}}}})
  const output=Array.isArray(result)?result[0]:result
  if(!('output'in output))throw new Error('benchmark bundle missing')
  const chunk=output.output.find(c=>c.type==='chunk');if(!chunk||chunk.type!=='chunk')throw new Error('benchmark code missing')
  const worker=new Worker(chunk.code,{eval:true})
  type Report={ms:number;heap:number;rss:number;count:number}
  const times:number[]=[],roundtrip:number[]=[],heap:number[]=[],rss:number[]=[]
  try {
    for(let i=0;i<35;i++) {
      const started=performance.now()
      const reply=await new Promise<Report>((resolve,reject)=>{
        const fail=(error:Error):void=>{worker.off('message',done);reject(error)}
        const done=(value:Report):void=>{worker.off('error',fail);resolve(value)}
        worker.once('message',done);worker.once('error',fail);worker.postMessage({})
      })
      expect(reply.count).toBeGreaterThanOrEqual(2)
      if(i>=5){times.push(reply.ms);roundtrip.push(performance.now()-started);heap.push(reply.heap);rss.push(reply.rss)}
    }
    const p95=(values:number[]):number=>values.slice().sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]
    const metrics={samples:times.length,cpuP95Ms:p95(times),workerRoundtripP95Ms:p95(roundtrip),maxHeapIncrementBytes:Math.max(...heap),maxRssIncrementBytes:Math.max(...rss)}
    process.stdout.write(`image-layout-benchmark ${JSON.stringify(metrics)}\n`)
    expect(metrics.workerRoundtripP95Ms).toBeLessThanOrEqual(900)
  } finally {await worker.terminate()}
})
