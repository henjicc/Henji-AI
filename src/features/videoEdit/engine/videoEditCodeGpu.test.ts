import type { VideoEditGraphicDraw } from '@/core/videoEdit/graphics'
import { describe, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createVideoEditGraphic, evaluateVideoEditGraphic, prepareVideoEditGraphic } from '@/core/videoEdit/graphics'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'
import * as glyphMetrics from '../videoEditGlyphMetrics'
import * as fonts from '@/platform/fonts'

function textDraw(text: string): VideoEditGraphicDraw {
  return { command: { kind: 'text', x: 0, y: 0, text, fontSize: 32, color: [1,1,1,1], fontFamily: 'sans-serif', align: 'left' }, rotation: 0, pivotX: 0, pivotY: 0 }
}
function mockTextCanvas(): void {
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(readonly width: number, readonly height: number) {}
    getContext() { return { font: '', fillStyle: '', textBaseline: '', fillText: vi.fn(), measureText: () => ({ width: 20, actualBoundingBoxRight: 20, actualBoundingBoxLeft: 0 }) } }
  })
}

it('结构化文字上传失败清理候选纹理，关闭不泄漏且可重试', async () => {
  mockTextCanvas()
  const { device, destroyed } = gpu(); const runtime = new VideoEditCodeGpu(device)
  vi.mocked(device.queue.copyExternalImageToTexture).mockImplementationOnce(() => { throw new Error('上传失败') })
  try {
    await expect(runtime.draw('clip', 3840, 2160, [textDraw('字形')])).rejects.toThrow('上传失败')
    expect(runtime.diagnostics()).toMatchObject({ residentBytes: 3840 * 2160 * 4, glyphs: 0 })
    await runtime.draw('clip', 3840, 2160, [textDraw('字形')])
    expect(runtime.diagnostics()).toMatchObject({ glyphs: 1, externalCopies: 1 })
    await runtime.dispose(); expect(destroyed).toHaveBeenCalledTimes(4)
    expect(runtime.diagnostics().residentBytes).toBe(0)
  } finally { await runtime.dispose(); vi.unstubAllGlobals() }
})

it('64份结构化文字热帧只更换一份时只上传一次，不逐出本帧随后需要的字形', async () => {
  mockTextCanvas()
  const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
  const names = Array.from({ length: 64 }, (_, index) => `old${index}`)
  try {
    await runtime.draw('clip', 3840, 2160, names.map(textDraw))
    expect(runtime.diagnostics().externalCopies).toBe(64)
    await runtime.draw('clip', 3840, 2160, ['new', ...names.slice(0,-1)].map(textDraw))
    expect(runtime.diagnostics()).toMatchObject({ externalCopies: 65, glyphs: 64 })
  } finally { await runtime.dispose(); vi.unstubAllGlobals() }
})

it('混合保持高精度，按输出格式分别复用管线，目标改格式时重新分配', async () => {
  const { device, compiled } = gpu(); const runtime = new VideoEditCodeGpu(device)
  try {
    const deep = await runtime.target('deep', 64, 64, 'rgba16float'), plain = await runtime.target('plain', 64, 64)
    expect((await runtime.mix('deep-mix', plain, deep, .5)).textureFormat).toBe('rgba16float')
    expect((await runtime.mix('plain-mix', plain, plain, .5)).textureFormat).toBe('rgba8unorm')
    const calls = compiled.mock.calls.length
    await runtime.mix('deep-mix', plain, deep, .2); await runtime.mix('plain-mix', plain, plain, .2)
    expect(compiled).toHaveBeenCalledTimes(calls)
    expect((await runtime.target('plain', 64, 64, 'rgba16float')).textureFormat).toBe('rgba16float')
  } finally { await runtime.dispose() }
  expect(runtime.diagnostics()).toMatchObject({ surfaces: 0, residentBytes: 0, pipelines: 0 })
})

