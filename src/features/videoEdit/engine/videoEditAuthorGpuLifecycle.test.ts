import { afterEach, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import { testAuthorBundle, testAuthorProgram } from './videoEditAuthorTestFixtures'
import type { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'
import type { VideoEditBuiltinScratchAllocator } from './videoEditBuiltinEffectsGpu'

const author = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn(), instance: vi.fn(), constructed: vi.fn() }))
const logError = vi.hoisted(() => vi.fn())
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: logError }) }))
vi.mock('./videoEditAuthorPrograms', () => ({ VideoEditAuthorPrograms: class {
  constructor(...args: unknown[]) { author.constructed(...args) }
  instance = author.instance
  dispose = author.dispose
} }))
afterEach(() => { vi.resetAllMocks() })
function fixture() {
  const destroyed = vi.fn()
  const events = new EventTarget()
  const device: GpuDevice = {
    queue: { copyExternalImageToTexture: vi.fn(), writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: vi.fn(async () => {}) },
    lost: new Promise(() => {}), createShaderModule: vi.fn(), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createSampler: vi.fn(),
    createTexture: () => ({ createView: () => ({}), destroy: destroyed }), createBuffer: () => ({ destroy: destroyed }), createBindGroup: vi.fn(),
    createCommandEncoder: vi.fn(), pushErrorScope: vi.fn(), popErrorScope: async () => null, destroy: vi.fn(),
  }
  author.instance.mockResolvedValue({ render: (...args: unknown[]) => { if (typeof args[0] === 'function') args[0] = args[0](); return author.render(...args) } })
  const program = testAuthorProgram(testAuthorBundle('export default {name:"异步作者",draw(){}}'))
  Object.assign(device, { addEventListener: events.addEventListener.bind(events), removeEventListener: vi.fn(events.removeEventListener.bind(events)) })
  const emitError = (message: string): void => { events.dispatchEvent(Object.assign(new Event('uncapturederror'), { error: { message } })) }
  return { runtime: new VideoEditCodeGpu(device), device, program, destroyed, emitError }
}
const info = { time: 1, frameDuration: 1 / 60, clip: { time: 1, duration: 3 } }

it.each([new DOMException('取消', 'AbortError'), new CodeMaterialError('CONTEXT', '输入已退役')])('作者滤镜保留异常原类型与实例：%s', async error => {
  const { runtime, program, device } = fixture()
  try {
    const input = await runtime.target('input', 16, 16, 'rgba16float')
    const scopes = vi.mocked(device.pushErrorScope).mock.calls.length
    author.render.mockRejectedValueOnce(error)
    await expect(runtime.authorFilter('filter', 'filter', program, {}, input, info)).rejects.toBe(error)
    expect(device.pushErrorScope).toHaveBeenCalledTimes(scopes)
    expect((await runtime.authorFilter('filter', 'filter', program, {}, input, info)).textureFormat).toBe('rgba16float')
  } finally { await runtime.dispose() }
})

it.each(['frame', 'nested:frame:child'])('连续触发帧两档热循环零分配，闲置一帧或键不用后释放：%s', async key => {
  const { runtime, destroyed } = fixture()
  const boundary = (keys: Set<string>): void => { if (key.startsWith('nested:')) runtime.releaseNestedFrames(keys); else runtime.releaseUnused(keys) }
  try {
    const first = await runtime.target(key, 16, 16)
    const precise = await runtime.target(key, 16, 16, 'rgba16float')
    const allocations = runtime.diagnostics().textureAllocations
    for (let frame = 0; frame < 5; frame++) {
      boundary(new Set([key]))
      expect(await runtime.target(key, 16, 16)).toBe(first)
      expect(await runtime.target(key, 16, 16, 'rgba16float')).toBe(precise)
      expect(runtime.diagnostics().textureAllocations).toBe(allocations)
      expect(destroyed).not.toHaveBeenCalled()
    }
    boundary(new Set([key]))
    await runtime.target(key, 16, 16, 'rgba16float')
    boundary(new Set([key]))
    expect(destroyed).toHaveBeenCalledTimes(1)
    expect(runtime.diagnostics().residentBytes).toBe(16 * 16 * 8)
    await runtime.target(key, 16, 16)
    boundary(new Set())
    expect(destroyed).toHaveBeenCalledTimes(3)
    expect(runtime.diagnostics().residentBytes).toBe(0)
  } finally { await runtime.dispose() }
})

it('共享设备错误在作者执行前后和并发期间只记一次原文，最后一个宿主关闭才移除监听', async () => {
  const { runtime, program, device, emitError } = fixture()
  const other = new VideoEditCodeGpu(device)
  const raw = 'Attachment rgba16float does not match pipeline rgba8unorm'
  try {
    const input = await runtime.target('input', 16, 16, 'rgba16float')
    emitError(raw)
    author.render.mockImplementationOnce(async () => { emitError(raw) })
    expect((await runtime.authorFilter('filter', 'filter', program, {}, input, info)).textureFormat).toBe('rgba16float')
    let complete!: () => void
    author.render.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve }))
    const pending = runtime.authorFilter('first', 'first', program, {}, input, info)
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    await other.authorFilter('second', 'second', program, {}, input, info)
    emitError(raw); complete(); await pending
    emitError(raw)
    expect(logError).toHaveBeenCalledTimes(4)
    for (const [, details] of logError.mock.calls) {
      expect(details.error.message).toBe(raw)
      expect(details).not.toHaveProperty('context')
    }
    await runtime.dispose(); emitError(raw)
    expect(logError).toHaveBeenCalledTimes(5)
  } finally { await runtime.dispose(); await other.dispose() }
  emitError(raw)
  expect(logError).toHaveBeenCalledTimes(5)
})

