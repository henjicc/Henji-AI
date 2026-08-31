import {
  createTileRegion,
  type ImageEditMemoryLease,
  type ImageEditResourceBudget,
} from '@/core/imageEdit/v3'
import { createLogger } from '@/core/logging'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import {
  IMAGE_EDIT_RENDER_PRIORITY,
  ImageEditTaskCancelledError,
  ImageEditTaskSupersededError,
  type ImageEditRenderScheduler,
} from '@/core/imageEdit/v3/renderScheduler'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import { ImageEditorPreviewBrushTileLoaderV3 } from './previewBrushTileLoaderV3'
import {
  collectImageEditorViewportBrushRequestsV3,
  createImageEditorViewportSourceTileRequestsV3,
  estimateImageEditorViewportWorkingRegionPixelsV3,
  ImageEditorViewportCompositeUnsupportedErrorV3,
  prepareImageEditorViewportCompositeV3,
  type PreparedImageEditorViewportCompositeV3,
} from './viewportCompositeDocumentV3'
import type {
  ImageEditorViewportCompositeRenderedEventV3,
  ImageEditorViewportCompositeWorkerEventV3,
  ImageEditorViewportCompositeWorkerFactoryV3,
  ImageEditorViewportCompositeWorkerPortV3,
} from './viewportCompositeProtocolV3'
import {
  ImageEditorViewportTileSchedulerV3,
  type ImageEditorViewportFrameV3,
} from './viewportTileSchedulerV3'
import type {
  ImageEditorViewportTilePlanV3,
  ImageEditorViewportTransformV3,
} from './viewportTilePlannerV3'
import {
  cloneImageEditorViewportSourceTilesV3,
  imageEditorViewportBrushTransferBytesV3,
  imageEditorViewportSourceTransferBytesV3,
} from './viewportCompositeTransferV3'
import {
  acquireImageEditorResourceLeaseV3,
  ImageEditorResourcePressureErrorV3,
} from './imageEditorResourcePressureV3'
import {
  acquireImageEditorSessionResourceBudgetV3,
  type ImageEditorSessionResourceBudgetLeaseV3,
} from './imageEditorSessionResourceBudgetV3'
import { getImageEditorGlobalRenderSchedulerV3 } from './imageEditorGlobalRenderSchedulerV3'
import { ImageEditorWorkerCompletionV3 } from './imageEditorWorkerCompletionV3'
import {
  ImageEditorViewportCompositeResultOwnerV3,
  validateImageEditorViewportCompositeEventV3,
} from './viewportCompositeResultOwnerV3'
const logger = createLogger('image_editor_v3.viewport_composite')
const MAX_TRANSFER_BYTES = 256 * 1024 * 1024
export class ImageEditorViewportCompositeSupersededErrorV3 extends Error {
  constructor() {
    super('视口合成请求已被更新版本取代')
    this.name = 'ImageEditorViewportCompositeSupersededErrorV3'
  }
}

export interface ImageEditorViewportCompositeRequestV3 {
  document: ImageEditDocumentV3
  quality: ImageEditRenderQuality
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
  viewport: ImageEditorViewportTransformV3
  viewportKey: string
}

export interface ImageEditorManagedViewportCompositeV3 {
  documentId: string
  revision: number
  viewportKey: string
  mip: number
  documentWidth: number
  documentHeight: number
  diagnostics: string[]
  tiles: ImageEditorViewportCompositeRenderedEventV3['tiles']
  release(): void
}

interface ViewportSchedulerV3 {
  render: ImageEditorViewportTileSchedulerV3['render']
  cancel(): void
  dispose(): void
}

export interface ImageEditorViewportCompositeClientOptionsV3 {
  sessionId: string
  workerFactory?: ImageEditorViewportCompositeWorkerFactoryV3
  scheduler?: ViewportSchedulerV3
  resourceBudget?: ImageEditResourceBudget
  brushTileLoader?: ImageEditorPreviewBrushTileLoaderV3
  transferMaxBytes?: number
  resourceBudgetConsumerId?: string
  renderScheduler?: ImageEditRenderScheduler
}

