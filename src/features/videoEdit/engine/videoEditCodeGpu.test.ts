import { describe, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { VideoEditCodeGpu } from './videoEditCodeGpu'

const context = { time: 1, localTime: 1, sequenceTime: 1, width: 3840, height: 2160, frame: 60, fps: 60 }
const source = (body: string, kind = 'generator', parameters = '{}'): string => `export default {apiVersion:1,name:"实验",kind:"${kind}",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:42,parameters:${parameters},render(ctx){${body}}}`
function gpu() {
  const destroyed = vi.fn(); const compiled = vi.fn(() => ({ getBindGroupLayout: () => ({}) }))
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() }
  const device: GpuDevice = {
    queue: { copyExternalImageToTexture: vi.fn(), writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: async () => {} },
    lost: new Promise(() => {}), createShaderModule: vi.fn(), createRenderPipeline: compiled,
    createSampler: vi.fn(), createTexture: () => ({ createView: () => ({}), destroy: destroyed }), createBuffer: () => ({ destroy: destroyed }),
    createBindGroup: vi.fn(), createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }), pushErrorScope: vi.fn(), popErrorScope: async () => null, destroy: vi.fn(),
  }
  return { destroyed, compiled, device }
}
function mockTextCanvas(): void {
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(readonly width: number, readonly height: number) {}
    getContext() { return { font: '', fillStyle: '', textBaseline: '', fillText: vi.fn(), measureText: () => ({ width: 20, actualBoundingBoxRight: 20, actualBoundingBoxLeft: 0 }) } }
  })
}
describe('代码GPU会话复用与资源边界', () => {
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
