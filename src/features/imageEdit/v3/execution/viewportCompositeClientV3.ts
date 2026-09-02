import {
  createTileRegion,
  imageEditOutputSizeV3,
  type ImageEditMemoryLease,
  type ImageEditResourceBudget,
} from '@/core/imageEdit/v3'
import { createLogger } from '@/core/logging'
import {
  IMAGE_EDIT_RENDER_PRIORITY,
  type ImageEditRenderScheduler,
} from '@/core/imageEdit/v3/renderScheduler'
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
  ImageEditorViewportCompositeWorkerEventV3,
  ImageEditorViewportCompositeWorkerFactoryV3,
  ImageEditorViewportCompositeWorkerPortV3,
} from './viewportCompositeProtocolV3'
import {
  ImageEditorViewportTileSchedulerV3,
  type ImageEditorViewportFrameV3,
} from './viewportTileSchedulerV3'
import type { ImageEditorViewportTilePlanV3 } from './viewportTilePlannerV3'
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
import { completeImageEditorViewportCompositeV3 } from './viewportCompositeCompletionV3'
import {
  ImageEditorViewportCompositeProgressV3,
  ImageEditorViewportCompositeResultOwnerV3,
} from './viewportCompositeResultOwnerV3'
import { ImageEditorViewportWorkerRetirementV3 } from './viewportWorkerRetirementV3'
import { acquireSharedImageEditorViewportCompositeWorkerV3 } from './viewportCompositeWorkerBrokerV3'
import {
  ImageEditorViewportCompositeDisposedErrorV3,
  ImageEditorViewportCompositeSupersededErrorV3,
  type ImageEditorManagedViewportCompositeV3,
  type ImageEditorViewportCompositeClientOptionsV3,
  type ImageEditorViewportCompositeRequestV3,
  type ImageEditorViewportRuntimeListenerV3,
} from './viewportCompositeTypesV3'
import {
  IMAGE_EDITOR_VIEWPORT_CANCEL_ACK_TIMEOUT_MS_V3,
  IMAGE_EDITOR_VIEWPORT_MAX_TRANSFER_BYTES_V3,
  imageEditorViewportErrorV3,
} from './viewportCompositeClientSupportV3'
import { imageEditorViewportCompositeCandidateFitsBudgetV3 } from './viewportCompositeAdmissionV3'
export {
  ImageEditorViewportCompositeDisposedErrorV3,
  ImageEditorViewportCompositeSupersededErrorV3,
} from './viewportCompositeTypesV3'
const logger = createLogger('image_editor_v3.viewport_composite')
interface ActiveViewportJobV3 extends ImageEditorViewportCompositeRequestV3 {
  sequence: number
  requestId: string
  controller: AbortController
  prepared: PreparedImageEditorViewportCompositeV3 | null
  frame: ImageEditorViewportFrameV3 | null
  tilePlan: ImageEditorViewportTilePlanV3 | null
  progress: ImageEditorViewportCompositeProgressV3 | null
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
  return acquireSharedImageEditorViewportCompositeWorkerV3()
}

let viewportCompositeClientSequence = 0

/** 每个会话只保留一个 source load / Worker composite，取消确认前不堆积新任务。 */
export class ImageEditorViewportCompositeClientV3 {
  private readonly budget: ImageEditResourceBudget
  private readonly scheduler: Pick<ImageEditorViewportTileSchedulerV3, 'render' | 'cancel' | 'dispose'>
  private readonly brushLoader: ImageEditorPreviewBrushTileLoaderV3
  private readonly workerFactory: ImageEditorViewportCompositeWorkerFactoryV3
  private readonly renderScheduler: ImageEditRenderScheduler
  private readonly transferMaxBytes: number
  private readonly sessionBudgetLease: ImageEditorSessionResourceBudgetLeaseV3 | null
  private readonly resultOwner = new ImageEditorViewportCompositeResultOwnerV3()
  private readonly runtimeListeners = new Set<ImageEditorViewportRuntimeListenerV3>()
  private worker: ImageEditorViewportCompositeWorkerPortV3 | null = null
  private active: ActiveViewportJobV3 | null = null
  private readonly retirement = new ImageEditorViewportWorkerRetirementV3<ActiveViewportJobV3>({
    timeoutMs: IMAGE_EDITOR_VIEWPORT_CANCEL_ACK_TIMEOUT_MS_V3,
    release: (job) => this.releaseJobResources(job),
    onTimeout: () => {
      this.worker?.terminate()
      this.worker = null
    },
  })
  private sequence = 0
  private disposed = false