function gpu() {
  const destroyed = vi.fn(); const compiled = vi.fn((_descriptor: unknown) => ({ getBindGroupLayout: () => ({}) }))
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), draw: vi.fn(), end: vi.fn() }
  const bindGroupLayout = vi.fn(() => ({ bindings: 'filter' })); const pipelineLayout = vi.fn(() => ({ layout: 'filter' }))
  const device: GpuDevice & { createBindGroupLayout: typeof bindGroupLayout; createPipelineLayout: typeof pipelineLayout } = {
    queue: { copyExternalImageToTexture: vi.fn(), writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: vi.fn(async () => {}) },
    lost: new Promise(() => {}), createShaderModule: vi.fn(), createRenderPipeline: compiled,
    createBindGroupLayout: bindGroupLayout, createPipelineLayout: pipelineLayout,
    createSampler: vi.fn(), createTexture: () => ({ createView: () => ({}), destroy: destroyed }), createBuffer: () => ({ destroy: destroyed }),
    createBindGroup: vi.fn(), createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }), pushErrorScope: vi.fn(), popErrorScope: vi.fn(async (): Promise<{ message?: string } | null> => null), destroy: vi.fn(),
  }
  return { destroyed, compiled, device, pass }
}
describe('代码GPU会话复用与资源边界', () => {

  it('复杂图形文字只缓存外观和分辨率档位，锚点/位置/旋转/透明度进入GPU均匀缓冲', async () => {
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return { save() {}, restore() {}, scale() {}, translate() {}, transform() {}, beginPath() {}, roundRect() {}, fill() {}, fillRect() {}, clearRect() {}, drawImage() {}, strokeText() {}, fillText() {}, measureText(text: string) { return { width: text.length * 50 } } } }
    })
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const graphic = createVideoEditGraphic('text', 3840, 2160)
    const draws = evaluateVideoEditGraphic(prepareVideoEditGraphic(graphic), { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } })
    try {
      await runtime.draw('graphic', 3840, 2160, draws)
      const initial = new Float32Array(vi.mocked(device.queue.writeBuffer).mock.lastCall![2] as Float32Array)
      const moved = { ...draws[0], scale: .5, rotation: 90, pivotX: 500, pivotY: 700, opacity: .25, command: { ...draws[0].command, x: 400, y: 600 } } as typeof draws[0]
      await runtime.draw('graphic', 3840, 2160, [moved])
      const values = vi.mocked(device.queue.writeBuffer).mock.lastCall![2] as Float32Array
      expect(runtime.diagnostics().externalCopies).toBe(1); expect(values[2]).toBe(initial[2] / 2); expect(values[7]).toBe(.25)
      expect([...values.slice(16)]).toEqual([Math.fround(Math.cos(Math.PI / 2)), 1, 500, 700])
      await runtime.draw('graphic', 3840, 2160, [{ ...moved, scale: 1.1 }]); expect(runtime.diagnostics().externalCopies).toBe(2)
      await runtime.draw('graphic', 3840, 2160, [{ ...moved, scale: 1.8, rotation: 5 }]); expect(runtime.diagnostics().externalCopies).toBe(2)
      await runtime.draw('graphic', 3840, 2160, [{ ...moved, textStyle: { ...moved.textStyle!, tracking: 200 } }]); expect(runtime.diagnostics().externalCopies).toBe(3)
      const enlarged = await runtime.draw('graphic', 3840, 2160, draws, undefined, 1.1)
      expect(enlarged.width).toBe(7680); expect(enlarged.height).toBe(4320)
      expect(await runtime.draw('graphic', 3840, 2160, draws, undefined, 1.8)).toBe(enlarged)
      expect(await runtime.draw('graphic', 3840, 2160, Array.from({ length: 257 }, () => draws[0]))).toBeDefined()
      for (let index = 0; index < 17; index++) await runtime.target(`small-${index}`, 8, 8)
    } finally { await runtime.dispose(); vi.unstubAllGlobals() }
  })
  it('所有区域蒙版复用 RGBA 缓冲，同一不可变蒙版不重传；替换、目标改写、尺寸变化与释放重新上传', async () => {
    const {device} = gpu(); const writeTexture = vi.fn()
    Object.assign(device.queue,{writeTexture})
    const runtime = new VideoEditCodeGpu(device)
    const data = new Uint8Array([0,128,255,64])
    const first = await runtime.uploadMask('mask',2,2,data)
    const rgba = writeTexture.mock.calls[0][1]
    expect([...rgba]).toEqual([0,0,0,0,128,128,128,128,255,255,255,255,64,64,64,64])
    expect(await runtime.uploadMask('mask',2,2,data)).toBe(first)
    expect(writeTexture).toHaveBeenCalledTimes(1)
    await runtime.uploadMask('mask',2,2,new Uint8Array([255,0,128,64]))
    expect(writeTexture.mock.calls[1][1]).toBe(rgba)
    await runtime.target('mask',2,2)
    await runtime.uploadMask('mask',2,2,data)
    expect(writeTexture).toHaveBeenCalledTimes(3)
    await runtime.uploadMask('mask',1,4,data)
    expect(writeTexture.mock.calls[3][1]).not.toBe(rgba)
    runtime.releaseUnused(new Set())
    expect(await runtime.uploadMask('mask',2,2,data)).not.toBe(first)
    expect(writeTexture).toHaveBeenCalledTimes(5)
    await runtime.dispose()
  })




  it('结构化形状复用原绘制目标，独立旋转中心和透明度进入同一管线', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const graphic = createVideoEditGraphic('rect', 3840, 2160)
    Object.assign(graphic.objects[0].parameters, { x: 100, y: 200, width: 300, height: 100, rotation: 90, opacity: .25, fill: [1, .5, 0, .5] })
    const draws = evaluateVideoEditGraphic(prepareVideoEditGraphic(graphic), { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } })
    const original = await runtime.draw('graphic', 3840, 2160, draws)
    const packed = vi.mocked(device.queue.writeBuffer).mock.lastCall?.[2] as Float32Array
    expect([...packed.slice(0, 8)]).toEqual([100, 200, 300, 100, 1, .5, 0, .125])
    expect(packed[16]).toBeCloseTo(0); expect([...packed.slice(17)]).toEqual([1, 250, 250])
    expect(await runtime.draw('graphic', 3840, 2160, draws)).toBe(original)
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 1, textureAllocations: 1, externalCopies: 0, generatorFrames: 2 })
    await expect(runtime.draw('bad', 3840, 2160, [{ ...draws[0], rotation: NaN }])).rejects.toThrow('范围')
    await runtime.dispose(); expect(runtime.diagnostics().residentBytes).toBe(0)
  })
  it('预乘透明混合只写一个RGBA目标，复用管线且拒绝跨设备、尺寸、强度和别名', async () => {
    const { device, compiled } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const left = await runtime.target('left', 3840, 2160); const right = await runtime.target('right', 3840, 2160)
    const mixed = await runtime.mix('mix', left, right, .5)
    const shader = vi.mocked(device.createShaderModule).mock.lastCall?.[0] as { code: string }
    expect(shader.code).toContain('return select(mix(a,b,t),dip,m.amount.y>0.5)')
    expect(vi.mocked(device.queue.writeBuffer).mock.lastCall?.[2]).toEqual(new Float32Array([.5, 0, 0, 0, 0, 0, 0, 0]))
    // 黑场／白场过渡：同一管线，uniform 带上经过的纯色
    await runtime.mix('mix', left, right, .25, [1, 1, 1, 1])
    expect(vi.mocked(device.queue.writeBuffer).mock.lastCall?.[2]).toEqual(new Float32Array([.25, 1, 0, 0, 1, 1, 1, 1]))
    const pipeline = compiled.mock.lastCall?.[0] as unknown as { fragment: { targets: Array<{ format: string; blend?: unknown }> } }
    expect(pipeline.fragment.targets).toEqual([{ format: 'rgba8unorm' }])
    expect(await runtime.mix('mix', left, right, .75)).toBe(mixed)
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 3, residentBytes: 3 * 3840 * 2160 * 4, pipelineCompiles: 3, mixFrames: 3 })
    for (const amount of [-.1, 1.1, NaN, Infinity]) await expect(runtime.mix('bad', left, right, amount)).rejects.toThrow('强度')
    await expect(runtime.mix('bad', left, { ...right, owner: gpu().device }, .5)).rejects.toThrow('同设备')
    await expect(runtime.mix('bad', left, { ...right, width: 1920 }, .5)).rejects.toThrow('同尺寸')
    await expect(runtime.mix('left', left, right, .5)).rejects.toThrow('同一纹理')
    expect(runtime.diagnostics().surfaces).toBe(3)
    runtime.releaseUnused(new Set(['left'])); expect(runtime.diagnostics().surfaces).toBe(1)
    await runtime.dispose(); expect(runtime.diagnostics()).toMatchObject({ surfaces: 0, residentBytes: 0, pipelines: 0 })
  })
  it('混合管线失败不分配候选目标，关闭等待迟到编译并禁止迟到分配', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const left = await runtime.target('left', 3840, 2160); const right = await runtime.target('right', 3840, 2160)
    vi.mocked(device.popErrorScope).mockResolvedValueOnce({ message: '混合编译失败' })
    await expect(runtime.mix('bad', left, right, .5)).rejects.toThrow('混合编译失败')
    expect(runtime.diagnostics().surfaces).toBe(2)
    let finish!: () => void
    vi.mocked(device.popErrorScope).mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(null) }))
    const mixing = runtime.mix('late', left, right, .5); const rejected = expect(mixing).rejects.toThrow('关闭')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    let closed = false; const disposing = runtime.dispose().then(() => { closed = true })
    await Promise.resolve(); expect(closed).toBe(false)
    finish(); await rejected; await disposing
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 0, residentBytes: 0, pipelines: 0 })
  })

  it('混合编译等待期间输入退役后拒绝提交和迟到目标分配', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const left = await runtime.target('left', 3840, 2160); const right = await runtime.target('right', 3840, 2160)
    let finish!: () => void
    vi.mocked(device.popErrorScope).mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(null) }))
    const pending = runtime.mix('out', left, right, .5)
    const rejected = expect(pending).rejects.toThrow('退役')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    runtime.releaseUnused(new Set()); finish(); await rejected
    expect(device.queue.submit).not.toHaveBeenCalled()
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 0, residentBytes: 0, textureAllocations: 2 })
    await runtime.dispose()
  })










  it('高精度目标有独立的512MiB上限，不挤占八位512MiB预算', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    for (let index = 0; index < 8; index++) await runtime.target(`deep-${index}`, 3840, 2160, 'rgba16float')
    await expect(runtime.target('deep-8', 3840, 2160, 'rgba16float')).rejects.toThrow('512MiB')
    for (let index = 0; index < 7; index++) await runtime.target(`plain-${index}`, 3840, 2160)
    expect(runtime.diagnostics().surfaces).toBe(15)
    runtime.releaseUnused(new Set(Array.from({ length: 7 }, (_, index) => [`plain-${index}`, `deep-${index + 1}`]).flat()))
    await runtime.target('deep-8', 3840, 2160, 'rgba16float')
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 15, residentBytes: 3840 * 2160 * (8 * 8 + 4 * 7) })
    await runtime.dispose(); expect(runtime.diagnostics().residentBytes).toBe(0)
  })
})