it('图层效果分配器进入宿主预算，完整 mip 按实际尺寸计费并在释放时归还', async () => {
  const { runtime, program } = fixture()
  try {
    await runtime.authorGenerator('output', 'clip', program, { width: 16, height: 16 }, {}, {}, info)
    const allocator = author.constructed.mock.calls[0][2] as VideoEditBuiltinScratchAllocator
    const before = runtime.diagnostics().residentBytes
    const texture = allocator.allocate(9, 5, 'rgba8unorm', 4)
    expect(runtime.diagnostics().residentBytes - before).toBe((9 * 5 + 4 * 2 + 2 + 1) * 4)
    allocator.release(texture)
    expect(runtime.diagnostics().residentBytes).toBe(before)
    const fullFloat = allocator.allocate(9, 5, 'rgba32float')
    expect(runtime.diagnostics().residentBytes - before).toBe(9 * 5 * 16)
    allocator.release(fullFloat)
    expect(runtime.diagnostics().residentBytes).toBe(before)
    for (const format of ['rgba32float', 'rgba16float']) { const large = allocator.allocate(8192, 8192, format); allocator.release(large) }
    expect(() => allocator.allocate(8193, 1, 'rgba16float')).toThrow(/设备上限/)
    expect(runtime.diagnostics().residentBytes).toBe(before)
  } finally { await runtime.dispose() }
})

it('仅 API 7 本帧实际产光时发布标记，重用目标后不会遗留；代码滤镜不继承标记', async () => {
  const { runtime, program } = fixture()
  const instance = { render: (...args: unknown[]) => { if (typeof args[0] === 'function') args[0] = args[0](); return author.render(...args) }, carriesLight: true }
  author.instance.mockResolvedValue(instance)
  try {
    for (const apiVersion of [4, 5, 6, 7] as const) {
      const picture = await runtime.authorGenerator('output', 'clip', { ...program, apiVersion }, { width: 16, height: 16 }, {}, {}, info)
      expect(picture.carriesLight).toBe(apiVersion === 7)
    }
    instance.carriesLight = false
    const picture = await runtime.authorGenerator('output', 'clip', { ...program, apiVersion: 7 }, { width: 16, height: 16 }, {}, {}, info)
    expect(picture.carriesLight).toBe(false)
    instance.carriesLight = true
    expect((await runtime.authorFilter('filter', 'clip', { ...program, apiVersion: 7 }, {}, picture, info)).carriesLight).toBe(false)
  } finally { await runtime.dispose() }
})

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
    expect(author.render).toHaveBeenLastCalledWith(first.texture, 16, 16, { title: 'B' }, assets, nextInfo, overrides, { frames: [], images: {} }, true, undefined, {}, 'interactive', expect.any(Function), expect.any(Function), undefined)
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
    expect(author.render).toHaveBeenLastCalledWith(half.texture, 3840, 2160, {}, {}, { ...info, renderScale: .5 }, undefined, { frames: [], images: {} }, true, { width: 1920, height: 1080 }, {}, 'interactive', expect.any(Function), expect.any(Function), undefined)
    const reduced = await runtime.authorGenerator('frame', 'clip', program, size, {}, {}, info, undefined, true, {}, 1.5)
    expect([reduced.width, reduced.height, reduced.displayWidth, reduced.displayHeight]).toEqual([2560, 1440, 3840, 2160])
    expect(author.render).toHaveBeenLastCalledWith(reduced.texture, 3840, 2160, {}, {}, { ...info, renderScale: 2 / 3 }, undefined, { frames: [], images: {} }, true, { width: 2560, height: 1440 }, {}, 'interactive', expect.any(Function), expect.any(Function), undefined)
    // 切回完整分辨率：换一张整幅纹理，调用与以前逐项相同
    const full = await runtime.authorGenerator('frame', 'clip', program, size, {}, {}, info)
    expect([full.width, full.height, full.displayWidth, full.displayHeight]).toEqual([3840, 2160, 3840, 2160])
    expect(full).not.toBe(half)
    expect(author.render).toHaveBeenLastCalledWith(full.texture, 3840, 2160, {}, {}, info, undefined, { frames: [], images: {} }, true, undefined, {}, 'interactive', expect.any(Function), expect.any(Function), undefined)
    expect(runtime.renderDivisor).toBe(1); runtime.setRenderDivisor(4); expect(runtime.renderDivisor).toBe(4)
  } finally { await runtime.dispose() }
})

