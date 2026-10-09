import { writeFileSync } from 'node:fs'
import type { Gpu } from 'vgpu'
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditRasterLayerV3, createBuiltInImageEditRenderNodeRegistry } from '@/core/imageEdit/v3'
import { compileImageEditRenderPlanV3 } from '@/core/imageEdit/v3/renderPlanCompiler'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { createImageEditorGpuExportPlanV3 } from '../export/gpuExportPlanV3'
import { ImageEditorGpuRasterCompositorV3 } from './imageEditorGpuRasterCompositorV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { imageEditorGpuSceneTileKeyV3, type ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'
import { imageEditorGpuExportLayoutV3 } from './imageEditorGpuSceneExportGeometryV3'
import { usesImageEditorGpuGaussianRegionsV3 } from './imageEditorGpuGaussianRegionsV3'

/** 显式本机探针，使用正式 compositor/atlas/export tile 计划；不包含文件编码和写盘。 */
export async function measureImageGaussianRegionsV3(gpu: Gpu): Promise<void> {
  const rows: Record<string, unknown>[] = []
  const resourceRef = `sha256:${'a'.repeat(64)}` as const
  for (const [width, height] of [[1920, 1080], [3840, 2160], [7680, 4320]]) for (const fraction of [.003, .03]) for (const quality of ['stable', 'export'] as const) {
    const document = createImageEditDocumentV3({ width, height })
    document.layers = [createImageEditRasterLayerV3('source', '源', resourceRef), createImageEditEffectLayerV3('blur', '高斯', 'gaussian_blur', { sigma_fraction_height: fraction })]
    const compiled = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef, byteLength: width * height * 4, mediaType: 'image/png' }], undefined, quality)
    if (!compiled.supported) throw new Error(compiled.reason)
    const memory = trackGaussianGpuAllocationsV3(gpu)
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
    const uploaded = new Map<string, ReturnType<typeof compositor.uploadTile>>()
    let peakBytes = 0
    const resolve = (key: ImageEditorGpuSceneTileKeyV3): ReturnType<typeof compositor.uploadTile> | null => uploaded.get(imageEditorGpuSceneTileKeyV3(key)) ?? null
    const fill = (): void => {
      for (const key of compositor.requiredResourceKeys()) {
        if (resolve(key)) continue
        const divisor = 2 ** key.mip
        const w = Math.min(512, Math.ceil(width / divisor) - key.tileX * 512), h = Math.min(512, Math.ceil(height / divisor) - key.tileY * 512)
        const pixels = Uint8Array.from({ length: w * h * 4 }, (_, i) => i % 4 === 3 ? 192 : (i * 17 + key.tileX * 31 + key.tileY * 7) % 256)
        const tile: ImageEditorV3SourceTile = { resourceRef, mip: key.mip, tileX: key.tileX, tileY: key.tileY, width: w, height: h, halo: 0,
          bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8', channels: 4, byteOrder: 'little-endian', rowStride: w * 4,
          colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight', orientationApplied: true, originX: key.tileX * 512, originY: key.tileY * 512, pixels: pixels.buffer }
        uploaded.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key, tile))
      }
      peakBytes = Math.max(peakBytes, compositor.estimatedResidentGpuBytes())
    }
    try {
      compositor.syncScene(compiled.scene)
      if (quality === 'stable') {
        const runs: number[] = []
        // 100% 放大局部窗口，不能把输入大图缩小后的核性能冒充原尺寸拖动。
        for (let i = 0; i < 23; i++) {
          const node = compiled.scene.graph.find(node => node.kind === 'effect')!
          const scene = { ...compiled.scene, graph: compiled.scene.graph.map(entry => entry === node ? { ...node, fingerprint: `drag:${i}`, parameters: { ...node.parameters, sigma_fraction_height: fraction * (1 + (i % 3) * .01) } } : entry) }
          compositor.syncScene(scene)
          compositor.updateViewport({ stageWidth: 1440, stageHeight: 810, viewportKey: 'drag', viewport: { documentX: Math.floor((width - 1440) / 2), documentY: Math.floor((height - 810) / 2), width: 1440, height: 810, zoom: 1, devicePixelRatio: 1 } })
          fill()
          const start = performance.now()
          await compositor.renderExportTarget(resolve)
          if (i >= 3) runs.push(performance.now() - start)
        }
        runs.sort((a, b) => a - b)
        rows.push({ width, height, fraction, quality: 'interactive', p50Ms: runs[9], p95Ms: runs[18], peakBytes, ...memory.snapshot(), samples: runs.length })
      } else {
        const plan = compileImageEditRenderPlanV3(document, createBuiltInImageEditRenderNodeRegistry(), 'export')
        const exportPlan = createImageEditorGpuExportPlanV3({ plan, width, height, tileSize: 512 })
        const start = performance.now()
        for (const tile of exportPlan.tiles) {
          for (const value of uploaded.values()) value.destroy()
          uploaded.clear()
          const core = usesImageEditorGpuGaussianRegionsV3(compiled.scene) ? { ...tile, renderX: tile.x, renderY: tile.y,
            renderWidth: tile.width, renderHeight: tile.height, coreOffsetX: 0, coreOffsetY: 0 } : tile
          compositor.updateExportViewport(imageEditorGpuExportLayoutV3('measure', core, compiled.scene, width), [width, height])
          fill()
          await compositor.readExportLinearPixels(resolve)
        }
        rows.push({ width, height, fraction, quality: 'final', totalMs: performance.now() - start, peakBytes, ...memory.snapshot(), tiles: exportPlan.tiles.length })
      }
    } catch (error) {
      rows.push({ width, height, fraction, quality: quality === 'stable' ? 'interactive' : 'final', rejected: String(error), peakBytes: Math.max(peakBytes, compositor.estimatedResidentGpuBytes()) })
    } finally {
      for (const value of uploaded.values()) value.destroy()
      compositor.dispose()
      await gpu.settled()
      memory.dispose()
    }
    if (process.env.HENJI_GAUSSIAN_MEASUREMENTS) writeFileSync(process.env.HENJI_GAUSSIAN_MEASUREMENTS, JSON.stringify({ adapter: {
      vendor: gpu.gpu.adapterInfo.vendor, architecture: gpu.gpu.adapterInfo.architecture, device: gpu.gpu.adapterInfo.device, description: gpu.gpu.adapterInfo.description }, rows }, null, 2))
  }
  if (rows.some(row => row.rejected)) throw new Error('大图 GPU 基准有预算/执行拒绝，详见测量文件')
  if (rows.some(row => Number(row.allocationPeakBytes) > 256 * 1024 * 1024)) throw new Error('GPU 实际分配峰值超出会话预算')
}

