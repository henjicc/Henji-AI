import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { SMART_REGION_FORMAT_VERSION } from '../../../../src/core/videoEdit/smartRegions'
import type { SmartRegionProgressEvent, SmartRegionRequest } from '../../../../src/platform/contracts/smartRegions'
import type { ContentDiskCache } from '../media/content-disk-cache'
import { LocalInferenceFailure } from '../local-inference/host'
import type { SmartRegionAnalysisJob, SmartRegionAnalysisResult } from '../local-inference/protocol'
import { SmartRegionService, type SmartRegionServiceDependencies } from './service'
import { parseSmartRegionProbe } from './probe'

function memoryCache(): ContentDiskCache & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    read: async key => files.get(key),
    locate: async key => files.has(key) ? `/cache/${key}` : undefined,
    write: async (key, bytes) => { files.set(key, bytes) },
    prepareTemporary: async key => `/cache/${key}.tmp`,
    adopt: async key => { files.set(key, new Uint8Array(1)); return `/cache/${key}` },
    remove: async key => { files.delete(key) },
    prune: async () => ({ removed: 0, bytes: 0 }),
  }
}

const done: SmartRegionAnalysisResult = { model: 'yunet', provider: 'dml', frames: 60, summary: { value: 2, peak: 1 }, decodeMs: 10, inferenceMs: 20, durationMs: 40 }

function setup(overrides: Partial<SmartRegionServiceDependencies> = {}) {
  const jobs: Array<{ job: SmartRegionAnalysisJob; resolve: (value: SmartRegionAnalysisResult) => void; reject: (error: Error) => void; progress: (done: number, total: number) => void }> = []
  const events: SmartRegionProgressEvent[] = []
  const segments = memoryCache(); const indexes = memoryCache()
  const deps: SmartRegionServiceDependencies = {
    identity: async source => ({ path: source, identity: `id:${source}` }),
    probe: async () => ({ width: 1920, height: 1080, fps: 59.94, startSeconds: 0.5 }),
    ensureModel: async id => `/models/${id}.onnx`,
    ffmpegPath: async () => '/bin/ffmpeg',
    segments, indexes,
    analyze: (job, progress) => new Promise((resolve, reject) => { jobs.push({ job, resolve, reject, progress }) }),
    cancelAnalysis: vi.fn(),
    providers: ['dml', 'cpu'],
    emit: event => { events.push(event) },
    log: vi.fn(),
    ...overrides,
  }
  return { service: new SmartRegionService(deps), deps, jobs, events, segments, indexes }
}

const request = (overrides: Partial<SmartRegionRequest> = {}): SmartRegionRequest => ({ source: '/media/a.mp4', kind: 'face', startUs: 2_300_000, endUs: 4_100_000, still: false, ...overrides })
const flush = async (): Promise<void> => { for (let index = 0; index < 50; index++) await Promise.resolve() }

it('取消后旧分析尚未结束就 ensure/wait：重新提交一次并收到终态', async () => {
  const { service, jobs, events } = setup()
  await service.ensure(request()); await flush()
  service.cancel(request())
  const renewed = service.ensure(request())
  const waiting = service.wait(request())
  jobs[0].reject(new LocalInferenceFailure('cancelled', '已取消'))
  await flush()
  expect(jobs).toHaveLength(2)
  jobs[1].resolve(done)
  await expect(renewed).resolves.toMatchObject({ state: 'analyzing' })
  await expect(waiting).resolves.toMatchObject({ state: 'ready' })
  expect(events.at(-1)?.status.state).toBe('ready')
})

it('模型下载中取消再请求：下载完成后只提交新分析', async () => {
  let release!: (path: string) => void
  const ensureModel = vi.fn<Parameters<SmartRegionServiceDependencies['ensureModel']>, ReturnType<SmartRegionServiceDependencies['ensureModel']>>()
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    .mockResolvedValue('/models/yunet.onnx')
  const { service, jobs, events } = setup({ ensureModel })
  await service.ensure(request()); await flush()
  service.cancel(request())
  const waiting = service.wait(request())
  release('/models/yunet.onnx'); await flush()
  expect(ensureModel).toHaveBeenCalledTimes(2)
  expect(jobs).toHaveLength(1)
  jobs[0].resolve(done)
  await expect(waiting).resolves.toMatchObject({ state: 'ready' })
  expect(events.at(-1)?.status.state).toBe('ready')
})