  constructor(private readonly options: ImageEditorViewportCompositeClientOptionsV3) {
    if (!options.sessionId.trim()) throw new Error('视口合成会话 ID 不能为空')
    this.transferMaxBytes = options.transferMaxBytes ?? IMAGE_EDITOR_VIEWPORT_MAX_TRANSFER_BYTES_V3
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
    if (this.disposed) return Promise.reject(new ImageEditorViewportCompositeDisposedErrorV3())
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
        progress: null,
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
        this.failJob(job, imageEditorViewportErrorV3(error))
      ))
    })
  }

  subscribeRuntime(listener: ImageEditorViewportRuntimeListenerV3): () => void {
    this.runtimeListeners.add(listener)
    return () => this.runtimeListeners.delete(listener)
  }

  cancel(): void {
    this.cancelActive(new ImageEditorViewportCompositeSupersededErrorV3())
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelActive(new ImageEditorViewportCompositeDisposedErrorV3())
    this.scheduler.dispose()
    this.brushLoader.dispose()
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' })
      this.worker.terminate()
      this.worker = null
    }
    this.retirement.releaseAll()
    this.resultOwner.dispose()
    this.runtimeListeners.clear()
    this.sessionBudgetLease?.release()
  }

  private async prepareAndPost(job: ActiveViewportJobV3): Promise<void> {
    await this.retirement.wait(
      job.controller.signal,
      () => new ImageEditorViewportCompositeSupersededErrorV3(),
    )
    this.assertActive(job)
    const prepared = prepareImageEditorViewportCompositeV3(
      job.document, job.quality, job.resourceDescriptors,
    )
    const wholeSource = job.analysisRequested === true
    const bitDepth = typeof job.document.color.bitDepth === 'number' ? job.document.color.bitDepth : 32
    job.prepared = prepared
    const frame = await this.scheduler.render({
      resourceRef: prepared.primaryResourceRef,
      resourceRefs: prepared.resourceRefs,
      revision: job.document.revision,
      documentSize: imageEditOutputSizeV3(job.document.geometry),
      sourceSize: job.document.geometry,
      viewport: job.viewport,
      bitDepth,
      haloDocumentPixels: prepared.haloDocumentPixels,
      overscanViewports: job.overscanViewports ?? 0.5,
      forwardPrefetchViewports: job.forwardPrefetchViewports ?? 1,
      previousMip: job.previousMip,
      preferredMip: job.preferredMip,
      coverage: job.coverage,
      resolveSourceTileRequests: (candidate) => createImageEditorViewportSourceTileRequestsV3(
        prepared, candidate, bitDepth, wholeSource,
      ),
      admitCandidate: (candidate) => imageEditorViewportCompositeCandidateFitsBudgetV3({
        budget: this.budget, prepared, document: job.document, candidate, bitDepth, wholeSource,
      }),
    })
    if (this.active !== job || job.controller.signal.aborted || this.disposed) {
      frame.release()
      throw new ImageEditorViewportCompositeSupersededErrorV3()
    }
    job.frame = frame
    job.tilePlan = frame.plan
    job.progress = new ImageEditorViewportCompositeProgressV3({
      document: job.document,
      plan: frame.plan,
      renderGeneration: job.renderGeneration,
      cameraSequence: job.cameraSequence,
      geometryHash: job.geometryHash,
      onTileReady: job.onTileReady,
    })
    if (frame.plan.tiles.length === 0) {
      throw new ImageEditorViewportCompositeUnsupportedErrorV3('视口未与文档相交')
    }
    const brushRequests = collectImageEditorViewportBrushRequestsV3(prepared, frame.plan, wholeSource)
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
      'lower-mip',
    )
    const maxRegionPixels = estimateImageEditorViewportWorkingRegionPixelsV3(
      prepared, frame.plan, wholeSource,
    )
    const workingBytes = maxRegionPixels * 4 * Float32Array.BYTES_PER_ELEMENT
      * Math.max(3, prepared.plan.nodes.length + 2)
    if (!Number.isSafeInteger(workingBytes)) throw new Error('视口合成工作集超出安全范围')
    job.workingLease = acquireImageEditorResourceLeaseV3(
      this.budget,
      'viewport-composite',
      'in-flight',
      workingBytes,
      'lower-mip',
    )
    const outputBytes = frame.plan.tiles.reduce((total, tile) => {
      const output = createTileRegion(
        imageEditOutputSizeV3(job.document.geometry),
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
      'lower-mip',
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
            renderGeneration: job.renderGeneration,
            cameraSequence: job.cameraSequence,
            geometryHash: job.geometryHash,
            document: job.document,
            quality: job.quality,
            phase: job.phase,
            analysisRequested: wholeSource,
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
    if (event.type === 'runtime') {
      if (this.active?.requestId === event.requestId) {
        for (const listener of this.runtimeListeners) listener(event)
      }
      return
    }
    if (this.retirement.acknowledge(event.requestId)) {
      this.releaseEvent(event)
      return
    }
    const job = this.active
    if (!job || event.requestId !== job.requestId || event.sequence !== job.sequence) {
      this.releaseEvent(event)
      return
    }
    if (event.type === 'tile-rendered') {
      try {
        if (!job.progress) throw new Error('视口 Worker 返回瓦片前缺少接收计划')
        job.progress.accept(event)
      } catch (error) {
        job.controller.abort(error)
        this.worker?.postMessage({ type: 'cancel', requestId: job.requestId })
        job.workerCompletion.reject(imageEditorViewportErrorV3(error))
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
    if (event.type !== 'rendered') throw new Error('视口 Worker 完成事件类型错误')
    try {
      if (!job.prepared || !job.tilePlan || !job.progress) {
        throw new Error('视口 Worker 返回前缺少渲染计划')
      }
      const gpuLease = job.outputLease
      if (!gpuLease) throw new Error('视口 Worker 返回前缺少成品资源额度')
      const result = completeImageEditorViewportCompositeV3({
        event,
        document: job.document,
        viewportKey: job.viewportKey,
        coverage: job.coverage ?? 'viewport',
        progress: job.progress,
        outputLease: gpuLease,
        resultOwner: this.resultOwner,
      })
      job.progress = null
      job.outputLease = null
      this.releaseJobResources(job)
      this.settle(job, () => job.resolve(result))
      logger.info('完成图片编辑 V3 视口分块合成', {
        event: 'image_editor_v3.viewport_composite.completed',
        requestId: job.requestId,
        context: { documentId: job.document.id, revision: event.revision, mip: event.mip, tileCount: result.tiles.length },
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
    this.retirement.releaseAll()
    if (job) job.workerCompletion.reject(new Error(message))
  }

  private failJob(job: ActiveViewportJobV3, error: Error): void {
    if (job.settled) return
    this.releaseJobResources(job)
    if (
      !(error instanceof ImageEditorViewportCompositeSupersededErrorV3)
      && !(error instanceof ImageEditorViewportCompositeDisposedErrorV3)
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
    if (job.posted) {
      this.worker?.postMessage({ type: 'cancel', requestId: job.requestId })
      this.retirement.retire(job.requestId, job)
    } else {
      this.releaseJobResources(job)
    }
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
    job.progress?.release()
    job.progress = null
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
