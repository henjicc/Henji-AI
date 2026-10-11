import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes'
import { createImageEditAdjustmentLayerV3, createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../documentFactory'
import { createImageEditSparseMaskReferenceV3 } from '../layerTypes'
import { createFloat32MaskTile, createFloat32PremultipliedRgbaTile } from '../effects/contracts'
import { compileImageEditRenderPlanV3 } from '../renderPlanCompiler'
import { resolveImageEditOutputGeometryV3 } from '../outputGeometry'
import type { ImageEditRect } from '../tileGeometry'
import { executeImageEditCpuRenderRegionPlanV3, type ImageEditCpuRegionRenderContextV3 } from './cpuRenderRegionExecutor'
import { ImageEditCpuRegionWorkerClientV3 } from './cpuRegionWorkerClient'
import { encodeImageEditorV3RenderedOutputTile } from './cpuOutputTile'
import { buildCpuRegionTestWorkerV3, CpuRegionNodeTestWorkerV3 } from './cpuRegionWorker.testSupport'
import type { CpuRegionWorkerPortV3, CpuRegionWorkerRequestV3 } from './cpuRegionWorkerProtocol'
import { splitImageEditCpuOutputV3, assembleImageEditCpuOutputV3 } from './cpuOutputParts'

let workerCode: string
beforeAll(async () => { workerCode = await buildCpuRegionTestWorkerV3() })
function fixture(size = 32) {
  const document = createImageEditDocumentV3({ width: size, height: size })
  const layer = createImageEditRasterLayerV3('source', '源', 'sha256:source')
  layer.opacity = .8
  document.layers = [layer, createImageEditAdjustmentLayerV3('exposure', '曝光', 'exposure', { stops: .3 })]
  const registry = createBuiltInImageEditRenderNodeRegistry()
  const plan = compileImageEditRenderPlanV3(document, registry, 'export')
  const rgba = (region: ImageEditRect) => createFloat32PremultipliedRgbaTile(region.width, region.height,
    'linear-light', Float32Array.from({ length: region.width * region.height * 4 }, (_, index) => [0.1, 0.2, 0.3, .5][index % 4]))
  const region = { x: 0, y: 0, width: size, height: size }
  const context: ImageEditCpuRegionRenderContextV3 = { size: document.geometry, registry,
    createTransparent: (rect) => createFloat32PremultipliedRgbaTile(rect.width, rect.height,
      'linear-light', new Float32Array(rect.width * rect.height * 4)),
    loadRaster: async (_node, rect) => rgba(rect), rasterizeVectorContent: async (_node, rect) => rgba(rect),
    loadMask: async (_ref, _node, rect) => createFloat32MaskTile(rect.width, rect.height, new Float32Array(rect.width * rect.height).fill(.4)) }
  const output = { rect: region, geometry: resolveImageEditOutputGeometryV3(document.geometry),
    description: { bitDepth: 8 as const, colorSpace: 'srgb' as const, transferFunction: 'srgb' as const, alphaMode: 'straight' as const } }
  return { document, plan, region, context, output }
}

describe('CPU 区域 Worker', () => {
  it('并行图节点仍只占一份源解码暂存，首个源失败后不继续读取其他源', async () => {
    const { document, region, context } = fixture()
    document.layers.unshift(createImageEditRasterLayerV3('base', '底图', 'sha256:base'))
    const plan = compileImageEditRenderPlanV3(document, context.registry, 'export')
    const original = context.loadRaster
    let active = 0, maximum = 0
    context.loadRaster = async (...args) => {
      active++; maximum = Math.max(maximum, active)
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      try { return await original(...args) } finally { active-- }
    }
    await executeImageEditCpuRenderRegionPlanV3(plan, region, context)
    expect(maximum).toBe(1)
    const failed = vi.fn(async () => { throw new Error('读取失败') })
    await expect(executeImageEditCpuRenderRegionPlanV3(plan, region, { ...context, loadRaster: failed })).rejects.toThrow('读取失败')
    expect(failed).toHaveBeenCalledOnce()
  })

  it('重复借出的源只复制一次，分层覆盖对象不合并；任务结束清除引用', async () => {
    const { document, region, context, output } = fixture()
    document.layers.unshift(createImageEditRasterLayerV3('base', '底图', 'sha256:source'))
    const plan = compileImageEditRenderPlanV3(document, context.registry, 'export')
    const shared = await context.loadRaster(plan.nodes[0], region)
    const covered = { ...shared, data: shared.data.map(value => value * .5) }
    const worker = new CpuRegionNodeTestWorkerV3(workerCode)
    const port = worker.port()
    const messages: CpuRegionWorkerRequestV3[] = []
    const client = new ImageEditCpuRegionWorkerClientV3({ ...port,
      postMessage: message => { messages.push(message); port.postMessage(message) } })
    try {
      for (const distinct of [false, false, true]) {
        messages.length = 0
        context.loadRaster = async node => distinct && node.layerId === 'source' ? covered : shared
        const result = await client.render(plan, region, context, output)
        const direct = await executeImageEditCpuRenderRegionPlanV3(plan, region, context)
        expect(result.pixels).toEqual(encodeImageEditorV3RenderedOutputTile(direct!, region, output.description).pixels)
        const replies = messages.filter(message => message.type === 'reply')
        expect(replies.filter(message => message.value !== undefined)).toHaveLength(distinct ? 2 : 1)
        expect(replies.filter(message => message.referenceId !== undefined)).toHaveLength(distinct ? 0 : 1)
      }
      expect(shared.data.byteLength).toBe(32 * 32 * 16)
    } finally { client.dispose() }
  })

  it('区域源与蒙版读取重叠，全部读取失败被处理且可继续使用线程', async () => {
    const { document, region, context, output } = fixture()
    document.layers[0].mask = createImageEditSparseMaskReferenceV3('mask', false, 1)
    const plan = compileImageEditRenderPlanV3(document, context.registry, 'export')
    const originalRaster = context.loadRaster, originalMask = context.loadMask
    let releaseMask!: () => void
    const rasterStarted = new Promise<void>(resolve => { releaseMask = resolve })
    let maskStarted!: () => void
    const maskReady = new Promise<void>(resolve => { maskStarted = resolve })
    context.loadRaster = async (...args) => { releaseMask(); await maskReady; return originalRaster(...args) }
    context.loadMask = async (...args) => { maskStarted(); await rasterStarted; return originalMask(...args) }
    const client = new ImageEditCpuRegionWorkerClientV3(new CpuRegionNodeTestWorkerV3(workerCode).port())
    try {
      expect((await client.render(plan, region, context, output)).pixels.byteLength).toBe(4096)
      await expect(client.render(plan, region, { ...context,
        loadRaster: async () => { throw new Error('源失败') },
        loadMask: async () => { throw new Error('蒙版失败') },
      }, output)).rejects.toThrow(/源失败|蒙版失败/)
      expect((await client.render(plan, region, context, output)).pixels.byteLength).toBe(4096)
    } finally { client.dispose() }
  })

  it.each(([0, 90, 180, 270] as const).flatMap(rotate => [32, 97].map(size => ({ rotate, size }))))('四线程分块在旋转$rotate、$size 像素、镜像和裁剪下与整幅输出逐字节一致', async ({ rotate, size }) => {
    const { document, context, region, plan, output } = fixture(size)
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
    // 30px不拆分；32覆盖四象限；97覆盖不能均分的尾行/列。
    const full = { ...target, rect: region, geometry: { ...target.geometry, cropX: 0, cropY: 0, outputWidth: size, outputHeight: size } }
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
