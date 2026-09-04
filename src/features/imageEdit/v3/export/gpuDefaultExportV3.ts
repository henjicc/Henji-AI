import { compileImageEditRenderPlanV3, createBuiltInImageEditRenderNodeRegistry } from '@/core/imageEdit/v3'
import type { ImageEditorV3RestartableExportTileStream } from '@/commands/imageEditorV3Export'
import { createLogger } from '@/core/logging'
import { ImageEditorRenderSessionGpuBridgeV3 } from '../execution/imageEditorRenderSessionGpuBridgeV3'
import type { ImageEditorV3ExportRenderDependencies, ImageEditorV3ExportTileStream,
  RenderImageEditorV3ExportTilesRequest } from './contracts'
import { renderImageEditorV3ExportTilesFromActiveGpuScene } from './gpuExportSessionV3'
import { renderImageEditorV3ExportTiles } from './renderExportTilesV3'

const logger = createLogger('features.image_edit.v3.gpu_default_export')
const registry = createBuiltInImageEditRenderNodeRegistry()

class GpuDefaultExportTileStreamV3 implements ImageEditorV3RestartableExportTileStream {
  constructor(
    private readonly gpu: ImageEditorV3ExportTileStream,
    private readonly cpu: () => ImageEditorV3ExportTileStream,
    private readonly cleanup?: () => void,
  ) {}

  async *[Symbol.asyncIterator]() {
    try {
      yield* this.gpu
    } finally {
      this.cleanup?.()
    }
  }

  createCpuFallback(error: Error): ImageEditorV3ExportTileStream {
    logger.warn('图片编辑 GPU 导出已请求事务级 CPU 重试', {
      event: 'image_editor_v3.gpu_export.cpu_retry_requested',
      context: { reason: error.message },
    })
    return this.cpu()
  }
}

/**
 * 正式导出唯一后端选择器：活动 Scene → 临时同协议 Scene → CPU 兼容后备。
 * dependencies 仅供 CPU 单元测试注入；生产入口不传入。
 */
export function renderImageEditorV3ExportTilesWithGpu(
  request: RenderImageEditorV3ExportTilesRequest,
  dependencies: ImageEditorV3ExportRenderDependencies = {},
): ImageEditorV3ExportTileStream {
  const cpu = (): ImageEditorV3ExportTileStream => renderImageEditorV3ExportTiles(request, dependencies)
  if (Object.keys(dependencies).length > 0) return cpu()

  const active = renderImageEditorV3ExportTilesFromActiveGpuScene(request)
  if (active) return new GpuDefaultExportTileStreamV3(active, cpu)
  if (typeof Worker === 'undefined') return cpu()

  let bridge: ImageEditorRenderSessionGpuBridgeV3 | null = null
  try {
    bridge = new ImageEditorRenderSessionGpuBridgeV3(
      `gpu-export:${request.sessionId ?? crypto.randomUUID()}`,
      undefined,
      () => undefined,
    )
    const plan = compileImageEditRenderPlanV3(request.document, registry, 'export')
    bridge.syncSnapshot({
      document: request.document,
      renderGeneration: 1,
      geometryHash: plan.outputHash,
      quality: 'export',
      resourceDescriptors: request.resourceDescriptors,
    })
    const stream = bridge.renderExport(request)
    if (!stream) {
      bridge.dispose()
      return cpu()
    }
    const ownedBridge = bridge
    return new GpuDefaultExportTileStreamV3(stream, cpu, () => ownedBridge.dispose())
  } catch (error) {
    bridge?.dispose()
    logger.warn('图片编辑临时 GPU Scene 初始化失败，切换 CPU 后备', {
      event: 'image_editor_v3.gpu_export.ephemeral_scene_failed',
      context: { reason: error instanceof Error ? error.message : String(error) },
    })
    return cpu()
  }
}