it('字体库加载/导入后的revision变化使代码度量失效，宿主释放订阅', async () => {
  const initial = fonts.fontLibrarySnapshot(); let revision = initial.revision; let listener: (() => void) | undefined
  const stop = vi.fn(); const invalidate = vi.spyOn(glyphMetrics, 'invalidateCodeTextMetrics')
  const snapshot = vi.spyOn(fonts, 'fontLibrarySnapshot').mockImplementation(() => ({ ...initial, revision }))
  const subscribe = vi.spyOn(fonts, 'subscribeFontLibrary').mockImplementation(callback => { listener = callback; return stop })
  const host = new VideoEditCodeGpu(gpu().device)
  try {
    expect(invalidate).toHaveBeenCalledTimes(1)
    listener!(); expect(invalidate).toHaveBeenCalledTimes(1)
    revision++; listener!(); expect(invalidate).toHaveBeenCalledTimes(2)
  } finally { await host.dispose(); expect(stop).toHaveBeenCalledTimes(1); invalidate.mockRestore(); snapshot.mockRestore(); subscribe.mockRestore() }
})

it('图片仅借用当前设备纹理，alpha模式与opacity进入可信管线且只懒编译一次', async () => {
    const { device, compiled, pass } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const destroy = vi.fn(); const view = {}; const texture = { createView: () => view, destroy }
    const draws: VideoEditGraphicDraw[] = [{ command: {kind:'image',source:{kind:'image',mediaId:'logo'},x:5,y:6,width:100,height:80,opacity:0.25},rotation:0,pivotX:0,pivotY:0 }]
    const input: VideoEditCodeImageInput = { texture, width: 3840, height: 2160, owner: device, premultiplied: false }
    await runtime.draw('clip', 3840, 2160, [])
    expect(compiled).toHaveBeenCalledTimes(2); expect(pass.draw).not.toHaveBeenCalled()
    const picture = await runtime.draw('clip', 3840, 2160, draws, new Map([['logo', input]]))
    expect(compiled).toHaveBeenCalledTimes(3)
    expect(vi.mocked(device.queue.writeBuffer).mock.lastCall?.[2]).toEqual(new Float32Array([5, 6, 100, 80, 1, 1, 1, .25, 0, 0, 0, 0, 3840, 2160, 0, 0, 1, 0, 0, 0]))
    expect(vi.mocked(device.createBindGroup).mock.lastCall?.[0]).toMatchObject({ entries: [{ binding: 0 }, { binding: 1, resource: view }, { binding: 2 }] })
    const imageModule = vi.mocked(device.createShaderModule).mock.lastCall?.[0] as { code: string }
    expect(imageModule.code).toContain('select(color.rgb*color.a,color.rgb,p.canvas.z==1.0)')
    expect(imageModule.code).toContain('vec4f(rgb*p.color.a,color.a*p.color.a)')
    const reused = await runtime.draw('clip', 3840, 2160, draws, new Map([['logo', { ...input, premultiplied: true }]]))
    expect(reused).toBe(picture); expect(compiled).toHaveBeenCalledTimes(3)
    const packed = vi.mocked(device.queue.writeBuffer).mock.lastCall?.[2] as Float32Array
    expect(packed[14]).toBe(1); expect(packed[7]).toBe(.25)
    expect(device.queue.copyExternalImageToTexture).not.toHaveBeenCalled()
    expect(runtime.diagnostics()).toMatchObject({ textureAllocations: 1, externalCopies: 0, residentBytes: 3840 * 2160 * 4 })
    await runtime.dispose(); expect(destroy).not.toHaveBeenCalled()
  })
