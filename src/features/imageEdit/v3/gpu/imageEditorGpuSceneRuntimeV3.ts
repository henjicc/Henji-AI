import { initFromDevice, type Gpu } from 'vgpu'
import {
  ImageEditWebGpuDeviceManager,
  type ImageEditWebGpuDeviceLoss,
} from '@/core/imageEdit/webgpu/deviceManager'
import { SingleflightRuntimeState } from '@/core/imageEdit/worker/gpuRuntimeLifecycle'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import {
  ImageEditorGpuRasterCompositorV3,
  type ImageEditorGpuRasterCompositorV3Like,
  type ImageEditorGpuRasterTextureV3,
} from './imageEditorGpuRasterCompositorV3'
import {
  compileImageEditorGpuRasterSceneV3,
  type ImageEditorGpuRasterSceneV3,
} from './imageEditorGpuRasterSceneCompilerV3'
import {
  IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
  imageEditorGpuSceneTileKeyV3,
  type ImageEditorGpuSceneFailedEventV3,
  type ImageEditorGpuSceneUploadTileV3,
  type ImageEditorGpuSceneWorkerEventV3,
  type ImageEditorGpuSceneWorkerRequestV3,
} from './imageEditorGpuSceneProtocolV3'
import { ImageEditorGpuSceneResourceRegistryV3 } from './imageEditorGpuSceneResourceRegistryV3'
import {
  imageEditorGpuSceneErrorMessageV3,
  ImageEditorGpuSceneRecoveryV3,
  isImageEditorGpuOutOfMemoryError,
  waitForImageEditorGpuSceneTaskV3,
} from './imageEditorGpuSceneRecoveryV3'
import { createImageEditorGpuSceneFrameDeliveryV3 } from './imageEditorGpuSceneFrameEventsV3'
import { createImageEditorGpuSceneFailureEventV3 } from './imageEditorGpuSceneFailureV3'
import { ImageEditorGpuSceneSequenceGateV3 } from './imageEditorGpuSceneSequenceV3'
import { ImageEditorGpuSceneExportRuntimeV3 } from './imageEditorGpuSceneExportRuntimeV3'
import { ImageEditorGpuExportResidualV3 } from './imageEditorGpuExportResidualV3'
import { admitImageEditorGpuSceneTileV3,
  trimImageEditorGpuSceneMemoryV3 } from './imageEditorGpuSceneTileAdmissionV3'
import {
  acceptsImageEditorGpuSceneRenderV3,
  refreshImageEditorGpuSceneInteractionProtectionsV3,
  refreshImageEditorGpuSceneViewportProtectionsV3,
} from './imageEditorGpuSceneProtectionV3'
import type {
  ImageEditorGpuSceneContextV3,
  ImageEditorGpuSceneDeviceManagerV3,
  ImageEditorGpuSceneGpuStateV3,
  ImageEditorGpuSceneRuntimeDependenciesV3,
  ImageEditorGpuSceneRuntimeStatusV3,
} from './imageEditorGpuSceneRuntimeContractsV3'
export type { ImageEditorGpuSceneRuntimeDependenciesV3, ImageEditorGpuSceneRuntimeStatusV3 } from './imageEditorGpuSceneRuntimeContractsV3'

interface PreviewMemoryControl {
  reducePreviewMemory(): boolean
}

function controlsPreviewMemory(
  compositor: ImageEditorGpuRasterCompositorV3Like,
): compositor is ImageEditorGpuRasterCompositorV3Like & PreviewMemoryControl {
  return typeof (compositor as Partial<PreviewMemoryControl>).reducePreviewMemory === 'function'
}

