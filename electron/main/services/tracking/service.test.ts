import { expect, it, vi } from 'vitest'
import { TrackingService, type TrackingServiceDependencies } from './service'
import type { ContentDiskCache } from '../media/content-disk-cache'
import type { TrackingJob } from '../local-inference/tracking/trackingProtocol'
import type { VideoEditTrackQuad } from '../../../../src/core/videoEdit/tracking'

it.each(['point','planar'] as const)('主进程 %s 不下载 ONNX 模型，完整传递四角/内外框并保留原任务日志',async method=> {
  let job!:TrackingJob
  const ensureModel=vi.fn(async()=>[])
  const log=vi.fn();const events:unknown[]=[]
  const results={locate:async()=>undefined,prepareTemporary:async()=> 'temporary',adopt:async()=> 'result'} as unknown as ContentDiskCache
  const deps:TrackingServiceDependencies={identity:async()=>({path:'source',identity:'content'}),probe:async()=>({width:640,height:360,fps:30,startSeconds:0,durationSeconds:1}),ensureModel,ffmpegPath:async()=> 'ffmpeg',results,track:async input=>{job=input;return {model:'opencv',provider:'cpu',firstFrame:0,frameCount:30,tracked:30,stopped:false,summary:{tracked:30,lost:0},decodeMs:1,inferenceMs:1,durationMs:2}},candidates:async()=>{throw new Error('不应生成候选')},cancel:()=>{},readHead:async()=>new Uint8Array(),emit:event=>{events.push(event)},providers:['cpu'],log}
  const service=new TrackingService(deps)
  const quad:VideoEditTrackQuad=[[.1,.1],[.8,.1],[.8,.8],[.1,.8]]
  const prompts=[{timeUs:0,...(method==='point'?{points:[[.5,.5,1] as [number,number,0|1]],window:{feature:.05,search:.25}}:{quad})}]
  expect(await service.run({source:'source',method,prompts},{startUs:0,endUs:1e6},{direction:'both'})).toMatchObject({state:'tracking'})
  for(let i=0;i<20;i++)await Promise.resolve()
  expect(ensureModel).not.toHaveBeenCalled();expect(job.method).toBe(method);expect(job.models).toEqual([])
  const {timeUs: _timeUs,...region}=prompts[0]
  expect(job.prompts).toEqual([{frame:0,...region}])
  expect(events.at(-1)).toMatchObject({status:{state:'ready'}})
  expect(log.mock.calls.map(c=>c[2])).toEqual(['tracking.run.start','tracking.run.completed'])
  service.dispose()
})
