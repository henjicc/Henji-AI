import { afterEach, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import { testAuthorBundle, testAuthorProgram } from './videoEditAuthorTestFixtures'

const author = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn(), instance: vi.fn() }))
vi.mock('./videoEditAuthorPrograms', () => ({ VideoEditAuthorPrograms: class {
  instance = author.instance
  dispose = author.dispose
} }))
afterEach(() => { vi.resetAllMocks() })
function fixture() {
  const destroyed = vi.fn()
  const device: GpuDevice = {
    queue: { copyExternalImageToTexture: vi.fn(), writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: vi.fn(async () => {}) },
    lost: new Promise(() => {}), createShaderModule: vi.fn(), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createSampler: vi.fn(),
    createTexture: () => ({ createView: () => ({}), destroy: destroyed }), createBuffer: () => ({ destroy: destroyed }), createBindGroup: vi.fn(),
    createCommandEncoder: vi.fn(), pushErrorScope: vi.fn(), popErrorScope: async () => null, destroy: vi.fn(),
  }
  author.instance.mockResolvedValue({ render: author.render })
  const program = testAuthorProgram(testAuthorBundle('export default {name:"异步作者",draw(){}}'))
  return { runtime: new VideoEditCodeGpu(device), device, program, destroyed }
}
const info = { time: 1, frameDuration: 1 / 60, clip: { time: 1, duration: 3 } }

it('关闭等待作者在途绘制，重复关闭共享屏障，结束后释放目标', async () => {
  const { runtime, program, destroyed } = fixture()
  let finish!: () => void
  author.render.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const drawing = runtime.authorGenerator('output', 'clip', program, { width: 16, height: 16 }, {}, {}, info)
  await vi.waitFor(() => expect(author.render).toHaveBeenCalledOnce())
  const closing = runtime.dispose()
  expect(runtime.dispose()).toBe(closing)
  expect(author.dispose).not.toHaveBeenCalled(); expect(destroyed).not.toHaveBeenCalled()
  await expect(runtime.authorGenerator('late', 'late', program, { width: 16, height: 16 }, {}, {}, info)).rejects.toThrow('关闭')
  finish(); await drawing; await closing
  expect(author.dispose).toHaveBeenCalledOnce(); expect(destroyed).toHaveBeenCalled()
  expect(runtime.diagnostics()).toMatchObject({ surfaces: 0, residentBytes: 0 })
})

it('关闭期间迟到的作者实例不能分配输出或调用绘制', async () => {
  const { runtime, program } = fixture()
  let finish!: () => void
  author.instance.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ render: author.render }) }))
  const drawing = runtime.authorGenerator('output', 'clip', program, { width: 16, height: 16 }, {}, {}, info)
  const rejected = expect(drawing).rejects.toThrow('关闭')
  await vi.waitFor(() => expect(author.instance).toHaveBeenCalledOnce())
  const closing = runtime.dispose(); finish(); await rejected; await closing
  expect(author.render).not.toHaveBeenCalled()
  expect(runtime.diagnostics().textureAllocations).toBe(0)
})

it('等待作者实例期间输入退役，拒绝滤镜绘制及迟到输出分配', async () => {
  const { runtime, program } = fixture()
  const input = await runtime.target('input', 16, 16)
  let finish!: () => void
  author.instance.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ render: author.render }) }))
  const drawing = runtime.authorFilter('output', 'effect', { ...program, kind: 'filter' }, {}, input, info)
  const rejected = expect(drawing).rejects.toThrow('退役')
  await vi.waitFor(() => expect(author.instance).toHaveBeenCalledOnce())
  runtime.releaseUnused(new Set()); finish(); await rejected
  expect(author.render).not.toHaveBeenCalled()
  expect(runtime.diagnostics()).toMatchObject({ surfaces: 0, textureAllocations: 1 })
  await runtime.dispose()
})