/** 原生显存不足只出现在设备的 uncapturederror 里，vGPU 不转发；其他原生错误不在这里处理。 */
function subscribeGpuOutOfMemory(device: GpuDevice, listener: (error: unknown) => void): () => void {
  const target = device as unknown as Partial<Pick<EventTarget, 'addEventListener' | 'removeEventListener'>>
  if (typeof target.addEventListener !== 'function') return () => undefined
  const handle = (event: Event): void => {
    const error = (event as Event & { error?: unknown }).error
    if (isImageEditorGpuOutOfMemoryError(error)) listener(error)
  }
  target.addEventListener('uncapturederror', handle)
  return () => target.removeEventListener?.('uncapturederror', handle)
}

export class ImageEditorGpuSceneRuntimeV3 {
  private readonly deviceManager: ImageEditorGpuSceneDeviceManagerV3
  private readonly contextFactory: (device: GpuDevice) => Promise<ImageEditorGpuSceneContextV3>
  private readonly compositorFactory: (
    context: ImageEditorGpuSceneContextV3,
    options: { memoryBudgetBytes: number },
  ) => ImageEditorGpuRasterCompositorV3Like
  private readonly compositorBudgets = new WeakMap<ImageEditorGpuRasterCompositorV3Like, number>()
  private readonly states: SingleflightRuntimeState<ImageEditorGpuSceneGpuStateV3>
  private sequence = new ImageEditorGpuSceneSequenceGateV3()
  /** 每次归还推进；上一个会话还在途的初始化、渲染不能再向新会话发事件。 */
  private sessionEpoch = 0
  private idleBudgetBytes = IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3
  /** 最近一次发起渲染时的会话代际；异步 GPU 错误只能归到发起过渲染的当前会话。 */
  private lastRenderEpoch = -1
  /** 同一个显存不足错误会经监听与渲染抛出两条路到达，只降一次档。 */
  private readonly handledOutOfMemory = new WeakSet<object>()
  private readonly transientTransforms = new Map<string, ImageEditTransformV3>()
  private resources: ImageEditorGpuSceneResourceRegistryV3<ImageEditorGpuRasterTextureV3> | null = null
  private readonly pendingTiles = new Map<string, ImageEditorGpuSceneUploadTileV3>()
  private scene: ImageEditorGpuRasterSceneV3 | null = null
  private layout: ImageEditorViewportLayoutV3 | null = null
  private presentationSurface: { generation: number; canvas: OffscreenCanvas } | null = null
  private sessionId: string | null = null
  private status: ImageEditorGpuSceneRuntimeStatusV3 = 'idle'
  private initializedOnce = false
  private readonly recovery = new ImageEditorGpuSceneRecoveryV3()
  private failNextRecoveryForDiagnostic = false
  private deviceAcquireCount = 0
  private surfaceFrameCount = 0
  private disposed = false
  private exportRuntime: ImageEditorGpuSceneExportRuntimeV3 | null = null