it('容器起点晚于取整范围：第零帧与实际解码起点一致，索引仍覆盖请求范围', async () => {
  const { service, jobs } = setup({ probe: async () => ({ width: 1920, height: 1080, fps: 30, startSeconds: 1.4 }) })
  const input = request({ startUs: 1_400_000, endUs: 2_500_000 })
  const waiting = service.wait(input); await flush()
  expect(jobs[0].job).toMatchObject({ startUs: 1_400_000, seekSeconds: 0, durationSeconds: 1.6, endUs: 3_000_000 })
  jobs[0].resolve(done)
  await expect(waiting).resolves.toMatchObject({ state: 'ready', segment: { startUs: 1_000_000, endUs: 3_000_000 } })
  await expect(service.ensure(input)).resolves.toMatchObject({ state: 'ready' })
  expect(jobs).toHaveLength(1)
})

it('请求完全早于容器起点：报解码失败，不提交分析', async () => {
  const analyze = vi.fn<Parameters<SmartRegionServiceDependencies['analyze']>, ReturnType<SmartRegionServiceDependencies['analyze']>>()
  const { service } = setup({ probe: async () => ({ width: 1920, height: 1080, fps: 30, startSeconds: 6 }), analyze })
  await expect(service.wait(request())).resolves.toMatchObject({ state: 'failed', reason: 'decode' })
  expect(analyze).not.toHaveBeenCalled()
})

it('修正容器时钟后不复用旧算法留下的错位缓存', async () => {
  const { service, segments, indexes } = setup()
  const oldIndexKey = createHash('sha256').update(JSON.stringify(['smart-region-index', SMART_REGION_FORMAT_VERSION, 'id:/media/a.mp4', 'face'])).digest('hex')
  const oldKey = 'a'.repeat(64)
  segments.files.set(oldKey, new Uint8Array(1))
  indexes.files.set(oldIndexKey, new TextEncoder().encode(JSON.stringify([{ key: oldKey, startUs: 2_000_000, endUs: 5_000_000, still: false, model: 'yunet', summary: done.summary }])))
  await expect(service.ensure(request())).resolves.toMatchObject({ state: 'analyzing' })
})

it.each(['probe', 'temporary', 'ffmpeg'] as const)('在 %s 前置等待中取消，不提交分析也不发布 ready', async stage => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const fixture = setup()
  if (stage === 'probe') fixture.deps.probe = async () => { await gate; return { width: 640, height: 360, fps: 30, startSeconds: 0 } }
  if (stage === 'temporary') fixture.deps.segments.prepareTemporary = async () => { await gate; return '/cache/temp' }
  if (stage === 'ffmpeg') fixture.deps.ffmpegPath = async () => { await gate; return 'ffmpeg' }
  await fixture.service.ensure(request()); await flush()
  fixture.service.cancel(request()); release(); await flush()
  expect(fixture.jobs).toHaveLength(0)
  expect(fixture.events.some(event => event.status.state === 'ready')).toBe(false)
  expect(fixture.service.hasActiveJobs()).toBe(false)
})

it('分析已提交后取消，迟到成功不进入缓存或广播 ready', async () => {
  const { service, jobs, events, segments } = setup()
  await service.ensure(request()); await flush()
  service.cancel(request()); jobs[0].resolve(done); await flush()
  expect(events.some(event => event.status.state === 'ready')).toBe(false)
  expect(segments.files.size).toBe(0)
})