it('缺输入、跨设备、错误尺寸/alpha或输入输出别名在目标写入前失败', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const draws: VideoEditGraphicDraw[] = [{ command: {kind:'image',source:{kind:'image',mediaId:'logo'},x:0,y:0,width:1,height:1,opacity:1},rotation:0,pivotX:0,pivotY:0 }]
    const input: VideoEditCodeImageInput = { texture: { createView: () => ({}), destroy: vi.fn() }, width: 100, height: 100, owner: device, premultiplied: false }
    await expect(runtime.draw('candidate', 3840, 2160, draws)).rejects.toThrow('输入不存在')
    for (const invalid of [{ ...input, owner: gpu().device }, { ...input, width: 0 }, { ...input, height: Infinity }, { ...input, width: 8193 }, { ...input, premultiplied: undefined }]) await expect(runtime.draw('candidate', 3840, 2160, draws, new Map([['logo', invalid as VideoEditCodeImageInput]]))).rejects.toThrow('当前设备')
    expect(runtime.diagnostics()).toMatchObject({ textureAllocations: 0, surfaces: 0, pipelineCompiles: 2 })
    const picture = await runtime.draw('valid', 3840, 2160, draws, new Map([['logo', input]]))
    vi.mocked(device.queue.writeBuffer).mockClear()
    await expect(runtime.draw('valid', 3840, 2160, draws, new Map([['logo', { ...input, texture: picture.texture }]]))).rejects.toThrow('同一纹理')
    await expect(runtime.draw('valid', 3840, 2160, draws)).rejects.toThrow('输入不存在')
    expect(device.queue.writeBuffer).not.toHaveBeenCalled(); expect(runtime.diagnostics().surfaces).toBe(1)
    await runtime.dispose()
  })