  constructor(
    private readonly emit: (event: ImageEditorGpuSceneWorkerEventV3, transfer?: Transferable[]) => void,
    dependencies: ImageEditorGpuSceneRuntimeDependenciesV3 = {},
  ) {
    this.deviceManager = dependencies.deviceManager ?? new ImageEditWebGpuDeviceManager()
    this.contextFactory = dependencies.contextFactory ?? (async (device) => {
      const gpu = await initFromDevice(device as unknown as Parameters<typeof initFromDevice>[0])
      return gpu as Gpu
    })
    this.compositorFactory = dependencies.compositorFactory
      ?? ((context, options) => new ImageEditorGpuRasterCompositorV3(context as Gpu, options))
    this.states = new SingleflightRuntimeState((state) => this.destroyGpuState(state))
    this.deviceManager.onDeviceLost((_reason, loss) => this.handleDeviceLost(loss))
  }
  handle(request: ImageEditorGpuSceneWorkerRequestV3): void {
    if (request.type === 'dispose') {
      this.dispose()
      return
    }
    if (this.disposed) return
    switch (request.type) {
      case 'initialize':
        void this.initialize(request)
        return
      case 'warm':
        void this.warm(request)
        return
      case 'release':
        this.release()
        return
      case 'sync-scene':
        if (!this.sequence.syncScene(request.sceneGeneration)) return
        this.exportRuntime?.cancelAll()
        this.transientTransforms.clear()
        this.pendingTiles.clear()
        this.resources?.releaseProtection('viewport')
        this.resources?.releaseProtection('interaction')
        {
          const compilation = compileImageEditorGpuRasterSceneV3(
            request.document,
            request.resourceDescriptors,
            request.sourcePyramids,
            request.quality,
          )
          this.scene = compilation.supported ? compilation.scene : null
          if (!compilation.supported) this.emitFailure('composition-not-ready', null, `GPU 不支持，转 CPU：${compilation.reason}`, true)
          this.states.peek()?.compositor.syncScene(this.scene)
          refreshImageEditorGpuSceneViewportProtectionsV3(
            this.resources, this.states.peek()?.compositor ?? null,
          )
        }
        return
      case 'upload-tiles':
        if (request.exportRequestId) {
          if (request.sceneGeneration === this.sequence.snapshot().sceneGeneration) {
            this.exportRuntime?.upload(request.exportRequestId, request.tiles)
          }
          return
        }
        this.uploadTiles(request)
        return
      case 'update-transform':
        if (!this.sequence.updateInteraction(request.sceneGeneration, request.interactionSequence)) return
        if (request.transform) this.transientTransforms.set(request.layerId, [...request.transform])
        else this.transientTransforms.delete(request.layerId)
        this.states.peek()?.compositor.updateTransientTransform(request.layerId, request.transform)
        refreshImageEditorGpuSceneViewportProtectionsV3(
          this.resources, this.states.peek()?.compositor ?? null,
        )
        refreshImageEditorGpuSceneInteractionProtectionsV3(
          this.resources, this.states.peek()?.compositor ?? null,
          request.transform ? request.layerId : null,
        )
        return
      case 'update-viewport':
        if (!this.sequence.updateCamera(request.sceneGeneration, request.cameraSequence)) return
        this.layout = request.layout
        {
          const compositor = this.states.peek()?.compositor
          compositor?.updateViewport(request.layout)
          refreshImageEditorGpuSceneViewportProtectionsV3(this.resources, compositor ?? null)
          if (compositor) this.trimMemoryPressure(compositor)
        }
        return
      case 'attach-presentation-surface':
        if (request.surfaceGeneration <= (this.presentationSurface?.generation ?? 0)) return
        this.presentationSurface = {
          generation: request.surfaceGeneration,
          canvas: request.canvas,
        }
        this.states.peek()?.compositor.attachPresentationSurface(
          request.canvas,
          request.surfaceGeneration,
        )
        return
      case 'render':
        if (!this.acceptsRenderRequest(request)) return
        void this.render(request)
        return
      case 'diagnostic-device-loss':
        this.failNextRecoveryForDiagnostic = request.recovery === 'failure'
        this.states.peek()?.managed.device.destroy()
        return
      case 'export':
        if (request.sceneGeneration !== this.sequence.snapshot().sceneGeneration) return
        if (!this.exportRuntime || !this.scene || this.status !== 'ready') {
          this.emitFailure('export-not-ready', request.requestId, 'GPU Scene 导出尚未准备完成', true)
          return
        }
        this.exportRuntime.start(request, this.scene)
        return
      case 'cancel-export':
        this.exportRuntime?.cancel(request.requestId)
        return
      case 'export-tile-consumed':
        this.exportRuntime?.acknowledge(request.requestId, request.tileX, request.tileY)
        return
    }
  }

  getStatus(): ImageEditorGpuSceneRuntimeStatusV3 {
    return this.status
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.status = 'disposed'
    this.exportRuntime?.cancelAll()
    this.exportRuntime = null
    this.resources?.dispose()
    this.resources = null
    this.pendingTiles.clear()
    this.scene = null
    this.layout = null
    this.transientTransforms.clear()
    this.recovery.dispose()
    this.states.destroy()
    this.deviceManager.destroy()
  }

