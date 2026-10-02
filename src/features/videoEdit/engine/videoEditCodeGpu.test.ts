import { describe, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { createVideoEditGraphic, evaluateVideoEditGraphic, prepareVideoEditGraphic } from '@/core/videoEdit/graphics'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'

const context = { time: 1, localTime: 1, sequenceTime: 1, width: 3840, height: 2160, frame: 60, fps: 60 }
const source = (body: string, kind = 'generator', parameters = '{}'): string => `export default {apiVersion:1,name:"实验",kind:"${kind}",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:42,parameters:${parameters},render(ctx){${body}}}`
function gpu() {
  const destroyed = vi.fn(); const compiled = vi.fn((_descriptor: unknown) => ({ getBindGroupLayout: () => ({}) }))
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() }
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
function mockTextCanvas(): void {
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(readonly width: number, readonly height: number) {}
    getContext() { return { font: '', fillStyle: '', textBaseline: '', fillText: vi.fn(), measureText: () => ({ width: 20, actualBoundingBoxRight: 20, actualBoundingBoxLeft: 0 }) } }
  })
}
describe('代码GPU会话复用与资源边界', () => {
  it('常量和仅参数滤镜复用完整固定绑定，作者不采样也不缩减宿主layout', async () => {
    const { device, compiled } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const input = await runtime.target('input', 3840, 2160)
    await runtime.filter('constant', 'constant', compileCodeMaterial(source('return rgba(0,1,0,.5);', 'filter')), context, {}, input)
    await runtime.filter('parameter', 'parameter', compileCodeMaterial(source('return rgba(ctx.params.gain,0,0,1);', 'filter', '{gain:{type:"number",title:"强度",default:.5,min:0,max:1,step:.01}}')), context, {}, input)
    expect(device.createBindGroupLayout).toHaveBeenCalledOnce()
    expect(device.createBindGroupLayout).toHaveBeenCalledWith({ entries: [
      { binding: 0, visibility: 2, texture: { sampleType: 'float' } },
      { binding: 1, visibility: 2, sampler: { type: 'filtering' } },
      { binding: 2, visibility: 2, buffer: { type: 'uniform', minBindingSize: 560 } },
    ] })
    expect(device.createPipelineLayout).toHaveBeenCalledOnce()
    expect(compiled.mock.calls.slice(-2).every(([descriptor]) => (descriptor as { layout: unknown }).layout === device.createPipelineLayout.mock.results[0].value)).toBe(true)
    expect(runtime.diagnostics().filterFrames).toBe(2)
    await runtime.dispose()
  })
  it('静态滤镜规范不可依赖的shader源时钟，长原视频入点不扩张证明范围', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const input = await runtime.target('input', 3840, 2160)
    const fixed = compileCodeMaterial(source('return sample(ctx.u,ctx.v);', 'filter').replace('mode:"dynamic"', 'mode:"static"'))
    await runtime.filter('out', 'static', fixed, { ...context, time: 3600 }, {}, input)
    const packed = vi.mocked(device.queue.writeBuffer).mock.lastCall![2] as Float32Array
    expect([...packed.slice(0, 3)]).toEqual([0, 1, 1])
    await expect(runtime.filter('bad', 'dynamic', compileCodeMaterial(source('return sample(ctx.u,ctx.v);', 'filter')), { ...context, time: 3600 }, {}, input)).rejects.toThrow('时间')
    await expect(runtime.filter('bad', 'static', fixed, { ...context, time: NaN }, {}, input)).rejects.toThrow('时间')
    await expect(runtime.filter('bad', 'static', fixed, { ...context, time: -1 }, {}, input)).rejects.toThrow('时间')
    expect(runtime.diagnostics().filterFrames).toBe(1)
    await runtime.dispose()
  })
  it('并发普通滤镜编译完成后，等待相同版本的转场调用仍重证负时钟且不额外提交', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const input = await runtime.target('input', 3840, 2160)
    const program = compileCodeMaterial(source('return rgba(clamp(1/(ctx.localTime+.5),0,1),0,0,1);', 'filter'))
    let finish!: () => void
    vi.mocked(device.popErrorScope).mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(null) }))
    const ordinary = runtime.filter('ordinary', 'v1', program, context, {}, input)
    const flagged = runtime.filter('transition', 'v1', program, { ...context, localTime: -.5 }, {}, input, true)
    const rejected = expect(flagged).rejects.toThrow('除数')
    for (let index = 0; index < 10; index++) await Promise.resolve()
    expect(device.queue.submit).not.toHaveBeenCalled()
    finish(); await ordinary; await rejected
    expect(device.queue.submit).toHaveBeenCalledOnce()
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 2, textureAllocations: 2, filterFrames: 1, pipelineCompiles: 3 })
    await runtime.dispose()
  })
  it('普通滤镜管线复用前重证负时钟安全，失败零新分配/提交，修正后同管线认证复用', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const input = await runtime.target('input', 3840, 2160)
    const unsafe = compileCodeMaterial(source('return rgba(clamp(1/(ctx.localTime+.5),0,1),0,0,1);', 'filter'))
    await runtime.filter('ordinary', 'v1', unsafe, context, {}, input)
    const before = runtime.diagnostics(); const submits = vi.mocked(device.queue.submit).mock.calls.length
    await expect(runtime.filter('bad', 'v1', unsafe, { ...context, localTime: -.5 }, {}, input, true)).rejects.toThrow('除数')
    expect(runtime.diagnostics()).toEqual(before); expect(device.queue.submit).toHaveBeenCalledTimes(submits)
    const recovered = compileCodeMaterial(source('return rgba(clamp(1/(max(ctx.localTime,0)+.5),0,1),0,0,1);', 'filter'))
    await runtime.filter('recovered', 'v2', recovered, context, {}, input)
    const compiles = runtime.diagnostics().pipelineCompiles
    await runtime.filter('recovered', 'v2', recovered, { ...context, localTime: -.5 }, {}, input, true)
    await runtime.filter('recovered', 'v2', recovered, { ...context, localTime: -.25 }, {}, input, true)
    expect(runtime.diagnostics().pipelineCompiles).toBe(compiles)
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
    expect(shader.code).toContain('return mix(textureSample(left,s,v.uv),textureSample(right,s,v.uv),amount.x)')
    const pipeline = compiled.mock.lastCall?.[0] as unknown as { fragment: { targets: Array<{ format: string; blend?: unknown }> } }
    expect(pipeline.fragment.targets).toEqual([{ format: 'rgba8unorm' }])
    expect(await runtime.mix('mix', left, right, .75)).toBe(mixed)
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 3, residentBytes: 3 * 3840 * 2160 * 4, pipelineCompiles: 3, mixFrames: 2 })
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
  it('滤镜关闭屏障等待编译，固定版本并发只编译一次并关闭异常scope', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const input = await runtime.target('input', 3840, 2160)
    const program = compileCodeMaterial(source('return sample(ctx.u,ctx.v);', 'filter'))
    let finish!: () => void
    vi.mocked(device.popErrorScope).mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(null) }))
    const first = runtime.filter('first', 'v1', program, context, {}, input)
    const second = runtime.filter('second', 'v1', program, context, {}, input)
    const rejected = [expect(first).rejects.toThrow('关闭'), expect(second).rejects.toThrow('关闭')]
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(vi.mocked(device.popErrorScope)).toHaveBeenCalledTimes(2)
    let closed = false; const disposing = runtime.dispose().then(() => { closed = true })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(closed).toBe(false)
    finish(); await Promise.all(rejected); await disposing
    expect(device.queue.submit).not.toHaveBeenCalled()
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 0, residentBytes: 0, pipelines: 0 })
    const other = gpu(); const retry = new VideoEditCodeGpu(other.device)
    const retryInput = await retry.target('input', 3840, 2160)
    vi.mocked(other.device.createRenderPipeline).mockImplementationOnce(() => { throw new Error('管线创建失败') })
    await expect(retry.filter('out', 'v1', program, context, {}, retryInput)).rejects.toThrow('管线创建失败')
    expect(other.device.pushErrorScope).toHaveBeenCalledTimes(2)
    expect(other.device.popErrorScope).toHaveBeenCalledTimes(2)
    await retry.dispose()
  })
  it.each(['mix', 'filter'] as const)('%s 编译等待期间输入退役后拒绝提交和迟到目标分配', async operation => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const left = await runtime.target('left', 3840, 2160); const right = await runtime.target('right', 3840, 2160)
    let finish!: () => void
    vi.mocked(device.popErrorScope).mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(null) }))
    const pending = operation === 'mix' ? runtime.mix('out', left, right, .5) : runtime.filter('out', 'v1', compileCodeMaterial(source('return sample(ctx.u,ctx.v);', 'filter')), context, {}, left)
    const rejected = expect(pending).rejects.toThrow('退役')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    runtime.releaseUnused(new Set()); finish(); await rejected
    expect(device.queue.submit).not.toHaveBeenCalled()
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 0, residentBytes: 0, textureAllocations: 2 })
    await runtime.dispose()
  })
  it('图片仅借用当前设备纹理，alpha模式与opacity进入可信管线且只懒编译一次', async () => {
    const { device, compiled, pass } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const destroy = vi.fn(); const view = {}; const texture = { createView: () => view, destroy }
    const imageParameters = '{logo:{type:"image",title:"图片",default:null}}'
    const program = compileCodeMaterial(source('return [image({source:ctx.params.logo,x:5,y:6,width:100,height:80,opacity:.25})];', 'generator', imageParameters))
    const values = { logo: { kind: 'image', mediaId: 'logo' } }
    const input: VideoEditCodeImageInput = { texture, width: 3840, height: 2160, owner: device, premultiplied: false }
    await runtime.generator('clip', program, context, {})
    expect(compiled).toHaveBeenCalledTimes(2); expect(pass.draw).not.toHaveBeenCalled()
    const picture = await runtime.generator('clip', program, context, values, new Map([['logo', input]]))
    expect(compiled).toHaveBeenCalledTimes(3)
    expect(vi.mocked(device.queue.writeBuffer).mock.lastCall?.[2]).toEqual(new Float32Array([5, 6, 100, 80, 1, 1, 1, .25, 0, 0, 0, 0, 3840, 2160, 0, 0, 1, 0, 0, 0]))
    expect(vi.mocked(device.createBindGroup).mock.lastCall?.[0]).toMatchObject({ entries: [{ binding: 0 }, { binding: 1, resource: view }, { binding: 2 }] })
    const imageModule = vi.mocked(device.createShaderModule).mock.lastCall?.[0] as { code: string }
    expect(imageModule.code).toContain('select(color.rgb*color.a,color.rgb,p.canvas.z==1.0)')
    expect(imageModule.code).toContain('vec4f(rgb*p.color.a,color.a*p.color.a)')
    const reused = await runtime.generator('clip', program, context, values, new Map([['logo', { ...input, premultiplied: true }]]))
    expect(reused).toBe(picture); expect(compiled).toHaveBeenCalledTimes(3)
    const packed = vi.mocked(device.queue.writeBuffer).mock.lastCall?.[2] as Float32Array
    expect(packed[14]).toBe(1); expect(packed[7]).toBe(.25)
    expect(device.queue.copyExternalImageToTexture).not.toHaveBeenCalled()
    expect(runtime.diagnostics()).toMatchObject({ textureAllocations: 1, externalCopies: 0, residentBytes: 3840 * 2160 * 4 })
    await runtime.dispose(); expect(destroy).not.toHaveBeenCalled()
  })
  it('缺输入、跨设备、错误尺寸/alpha或输入输出别名在目标写入前失败', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const program = compileCodeMaterial(source('return [image({source:ctx.params.logo,x:0,y:0,width:100,height:100})];', 'generator', '{logo:{type:"image",title:"图",default:null}}'))
    const values = { logo: { kind: 'image', mediaId: 'logo' } }
    const input: VideoEditCodeImageInput = { texture: { createView: () => ({}), destroy: vi.fn() }, width: 100, height: 100, owner: device, premultiplied: false }
    await expect(runtime.generator('candidate', program, context, values)).rejects.toThrow('输入不存在')
    for (const invalid of [{ ...input, owner: gpu().device }, { ...input, width: 0 }, { ...input, height: Infinity }, { ...input, width: 8193 }, { ...input, premultiplied: undefined }]) await expect(runtime.generator('candidate', program, context, values, new Map([['logo', invalid as VideoEditCodeImageInput]]))).rejects.toThrow('当前设备')
    expect(runtime.diagnostics()).toMatchObject({ textureAllocations: 0, surfaces: 0, pipelineCompiles: 2 })
    const picture = await runtime.generator('valid', program, context, values, new Map([['logo', input]]))
    vi.mocked(device.queue.writeBuffer).mockClear()
    await expect(runtime.generator('valid', program, context, values, new Map([['logo', { ...input, texture: picture.texture }]]))).rejects.toThrow('同一纹理')
    await expect(runtime.generator('valid', program, context, values)).rejects.toThrow('输入不存在')
    expect(device.queue.writeBuffer).not.toHaveBeenCalled(); expect(runtime.diagnostics().surfaces).toBe(1)
    await runtime.dispose()
  })
  it('图片管线编译失败不分配候选目标、不销毁借用图，恢复后关闭等待提交', async () => {
    const { device, compiled } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const program = compileCodeMaterial(source('return [image({source:ctx.params.logo,x:0,y:0,width:1,height:1})];', 'generator', '{logo:{type:"image",title:"图",default:null}}'))
    const destroy = vi.fn(); const input = { texture: { createView: () => ({}), destroy }, width: 1, height: 1, owner: device, premultiplied: true }
    await runtime.generator('empty', program, context, {})
    runtime.releaseUnused(new Set())
    vi.mocked(device.popErrorScope).mockResolvedValueOnce({ message: '图片编译失败' })
    await expect(runtime.generator('candidate', program, context, { logo: { kind: 'image', mediaId: 'logo' } }, new Map([['logo', input]]))).rejects.toThrow('图片编译失败')
    expect(runtime.diagnostics()).toMatchObject({ residentBytes: 0, surfaces: 0, pipelineCompiles: 2 })
    let finish!: () => void
    vi.mocked(device.queue.onSubmittedWorkDone).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    await runtime.generator('candidate', program, context, { logo: { kind: 'image', mediaId: 'logo' } }, new Map([['logo', input]]))
    expect(compiled).toHaveBeenCalledTimes(4)
    let closed = false
    const disposing = runtime.dispose().then(() => { closed = true })
    await Promise.resolve(); expect(closed).toBe(false)
    finish(); await disposing; expect(closed).toBe(true); expect(destroy).not.toHaveBeenCalled()
    expect(runtime.diagnostics()).toMatchObject({ residentBytes: 0, pipelines: 0 })
  })
  it('关闭等待迟到图片管线校验，迟到结果不分配目标或持有借用纹理', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const program = compileCodeMaterial(source('return [image({source:ctx.params.logo,x:0,y:0,width:1,height:1})];', 'generator', '{logo:{type:"image",title:"图",default:null}}'))
    await runtime.generator('empty', program, context, {}); runtime.releaseUnused(new Set())
    let validate!: () => void
    vi.mocked(device.popErrorScope).mockReturnValueOnce(new Promise(resolve => { validate = () => resolve(null) }))
    const destroy = vi.fn(); const input = { texture: { createView: () => ({}), destroy }, width: 1, height: 1, owner: device, premultiplied: false }
    const rendering = runtime.generator('late', program, context, { logo: { kind: 'image', mediaId: 'logo' } }, new Map([['logo', input]]))
    const rejected = expect(rendering).rejects.toThrow('关闭')
    await Promise.resolve(); await Promise.resolve()
    let closed = false
    const disposing = runtime.dispose().then(() => { closed = true })
    await Promise.resolve(); expect(closed).toBe(false)
    validate(); await rejected; await disposing
    expect(runtime.diagnostics()).toMatchObject({ residentBytes: 0, surfaces: 0, pipelines: 0, pipelineCompiles: 2 })
    expect(destroy).not.toHaveBeenCalled()
  })
  it('同设备纹理和管线复用，标量/时间变化只更新有界缓冲，关闭释放全部目标', async () => {
    const { device, compiled, destroyed } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const generator = compileCodeMaterial(source('return [rect({x:ctx.time,y:0,width:200,height:100,fill:[1,0,0,.5]})];'))
    const filter = compileCodeMaterial(source('const c=sample(ctx.u,ctx.v);return rgba(c.r*ctx.params.amount,c.g,c.b,c.a);', 'filter', '{amount:{type:"number",title:"强度",default:.5,min:0,max:1,step:.01}}'))
    const picture = await runtime.generator('clip', generator, context, {})
    await runtime.filter('effect', 'version', filter, context, {}, picture)
    const reused = await runtime.generator('clip', generator, { ...context, time: 2 }, {})
    await runtime.filter('effect', 'version', filter, context, { amount: .8 }, reused)
    expect(reused).toBe(picture); expect(compiled).toHaveBeenCalledTimes(3)
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 2, textureAllocations: 2, pipelineCompiles: 3, externalCopies: 0, generatorFrames: 2, filterFrames: 2 })
    await runtime.dispose()
    expect(runtime.diagnostics()).toMatchObject({ residentBytes: 0, surfaces: 0, glyphs: 0, pipelines: 0 })
    expect(destroyed).toHaveBeenCalledTimes(4)
    await expect(runtime.generator('clip', generator, context, {})).rejects.toThrow('关闭')
  })
  it('256MiB是所有代码目标共用上限，回收不可见目标后恢复，不降分辨率', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const program = compileCodeMaterial(source('return [];'))
    for (let index = 0; index < 8; index++) await runtime.generator(String(index), program, context, {})
    await expect(runtime.generator('9', program, context, {})).rejects.toThrow('256MiB')
    expect(runtime.diagnostics().surfaces).toBe(8)
    runtime.releaseUnused(new Set(['0']))
    await runtime.generator('9', program, context, {})
    expect(runtime.diagnostics().surfaces).toBe(2)
    await runtime.dispose()
  })
  it('候选滤镜失败保留旧目标，随后有效版本能恢复且不接受跨设备输入', async () => {
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const picture = await runtime.generator('clip', compileCodeMaterial(source('return [];')), context, {})
    const unsafe = compileCodeMaterial(source('return rgba(clamp(1/ctx.u,0,1),0,0,1);', 'filter'))
    await expect(runtime.filter('bad', 'bad-version', unsafe, context, {}, picture)).rejects.toThrow('除数')
    expect(runtime.diagnostics().surfaces).toBe(1)
    const valid = compileCodeMaterial(source('return sample(ctx.u,ctx.v);', 'filter'))
    await runtime.filter('valid', 'valid-version', valid, { ...context, seed: 4294967295 }, {}, picture)
    await expect(runtime.filter('invalid', 'valid-version', valid, context, {}, { ...picture, owner: gpu().device })).rejects.toThrow('当前设备')
    await runtime.dispose()
  })
  it('字形上传失败清理候选纹理，关闭不泄漏且可重试', async () => {
    mockTextCanvas()
    const { device, destroyed } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const program = compileCodeMaterial(source('return [text({x:0,y:0,text:"字形",fontSize:32,color:[1,1,1,1]})];'))
    vi.mocked(device.queue.copyExternalImageToTexture).mockImplementationOnce(() => { throw new Error('上传失败') })
    try {
      await expect(runtime.generator('clip', program, context, {})).rejects.toThrow('上传失败')
      expect(runtime.diagnostics()).toMatchObject({ residentBytes: 3840 * 2160 * 4, glyphs: 0 })
      await runtime.generator('clip', program, context, {})
      expect(runtime.diagnostics()).toMatchObject({ glyphs: 1, externalCopies: 1 })
      await runtime.dispose()
      expect(destroyed).toHaveBeenCalledTimes(4)
      expect(runtime.diagnostics().residentBytes).toBe(0)
    } finally { await runtime.dispose(); vi.unstubAllGlobals() }
  })
  it('64字形热帧只更换一个标题时只上传一份，不逐出本帧随后需要的字形', async () => {
    mockTextCanvas()
    const { device } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const title = (text: string): string => `text({x:0,y:0,text:"${text}",fontSize:32,color:[1,1,1,1]})`
    const names = Array.from({ length: 64 }, (_, index) => `old${index}`)
    try {
      await runtime.generator('clip', compileCodeMaterial(source(`return [${names.map(title).join(',')}];`)), context, {})
      expect(runtime.diagnostics().externalCopies).toBe(64)
      await runtime.generator('clip', compileCodeMaterial(source(`return [${['new', ...names.slice(0, -1)].map(title).join(',')}];`)), context, {})
      expect(runtime.diagnostics().externalCopies).toBe(65)
      expect(runtime.diagnostics().glyphs).toBe(64)
    } finally { await runtime.dispose(); vi.unstubAllGlobals() }
  })
  it('高精度滤镜与混合保持 rgba16float，按输出格式分别编译，八位路径不变', async () => {
    const { device, compiled } = gpu(); const runtime = new VideoEditCodeGpu(device)
    const deep = await runtime.target('deep', 3840, 2160, 'rgba16float'); const plain = await runtime.target('plain', 3840, 2160)
    expect([deep.highPrecision, plain.highPrecision]).toEqual([true, false])
    const program = compileCodeMaterial(source('return sample(ctx.u,ctx.v);', 'filter'))
    const format = (): string => (compiled.mock.lastCall?.[0] as { fragment: { targets: Array<{ format: string }> } }).fragment.targets[0].format
    const filtered = await runtime.filter('deep-out', 'version', program, context, {}, deep)
    expect(filtered.textureFormat).toBe('rgba16float'); expect(format()).toBe('rgba16float')
    const ordinary = await runtime.filter('plain-out', 'version', program, context, {}, plain)
    expect(ordinary.textureFormat).toBe('rgba8unorm'); expect(format()).toBe('rgba8unorm')
    const compiles = runtime.diagnostics().pipelineCompiles
    await runtime.filter('deep-out', 'version', program, context, {}, deep); await runtime.filter('plain-out', 'version', program, context, {}, plain)
    expect(runtime.diagnostics().pipelineCompiles).toBe(compiles)
    const mixed = await runtime.mix('mix', plain, filtered, .5)
    expect(mixed.textureFormat).toBe('rgba16float'); expect(format()).toBe('rgba16float')
    expect((await runtime.mix('plain-mix', plain, ordinary, .5)).textureFormat).toBe('rgba8unorm'); expect(format()).toBe('rgba8unorm')
    // A key reused at another format is reallocated, never written in the old format.
    expect((await runtime.target('plain', 3840, 2160, 'rgba16float')).textureFormat).toBe('rgba16float')
    const frame = 3840 * 2160
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 6, residentBytes: frame * 8 * 4 + frame * 4 * 2, pipelines: 2 + 2 + 2 })
    await runtime.dispose(); expect(runtime.diagnostics()).toMatchObject({ surfaces: 0, residentBytes: 0, pipelines: 0 })
  })
  it('高精度目标有独立的512MiB上限，不挤占八位256MiB预算', async () => {
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