it('参数与时间变化复用目标，完整参数、素材和覆盖直接传给作者', async () => {
  const { runtime, program } = fixture()
  const size = { width: 16, height: 16 }, assets = {}, overrides = { title: { dx: 12 } }
  try {
    const first = await runtime.authorGenerator('frame', 'clip', program, size, { title: 'A' }, assets, info, overrides)
    const nextInfo = { ...info, time: 2 }
    const second = await runtime.authorGenerator('frame', 'clip', program, size, { title: 'B' }, assets, nextInfo, overrides)
    expect(second).toBe(first)
    expect(author.render).toHaveBeenLastCalledWith(first.texture, 16, 16, { title: 'B' }, assets, nextInfo, overrides, { frames: [], images: {} }, true)
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 1, textureAllocations: 1, generatorFrames: 2 })
  } finally { await runtime.dispose() }
  expect(runtime.diagnostics()).toMatchObject({ surfaces: 0, residentBytes: 0 })
})

it('1/2 回放分辨率：输出纹理减半、放置尺寸不变，作者拿到输出尺寸与 renderScale；完整分辨率原样调用', async () => {
  const { runtime, program } = fixture()
  const size = { width: 3840, height: 2160 }
  try {
    const half = await runtime.authorGenerator('frame', 'clip', program, size, {}, {}, info, undefined, true, {}, 2)
    expect([half.width, half.height, half.displayWidth, half.displayHeight]).toEqual([1920, 1080, 3840, 2160])
    expect(author.render).toHaveBeenLastCalledWith(half.texture, 3840, 2160, {}, {}, { ...info, renderScale: .5 }, undefined, { frames: [], images: {} }, true, { width: 1920, height: 1080 })
    // 切回完整分辨率：换一张整幅纹理，调用与以前逐项相同
    const full = await runtime.authorGenerator('frame', 'clip', program, size, {}, {}, info)
    expect([full.width, full.height, full.displayWidth, full.displayHeight]).toEqual([3840, 2160, 3840, 2160])
    expect(full).not.toBe(half)
    expect(author.render).toHaveBeenLastCalledWith(full.texture, 3840, 2160, {}, {}, info, undefined, { frames: [], images: {} }, true)
    expect(runtime.renderDivisor).toBe(1); runtime.setRenderDivisor(4); expect(runtime.renderDivisor).toBe(4)
  } finally { await runtime.dispose() }
})

it('滤镜保留输入精度与相邻帧，拒绝跨设备、错误顺序和输入输出别名', async () => {
  const { runtime, program } = fixture()
  const filter = { ...program, kind: 'filter' as const, frames: [-.5] }
  try {
    const input = await runtime.target('input', 16, 16, 'rgba16float')
    const frames = [{ offset: -.5, texture: input.texture, available: true }]
    const output = await runtime.authorFilter('filtered', 'effect', filter, { gain: .4 }, input, info, frames)
    expect(output.textureFormat).toBe('rgba16float')
    expect(author.render).toHaveBeenLastCalledWith(output.texture, 16, 16, { gain: .4 }, {}, info, undefined, { current: input.texture, frames, images: {} })
    const calls = author.render.mock.calls.length
    await expect(runtime.authorFilter('bad', 'effect', filter, {}, input, info, [])).rejects.toThrow('匹配输入')
    await expect(runtime.authorFilter('bad', 'effect', filter, {}, { ...input, owner: {} as GpuDevice }, info, frames)).rejects.toThrow('当前渲染设备')
    await expect(runtime.authorFilter('input', 'effect', filter, {}, input, info, frames)).rejects.toThrow('同一纹理')
    expect(author.render).toHaveBeenCalledTimes(calls)
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 2, textureAllocations: 2 })
  } finally { await runtime.dispose() }
})