  /** 待命线程先把设备、vGPU Context 与空合成器建好；领用后 initialize 直接拿到。 */
  private async warm(request: Extract<ImageEditorGpuSceneWorkerRequestV3, { type: 'warm' }>): Promise<void> {
    if (request.protocolVersion !== IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3 || this.sessionId) return
    this.idleBudgetBytes = request.memoryBudgetBytes
    try {
      const state = await this.acquireGpuState(request.memoryBudgetBytes)
      this.emit({ type: 'warmed', sceneGeneration: 0, deviceGeneration: state.managed.generation })
    } catch (error) {
      // 预热失败只报给待命池记日志；领用后的 initialize 会重新申请设备，并按正常路径报告失败。
      this.emit({
        type: 'warmed', sceneGeneration: 0,
        deviceGeneration: this.deviceManager.getRecoveryStatus().generation,
        error: imageEditorGpuSceneErrorMessageV3(error),
      })
    }
  }

  /**
   * 结束当前会话、保留设备：场景代际、资源登记表、呈现 Surface 与导出全部清掉，
   * 合成器换成新的空合成器（旧合成器持有上一个会话的场景、atlas 与 Surface）。
   */
  private release(): void {
    this.sessionEpoch += 1
    this.sessionId = null
    this.exportRuntime?.cancelAll()
    this.exportRuntime = null
    this.resources?.dispose()
    this.resources = null
    this.pendingTiles.clear()
    this.scene = null
    this.layout = null
    this.transientTransforms.clear()
    this.presentationSurface = null
    this.sequence = new ImageEditorGpuSceneSequenceGateV3()
    this.recovery.reset()
    this.initializedOnce = false
    this.failNextRecoveryForDiagnostic = false
    this.deviceAcquireCount = 0
    this.surfaceFrameCount = 0
    const state = this.states.peek()
    if (state) {
      state.compositor.dispose()
      try {
        state.compositor = this.createCompositor(state.context, this.idleBudgetBytes)
      } catch {
        this.states.invalidate()
      }
    }
    this.status = 'idle'
    const kept = this.states.peek()
    const deviceRecovery = this.deviceManager.getRecoveryStatus()
    this.emit({
      type: 'released',
      sceneGeneration: 0,
      deviceGeneration: kept?.managed.generation ?? deviceRecovery.generation,
      deviceReady: kept !== null,
      // 设备管理器的丢失计数与冷却期跟着线程走；有丢失历史的线程不留给下一个会话。
      deviceLossHistory: ((deviceRecovery as { recentLosses?: number }).recentLosses ?? 0) > 0
        || deviceRecovery.retryAfterMs > 0,
    })
  }

  private acquireGpuState(memoryBudgetBytes: number): Promise<ImageEditorGpuSceneGpuStateV3> {
    return this.states.acquire(async () => {
      this.deviceAcquireCount += 1
      const managed = await this.deviceManager.acquire()
      const context = await this.contextFactory(managed.device)
      const compositor = this.createCompositor(context, memoryBudgetBytes)
      // vGPU 的异步错误多半属于刚提交的帧，按单帧失败处理；显存不足另有降档处理。
      const unsubscribeContext = context.onError((error) => this.handleAsyncGpuError(error))
      const unsubscribeDevice = subscribeGpuOutOfMemory(managed.device, (error) => this.handleAsyncGpuError(error))
      return {
        managed, context, compositor,
        unsubscribeError: () => {
          unsubscribeContext()
          unsubscribeDevice()
        },
      }
    })
  }

  private createCompositor(
    context: ImageEditorGpuSceneContextV3,
    memoryBudgetBytes: number,
  ): ImageEditorGpuRasterCompositorV3Like {
    const compositor = this.compositorFactory(context, { memoryBudgetBytes })
    this.compositorBudgets.set(compositor, memoryBudgetBytes)
    return compositor
  }

