import { expect, it, vi } from 'vitest'
import { TrackingService, type TrackingServiceDependencies } from './service'
import type { ContentDiskCache } from '../media/content-disk-cache'
import type { TrackingJob, TrackingJobResult, TrackingCandidatesResult } from '../local-inference/tracking/trackingProtocol'
import type { VideoEditTrackQuad } from '../../../../src/core/videoEdit/tracking'
import type { TrackingDefinition, TrackingProgressEvent } from '../../../../src/platform/contracts/tracking'

const definition: TrackingDefinition = { source: 'source', method: 'point', prompts: [{ timeUs: 0, points: [[.5, .5, 1]] }] }
const flush = async (): Promise<void> => { for (let i = 0; i < 50; i++) await Promise.resolve() }
function setup() {
  const events: TrackingProgressEvent[] = []
  const deps: TrackingServiceDependencies = {
    identity: vi.fn(async () => ({ path: 'source', identity: 'first' })),
    probe: vi.fn(async () => ({ width: 640, height: 360, fps: 30, startSeconds: 0 })),
    ensureModel: async () => [], ffmpegPath: async () => 'ffmpeg',
    results: { locate: vi.fn(async () => undefined), prepareTemporary: async () => 'temporary', adopt: async () => 'result' } as unknown as ContentDiskCache,
    track: vi.fn(async (): Promise<TrackingJobResult> => ({ model: 'opencv', provider: 'cpu', firstFrame: 0, frameCount: 30, tracked: 30, stopped: false, summary: { tracked: 30, lost: 0 }, decodeMs: 1, inferenceMs: 1, durationMs: 2 })),
    candidates: vi.fn(async (): Promise<TrackingCandidatesResult> => ({ provider: 'cpu', size: 1, candidates: [] })), cancel: vi.fn(),
    readHead: async () => new Uint8Array(), providers: ['cpu'], emit: event => { events.push(event) }, log: vi.fn(),
  }
  return { service: new TrackingService(deps), deps, events }
}

it('同路径文件身份改变使 status/run/ensureCovered/candidates 的探测和结果键失效', async () => {
  const { service, deps } = setup()
  await service.status(definition); await service.status(definition)
  expect(deps.identity).toHaveBeenCalledTimes(2)
  expect(deps.probe).toHaveBeenCalledTimes(1)
  const firstKey = vi.mocked(deps.results.locate).mock.calls[0][0]
  vi.mocked(deps.identity).mockResolvedValue({ path: 'source', identity: 'second' })
  vi.mocked(deps.probe).mockResolvedValue({ width: 1280, height: 720, fps: 24, startSeconds: 1.4 })
  await service.status(definition)
  const secondKey = vi.mocked(deps.results.locate).mock.calls.at(-1)![0]
  expect(secondKey).not.toBe(firstKey); expect(deps.probe).toHaveBeenCalledTimes(2)
  await service.ensureCovered(definition, { startUs: 1_400_000, endUs: 2_000_000 })
  expect(vi.mocked(deps.track).mock.calls[0][0]).toMatchObject({ fps: 24, containerStartUs: 1_400_000, display: { width: 1280, height: 720 } })
  await service.candidates({ source: 'source', timeUs: 1_400_000, points: [[.5, .5, 1]] })
  expect(vi.mocked(deps.candidates).mock.calls[0][0]).toMatchObject({ fps: 24, containerStartUs: 1_400_000 })
  service.dispose()
})

it.each(['temporary', 'ffmpeg'] as const)('在 %s 前置等待中停止，不提交跟踪并回到 idle', async stage => {
  const { service, deps, events } = setup()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  if (stage === 'temporary') deps.results.prepareTemporary = async () => { await gate; return 'temp' }
  else deps.ffmpegPath = async () => { await gate; return 'ffmpeg' }
  await service.run(definition, { startUs: 0, endUs: 1e6 }, { direction: 'both' }); await flush()
  service.stop(definition); release(); await flush()
  expect(deps.track).not.toHaveBeenCalled(); expect(events.at(-1)?.status).toEqual({ state: 'idle' })
  expect(service.hasActiveJobs()).toBe(false)
  expect(deps.log).toHaveBeenCalledWith('info', expect.any(String), 'tracking.run.stopped', expect.any(Object))
})

it('提交后停止而后台迟到成功，终态仍保留 stopped', async () => {
  const { service, deps, events } = setup()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const completed = await deps.track({} as TrackingJob, () => {})
  vi.mocked(deps.track).mockClear().mockImplementation(async () => { await gate; return completed })
  await service.run(definition, { startUs: 0, endUs: 1e6 }, { direction: 'both' }); await flush()
  service.stop(definition); release(); await flush()
  expect(events.at(-1)?.status).toMatchObject({ state: 'ready', stopped: true })
})

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