/** 诊断计数包含 texture/buffer 创建与 destroy，非驱动内部资源/延迟回收。 */
function trackGaussianGpuAllocationsV3(gpu: Gpu): { snapshot(): { texturePeakBytes: number; allocationPeakBytes: number }; dispose(): void } {
  const texture = gpu.gpu.createTexture.bind(gpu.gpu), buffer = gpu.gpu.createBuffer.bind(gpu.gpu)
  let textureBytes = 0, bufferBytes = 0, texturePeakBytes = 0, allocationPeakBytes = 0
  const update = (): void => { texturePeakBytes = Math.max(texturePeakBytes, textureBytes); allocationPeakBytes = Math.max(allocationPeakBytes, textureBytes + bufferBytes) }
  gpu.gpu.createTexture = (descriptor: Parameters<Gpu['gpu']['createTexture']>[0]) => {
    const value = texture(descriptor)
    const bytesPerPixel = { rgba8unorm: 4, rgba16float: 8, rgba32float: 16, r8unorm: 1, r32float: 4 }[value.format as 'rgba16float']
    if (!bytesPerPixel) throw new Error(`测量缺少格式字节数：${value.format}`)
    let bytes = 0
    for (let level = 0; level < value.mipLevelCount; level++) bytes += Math.max(1, value.width >> level) * Math.max(1, value.height >> level) * value.depthOrArrayLayers * bytesPerPixel * value.sampleCount
    textureBytes += bytes; update()
    const destroy = value.destroy.bind(value); let destroyed = false
    value.destroy = () => { if (!destroyed) { destroyed = true; textureBytes -= bytes } destroy() }
    return value
  }
  gpu.gpu.createBuffer = (descriptor: Parameters<Gpu['gpu']['createBuffer']>[0]) => {
    const value = buffer(descriptor)
    bufferBytes += value.size; update()
    const destroy = value.destroy.bind(value); let destroyed = false
    value.destroy = () => { if (!destroyed) { destroyed = true; bufferBytes -= value.size } destroy() }
    return value
  }
  return { snapshot: () => ({ texturePeakBytes, allocationPeakBytes }), dispose: () => { gpu.gpu.createTexture = texture; gpu.gpu.createBuffer = buffer } }
}