describe('智能区域分析服务', () => {
  it('按整秒范围分析一次：并发请求共用，进度广播，完成后命中缓存；被覆盖的更短范围直接复用', async () => {
    const { service, jobs, events } = setup()
    expect(await service.ensure(request())).toEqual({ state: 'analyzing', progress: 0 })
    expect(await service.ensure(request({ startUs: 2_000_000 }))).toEqual({ state: 'analyzing', progress: 0 })
    await flush()
    expect(jobs).toHaveLength(1)
    const { job } = jobs[0]
    // 范围按整秒：2s–5s；FFmpeg 定位相对容器起点 0.5s；人脸帧率上限 30。
    expect(job).toMatchObject({ kind: 'face', startUs: 2_000_000, endUs: 5_000_000, seekSeconds: 1.5, durationSeconds: 3, fps: 30, display: { width: 1920, height: 1080 }, providers: ['dml', 'cpu'], models: [{ name: 'yunet', path: '/models/face_detection_yunet.onnx' }] })
    jobs[0].progress(45, 90)
    expect(events.at(-1)?.status).toEqual({ state: 'analyzing', progress: 0.5 })
    jobs[0].resolve(done)
    await expect(service.wait(request())).resolves.toMatchObject({ state: 'ready', segment: { startUs: 2_000_000, endUs: 5_000_000, model: 'yunet', summary: { value: 2, peak: 1 } } })
    expect(events.at(-1)?.status.state).toBe('ready')
    expect(await service.ensure(request({ startUs: 3_000_000, endUs: 4_000_000 }))).toMatchObject({ state: 'ready' })
    expect(await service.ensure(request({ kind: 'text' }))).toEqual({ state: 'analyzing', progress: 0 })
    await flush()
    expect(jobs).toHaveLength(2)
    expect(jobs[1].job.fps).toBe(10)
  })

  it('人物：RVM 下载失败时只用 Selfie；全部模型拿不到报 model', async () => {
    const ensureModel = vi.fn(async (id: string) => { if (id === 'person_matting_rvm') throw new Error('network:'); return `/models/${id}.onnx` })
    const person = setup({ ensureModel })
    void person.service.ensure(request({ kind: 'person' }))
    await flush()
    expect(person.jobs[0].job.models).toEqual([{ name: 'selfie', path: '/models/selfie_segmentation.onnx' }])
    expect(person.jobs[0].job.fps).toBeCloseTo(59.94)

    const offline = setup({ ensureModel: async () => { throw new Error('network:') } })
    await expect(offline.service.wait(request())).resolves.toEqual({ state: 'failed', reason: 'model' })
  })

  it('失败原因：解码失败、推理失败、缓存写入失败分别给出；取消不广播失败，之后可重新开始', async () => {
    const { service, jobs, events, deps } = setup()
    const waiting = service.wait(request())
    await flush()
    jobs[0].reject(new LocalInferenceFailure('decode', '坏文件'))
    await expect(waiting).resolves.toEqual({ state: 'failed', reason: 'decode' })
    const retry = service.wait(request())
    await flush()
    jobs[1].reject(new LocalInferenceFailure('output', '磁盘满'))
    await expect(retry).resolves.toEqual({ state: 'failed', reason: 'disk' })

    void service.ensure(request())
    await flush()
    const count = events.length
    service.cancel(request())
    expect(deps.cancelAnalysis).toHaveBeenCalledWith(jobs[2].job.id)
    jobs[2].reject(new LocalInferenceFailure('cancelled', '已取消'))
    await flush()
    expect(events.slice(count).some(event => event.status.state === 'failed')).toBe(false)
    expect(await service.ensure(request())).toEqual({ state: 'analyzing', progress: 0 })
  })

  it('静态图片：不定位、只取一帧，任何时间都覆盖', async () => {
    const { service, jobs } = setup()
    void service.ensure(request({ source: '/media/a.png', still: true, startUs: 0, endUs: 0 }))
    await flush()
    expect(jobs[0].job).toMatchObject({ seekSeconds: 0, durationSeconds: null, fps: 1, startUs: 0, endUs: 0 })
  })

  it('ffprobe 解析：像素比与 90° 旋转换算成显示尺寸，取平均帧率与容器起点', () => {
    expect(parseSmartRegionProbe(JSON.stringify({ streams: [{ width: 1920, height: 1080, sample_aspect_ratio: '1:1', avg_frame_rate: '30000/1001', side_data_list: [{ rotation: -90 }] }], format: { start_time: '1.400000' } })))
      .toEqual({ width: 1080, height: 1920, fps: 30000 / 1001, startSeconds: 1.4 })
    expect(parseSmartRegionProbe(JSON.stringify({ streams: [{ width: 1440, height: 1080, sample_aspect_ratio: '4:3', avg_frame_rate: '0/0', r_frame_rate: '25/1' }] })))
      .toEqual({ width: 1920, height: 1080, fps: 25, startSeconds: 0 })
    expect(() => parseSmartRegionProbe('{"streams":[]}')).toThrow('没有可分析的画面')
  })
})