  private async initialize(
    request: Extract<ImageEditorGpuSceneWorkerRequestV3, { type: 'initialize' }>,
    recovered = false,
  ): Promise<void> {
    if (request.protocolVersion !== IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3) {
      this.emitFailure('initialization-failed', null, 'GPU Scene 协议版本不兼容', false)
      return
    }
    if (this.sessionId && this.sessionId !== request.sessionId) {
      this.emitFailure('initialization-failed', null, 'GPU Scene Worker 不可跨会话复用', false)
      return
    }
    this.sessionId = request.sessionId
    const epoch = this.sessionEpoch
    if ((!recovered && request.diagnosticInitializationFailure)
      || (recovered && this.failNextRecoveryForDiagnostic)) {
      // 让随后已排队的权威 sync-scene 先推进 generation，注入事件与真实异步
      // requestDevice 失败保持相同次序，不会被客户端旧 scene 门控丢弃。
      if (!recovered) await waitForImageEditorGpuSceneTaskV3()
      if (epoch !== this.sessionEpoch) return
      // 注入的失败模拟设备永久不可用：不排定时重试。
      this.failNextRecoveryForDiagnostic = false
      this.status = 'fallback'
      this.emitFailure(
        'initialization-failed', null,
        recovered ? 'Reality 注入 GPU 恢复失败' : 'Reality 注入 GPU 初始化失败', true,
      )
      return
    }
    if (!this.resources) {
      try {
        this.resources = new ImageEditorGpuSceneResourceRegistryV3({
          memoryBudgetBytes: request.memoryBudgetBytes,
          disposePayload: (payload) => payload.destroy(),
        })
      } catch (error) {
        this.status = 'fallback'
        this.emitFailure('initialization-failed', null, imageEditorGpuSceneErrorMessageV3(error), false)
        return
      }
    }
    this.status = recovered || this.initializedOnce ? 'recovering' : 'initializing'
    const budgetBytes = this.resources.snapshot().budgetBytes
    try {
      const state = await this.acquireGpuState(budgetBytes)
      if (this.disposed || epoch !== this.sessionEpoch) return
      // 待命线程按默认预算建的合成器；会话要求的预算不同才换一个。
      if (this.compositorBudgets.get(state.compositor) !== budgetBytes) {
        state.compositor.dispose()
        state.compositor = this.createCompositor(state.context, budgetBytes)
      }
      const wasRecovery = this.initializedOnce || recovered
      this.initializedOnce = true
      this.status = 'ready'
      this.recovery.resetFailures()
      this.exportRuntime?.cancelAll()
      this.exportRuntime = new ImageEditorGpuSceneExportRuntimeV3({
        emit: this.emit,
        createCompositor: (memoryBudgetBytes) => this.compositorFactory(
          state.context,
          { memoryBudgetBytes },
        ),
        createResidual: () => new ImageEditorGpuExportResidualV3(state.context as Gpu),
        previewCompositor: () => this.states.peek()?.compositor ?? null,
        previewResource: (key) => this.resources?.get(key) ?? null,
        currentSceneGeneration: () => this.sequence.snapshot().sceneGeneration,
        deviceGeneration: () => this.states.peek()?.managed.generation
          ?? this.deviceManager.getRecoveryStatus().generation,
        sessionBudgetBytes: this.resources?.snapshot().budgetBytes,
        trimPreviewMemory: (exportResidentBytes) => trimImageEditorGpuSceneMemoryV3({
          resources: this.resources,
          preview: this.states.peek()?.compositor ?? null,
          exportResidentBytes,
        }),
      })
      state.compositor.syncScene(this.scene)
      if (this.presentationSurface) {
        state.compositor.attachPresentationSurface(
          this.presentationSurface.canvas,
          this.presentationSurface.generation,
        )
      }
      if (this.layout) {
        state.compositor.updateViewport(this.layout)
        this.trimMemoryPressure(state.compositor)
      }
      for (const [layerId, transform] of this.transientTransforms) {
        state.compositor.updateTransientTransform(layerId, transform)
      }
      this.flushPendingTiles(state.compositor)
      // 补传瓦片时可能已因反复失败交给 CPU，此时不能再宣布就绪。
      if (!this.states.isCurrent(state)) return
      this.emit({
        type: 'ready',
        sceneGeneration: this.sequence.snapshot().sceneGeneration,
        deviceGeneration: state.managed.generation,
        recovered: wasRecovery,
      })
    } catch (error) {
      if (this.disposed || epoch !== this.sessionEpoch) return
      this.status = 'fallback'
      // 首次初始化、恢复或重试没成：CPU 接管，按退避再试，不让整个文档期间都停在 CPU。
      // 报 gpu-fallback 而不是 initialization-failed：后者会让客户端把当前设备代际标为丢失，
      // 设备其实还在时，重试成功的 ready 会被挡掉。
      this.emitFailure('gpu-fallback', null, imageEditorGpuSceneErrorMessageV3(error), true)
      this.scheduleFallbackRetry()
    }
  }