it('作者导入失败不分配候选目标，修正版本后恢复且原输入不销毁', async () => {
  const { runtime, program, destroyed } = fixture()
  try {
    const input = await runtime.target('input', 16, 16)
    author.instance.mockRejectedValueOnce(new Error('作者模块语法错误'))
    await expect(runtime.authorFilter('output', 'effect', program, {}, input, info)).rejects.toThrow('语法错误')
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 1, textureAllocations: 1 })
    expect(destroyed).not.toHaveBeenCalled()
    await runtime.authorFilter('output', 'effect', program, {}, input, info)
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 2, filterFrames: 1 })
  } finally { await runtime.dispose() }
})

it('作者目标共享512MiB预算，回收不可见目标后恢复且不降低分辨率', async () => {
  const { runtime, program } = fixture()
  const size = { width: 3840, height: 2160 }
  try {
    for (let i = 0; i < 16; i++) await runtime.authorGenerator(String(i), String(i), program, size, {}, {}, info)
    await expect(runtime.authorGenerator('overflow', 'overflow', program, size, {}, {}, info)).rejects.toThrow('512MiB')
    expect(runtime.diagnostics().surfaces).toBe(16)
    runtime.releaseUnused(new Set(['0']))
    const output = await runtime.authorGenerator('overflow', 'overflow', program, size, {}, {}, info)
    expect([output.width, output.height]).toEqual([3840, 2160])
    expect(runtime.diagnostics().surfaces).toBe(2)
  } finally { await runtime.dispose() }
})

it('每次作者绘制只登记一次GPU完成，后续帧不改写已捕获的耗时', async () => {
  const { runtime, program, device } = fixture()
  let tick = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => ++tick)
  try {
    let complete!: () => void
    vi.mocked(device.queue.onSubmittedWorkDone).mockReturnValueOnce(new Promise<void>(resolve => { complete = resolve }))
    await runtime.authorGenerator('frame', 'clip', program, { width: 16, height: 16 }, {}, {}, info)
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledOnce()
    const captured = runtime.captureFramePerformance()
    complete()
    await vi.waitFor(() => expect(captured()[0].gpuMs).toBeGreaterThan(0))
    const first = { ...captured()[0] }
    expect(first.frame).toBe(60); expect(first.gpuMs).toBeGreaterThan(0)
    runtime.resetFramePerformance()
    await runtime.authorGenerator('frame', 'clip', program, { width: 16, height: 16 }, {}, {}, { ...info, time: 2 })
    expect(captured()[0]).toEqual(first)
  } finally { await runtime.dispose(); clock.mockRestore() }
})

it('成本报告带上各片段图层的沿用与上传统计，同一序列帧的片段相加；原生 GPU 入口不报', async () => {
  const { runtime, program } = fixture()
  try {
    author.render.mockResolvedValueOnce({ reused: 3, redrawn: 1, direct: 0, video: 0, uploads: 1, uploadBytes: 1024 })
    await runtime.authorGenerator('a', 'clip-a', program, { width: 16, height: 16 }, {}, {}, info)
    author.render.mockResolvedValueOnce({ reused: 0, redrawn: 1, direct: 1, video: 1, uploads: 2, uploadBytes: 2048 })
    await runtime.authorGenerator('b', 'clip-b', program, { width: 16, height: 16 }, {}, {}, info)
    author.render.mockResolvedValueOnce(undefined)
    await runtime.authorGenerator('c', 'clip-c', program, { width: 16, height: 16 }, {}, {}, info)
    expect(runtime.captureFramePerformance()()[0].layers).toEqual({ reused: 3, redrawn: 2, direct: 1, video: 1, uploads: 3, uploadBytes: 3072 })
    runtime.resetFramePerformance()
    author.render.mockResolvedValueOnce(undefined)
    await runtime.authorGenerator('c', 'clip-c', program, { width: 16, height: 16 }, {}, {}, info)
    expect(runtime.captureFramePerformance()()[0]).not.toHaveProperty('layers')
  } finally { await runtime.dispose() }
})
