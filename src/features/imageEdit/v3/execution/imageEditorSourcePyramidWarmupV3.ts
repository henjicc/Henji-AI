import {
  createImageEditorV3RequestId,
  readImageEditorV3FastProxy,
} from '@/commands/imageEditorV3'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { createLogger } from '@/core/logging'
import type {
  ImageEditorV3ResourceDescriptor,
  ImageEditorV3ResourceRef,
} from '@/platform/contracts/imageEditorV3'
import { collectImageEditorPreviewResourceRequestsV3 } from './previewDocumentV3'

const logger = createLogger('image_editor_v3.source_warmup')
// 2K 让常见高分辨率照片在放大时直接命中 mip 1；以 5802×3655 的基准图计，
// 预热约占 21 MiB，仍低于主进程快速代理 48 MiB 的硬预算。
export const IMAGE_EDITOR_SOURCE_WARMUP_MAX_DIMENSION_V3 = 2_048

/**
 * 按 source identity 常驻，而不是按 generation 重启。快速代理在主进程同步种下粗 mip 链，
 * 随后的草稿/目标视口直接命中同一金字塔，不再逐瓦片重复解码原文件。
 */
export class ImageEditorSourcePyramidWarmupV3 {
  private readonly controllers = new Map<ImageEditorV3ResourceRef, AbortController>()
  private readonly completed = new Set<ImageEditorV3ResourceRef>()
  private disposed = false

  warm(
    document: ImageEditDocumentV3,
    descriptors: readonly ImageEditorV3ResourceDescriptor[],
  ): void {
    if (this.disposed) return
    let requests: ReturnType<typeof collectImageEditorPreviewResourceRequestsV3>
    try {
      requests = collectImageEditorPreviewResourceRequestsV3(
        document,
        IMAGE_EDITOR_SOURCE_WARMUP_MAX_DIMENSION_V3,
        descriptors,
      )
    } catch (error) {
      logger.warn('无法规划图片源预热，继续使用按需瓦片', {
        event: 'image_editor_v3.source_warmup.plan_failed',
        context: { message: error instanceof Error ? error.message : String(error) },
      })
      return
    }
    for (const request of requests) {
      if (request.kind !== 'image-proxy') continue
      const resourceRef = request.resourceId as ImageEditorV3ResourceRef
      if (this.completed.has(resourceRef) || this.controllers.has(resourceRef)) continue
      const controller = new AbortController()
      this.controllers.set(resourceRef, controller)
      const startedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
      void readImageEditorV3FastProxy({
        requestId: createImageEditorV3RequestId('source-warmup'),
        resourceRef,
        maxDimension: IMAGE_EDITOR_SOURCE_WARMUP_MAX_DIMENSION_V3,
      }, controller.signal).then(() => {
        if (!controller.signal.aborted && !this.disposed) this.completed.add(resourceRef)
        logger.debug('图片源粗粒度金字塔预热完成', {
          event: 'image_editor_v3.source_warmup.completed',
          context: {
            resourceRef,
            durationMs: Math.max(0, Math.round(
              (typeof performance === 'undefined' ? Date.now() : performance.now()) - startedAt,
            )),
          },
        })
      }).catch((error: unknown) => {
        if (controller.signal.aborted || this.disposed) return
        logger.warn('图片源粗粒度金字塔预热失败，继续使用按需瓦片', {
          event: 'image_editor_v3.source_warmup.failed',
          context: {
            resourceRef,
            message: error instanceof Error ? error.message : String(error),
          },
        })
      }).finally(() => {
        if (this.controllers.get(resourceRef) === controller) this.controllers.delete(resourceRef)
      })
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    this.completed.clear()
  }
}
