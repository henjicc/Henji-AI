import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes'
import { createImageEditAdjustmentLayerV3, createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../documentFactory'
import { createFloat32MaskTile, createFloat32PremultipliedRgbaTile } from '../effects/contracts'
import { compileImageEditRenderPlanV3 } from '../renderPlanCompiler'
import { resolveImageEditOutputGeometryV3 } from '../outputGeometry'
import type { ImageEditRect } from '../tileGeometry'
import { executeImageEditCpuRenderRegionPlanV3, type ImageEditCpuRegionRenderContextV3 } from './cpuRenderRegionExecutor'
import { ImageEditCpuRegionWorkerClientV3 } from './cpuRegionWorkerClient'
import { encodeImageEditorV3RenderedOutputTile } from './cpuOutputTile'
import { buildCpuRegionTestWorkerV3, CpuRegionNodeTestWorkerV3 } from './cpuRegionWorker.testSupport'
import type { CpuRegionWorkerPortV3 } from './cpuRegionWorkerProtocol'
import { splitImageEditCpuOutputV3, assembleImageEditCpuOutputV3 } from './cpuOutputParts'

let workerCode: string
beforeAll(async () => { workerCode = await buildCpuRegionTestWorkerV3() })
function fixture() {
  const document = createImageEditDocumentV3({ width: 32, height: 32 })
  const layer = createImageEditRasterLayerV3('source', '源', 'sha256:source')
  layer.opacity = .8
  document.layers = [layer, createImageEditAdjustmentLayerV3('exposure', '曝光', 'exposure', { stops: .3 })]
  const registry = createBuiltInImageEditRenderNodeRegistry()
  const plan = compileImageEditRenderPlanV3(document, registry, 'export')
  const rgba = (region: ImageEditRect) => createFloat32PremultipliedRgbaTile(region.width, region.height,
    'linear-light', Float32Array.from({ length: region.width * region.height * 4 }, (_, index) => [0.1, 0.2, 0.3, .5][index % 4]))
  const region = { x: 0, y: 0, width: 32, height: 32 }
  const context: ImageEditCpuRegionRenderContextV3 = { size: document.geometry, registry,
    createTransparent: (rect) => createFloat32PremultipliedRgbaTile(rect.width, rect.height,
      'linear-light', new Float32Array(rect.width * rect.height * 4)),
    loadRaster: async (_node, rect) => rgba(rect), rasterizeAnnotations: async (_node, rect) => rgba(rect),
    loadMask: async (_ref, _node, rect) => createFloat32MaskTile(rect.width, rect.height, new Float32Array(rect.width * rect.height).fill(.4)) }
  const output = { rect: region, geometry: resolveImageEditOutputGeometryV3(document.geometry),
    description: { bitDepth: 8 as const, colorSpace: 'srgb' as const, transferFunction: 'srgb' as const, alphaMode: 'straight' as const } }
  return { document, plan, region, context, output }
}

describe('CPU 区域 Worker', () => {
  it.each([0, 90, 180, 270] as const)('四线程分块在旋转%s、镜像和裁剪下与整幅输出逐字节一致', async rotate => {
    const { document, context, region, plan, output } = fixture()
    context.loadRaster = async (_node, requested) => createFloat32PremultipliedRgbaTile(requested.width, requested.height,
      'linear-light', Float32Array.from({ length: requested.width * requested.height * 4 }, (_, index) => {
        const x = requested.x + Math.floor(index / 4) % requested.width
        const y = requested.y + Math.floor(index / 4 / requested.width)
        return [x / 64, y / 64, (x + y) / 128, .5][index % 4]
      }))
    document.geometry.orientation = { rotate, mirrored: true }
    document.geometry.crop = { x: 1, y: 1, width: 30, height: 30 }
    const rect = { x: 0, y: 0, width: 30, height: 30 }
    const target = { ...output, rect, geometry: resolveImageEditOutputGeometryV3(document.geometry) }
    // 30px按技术阈值不拆分；另用32输出覆盖实际四块路径。
    const full = { ...target, rect: region, geometry: { ...target.geometry, cropX: 0, cropY: 0, outputWidth: 32, outputHeight: 32 } }
    const clients = Array.from({ length: 4 }, () => new ImageEditCpuRegionWorkerClientV3(new CpuRegionNodeTestWorkerV3(workerCode).port()))
    try {
      for (const geometry of [target, full]) {
        const parts = splitImageEditCpuOutputV3(geometry, 4)
        const actual = assembleImageEditCpuOutputV3(await Promise.all(parts.map((part, index) => clients[index].render(plan, part.region, context, part.output))), geometry.rect, 4)
        const expected = await clients[0].render(plan, region, context, geometry)
        expect(actual.pixels).toEqual(expected.pixels)
      }
    } finally { clients.forEach(client => client.dispose()) }
  })
  it('真实线程与直接执行的整幅/分块逐字节一致，读取器借出缓冲不被 detach', async () => {
    const { plan, region, context, output } = fixture()
    const shared = await context.loadRaster(plan.nodes[0], region)
    context.loadRaster = async () => shared
    const client = new ImageEditCpuRegionWorkerClientV3(new CpuRegionNodeTestWorkerV3(workerCode).port())
    try {
      const direct = await executeImageEditCpuRenderRegionPlanV3(plan, region, context)
      const expected = encodeImageEditorV3RenderedOutputTile(direct!, region, output.description)
      for (let count = 0; count < 2; count++) expect((await client.render(plan, region, context, output)).pixels).toEqual(expected.pixels)
      expect(shared.data.byteLength).toBe(32 * 32 * 16)
      context.loadRaster = fixture().context.loadRaster
      const part = { x: 4, y: 4, width: 16, height: 16 }
      const result = await client.render(plan, part, context, { ...output, rect: part })
      const reference = await executeImageEditCpuRenderRegionPlanV3(plan, part, context)
      expect(result.pixels).toEqual(encodeImageEditorV3RenderedOutputTile(reference!, part, output.description).pixels)
    } finally { client.dispose() }
  })

  it('源读取失败完整返回，不挂起任务；同 Worker 可继续下一次读取', async () => {
    const { plan, region, context, output } = fixture()
    const client = new ImageEditCpuRegionWorkerClientV3(new CpuRegionNodeTestWorkerV3(workerCode).port())
    try {
      await expect(client.render(plan, region, { ...context, loadRaster: async () => { throw new Error('源损坏') } }, output)).rejects.toThrow('源损坏')
      expect((await client.render(plan, region, context, output)).pixels.byteLength).toBe(4096)
    } finally { client.dispose() }
  })

  it('取消立即终止计算线程，迟到的资源回执不再发送', async () => {
    const { plan, region, context, output } = fixture()
    let receive: Parameters<CpuRegionWorkerPortV3['subscribe']>[0] | undefined
    const postMessage = vi.fn(), terminate = vi.fn()
    const client = new ImageEditCpuRegionWorkerClientV3({ postMessage, terminate, subscribe: (fn) => { receive = fn } })
    const controller = new AbortController()
    let resolveSource!: (value: Awaited<ReturnType<typeof context.loadRaster>>) => void
    const source = await context.loadRaster(plan.nodes[0], region)
    const promise = client.render(plan, region, { ...context, signal: controller.signal,
      loadRaster: () => new Promise((resolve) => { resolveSource = resolve }) }, output)
    receive!({ type: 'callback', jobId: 1, callbackId: 1, request: { kind: 'raster', nodeId: plan.nodes[0].id, region } })
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    resolveSource(source)
    await Promise.resolve()
    expect(terminate).toHaveBeenCalledOnce()
    expect(postMessage).toHaveBeenCalledTimes(1)
  })
})