  private uploadTiles(
    request: Extract<ImageEditorGpuSceneWorkerRequestV3, { type: 'upload-tiles' }>,
  ): void {
    if (request.sceneGeneration !== this.sequence.snapshot().sceneGeneration || !this.resources) return
    const compositor = this.states.peek()?.compositor
    for (const entry of request.tiles) {
      if (this.resources.get(entry.key)) continue
      if (!compositor) this.pendingTiles.set(imageEditorGpuSceneTileKeyV3(entry.key), entry)
      else if (!this.admitTile(compositor, entry)) return
    }
  }

  private admitTile(
    compositor: ImageEditorGpuRasterCompositorV3Like,
    entry: ImageEditorGpuSceneUploadTileV3,
  ): boolean {
    if (!this.resources || this.resources.get(entry.key)) return true
    const result = admitImageEditorGpuSceneTileV3({
      resources: this.resources,
      compositor,
      entry,
      trimCombined: (bytes) => trimImageEditorGpuSceneMemoryV3({
        resources: this.resources,
        preview: this.states.peek()?.compositor ?? null,
        exportResidentBytes: this.exportRuntime?.activeResidentGpuBytes() ?? 0,
        additionalBytes: bytes,
      }),
    })
    if (result.admitted) return true
    // 本批剩下的瓦片不再上传；下一帧会按当前档位重新请求缺的瓦片。
    this.handleFrameFailure(null, new Error(result.message))
    return false
  }

  private flushPendingTiles(compositor: ImageEditorGpuRasterCompositorV3Like): void {
    const pending = [...this.pendingTiles.values()]
    this.pendingTiles.clear()
    for (const entry of pending) {
      if (!this.admitTile(compositor, entry)) break
    }
  }

  private trimMemoryPressure(compositor: ImageEditorGpuRasterCompositorV3Like): void {
    trimImageEditorGpuSceneMemoryV3({ resources: this.resources, preview: compositor,
      exportResidentBytes: this.exportRuntime?.activeResidentGpuBytes() ?? 0,
      includeCompositorPressure: true })
  }

