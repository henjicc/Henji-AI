import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditEffectPresetSchema, resolveVideoEditStylePieceEffects } from '@/core/videoEdit/effectPresets'
import { addressCodeMaterialFiles, documentCodeSourceResolver } from '@/core/videoEdit/codeMaterial/sources'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { styleCodeDeclarations } from '@/core/videoEdit/styleCodeSnapshot'
import { materializeVideoEditStylePiece } from '../application/videoEditStyleCode'
import { testAuthorModule, testAuthorProgram } from './videoEditAuthorTestFixtures'
import { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { bundleAuthorFiles } from './videoEditAuthorBundle'
import { build } from 'esbuild'

// Node 替代编译 Worker 的装配边界；源码依赖、声明解析、作者运行时与 Dawn 设备均为真实实现。
vi.mock('../application/videoEditCodeState', async () => {
  const { testAuthorProgram } = await import('./videoEditAuthorTestFixtures')
  const { bundleAuthorFiles } = await import('./videoEditAuthorBundle')
  const { build } = await import('esbuild')
  return { compileVideoEditCode: async (files: import('@/core/videoEdit/codeMaterial/sources').CodeMaterialFiles) => testAuthorProgram(await bundleAuthorFiles(files, options => build(options as import('esbuild').BuildOptions))), rememberVideoEditCodeMetadata() {} }
})
let gpu: Gpu
beforeAll(async () => { gpu = await init() })
afterAll(() => gpu?.dispose())

it('代码滤镜快照跨工程重建，旋钮映射值进入真实 GPU，库版本锁定与内容复用保持', async () => {
  const source = { entry: 'main.ts', files: {
    'main.ts': `import { pixels } from './pixels.ts'; export default {name:'风格滤镜',kind:'filter',mode:'static',params:[{key:'gain',title:'强度',type:'number',default:.5,min:0,max:1,step:.01}],createWebGPU(device){return {draw(target,t,p,W,H){device.queue.writeTexture({texture:target},pixels(W,H,p.gain),{bytesPerRow:W*4},[W,H]);}}}}`,
    'pixels.ts': 'export function pixels(W,H,gain){const data=new Uint8Array(W*H*4);for(let i=0;i<data.length;i+=4)data.set([Math.round(gain*255),0,0,255],i);return data;}',
  } }
  const bundle = await bundleAuthorFiles({ ...source, apiVersion: 7 }, options => build(options as import('esbuild').BuildOptions)), program = testAuthorProgram(bundle)
  const { codeSources, ...manifest } = await addressCodeMaterialFiles(source)
  const preset = videoEditEffectPresetSchema.parse({ id: 'gpu-piece', name: '代码滤镜', media: 'video', effects: [{ id: 'code', name: '滤镜', enabled: true, amount: 1, code: { definitionId: 'source', versionId: 'fixed', parameters: { gain: .5 } } }], codeSnapshots: { code: { version: { id: 'fixed', ...manifest, apiVersion: 7, languageVersion: 4, libraries: { 'henji-effects': '1.3.0' } }, codeSources, ...styleCodeDeclarations(program) } }, knobs: [{ key: 'strength', name: '强度', min: 0, max: 100, default: 50, mappings: [{ effectId: 'code', parameter: 'gain', points: [{ input: 0, output: 0 }, { input: 100, output: 1 }] }] }] })
  const document = createVideoEditTestDocument('代码风格件 GPU')
  const [effect] = await materializeVideoEditStylePiece(document, preset, { knobs: { strength: 80 } })
  await materializeVideoEditStylePiece(document, preset)
  expect(document.codeMaterials).toHaveLength(1)
  expect(document.codeMaterials![0].versions[0].libraries).toEqual({ 'henji-effects': '1.3.0' })
  const reconstructed = codeMaterialSource(document, effect.code!)
  expect(documentCodeSourceResolver().read(reconstructed.files[1].hash, reconstructed.files[1].location)).toContain('pixels')
  const rebuilt = await bundleAuthorFiles(reconstructed.compilation, options => build(options as import('esbuild').BuildOptions))
  const device = gpu.gpu, width = 16, height = 8
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: 0x01 | 0x02 | 0x04 | 0x10 })
  const runtime = new VideoEditAuthorRuntime(device as unknown as GpuDevice, testAuthorModule(rebuilt.code), undefined, true, 7)
  try {
    device.pushErrorScope('validation')
    await runtime.render(target as unknown as GpuTexture, width, height, effect.code!.parameters, {}, { time: 0, frameDuration: 1 / 30, clip: { time: 0, duration: 1 } })
    const buffer = device.createBuffer({ size: 256 * height, usage: 0x01 | 0x08 })
    try {
      const encoder = device.createCommandEncoder(); encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: 256 }, [width, height]); device.queue.submit([encoder.finish()])
      await buffer.mapAsync(1)
      expect([...new Uint8Array(buffer.getMappedRange()).subarray(0, 4)]).toEqual([204, 0, 0, 255])
      buffer.unmap()
    } finally { buffer.destroy() }
    expect(await device.popErrorScope()).toBeNull()
    expect(resolveVideoEditStylePieceEffects(preset)[0].code!.parameters.gain).toBe(.5)
  } finally { await runtime.dispose(); target.destroy() }
})
