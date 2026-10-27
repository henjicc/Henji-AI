import { createVideoEditTestDocument as createVideoEditDocument } from '../../../core/videoEdit/testFixtures'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { VideoEditGpuDeviceLostError } from './videoEditGpuFailure'
import type { VideoSample } from 'mediabunny'
import { VideoEditCodePicture } from './videoEditCodePicture'
import { VideoEditNativePicture } from './videoEditNativePicture'
import type { NativeVideoFrame } from './videoEditNativeFrames'
import { videoEditCornerPinMatrix, type VideoEditTrackQuad } from '@/core/videoEdit/tracking'

const state = vi.hoisted(() => ({ device: undefined as GpuDevice | undefined, format: 'rgba8unorm', acquisitions: 0, destroyedManagers: 0, loss: undefined as ((reason: string) => void) | undefined }))
it('导出捕获在画布纹理过期前复制到 GPU 位图，不映射 CPU 缓冲区', async () => {
  const capture = Object.assign(vi.fn(), { gpu: true, maxPixels: Infinity })
  const bitmap = { close: vi.fn() }
  const transfer = vi.fn(() => bitmap)
  const destination = { createView: () => ({}) }
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { configure: vi.fn(), getCurrentTexture: () => destination } }
    transferToImageBitmap = transfer
  })
  const { compositor, device } = copyFixture(async () => {}, () => capture)
  const project = createVideoEditDocument('GPU 捕获')
  await (await compositor.draw(videoEditComposition(project, project.sequences[0].id), [], [], () => true)).completion
  expect(await capture.mock.calls[0][0]).toBe(bitmap)
  expect(transfer).toHaveBeenCalledOnce()
  const copies = device.createCommandEncoder.mock.results.map(result => result.value)
  expect(copies.some(encoder => encoder.copyTextureToTexture.mock.calls.length === 1)).toBe(true)
  expect(copies.every(encoder => encoder.copyTextureToBuffer.mock.calls.length === 0)).toBe(true)
  await compositor.dispose()
})
it('设备丢失必须交给会话重建，父设备丢失同样使嵌套画面失效', async () => {
  const { compositor, output } = copyFixture(async () => {})
  await compositor.prepare()
  const lost = state.loss!
  const child = compositor.fork(output)
  await child.prepare()
  lost('Device was destroyed.')
  await expect(compositor.snapshot({} as VideoSample, false)).rejects.toBeInstanceOf(VideoEditGpuDeviceLostError)
  await expect(child.prepare()).rejects.toBeInstanceOf(VideoEditGpuDeviceLostError)
  await child.dispose(); await compositor.dispose()
})
it('代码视频输入借用同设备预乘纹理，不上传、不夺取所有权，只有读位图才拷贝，跨设备及取消明确拒绝', async () => {
  const { compositor, device } = copyFixture(async () => {})
  const bitmap = { width: 640, height: 360, close: vi.fn() }
  const transfer = vi.fn(() => bitmap)
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { configure: vi.fn(), getCurrentTexture: () => ({ createView: () => ({}) }) } }
    transferToImageBitmap = transfer
  })
  const texture = { createView: () => ({}), destroy: vi.fn() }
  const picture = new VideoEditCodePicture(texture, 640, 360, device, 'rgba16float')
  try {
    const inputs = await compositor.prepareImages(new Map([['one', picture], ['two', picture]]), () => true)
    expect(inputs.get('one')).toMatchObject({ texture, owner: device, premultiplied: true })
    expect(inputs.get('two')!.texture).toBe(inputs.get('one')!.texture)
    expect(transfer).not.toHaveBeenCalled()
    expect(inputs.get('one')!.source).toBe(bitmap)
    expect(inputs.get('two')!.source).toBe(bitmap)
    expect(transfer).toHaveBeenCalledOnce()
    expect(device.queue.copyExternalImageToTexture).not.toHaveBeenCalled()
    expect(compositor.imageDiagnostics()).toMatchObject({ textures: 0, bytes: 0, uploads: 0 })
    const stale = inputs.get('one')!
    await compositor.prepareImages(new Map([['one', picture]]), () => true)
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(() => stale.source).toThrow('过期')
    const foreign = new VideoEditCodePicture(texture, 640, 360, {} as GpuDevice)
    await expect(compositor.prepareImages(new Map([['bad', foreign]]), () => true)).rejects.toThrow('设备')
    await expect(compositor.prepareImages(new Map([['one', picture]]), () => false)).rejects.toThrow('取消')
    expect(texture.destroy).not.toHaveBeenCalled()
  } finally { await compositor.dispose() }
  expect(texture.destroy).not.toHaveBeenCalled()
  expect(bitmap.close).toHaveBeenCalledOnce()
})
it('输入画面保持原节目画布黑底，普通嵌套目标仍保留透明背景', async () => {
  const { compositor, device } = copyFixture(async () => {}), model = createVideoEditDocument('输入黑底')
  model.sequences[0].width = 3840; model.sequences[0].height = 2160
  const composition = videoEditComposition(model, model.sequences[0].id)
  try {
    const target = await (await compositor.code()).target('target', 3840, 2160)
    for (const opaque of [false, true]) {
      const picture = new VideoEditCodePicture(target.texture, target.width, target.height, target.owner, target.textureFormat, opaque)
      await (await compositor.draw(composition, [], [], () => true, undefined, picture)).completion
      const descriptor = device.createCommandEncoder.mock.results.at(-1)!.value.beginRenderPass.mock.calls[0][0] as { colorAttachments: { clearValue: { a: number } }[] }
      expect(descriptor.colorAttachments[0].clearValue.a).toBe(opaque ? 1 : 0)
    }
  } finally { await compositor.dispose() }
})
it('首帧管线并行异步编译，全部就绪前不提交 GPU 命令', async () => {
  const { compositor, device } = copyFixture(async () => {})
  const finishes: Array<() => void> = []
  const compile = vi.fn((descriptor: unknown) => new Promise<ReturnType<typeof device.createRenderPipeline>>(resolve => finishes.push(() => resolve({ descriptor, getBindGroupLayout: () => ({}) }))))
  Object.assign(device, { createRenderPipelineAsync: compile })
  const project = createVideoEditDocument('并行初始化')
  const draw = compositor.draw(videoEditComposition(project, project.sequences[0].id), [], [], () => true)
  await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(9))
  expect(device.createRenderPipeline).not.toHaveBeenCalled()
  expect(device.queue.submit).not.toHaveBeenCalled()
  for (const finish of finishes) finish()
  await (await draw).completion
  expect(device.queue.submit).toHaveBeenCalledOnce()
  await compositor.dispose()
})
it('空闲预建只完成设备和管线，不提交画面；释放后不能再接管', async () => {
  const { compositor, device } = copyFixture(async () => {})
  await compositor.prepare()
  expect(device.queue.submit).not.toHaveBeenCalled()
  await compositor.dispose()
  await expect(compositor.prepare()).rejects.toThrow('会话不可用')
})
it('预览及离屏导出写同一透视矩阵，普通片段清空矩阵且不受上帧绑定污染',async()=> {
  const {compositor,device}=copyFixture(async()=>{})
  const project=createVideoEditDocument('贴屏');project.items.push({id:'image',kind:'image',name:'输入'})
  const document=videoEditComposition(project,project.sequences[0].id);const clip=makeVideoEditItemClip(project,'image',document.id,{frame:0})
  const quad:VideoEditTrackQuad=[[.1,.2],[.8,.1],[.9,.8],[.2,.9]];const tracked={...clip,trackingQuad:quad};const h=videoEditCornerPinMatrix(quad)
  const code=await compositor.code();const input=await code.target('source',100,100);const target=await code.target('export',document.width,document.height)
  await (await compositor.draw(document,[tracked],[input],()=>true)).completion
  const preview=new Float32Array(device.queue.writeBuffer.mock.lastCall![2] as Float32Array)
  await (await compositor.draw(document,[tracked],[input],()=>true,undefined,target)).completion
  expect(device.queue.writeBuffer.mock.lastCall![2]).toEqual(preview)
  expect([...preview.slice(12)]).toEqual([h[0],h[1],h[2],0,h[3],h[4],h[5],0,h[6],h[7],h[8],0].map(Math.fround))
  await (await compositor.draw(document,[clip],[input],()=>true)).completion
  expect([...(device.queue.writeBuffer.mock.lastCall![2] as Float32Array).slice(12)]).toEqual(new Array<number>(12).fill(0))
  await compositor.dispose()
})
afterEach(() => { vi.unstubAllGlobals(); state.format = 'rgba8unorm' })
it('历史像素复制编码在同一提交内，保留带行填充的 BGRA；离屏不截取，普通预览不读回', async () => {
  let complete!: () => void
  const fence = new Promise<void>(resolve => { complete = resolve })
  const capture = vi.fn()
  const close = vi.fn(); const bitmap = { close } as unknown as ImageBitmap
  const imageData = vi.fn(function(this: { data: Uint8ClampedArray; width: number; height: number }, data: Uint8ClampedArray, width: number, height: number) { this.data = data; this.width = width; this.height = height })
  vi.stubGlobal('ImageData', imageData); vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  state.format = 'bgra8unorm'
  let enabled = true
  const { compositor, device, output } = copyFixture(() => fence, () => enabled ? capture : undefined)
  output.width = 2; output.height = 2
  const mapped = new Uint8Array(512); mapped.set([3, 2, 1, 255, 6, 5, 4, 255]); mapped.set([9, 8, 7, 255, 12, 11, 10, 255], 256)
  const buffer = { mapAsync: vi.fn(async () => {}), getMappedRange: () => mapped.buffer, unmap: vi.fn(), destroy: vi.fn() }
  device.createBuffer.mockReturnValueOnce(buffer)
  capture.mockImplementation(() => { expect(device.queue.submit).toHaveBeenCalled() })
  const project = createVideoEditDocument('历史呈现')
  const composition = videoEditComposition(project, project.sequences[0].id)
  const result = await compositor.draw(composition, [], [], () => true)
  expect(capture).toHaveBeenCalledOnce()
  const pixels = capture.mock.calls[0][0] as Promise<ImageBitmap>
  expect(await pixels).toBe(bitmap)
  expect(imageData.mock.calls[0][0]).toEqual(new Uint8ClampedArray([1,2,3,255,4,5,6,255,7,8,9,255,10,11,12,255]))
  expect(buffer.unmap).toHaveBeenCalledOnce(); expect(buffer.destroy).toHaveBeenCalledOnce()
  expect(device.createCommandEncoder.mock.results[0].value.copyTextureToBuffer).toHaveBeenCalledOnce()
  let finished = false; void result.completion.then(() => { finished = true })
  await Promise.resolve(); expect(finished).toBe(false)
  const target = await (await compositor.code()).target('export', composition.width, composition.height)
  const offscreen = await compositor.draw(composition, [], [], () => true, undefined, target)
  expect(capture).toHaveBeenCalledOnce()
  complete(); await Promise.all([result.completion, offscreen.completion])
  enabled = false
  await (await compositor.draw(composition, [], [], () => true)).completion
  expect(capture).toHaveBeenCalledOnce()
  expect(device.createCommandEncoder.mock.results.at(-1)!.value.copyTextureToBuffer).not.toHaveBeenCalled()
  await compositor.dispose()
})
it('历史缓冲区映射失败仍销毁缓冲区，错误交给采集而不伪造画面', async () => {
  const capture = vi.fn()
  const { compositor, device } = copyFixture(async () => {}, () => capture)
  const buffer = { mapAsync: vi.fn(async () => { throw new Error('映射失败') }), destroy: vi.fn() }
  device.createBuffer.mockReturnValueOnce(buffer)
  const project = createVideoEditDocument('失败释放')
  await (await compositor.draw(videoEditComposition(project, project.sequences[0].id), [], [], () => true)).completion
  await expect(capture.mock.calls[0][0]).rejects.toThrow('映射失败')
  expect(buffer.destroy).toHaveBeenCalledOnce()
  await compositor.dispose()
})
it.each([undefined, Infinity])('快照像素预算 %s：历史缩放而正式取帧保留全尺寸', async maxPixels => {
  const capture = Object.assign(vi.fn(), { maxPixels })
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap
  vi.stubGlobal('ImageData', class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} })
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  const { compositor, device, output } = copyFixture(async () => {}, () => capture)
  output.width = 1920; output.height = 1080
  device.createBuffer.mockReturnValueOnce({ mapAsync: async () => {}, getMappedRange: () => new ArrayBuffer(1920 * 1080 * 4), unmap: vi.fn(), destroy: vi.fn() })
  try {
    const document = createVideoEditDocument('取帧分辨率')
    await (await compositor.draw(videoEditComposition(document, document.sequences[0].id), [], [], () => true)).completion
    await capture.mock.calls[0][0]
    expect(createImageBitmap).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 1080 }), {
      resizeWidth: maxPixels === Infinity ? 1920 : 1280, resizeHeight: maxPixels === Infinity ? 1080 : 720, resizeQuality: 'high',
    })
    bitmap.close()
  } finally { await compositor.dispose() }
})
it('GPU validation failure rejects the frame receipt instead of reporting a blank frame as successful', async () => {
  const { compositor, device } = copyFixture(async () => {})
  const project = createVideoEditDocument('合成错误')
  await compositor.code()
  device.popErrorScope.mockResolvedValueOnce({ message: 'invalid draw binding' })
  const result = await compositor.draw(videoEditComposition(project, project.sequences[0].id), [], [], () => true)
  await expect(result.completion).rejects.toThrow('invalid draw binding')
  await compositor.dispose()
})
vi.mock('@/core/imageEdit/webgpu/deviceManager', () => ({ ImageEditWebGpuDeviceManager: class {
  onDeviceLost(callback: (reason: string) => void) { state.loss = callback }
  async acquire() { state.acquisitions++; return { device: state.device!, provider: { getPreferredCanvasFormat: () => state.format } } }
  destroy() { state.destroyedManagers++ }
} }))
it('嵌套合成共享父 GPU 设备，子合成器销毁不销毁父设备，保留半浮点图层', async () => {
  const acquired = state.acquisitions; const destroyed = state.destroyedManagers
  const { compositor, device } = copyFixture(async () => {})
  const canvas = { width: 64, height: 64, getContext: () => ({ configure: vi.fn(), getCurrentTexture: () => ({ createView: () => ({}) }) }) } as unknown as OffscreenCanvas
  const child = compositor.fork(canvas)
  const picture = await (await child.code()).target('nested:frame:0', 64, 64, 'rgba16float')
  expect(picture.owner).toBe(device); expect(device.createTexture).toHaveBeenCalledWith(expect.objectContaining({ format: 'rgba16float' }))
  expect(state.acquisitions).toBe(acquired + 1)
  await child.dispose(); expect(state.destroyedManagers).toBe(destroyed)
  await compositor.blank(64, 64, 0, 1 / 30)
  await compositor.dispose(); expect(state.destroyedManagers).toBe(destroyed + 1)
})
function copyFixture(fence: () => Promise<void>, capture?: () => ((pixels: Promise<ImageBitmap>) => void) | undefined, idle?: () => void) {
  const closed = vi.fn(); const destroyed = vi.fn()
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() }
  const device = {
    queue: { copyExternalImageToTexture: vi.fn(), writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: fence },
    lost: new Promise<{ reason?: string; message?: string }>(() => {}), createShaderModule: vi.fn(), createRenderPipeline: vi.fn((descriptor: unknown) => ({ descriptor, getBindGroupLayout: () => ({}) })), createSampler: vi.fn(),
    createTexture: vi.fn((descriptor: unknown) => ({ descriptor, createView: () => ({ descriptor }), destroy: destroyed })), createBuffer: vi.fn((): { destroy: ReturnType<typeof vi.fn>; mapAsync?: (mode: number) => Promise<void>; getMappedRange?: () => ArrayBuffer; unmap?: () => void } => ({ destroy: vi.fn() })),
    createBindGroup: vi.fn(), createCommandEncoder: vi.fn(() => ({ beginRenderPass: vi.fn((_descriptor: unknown) => pass), copyTextureToBuffer: vi.fn(), copyTextureToTexture: vi.fn(), finish: () => ({}) })), pushErrorScope: vi.fn(), popErrorScope: vi.fn(async (): Promise<{ message?: string } | null> => null), destroy: vi.fn(), importExternalTexture: vi.fn(),
  }
  state.device = device
  const canvasView = { canvas: true }
  const output = { width: 3840, height: 2160, getContext: () => ({ configure: vi.fn(), getCurrentTexture: () => ({ createView: () => canvasView }) }) } as unknown as OffscreenCanvas
  const compositor = new VideoEditGpuCompositor(output, undefined, capture, undefined, idle)
  const sample = { timestamp: 0, duration: 1 / 60, displayWidth: 3840, displayHeight: 2160, rotation: 0, flip: false, toVideoFrame: () => ({ visibleRect: { width: 3840, height: 2160 }, close: closed }) } as unknown as VideoSample
  return { compositor, sample, device, closed, destroyed, canvasView, pass, output }
}
it('已经到时的画面直接提交，不再等待额外一次垂直同步', async () => {
  const request = vi.fn((callback: FrameRequestCallback) => { queueMicrotask(() => callback(performance.now())); return 1 })
  vi.stubGlobal('self', { requestAnimationFrame: request, cancelAnimationFrame: vi.fn() })
  const { compositor, device } = copyFixture(async () => {})
  const document = createVideoEditDocument('到时呈现')
  const result = await compositor.draw(videoEditComposition(document, document.sequences[0].id), [], [], () => true, performance.timeOrigin + performance.now() - 1)
  await result.completion
  expect(result.presented).toBe(true); expect(device.queue.submit).toHaveBeenCalledOnce(); expect(request).not.toHaveBeenCalled()
  await compositor.dispose()
})
describe('全尺寸离屏合成与迟到校验', () => {
  function composition() {
    const document = createVideoEditDocument('RGBA合成')
    document.sequences[0].width = 3840; document.sequences[0].height = 2160
    document.items.push({ id: 'image', kind: 'image', name: '输入' })
    const clip = makeVideoEditItemClip(document, 'image', document.sequences[0].id, { frame: 0 })
    return { document: videoEditComposition(document, document.sequences[0].id), clip }
  }
  it('BGRA画布和RGBA中间目标分用匹配管线，透明清屏，几何和opacity只归一化一次', async () => {
    state.format = 'bgra8unorm'
    const { compositor, device } = copyFixture(async () => {}); const { document, clip } = composition()
    const code = await compositor.code(); const input = await code.target('input', 3840, 2160); const target = await code.target('target', 3840, 2160)
    const before = device.createRenderPipeline.mock.calls.length
    const transformed = { ...clip, x: .1, y: -.2, scale: .5, rotation: 90, opacity: .25 }
    await (await compositor.draw(document, [transformed], [input], () => true, undefined, target)).completion
    const rgba = device.createRenderPipeline.mock.calls.slice(before).map(([descriptor]) => (descriptor as { fragment: { targets: Array<{ format: string }> } }).fragment.targets[0].format)
    expect(rgba).toEqual(['rgba8unorm', 'rgba8unorm', 'rgba8unorm', 'rgba8unorm'])
    const initial = device.createRenderPipeline.mock.calls.slice(0, 4).map(([descriptor]) => (descriptor as { fragment: { targets: Array<{ format: string }> } }).fragment.targets[0].format)
    expect(initial).toEqual(['bgra8unorm', 'bgra8unorm', 'bgra8unorm', 'bgra8unorm'])
    expect(device.createCommandEncoder.mock.results.at(-1)!.value.beginRenderPass).toHaveBeenCalledWith(expect.objectContaining({ colorAttachments: [expect.objectContaining({ clearValue: { r: 0, g: 0, b: 0, a: 0 } })] }))
    const values = device.queue.writeBuffer.mock.lastCall?.[2] as Float32Array
    expect(values[0]).toBe(.5); expect(values[2]).toBeCloseTo(0); expect(values[3]).toBe(1)
    expect([...values.slice(4, 8)]).toEqual([Math.fround(.2), Math.fround(-.4), .25, 0])
    const compiles = device.createRenderPipeline.mock.calls.length
    await (await compositor.draw(document, [clip], [input], () => true, undefined, target)).completion
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(compiles)
    await (await compositor.draw(document, [{ ...clip, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }], [target], () => true)).completion
    expect([...device.queue.writeBuffer.mock.lastCall![2] as Float32Array].slice(0, 8)).toEqual([1, 1, 1, 0, 0, 0, 1, 0])
    expect(device.createCommandEncoder.mock.results.at(-1)!.value.beginRenderPass).toHaveBeenCalledWith(expect.objectContaining({ colorAttachments: [expect.objectContaining({ clearValue: { r: 0, g: 0, b: 0, a: 1 } })] }))
    await expect(compositor.draw(document, [clip], [target], () => true, undefined, target)).rejects.toThrow('同一纹理')
    await compositor.dispose(); expect(code.diagnostics()).toMatchObject({ surfaces: 0, residentBytes: 0 })
  })
  it('取消的首帧不启动离屏编译，关闭屏障等待已启动校验且没有迟到提交', async () => {
    const { compositor, device } = copyFixture(async () => {}); const { document, clip } = composition()
    const code = await compositor.code(); const input = await code.target('input', 3840, 2160); const target = await code.target('target', 3840, 2160)
    const before = device.createRenderPipeline.mock.calls.length
    expect((await compositor.draw(document, [clip], [input], () => false, undefined, target)).presented).toBe(false)
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(before)
    let finish!: () => void
    device.popErrorScope.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(null) }))
    const pending = compositor.draw(document, [clip], [input], () => true, undefined, target)
    const rejected = expect(pending).rejects.toThrow('不可用')
    for (let index = 0; index < 10; index++) await Promise.resolve()
    let closed = false; const closing = compositor.dispose().then(() => { closed = true })
    await Promise.resolve(); expect(closed).toBe(false)
    finish(); await rejected; await closing
    expect(device.queue.submit).not.toHaveBeenCalled(); expect(code.diagnostics()).toMatchObject({ surfaces: 0, residentBytes: 0 })
  })
  it.each(['input', 'target'] as const)('离屏编译等待期间%s退役，校验完成后不提交已释放纹理', async retired => {
    const { compositor, device } = copyFixture(async () => {}); const { document, clip } = composition()
    const code = await compositor.code(); const input = await code.target('input', 3840, 2160); const target = await code.target('target', 3840, 2160)
    let finish!: () => void
    device.popErrorScope.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(null) }))
    const pending = compositor.draw(document, [clip], [input], () => true, undefined, target)
    const rejected = expect(pending).rejects.toThrow('退役')
    for (let index = 0; index < 10; index++) await Promise.resolve()
    code.releaseUnused(new Set([retired === 'input' ? 'target' : 'input']))
    finish(); await rejected
    expect(device.queue.submit).not.toHaveBeenCalled(); expect(code.diagnostics()).toMatchObject({ surfaces: 1, textureAllocations: 2 })
    await compositor.dispose()
  })
})
it('未来帧仍等指定时刻，取消等待不能提交已失效画面', async () => {
  const callbacks = new Map<number, FrameRequestCallback>(); let token = 0
  const request = vi.fn((callback: FrameRequestCallback) => { callbacks.set(++token, callback); return token })
  vi.stubGlobal('self', { requestAnimationFrame: request, cancelAnimationFrame: (id: number) => callbacks.delete(id) })
  const idle = vi.fn()
  const { compositor, device } = copyFixture(async () => {}, undefined, idle); const document = createVideoEditDocument('未来呈现')
  let owned = true
  const rendering = compositor.draw(videoEditComposition(document, document.sequences[0].id), [], [], () => owned, performance.timeOrigin + performance.now() + 1000)
  for (let index = 0; index < 20; index++) await Promise.resolve()
  expect(request).toHaveBeenCalledOnce(); expect(device.queue.submit).not.toHaveBeenCalled()
  expect(compositor.waitingForPresentation).toBe(true); expect(idle).toHaveBeenCalledOnce()
  owned = false; compositor.cancelPresentation()
  expect((await rendering).presented).toBe(false); expect(device.queue.submit).not.toHaveBeenCalled(); expect(callbacks.size).toBe(0)
  expect(compositor.waitingForPresentation).toBe(false)
  await compositor.dispose()
})
it('同队列顺序复制不逐层等待，外部解码帧保留到完成；销毁等待所有复制释放', async () => {
  let complete!: () => void; const fence = new Promise<void>(resolve => { complete = resolve })
  const { compositor, sample, device, closed, destroyed } = copyFixture(() => fence)
  const copies = await Promise.all([compositor.snapshot(sample, true, true), compositor.snapshot(sample, true, true)])
  expect(device.queue.submit).toHaveBeenCalledTimes(2); expect(closed).not.toHaveBeenCalled()
  // The final composition is enqueued after copies without awaiting their fences.
  const document = createVideoEditDocument('同队列合成')
  const drawing = await compositor.draw(videoEditComposition(document, document.sequences[0].id), [], [], () => true)
  expect(device.queue.submit).toHaveBeenCalledTimes(3)
  let disposed = false; const closing = compositor.dispose().then(() => { disposed = true })
  await Promise.resolve(); expect(disposed).toBe(false)
  complete(); await drawing.completion; await closing
  expect(closed).toHaveBeenCalledTimes(2)
  copies.forEach(copy => copy.close()); expect(destroyed).toHaveBeenCalledTimes(4)
  await expect(compositor.snapshot(sample, true, true)).rejects.toThrow('关闭')
})
it('原生共享纹理帧按原样导入、绝不在 Worker 里关闭：复制完成后才随画面关闭交回；复制失败也不关闭', async () => {
  let complete!: () => void; const fence = new Promise<void>(resolve => { complete = resolve })
  const { compositor, device } = copyFixture(() => fence)
  const frame = { codedWidth: 3840, codedHeight: 2160, visibleRect: { width: 3840, height: 2160 }, format: 'NV12', close: vi.fn() }
  const release = vi.fn()
  const native = { frame, meta: { route: 'r', streamId: 's', frameIndex: 0, timestampUs: 1_000_000, ptsUs: 1_000_000, durationUs: 16_667 }, receivedAt: 0, release } as unknown as NativeVideoFrame
  const picture = new VideoEditNativePicture(native, 0, 1 / 60)
  const copy = await compositor.snapshot(picture, true, true)
  expect(device.importExternalTexture).toHaveBeenCalledWith({ source: frame })
  expect(copy).toMatchObject({ timestamp: 1, duration: 0.016667, displayWidth: 3840, displayHeight: 2160 })
  picture.close(); await Promise.resolve(); await Promise.resolve()
  expect(release).not.toHaveBeenCalled()
  complete(); await fence; for (let index = 0; index < 5; index++) await Promise.resolve()
  expect(release).toHaveBeenCalledOnce(); expect(frame.close).not.toHaveBeenCalled()
  device.importExternalTexture.mockImplementationOnce(() => { throw new Error('导入失败') })
  const failing = new VideoEditNativePicture({ ...native, release: vi.fn() } as NativeVideoFrame, 0, 1 / 60)
  await expect(compositor.snapshot(failing, false)).rejects.toThrow('导入失败')
  expect(frame.close).not.toHaveBeenCalled()
  copy.close(); await compositor.dispose()
})
it.each([1, 2] as const)('sRGB 视频在 %s 分辨率的 RGBA 与紧凑 YUV 复制阶段转换；BT.709 保持原路径', async divisor => {
  const { compositor, device } = copyFixture(async () => {})
  compositor.setPictureDivisor(divisor)
  const frame = { codedWidth: 3840, codedHeight: 2160, format: 'NV12', colorSpace: { transfer: 'bt709' } }
  const native = { frame, meta: { timestampUs: 0 }, release: vi.fn() } as unknown as NativeVideoFrame
  const picture = new VideoEditNativePicture(native, 0, 1 / 60, { bitDepth: 8, hasAlpha: false })
  for (const compact of [false, true]) (await compositor.snapshot(picture, compact)).close()
  const before = device.createRenderPipeline.mock.calls.length
  frame.colorSpace.transfer = 'iec61966-2-1'
  for (const compact of [false, true]) (await compositor.snapshot(picture, compact)).close()
  const added = device.createRenderPipeline.mock.calls.slice(before).map(call => call[0] as { fragment: { entryPoint: string; constants: Record<string, number> } })
  expect(added.map(value => value.fragment.entryPoint)).toEqual(['y', 'uv', 'rgba', 'rgba', 'rgba'])
  expect(added.every(value => value.fragment.constants.SRGB_TO_REC709)).toBe(true)
  const compiled = device.createRenderPipeline.mock.calls.length
  frame.colorSpace.transfer = 'bt709'
  ;(await compositor.snapshot(picture, true)).close()
  expect(device.createRenderPipeline.mock.calls).toHaveLength(compiled)
  picture.close()
  await compositor.dispose()
})
it('多源同时等待复制名额时逐次重查，单个完成不能唤醒后突破两份外部帧预算', async () => {
  const finish: Array<() => void> = []
  const { compositor, sample, device, closed } = copyFixture(() => new Promise<void>(resolve => { finish.push(resolve) }))
  const pending = Array.from({ length: 4 }, () => compositor.snapshot(sample, true, true))
  const tick = async (): Promise<void> => { for (let index = 0; index < 30; index++) await Promise.resolve() }
  await tick(); expect(device.queue.submit).toHaveBeenCalledTimes(2)
  finish[0](); await tick(); expect(device.queue.submit).toHaveBeenCalledTimes(3)
  finish[1](); await tick(); expect(device.queue.submit).toHaveBeenCalledTimes(4)
  finish[2](); finish[3](); const copies = await Promise.all(pending)
  await tick(); expect(closed).toHaveBeenCalledTimes(4)
  copies.forEach(copy => copy.close()); await compositor.dispose()
})
describe('合成器共享图片候选生命周期', () => {
  it('文字/字幕/标题共享局部纹理，动画仅改变GPU几何，离屏导出写相同几何', async () => {
    vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} getContext() { return { save() {}, restore() {}, scale() {}, beginPath() {}, fill() {}, clearRect() {}, drawImage() {}, fillRect() {}, fillText() {}, strokeText() {}, measureText(text: string) { return { width: text.length * 70 } } } } })
    const { compositor, device } = copyFixture(async () => {})
    const project = createVideoEditDocument('局部文字'); Object.assign(project.sequences[0], { width: 3840, height: 2160 })
    project.items.push({ id: 'text', kind: 'text', name: '文字' }); const document = videoEditComposition(project, project.sequences[0].id)
    const clip = makeVideoEditItemClip(project, 'text', document.id, { frame: 0 }); clip.text = 'Motion'
    try {
      await (await compositor.draw(document, [clip], [null], () => true)).completion
      const upload = device.queue.copyExternalImageToTexture.mock.lastCall![0] as { source: OffscreenCanvas }
      expect(upload.source.width * upload.source.height).toBeLessThan(3840 * 2160 / 10)
      const moved = { ...clip, x: .1, y: -.1, anchorX: .2, anchorY: .8, rotation: 40, opacity: .4, scale: .8 }
      await (await compositor.draw(document, [moved], [null], () => true)).completion
      const preview = new Float32Array(device.queue.writeBuffer.mock.lastCall![2] as Float32Array)
      const target = await (await compositor.code()).target('export-text', 3840, 2160)
      await (await compositor.draw(document, [moved], [null], () => true, undefined, target)).completion
      expect(device.queue.writeBuffer.mock.lastCall![2]).toEqual(preview); expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1)
      await (await compositor.draw(document, [{ ...moved, scale: 1.1 }], [null], () => true)).completion
      await (await compositor.draw(document, [{ ...moved, scale: 1.8 }], [null], () => true)).completion
      expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2)
      const quad: VideoEditTrackQuad = [[.1,.2],[.8,.1],[.9,.8],[.2,.9]]
      const tracked = { ...clip, trackingQuad: quad }
      await (await compositor.draw(document, [tracked], [null], () => true)).completion
      const values = device.queue.writeBuffer.mock.lastCall![2] as Float32Array
      const h = videoEditCornerPinMatrix(quad)
      // Center-aligned text has a symmetric local rectangle; its local center maps to the original source center.
      const w = values[20] * .5 + values[21] * .5 + values[22]
      expect((values[12] * .5 + values[13] * .5 + values[14]) / w).toBeCloseTo((h[0] * .5 + h[1] * .5 + h[2]) / (h[6] * .5 + h[7] * .5 + 1), 5)
      expect((values[16] * .5 + values[17] * .5 + values[18]) / w).toBeCloseTo((h[3] * .5 + h[4] * .5 + h[5]) / (h[6] * .5 + h[7] * .5 + 1), 5)
    } finally { await compositor.dispose() }
  })
  it('代码与普通片段共享一次上传，满文字工作集切换图片先回收，不因旧预算阻塞', async () => {
    vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} getContext() { return { save() {}, restore() {}, scale() {}, beginPath() {}, fill() {}, clearRect() {}, drawImage() {}, fillRect() {}, fillText() {}, strokeText() {}, measureText(text: string) { return { width: text.length * 10 } } } } })
    for (const [width, height, count] of [[3840, 2160, 8], [16, 16, 32]]) {
      const { compositor, device, destroyed } = copyFixture(async () => {})
      compositor.canvas.width = width; compositor.canvas.height = height
      const document = createVideoEditDocument('满工作集'); document.sequences[0].width = width; document.sequences[0].height = height
      document.items = [{ id: 'text', kind: 'text', name: '文字' }]
      const composition = videoEditComposition(document, document.sequences[0].id)
      const base = makeVideoEditItemClip(document, 'text', document.sequences[0].id, { frame: 0 })
      const clips = Array.from({ length: count }, (_, index) => ({ ...base, id: `text-${index}` }))
      await compositor.prepareImages(new Map(), () => true, new Set(clips.map(clip => clip.id)))
      await (await compositor.draw(composition, clips, clips.map(() => null), () => true)).completion
      expect(compositor.imageDiagnostics().textures).toBe(count)
      const picture = { width, height } as ImageBitmap
      const inputs = await compositor.prepareImages(new Map([['original', picture], ['same-original', picture]]), () => true)
      expect(inputs.get('original')!.texture).toBe(inputs.get('same-original')!.texture)
      expect(inputs.get('original')!.premultiplied).toBe(true)
      expect(device.queue.copyExternalImageToTexture).toHaveBeenLastCalledWith({ source: picture }, { texture: inputs.get('original')!.texture, premultipliedAlpha: true }, [width, height])
      expect(destroyed).toHaveBeenCalledTimes(count)
      await (await compositor.draw(composition, [base, { ...base, id: 'copy' }], [picture, picture], () => true)).completion
      expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(count + 1)
      expect(compositor.imageDiagnostics()).toMatchObject({ textures: 1, bytes: width * height * 4, uploads: count + 1 })
      await expect(compositor.prepareImages(new Map(Array.from({ length: 33 }, (_, index) => [`image-${index}`, { width: 1, height: 1 } as ImageBitmap])), () => true)).rejects.toThrow('32')
      await compositor.dispose(); expect(compositor.imageDiagnostics().textures).toBe(0)
    }
  })
  it('新图上传异常清理候选并保留最后有效纹理，重试不读取被销毁纹理', async () => {
    const textures: Array<{ createView: () => object; destroy: ReturnType<typeof vi.fn> }> = []
    const copy = vi.fn(); const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() }
    state.device = {
      queue: { copyExternalImageToTexture: copy, writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: async () => {} },
      lost: new Promise(() => {}), createShaderModule: vi.fn(), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createSampler: vi.fn(),
      createTexture: () => { const texture = { createView: () => ({}), destroy: vi.fn() }; textures.push(texture); return texture }, createBuffer: () => ({ destroy: vi.fn() }),
      createBindGroup: vi.fn(), createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }), pushErrorScope: vi.fn(), popErrorScope: async () => null, destroy: vi.fn(),
    }
    const output = { getContext: () => ({ configure: vi.fn(), getCurrentTexture: () => ({ createView: () => ({}) }) }) } as unknown as OffscreenCanvas
    const compositor = new VideoEditGpuCompositor(output)
    const document = createVideoEditDocument('图片上传'); document.items.push({ id: 'item', name: '画面', kind: 'text' })
    const clip = makeVideoEditItemClip(document, 'item', document.sequences[0].id, { frame: 0 }); const composition = videoEditComposition(document, document.sequences[0].id)
    const first = { width: 32, height: 32 } as ImageBitmap; const second = { width: 32, height: 32 } as ImageBitmap
    await (await compositor.draw(composition, [clip], [first], () => true)).completion
    copy.mockImplementationOnce(() => { throw new Error('GPU上传失败') })
    await expect(compositor.draw(composition, [clip], [second], () => true)).rejects.toThrow('GPU上传失败')
    expect(textures[0].destroy).not.toHaveBeenCalled(); expect(textures[1].destroy).toHaveBeenCalledOnce()
    await (await compositor.draw(composition, [clip], [first], () => true)).completion
    expect(copy).toHaveBeenCalledTimes(2)
    await compositor.dispose(); expect(textures[0].destroy).toHaveBeenCalledOnce()
  })
})
describe('高位深合成（任务 2.7）', () => {
  type Descriptor = { format?: string; fragment?: { targets: Array<{ format: string }> } }
  type Fixture = ReturnType<typeof copyFixture>
  const textureFormats = (device: Fixture['device']): string[] => device.createTexture.mock.calls.map(([descriptor]) => (descriptor as Descriptor).format!)
  const pipelineFormat = (pipeline: unknown): string => (pipeline as { descriptor: Descriptor }).descriptor.fragment!.targets[0].format
  const nativeFrame = (format: VideoFrame['format'], depth?: { bitDepth: number; hasAlpha: boolean }): VideoEditNativePicture => {
    const frame = { codedWidth: 3840, codedHeight: 2160, visibleRect: { width: 3840, height: 2160 }, format, close: vi.fn() }
    return new VideoEditNativePicture({ frame, meta: { route: 'r', streamId: 's', frameIndex: 0, timestampUs: 0, ptsUs: 0, durationUs: 16_667 }, receivedAt: 0, release: vi.fn() } as unknown as NativeVideoFrame, 0, 1 / 60, depth)
  }
  const browserSample = (format: VideoFrame['format']): VideoSample => ({ timestamp: 0, duration: 1 / 60, displayWidth: 3840, displayHeight: 2160, rotation: 0, flip: false, format, toVideoFrame: () => ({ visibleRect: { width: 3840, height: 2160 }, close: vi.fn() }) }) as unknown as VideoSample
  it('原生与浏览器高位深帧按位深与透明复制为 rgb10a2unorm 或 rgba16float；八位与无格式浏览器帧保持原格式、字节与复制管线', async () => {
    const { compositor, pass } = copyFixture(async () => {})
    const cases: Array<[VideoSample | VideoEditNativePicture, boolean, string, number, boolean]> = [
      [nativeFrame(null, { bitDepth: 10, hasAlpha: false }), false, 'rgb10a2unorm', 4, true],
      [nativeFrame(null, { bitDepth: 12, hasAlpha: true }), false, 'rgba16float', 8, true],
      [nativeFrame(null), false, 'rgba16float', 8, true],
      [nativeFrame('NV12'), true, 'r8unorm', 1.5, false],
      [browserSample('I420P10' as VideoFrame['format']), false, 'rgb10a2unorm', 4, true],
      [browserSample('I420AP10' as VideoFrame['format']), false, 'rgba16float', 8, true],
      [browserSample(null), false, 'rgba8unorm', 4, false],
      [browserSample('RGBA'), false, 'rgba8unorm', 4, false],
    ]
    for (const [picture, compact, format, bytesPerPixel, highPrecision] of cases) {
      const copy = await compositor.snapshot(picture, compact)
      // Pool reuse is per format: a recycled texture must have the requested format too.
      expect((copy.texture as unknown as { descriptor: Descriptor }).descriptor.format).toBe(format)
      expect(copy.allocationSize()).toBe(3840 * 2160 * bytesPerPixel); expect(copy.highPrecision).toBe(highPrecision)
      if (!compact) expect(pipelineFormat(pass.setPipeline.mock.lastCall![0])).toBe(format)
      copy.close()
    }
    expect(compositor.precisionDiagnostics()).toMatchObject({ highPrecisionSnapshots: 5, highPrecisionFrames: 0, preciseTargetBytes: 0 })
    await compositor.dispose()
  })
  it('八位帧仍直接写画布；含高精度画面的帧写 rgba16float 目标并在同一次提交量化到画布', async () => {
    state.format = 'bgra8unorm'
    const { compositor, device, canvasView, destroyed } = copyFixture(async () => {})
    const model = createVideoEditDocument('高位深'); model.sequences[0].width = 3840; model.sequences[0].height = 2160
    model.items.push({ id: 'item', kind: 'text', name: '画面' })
    const document = videoEditComposition(model, model.sequences[0].id)
    const clip = makeVideoEditItemClip(model, 'item', model.sequences[0].id, { frame: 0 })
    const eight = await compositor.snapshot(nativeFrame('NV12'), true); const ten = await compositor.snapshot(nativeFrame(null), false)
    const compiles = device.createRenderPipeline.mock.calls.length; const textures = device.createTexture.mock.calls.length
    const views = (): unknown[] => {
      const encoder = device.createCommandEncoder.mock.results.at(-1)!.value as { beginRenderPass: { mock: { calls: Array<[{ colorAttachments: Array<{ view: unknown; clearValue: unknown }> }]> } } }
      return encoder.beginRenderPass.mock.calls.map(([descriptor]) => descriptor.colorAttachments[0].view)
    }
    await (await compositor.draw(document, [clip], [eight], () => true)).completion
    expect(views()).toEqual([canvasView])
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(compiles); expect(device.createTexture).toHaveBeenCalledTimes(textures)
    for (let frame = 0; frame < 2; frame++) {
      await (await compositor.draw(document, [clip, { ...clip, id: 'over' }], [eight, ten], () => true)).completion
      const [composed, quantized] = views()
      expect(composed).toMatchObject({ descriptor: { format: 'rgba16float', size: [3840, 2160] } }); expect(quantized).toBe(canvasView)
    }
    // Four layer pipelines for the rgba16float target and one quantizing pass for the canvas, compiled once.
    expect(device.createRenderPipeline.mock.calls.slice(compiles).map(([descriptor]) => (descriptor as Descriptor).fragment!.targets[0].format)).toEqual(['rgba16float', 'rgba16float', 'rgba16float', 'rgba16float', 'bgra8unorm'])
    expect(textureFormats(device).slice(textures)).toEqual(['rgba16float'])
    expect(device.queue.submit).toHaveBeenCalledTimes(5)
    expect(compositor.precisionDiagnostics()).toEqual({ highPrecisionSnapshots: 1, highPrecisionFrames: 2, preciseTargetBytes: 3840 * 2160 * 8 })
    eight.close(); ten.close()
    const before = destroyed.mock.calls.length; await compositor.dispose()
    expect(destroyed.mock.calls.length).toBeGreaterThan(before)
    expect(compositor.precisionDiagnostics().preciseTargetBytes).toBe(0)
  })
})