  private async render(
    request: Extract<ImageEditorGpuSceneWorkerRequestV3, { type: 'render' }>,
  ): Promise<void> {
    const state = this.states.peek()
    if (!state || !this.scene || !this.layout || !this.resources) {
      this.emitFailure('composition-not-ready', request.requestId, 'GPU Scene 尚未准备完成', true)
      return
    }
    const epoch = this.sessionEpoch
    this.lastRenderEpoch = epoch
    const resolve = (key: Parameters<typeof this.resources.get>[0]) => this.resources?.get(key) ?? null
    const missing = state.compositor.missingResources(resolve)
    refreshImageEditorGpuSceneViewportProtectionsV3(this.resources, state.compositor)
    if (missing.length > 0) {
      this.emit({
        type: 'tiles-needed',
        sceneGeneration: request.sceneGeneration,
        deviceGeneration: state.managed.generation,
        keys: missing,
      })
      if (!state.compositor.canRenderPreview?.(resolve)) {
        this.emitFailure('composition-not-ready', request.requestId, 'GPU Scene 等待源纹理', true)
        return
      }
    }
    try {
      const result = await state.compositor.render(
        resolve,
        request.surfaceGeneration,
        () => this.acceptsRenderRequest(request)
          && this.states.isCurrent(state)
          && request.surfaceGeneration === (this.presentationSurface?.generation ?? 0),
      )
      if (epoch !== this.sessionEpoch || !this.acceptsRenderRequest(request)
        || !this.states.isCurrent(state) || !this.resources) {
        if (result.presentation.kind === 'gpu-image-bitmap') result.presentation.bitmap.close()
        return
      }
      if (result.presentation.kind === 'webgpu-surface') this.surfaceFrameCount += 1
      this.resources.releaseProtection('stable-frame')
      for (const key of result.usedResourceKeys) this.resources.protect(key, 'stable-frame')
      this.recovery.recordFrame(performance.now())
      const delivery = createImageEditorGpuSceneFrameDeliveryV3(
        request,
        state.managed.generation,
        result,
      )
      this.emit(delivery.event, delivery.transfer)
    } catch (error) {
      // 设备丢失时 states 已失效，由设备丢失流程接管；被新请求取代的帧失败不算数。
      if (epoch === this.sessionEpoch && this.acceptsRenderRequest(request) && this.states.isCurrent(state)) {
        this.handleFrameFailure(request.requestId, error)
      }
    }
  }

  /**
   * 单帧（或一批瓦片）失败：设备、合成器与已上传资源都保留，通知客户端重新请求下一帧。
   * 显存不足先让出缓存并降预览档位，能降就不计入失败次数；反复失败才交给 CPU。
   */
  private handleFrameFailure(requestId: string | null, error: unknown): void {
    const message = imageEditorGpuSceneErrorMessageV3(error)
    const outOfMemory = isImageEditorGpuOutOfMemoryError(error)
    if (outOfMemory && typeof error === 'object' && error !== null) {
      if (this.handledOutOfMemory.has(error)) {
        this.emitFailure('frame-failed', requestId, message, true, true)
        return
      }
      this.handledOutOfMemory.add(error)
      if (this.reducePreviewMemory()) {
        this.emitFailure('frame-failed', requestId, message, true, true)
        return
      }
    }
    if (!this.recovery.recordFailure(performance.now())) {
      this.emitFailure('frame-failed', requestId, message, true, outOfMemory)
      return
    }
    this.enterFallback(requestId, message)
  }

  /**
   * vGPU 与设备异步上报的错误。显存不足照常降档；其余错误不在这里计数：同一个错误还会被呈现器
   * 拿去处理（直呈 Surface 失效时它自己降到 ImageBitmap，ImageBitmap 提交时再抛出、由渲染失败计数），
   * 这里只请求重绘一帧，让那一帧暴露问题。上一个会话迟到的错误不算到新会话头上。
   */
  private handleAsyncGpuError(error: unknown): void {
    if (this.disposed || !this.sessionId || this.status !== 'ready'
      || this.lastRenderEpoch !== this.sessionEpoch) return
    if (isImageEditorGpuOutOfMemoryError(error)) {
      this.handleFrameFailure(null, error)
      return
    }
    this.recovery.noteError()
    this.emitFailure('frame-failed', null, imageEditorGpuSceneErrorMessageV3(error), true)
  }