it('图片管线编译失败不分配候选目标、不销毁借用图，恢复后关闭等待提交', async () => {
    const { device, compiled } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const draws: VideoEditGraphicDraw[] = [{ command: {kind:'image',source:{kind:'image',mediaId:'logo'},x:0,y:0,width:1,height:1,opacity:1},rotation:0,pivotX:0,pivotY:0 }]
    const destroy = vi.fn(); const input = { texture: { createView: () => ({}), destroy }, width: 1, height: 1, owner: device, premultiplied: true }
    await runtime.draw('empty', 3840, 2160, [])
    runtime.releaseUnused(new Set())
    vi.mocked(device.popErrorScope).mockResolvedValueOnce({ message: '图片编译失败' })
    await expect(runtime.draw('candidate', 3840, 2160, draws, new Map([['logo', input]]))).rejects.toThrow('图片编译失败')
    expect(runtime.diagnostics()).toMatchObject({ residentBytes: 0, surfaces: 0, pipelineCompiles: 2 })
    let finish!: () => void
    vi.mocked(device.queue.onSubmittedWorkDone).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    await runtime.draw('candidate', 3840, 2160, draws, new Map([['logo', input]]))
    expect(compiled).toHaveBeenCalledTimes(4)
    let closed = false
    const disposing = runtime.dispose().then(() => { closed = true })
    await Promise.resolve(); expect(closed).toBe(false)
    finish(); await disposing; expect(closed).toBe(true); expect(destroy).not.toHaveBeenCalled()
    expect(runtime.diagnostics()).toMatchObject({ residentBytes: 0, pipelines: 0 })
  })