it('放大导出中的高分辨率作者按实际纹理传 renderScale，保持逻辑放置尺寸', async () => {
  const { runtime, program } = fixture()
  try {
    const output = await runtime.authorGenerator('frame', 'clip', program, { width: 8192, height: 4320 }, {}, {}, info, undefined, true, {}, .5)
    expect([output.width, output.height, output.displayWidth, output.displayHeight]).toEqual([8192, 4320, 8192, 4320])
    expect(author.render).toHaveBeenLastCalledWith(output.texture, 8192, 4320, {}, {}, { ...info, renderScale: 1 }, undefined, { frames: [], images: {} }, true, { width: 8192, height: 4320 }, {}, 'interactive', expect.any(Function), expect.any(Function), undefined)
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
    expect(author.render.mock.lastCall?.slice(0, 8)).toEqual([output.texture, 16, 16, { gain: .4 }, {}, info, undefined, { current: input.texture, frames, images: {} }])
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

it('作者目标按实际字节计量，超过历史预算仍可渲染，回收不可见目标', async () => {
  const { runtime, program } = fixture()
  const size = { width: 3840, height: 2160 }
  try {
    for (let i = 0; i < 16; i++) await runtime.authorGenerator(String(i), String(i), program, size, {}, {}, info)
    await runtime.authorGenerator('overflow', 'overflow', program, size, {}, {}, info)
    expect(runtime.diagnostics().surfaces).toBe(17)
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


it('层式作者滤镜首层升档回传实际目标，生成与预热也不先分配八位输出', async () => {
  const { runtime, program } = fixture()
  const initialCalls = vi.fn()
  author.instance.mockResolvedValue({ render: async (...args: Parameters<VideoEditAuthorRuntime['render']>) => {
    const [initial, , , , , , , , , , , , , promote] = args
    expect(typeof initial).toBe('function')
    initialCalls(typeof initial)
    promote!()
  } })
  try {
    const input = await runtime.target('input', 16, 16)
    const before = runtime.diagnostics().residentBytes
    const filtered = await runtime.authorFilter('filter', 'filter', program, {}, input, info)
    expect(filtered.textureFormat).toBe('rgba16float')
    expect(runtime.diagnostics().residentBytes - before).toBe(16 * 16 * 8)
    const generated = await runtime.authorGenerator('generator', 'generator', program, { width: 16, height: 16 }, {}, {}, info)
    expect(generated.textureFormat).toBe('rgba16float')
    expect(runtime.diagnostics().residentBytes - before).toBe(16 * 16 * 8 * 2)
    await runtime.warmAuthor('warm', program, { width: 16, height: 16 }, {}, {}, info)
    expect(runtime.diagnostics().residentBytes - before).toBe(16 * 16 * 8 * 2)
    expect(initialCalls).toHaveBeenCalledTimes(3)
  } finally { await runtime.dispose() }
})

it.each(['frame', 'nested:frame:child'])('换档或尺寸分配失败保留现有画面，恢复后复用并完整释放：%s', async key => {
  const { runtime, device, destroyed } = fixture()
  try {
    const first = await runtime.target(key, 16, 16)
    const create = device.createTexture
    device.createTexture = () => { throw new Error('分配失败') }
    await expect(runtime.target(key, 16, 16, 'rgba16float')).rejects.toThrow('分配失败')
    expect(await runtime.target(key, 16, 16)).toBe(first)
    expect(runtime.diagnostics().residentBytes).toBe(16 * 16 * 4)
    expect(destroyed).not.toHaveBeenCalled()
    device.createTexture = create
    const precise = await runtime.target(key, 16, 16, 'rgba16float')
    device.createTexture = () => { throw new Error('尺寸分配失败') }
    await expect(runtime.target(key, 32, 16)).rejects.toThrow('尺寸分配失败')
    expect(await runtime.target(key, 16, 16)).toBe(first)
    expect(await runtime.target(key, 16, 16, 'rgba16float')).toBe(precise)
    expect(destroyed).not.toHaveBeenCalled()
    device.createTexture = create
    await runtime.target(key, 32, 16)
    expect(runtime.diagnostics().residentBytes).toBe(32 * 16 * 4)
  } finally { await runtime.dispose() }
  expect(destroyed).toHaveBeenCalledTimes(3)
})

it('并发作者滤镜失败归属各自调用，不在跨 await 的设备栈上开错误作用域', async () => {
  const { runtime, program, device } = fixture()
  try {
    const input = await runtime.target('input', 16, 16)
    const scopes = vi.mocked(device.pushErrorScope).mock.calls.length
    let fail!: () => void
    author.render.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = () => reject(new Error('甲失败')) }))
    const first = runtime.authorFilter('first', 'first', { ...program, name: '甲' }, {}, input, info)
    const rejected = expect(first).rejects.toThrow('甲失败')
    await vi.waitFor(() => expect(author.render).toHaveBeenCalledOnce())
    expect((await runtime.authorFilter('second', 'second', { ...program, name: '乙' }, {}, input, info)).textureFormat).toBe('rgba8unorm')
    fail(); await rejected
    expect(device.pushErrorScope).toHaveBeenCalledTimes(scopes)
  } finally { await runtime.dispose() }
})