  /** 先淘汰全部未受保护的缓存瓦片，再让合成器降低预览档位；返回是否真的降了档。 */
  private reducePreviewMemory(): boolean {
    const compositor = this.states.peek()?.compositor
    if (!compositor || !this.resources || !controlsPreviewMemory(compositor)) return false
    while (this.resources.evictOldestUnprotected()) continue
    const reduced = compositor.reducePreviewMemory()
    refreshImageEditorGpuSceneViewportProtectionsV3(this.resources, compositor)
    this.trimMemoryPressure(compositor)
    return reduced
  }

  private handleDeviceLost(loss: ImageEditWebGpuDeviceLoss): void {
    if (this.disposed) return
    this.exportRuntime?.cancelAll()
    this.exportRuntime = null
    const required = this.states.peek()?.compositor.requiredResourceKeys() ?? []
    this.resources?.clear()
    this.states.invalidate()
    this.status = 'lost'
    const sceneGeneration = this.sequence.snapshot().sceneGeneration
    this.emit({
      type: 'device-lost',
      sceneGeneration,
      deviceGeneration: loss.generation,
      reason: loss.reason,
      retryAfterMs: loss.recovery.retryAfterMs,
    })
    if (required.length > 0) {
      this.emit({
        type: 'tiles-needed',
        sceneGeneration,
        deviceGeneration: loss.generation,
        keys: required,
      })
    }
    if (!this.sessionId) {
      this.status = 'fallback'
      return
    }
    const recover = (): void => {
      if (this.disposed || !this.sessionId) return
      void this.initialize({
        type: 'initialize',
        protocolVersion: IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
        sessionId: this.sessionId,
        memoryBudgetBytes: this.resources?.snapshot().budgetBytes
          ?? IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
      }, true)
    }
    if (!this.recovery.schedule(loss.recovery.retryAfterMs, recover)) {
      this.status = 'fallback'
      this.scheduleFallbackRetry()
    }
  }

  private scheduleFallbackRetry(): void {
    this.recovery.scheduleFallbackRetry(() => {
      if (this.disposed || !this.sessionId || this.status !== 'fallback') return
      void this.initialize({
        type: 'initialize',
        protocolVersion: IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
        sessionId: this.sessionId,
        memoryBudgetBytes: this.resources?.snapshot().budgetBytes
          ?? IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
      }, true)
    })
  }

  private acceptsRenderRequest(
    request: Extract<ImageEditorGpuSceneWorkerRequestV3, { type: 'render' }>,
  ): boolean {
    return acceptsImageEditorGpuSceneRenderV3(
      request, this.sequence.snapshot(), this.presentationSurface?.generation ?? 0,
    )
  }

  private emitFailure(
    code: ImageEditorGpuSceneFailedEventV3['code'],
    requestId: string | null,
    message: string,
    recoverable: boolean,
    outOfMemory = false,
  ): void {
    const event = createImageEditorGpuSceneFailureEventV3({
      sceneGeneration: this.sequence.snapshot().sceneGeneration,
      deviceGeneration: this.deviceManager.getRecoveryStatus().generation,
      requestId, code, message, recoverable,
      deviceAcquireCount: this.deviceAcquireCount, surfaceFrameCount: this.surfaceFrameCount,
    })
    this.emit(outOfMemory ? { ...event, outOfMemory } : event)
  }

  /** 反复失败：释放合成状态交给 CPU，设备留在设备管理器里，按退避重新尝试 GPU。 */
  private enterFallback(requestId: string | null, message: string): void {
    if (this.status === 'fallback' || this.status === 'disposed') return
    this.status = 'fallback'
    this.recovery.resetFailures()
    this.exportRuntime?.cancelAll()
    this.exportRuntime = null
    this.pendingTiles.clear()
    this.resources?.clear()
    this.states.invalidate()
    this.emitFailure('gpu-fallback', requestId, message, true)
    this.scheduleFallbackRetry()
  }
  private destroyGpuState(state: ImageEditorGpuSceneGpuStateV3): void {
    state.unsubscribeError()
    state.compositor.dispose()
    state.context.dispose()
  }
}
