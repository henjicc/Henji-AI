import { describe, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'

const context = { time: 1, localTime: 1, sequenceTime: 1, width: 3840, height: 2160, frame: 60, fps: 60 }
const source = (body: string, kind = 'generator', parameters = '{}'): string => `export default {apiVersion:1,name:"实验",kind:"${kind}",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:42,parameters:${parameters},render(ctx){${body}}}`
function gpu() {
  const destroyed = vi.fn(); const compiled = vi.fn(() => ({ getBindGroupLayout: () => ({}) }))
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() }
  const device: GpuDevice = {
    queue: { copyExternalImageToTexture: vi.fn(), writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: vi.fn(async () => {}) },
    lost: new Promise(() => {}), createShaderModule: vi.fn(), createRenderPipeline: compiled,
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
    expect(vi.mocked(device.queue.writeBuffer).mock.lastCall?.[2]).toEqual(new Float32Array([5, 6, 100, 80, 1, 1, 1, .25, 0, 0, 0, 0, 3840, 2160, 0, 0]))
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
})