interface ActiveViewportJobV3 extends ImageEditorViewportCompositeRequestV3 {
  sequence: number
  requestId: string
  controller: AbortController
  prepared: PreparedImageEditorViewportCompositeV3 | null
  frame: ImageEditorViewportFrameV3 | null
  tilePlan: ImageEditorViewportTilePlanV3 | null
  transferLease: ImageEditMemoryLease | null
  workingLease: ImageEditMemoryLease | null
  outputLease: ImageEditMemoryLease | null
  posted: boolean
  renderTaskId: string
  workerCompletion: ImageEditorWorkerCompletionV3<ImageEditorViewportCompositeWorkerEventV3>
  settled: boolean
  resolve: (result: ImageEditorManagedViewportCompositeV3) => void
  reject: (error: Error) => void
}

function createDefaultWorker(): ImageEditorViewportCompositeWorkerPortV3 {
  if (typeof Worker === 'undefined') throw new Error('当前环境不支持视口分块 Worker')
  return new Worker(new URL('./imageEditorViewportComposite.worker.ts', import.meta.url), {
    type: 'module',
    name: 'image-editor-v3-viewport-composite',
  })
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function normalizeViewportError(error: unknown): Error {
  return error instanceof ImageEditTaskSupersededError
    || error instanceof ImageEditTaskCancelledError
    ? new ImageEditorViewportCompositeSupersededErrorV3()
    : toError(error)
}
let viewportCompositeClientSequence = 0

/** 一个会话同时最多只有一个 source load / Worker composite；新请求立即取消旧请求。 */
export class ImageEditorViewportCompositeClientV3 {
  private readonly budget: ImageEditResourceBudget
  private readonly scheduler: ViewportSchedulerV3
  private readonly brushLoader: ImageEditorPreviewBrushTileLoaderV3
  private readonly workerFactory: ImageEditorViewportCompositeWorkerFactoryV3
  private readonly renderScheduler: ImageEditRenderScheduler
  private readonly transferMaxBytes: number
  private readonly sessionBudgetLease: ImageEditorSessionResourceBudgetLeaseV3 | null
  private readonly resultOwner = new ImageEditorViewportCompositeResultOwnerV3()
  private worker: ImageEditorViewportCompositeWorkerPortV3 | null = null
  private active: ActiveViewportJobV3 | null = null
  private readonly retiredJobs = new Map<string, ActiveViewportJobV3>()
  private sequence = 0
  private disposed = false

  constructor(private readonly options: ImageEditorViewportCompositeClientOptionsV3) {
    if (!options.sessionId.trim()) throw new Error('视口合成会话 ID 不能为空')
    this.transferMaxBytes = options.transferMaxBytes ?? MAX_TRANSFER_BYTES
    this.renderScheduler = options.renderScheduler ?? getImageEditorGlobalRenderSchedulerV3()
    if (!Number.isSafeInteger(this.transferMaxBytes) || this.transferMaxBytes < 0) {
      throw new Error('视口合成传输上限必须是非负整数')
    }
    this.sessionBudgetLease = options.resourceBudget
      ? null
      : acquireImageEditorSessionResourceBudgetV3(options.sessionId, {
          consumerId: options.resourceBudgetConsumerId
            ?? `viewport-composite:${++viewportCompositeClientSequence}`,
        })
    this.budget = options.resourceBudget ?? this.sessionBudgetLease!.budget
    this.scheduler = options.scheduler ?? new ImageEditorViewportTileSchedulerV3({
      sessionId: `${options.sessionId}:composite-source`,
      cacheOptions: { resourceBudget: this.budget },
    })
    this.brushLoader = options.brushTileLoader ?? new ImageEditorPreviewBrushTileLoaderV3()
    this.workerFactory = options.workerFactory ?? createDefaultWorker
  }

  render(request: ImageEditorViewportCompositeRequestV3): Promise<ImageEditorManagedViewportCompositeV3> {
    if (this.disposed) return Promise.reject(new Error('视口合成会话已经释放'))
    this.cancelActive(new ImageEditorViewportCompositeSupersededErrorV3())
    const sequence = ++this.sequence
    return new Promise((resolve, reject) => {
      const job: ActiveViewportJobV3 = {
        ...request,
        sequence,
        requestId: `${this.options.sessionId}:viewport:${sequence}`,
        controller: new AbortController(),
        prepared: null,
        frame: null,
        tilePlan: null,
        transferLease: null,
        workingLease: null,
        outputLease: null,
        posted: false,
        renderTaskId: `${this.options.sessionId}:viewport-worker:${sequence}`,
        workerCompletion: new ImageEditorWorkerCompletionV3(),
        settled: false,
        resolve,
        reject,
      }
      this.active = job
      logger.info('开始图片编辑 V3 视口分块合成', {
        event: 'image_editor_v3.viewport_composite.start',
        requestId: job.requestId,
        context: { documentId: request.document.id, revision: request.document.revision },
      })
      void this.prepareAndPost(job).catch((error: unknown) => (
        this.failJob(job, normalizeViewportError(error))
      ))
    })
  }

  cancel(): void {
    this.cancelActive(new ImageEditorViewportCompositeSupersededErrorV3())
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelActive(new Error('视口合成会话已经释放'))
    this.scheduler.dispose()
    this.brushLoader.dispose()
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' })
      this.worker.terminate()
      this.worker = null
    }
    for (const job of this.retiredJobs.values()) this.releaseJobResources(job)
    this.retiredJobs.clear()
    this.resultOwner.dispose()
    this.sessionBudgetLease?.release()
  }

  private async prepareAndPost(job: ActiveViewportJobV3): Promise<void> {
    const prepared = prepareImageEditorViewportCompositeV3(
      job.document,
      job.quality,
      job.resourceDescriptors,
    )
    job.prepared = prepared
    const frame = await this.scheduler.render({
      resourceRef: prepared.primaryResourceRef,
      resourceRefs: prepared.resourceRefs,
      revision: job.document.revision,
      documentSize: job.document.geometry,
      viewport: job.viewport,
      bitDepth: typeof job.document.color.bitDepth === 'number' ? job.document.color.bitDepth : 32,
      haloDocumentPixels: prepared.haloDocumentPixels,
      resolveSourceTileRequests: (candidate) => createImageEditorViewportSourceTileRequestsV3(
        prepared,
        candidate,
        typeof job.document.color.bitDepth === 'number' ? job.document.color.bitDepth : 32,
      ),
    })
    if (this.active !== job || job.controller.signal.aborted || this.disposed) {
      frame.release()
      throw new ImageEditorViewportCompositeSupersededErrorV3()
    }
    job.frame = frame
    job.tilePlan = frame.plan
    if (frame.plan.tiles.length === 0) {
      throw new ImageEditorViewportCompositeUnsupportedErrorV3('视口未与文档相交')
    }
    const brushRequests = collectImageEditorViewportBrushRequestsV3(prepared, frame.plan)
    const transferBytes = imageEditorViewportSourceTransferBytesV3(frame)
      + imageEditorViewportBrushTransferBytesV3(brushRequests)
    if (!Number.isSafeInteger(transferBytes) || transferBytes > this.transferMaxBytes) {
      throw new Error('视口合成超过单帧受控传输上限')
    }
    job.transferLease = acquireImageEditorResourceLeaseV3(
      this.budget,
      'viewport-composite',
      'transfer',
      transferBytes,
      'fallback-managed-preview',
    )
    const maxRegionPixels = estimateImageEditorViewportWorkingRegionPixelsV3(
      prepared,
      frame.plan,
    )
    const workingBytes = maxRegionPixels * 4 * Float32Array.BYTES_PER_ELEMENT
      * Math.max(3, prepared.plan.nodes.length + 2)
    if (!Number.isSafeInteger(workingBytes)) throw new Error('视口合成工作集超出安全范围')
    job.workingLease = acquireImageEditorResourceLeaseV3(
      this.budget,
      'viewport-composite',
      'in-flight',
      workingBytes,
      'fallback-managed-preview',
    )
    const outputBytes = frame.plan.tiles.reduce((total, tile) => {
      const output = createTileRegion(
        job.document.geometry,
        { mip: frame.plan.mip, x: tile.tileX, y: tile.tileY },
        tile.halo,
      ).outputRect
      const next = total + output.width * output.height * 4
      if (!Number.isSafeInteger(next)) throw new Error('视口成品瓦片字节数超出安全范围')
      return next
    }, 0)
    // Worker 创建 ImageBitmap 前先占住成品额度，避免先分配后 admission 失败。
    job.outputLease = acquireImageEditorResourceLeaseV3(
      this.budget,
      'viewport-composite',
      'gpu',
      outputBytes,
      'fallback-managed-preview',
    )
    const brushTiles = await this.brushLoader.load(
      brushRequests,
      job.document,
      job.controller.signal,
    )
    this.assertActive(job)
    const sourceTiles = cloneImageEditorViewportSourceTilesV3(frame)
    frame.release()
    job.frame = null
    const event = await this.renderScheduler.schedule<ImageEditorViewportCompositeWorkerEventV3>({
      id: job.renderTaskId,
      sessionId: this.options.sessionId,
      coalescingKey: 'display',
      revision: job.document.revision,
      kind: 'preview',
      purpose: 'display',
      lane: 'gpu',
      priority: job.quality === 'draft'
        ? IMAGE_EDIT_RENDER_PRIORITY.interactionDraft
        : IMAGE_EDIT_RENDER_PRIORITY.viewportStable,
      run: ({ signal }) => job.workerCompletion.wait({
        signals: [signal, job.controller.signal],
        onAbort: () => {
          if (job.posted) this.worker?.postMessage({ type: 'cancel', requestId: job.requestId })
        },
        fallbackAbortError: () => new ImageEditorViewportCompositeSupersededErrorV3(),
        start: () => {
          const worker = this.ensureWorker()
          job.posted = true
          worker.postMessage({
            type: 'render',
            requestId: job.requestId,
            sequence: job.sequence,
            document: job.document,
            quality: job.quality,
            plan: frame.plan,
            sourceTiles,
            brushTiles,
          }, [
            ...sourceTiles.map((tile) => tile.pixels),
            ...brushTiles.map((tile) => tile.bytes),
          ])
        },
      }),
    })
    this.assertActive(job)
    this.completeWorkerEvent(job, event)
  }

  private ensureWorker(): ImageEditorViewportCompositeWorkerPortV3 {
    if (this.worker) return this.worker
    const worker = this.workerFactory()
    worker.onmessage = (event) => this.handleWorkerEvent(event.data)
    worker.onerror = (event) => this.handleWorkerFailure(event.message || '视口分块 Worker 异常')
    this.worker = worker
    return worker
  }

  private handleWorkerEvent(event: ImageEditorViewportCompositeWorkerEventV3): void {
    const job = this.active
    if (!job || event.requestId !== job.requestId || event.sequence !== job.sequence) {
      this.releaseEvent(event)
      const retired = this.retiredJobs.get(event.requestId)
      if (retired && retired.sequence === event.sequence) {
        this.retiredJobs.delete(event.requestId)
        this.releaseJobResources(retired)
      }
      return
    }
    if (!job.workerCompletion.resolve(event)) this.releaseEvent(event)
  }

  private completeWorkerEvent(job: ActiveViewportJobV3, event: ImageEditorViewportCompositeWorkerEventV3): void {
    if (event.type === 'failed') {
      throw event.code === 'aborted'
        ? new ImageEditorViewportCompositeSupersededErrorV3()
        : new Error(event.message)
    }
    try {
      if (!job.prepared || !job.tilePlan) throw new Error('视口 Worker 返回前缺少渲染计划')
      validateImageEditorViewportCompositeEventV3(event, job.document, job.tilePlan)
      const gpuBytes = event.tiles.reduce(
        (total, tile) => total + tile.outputRect.width * tile.outputRect.height * 4,
        0,
      )
      const gpuLease = job.outputLease
      if (!gpuLease || gpuBytes > gpuLease.bytes) {
        throw new Error('视口 Worker 返回的成品超过预留 GPU 资源')
      }
      job.outputLease = null
      this.releaseJobResources(job)
      const release = this.resultOwner.lease(event, gpuLease)
      this.settle(job, () => job.resolve({
        documentId: job.document.id,
        revision: event.revision,
        viewportKey: job.viewportKey,
        mip: event.mip,
        documentWidth: event.documentWidth,
        documentHeight: event.documentHeight,
        diagnostics: event.diagnostics,
        tiles: event.tiles,
        release,
      }))
      logger.info('完成图片编辑 V3 视口分块合成', {
        event: 'image_editor_v3.viewport_composite.completed',
        requestId: job.requestId,
        context: { documentId: job.document.id, revision: event.revision, mip: event.mip, tileCount: event.tiles.length },
      })
    } catch (error) {
      this.releaseEvent(event)
      throw error
    }
  }

  private handleWorkerFailure(message: string): void {
    const job = this.active
    this.worker?.terminate()
    this.worker = null
    for (const retired of this.retiredJobs.values()) this.releaseJobResources(retired)
    this.retiredJobs.clear()
    if (job) job.workerCompletion.reject(new Error(message))
  }

  private failJob(job: ActiveViewportJobV3, error: Error): void {
    if (job.settled) return
    this.releaseJobResources(job)
    if (
      !(error instanceof ImageEditorViewportCompositeSupersededErrorV3)
      && !(error instanceof ImageEditorViewportCompositeUnsupportedErrorV3)
      && !(error instanceof ImageEditorResourcePressureErrorV3)
    ) {
      logger.error('图片编辑 V3 视口分块合成失败', error, {
        event: 'image_editor_v3.viewport_composite.failed',
        requestId: job.requestId,
        context: { documentId: job.document.id, revision: job.document.revision },
      })
    }
    this.settle(job, () => job.reject(error))
  }

  private cancelActive(error: Error): void {
    const job = this.active
    if (!job) return
    job.controller.abort(error)
    this.renderScheduler.cancelTask(job.renderTaskId)
    this.scheduler.cancel()
    if (job.posted) this.retiredJobs.set(job.requestId, job)
    else this.releaseJobResources(job)
    this.settle(job, () => job.reject(error))
  }

  private assertActive(job: ActiveViewportJobV3): void {
    if (this.active !== job || job.controller.signal.aborted || this.disposed) {
      throw new ImageEditorViewportCompositeSupersededErrorV3()
    }
  }

  private releaseJobResources(job: ActiveViewportJobV3): void {
    job.frame?.release()
    job.frame = null
    job.transferLease?.release()
    job.transferLease = null
    job.workingLease?.release()
    job.workingLease = null
    job.outputLease?.release()
    job.outputLease = null
  }

  private settle(job: ActiveViewportJobV3, complete: () => void): void {
    if (job.settled) return
    job.settled = true
    if (this.active === job) this.active = null
    complete()
  }

  private releaseEvent(event: ImageEditorViewportCompositeWorkerEventV3): void {
    this.resultOwner.releaseEvent(event)
  }
}