it('关闭等待迟到图片管线校验，迟到结果不分配目标或持有借用纹理', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const draws: VideoEditGraphicDraw[] = [{ command: {kind:'image',source:{kind:'image',mediaId:'logo'},x:0,y:0,width:1,height:1,opacity:1},rotation:0,pivotX:0,pivotY:0 }]
    await runtime.draw('empty', 3840, 2160, []); runtime.releaseUnused(new Set())
    let validate!: () => void
    vi.mocked(device.popErrorScope).mockReturnValueOnce(new Promise(resolve => { validate = () => resolve(null) }))
    const destroy = vi.fn(); const input = { texture: { createView: () => ({}), destroy }, width: 1, height: 1, owner: device, premultiplied: false }
    const rendering = runtime.draw('late', 3840, 2160, draws, new Map([['logo', input]]))
    const rejected = expect(rendering).rejects.toThrow('关闭')
    await Promise.resolve(); await Promise.resolve()
    let closed = false
    const disposing = runtime.dispose().then(() => { closed = true })
    await Promise.resolve(); expect(closed).toBe(false)
    validate(); await rejected; await disposing
    expect(runtime.diagnostics()).toMatchObject({ residentBytes: 0, surfaces: 0, pipelines: 0, pipelineCompiles: 2 })
    expect(destroy).not.toHaveBeenCalled()
  })
