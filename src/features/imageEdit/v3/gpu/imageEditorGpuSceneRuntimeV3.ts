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
export class ImageEditorGpuSceneRuntimeV3 {
  private readonly deviceManager: ImageEditorGpuSceneDeviceManagerV3
  private readonly contextFactory: (device: GpuDevice) => Promise<ImageEditorGpuSceneContextV3>
  private readonly compositorFactory: (
    context: ImageEditorGpuSceneContextV3,
    options: { memoryBudgetBytes: number },
  ) => ImageEditorGpuRasterCompositorV3Like
  private readonly states: SingleflightRuntimeState<ImageEditorGpuSceneGpuStateV3>
  private readonly sequence = new ImageEditorGpuSceneSequenceGateV3()
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
          )
          this.scene = compilation.supported ? compilation.scene : null
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
          if (compositor && !this.trimMemoryPressure(compositor)) {
            this.enterFallback(
              'resource-budget-exceeded', null,
              'GPU Scene 当前视口与受保护资源超过会话显存预算', true,
            )
          }
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
    if ((!recovered && request.diagnosticInitializationFailure)
      || (recovered && this.failNextRecoveryForDiagnostic)) {
      // 让随后已排队的权威 sync-scene 先推进 generation，注入事件与真实异步
      // requestDevice 失败保持相同次序，不会被客户端旧 scene 门控丢弃。
      if (!recovered) await waitForImageEditorGpuSceneTaskV3()
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
    try {
      const state = await this.states.acquire(async () => {
        this.deviceAcquireCount += 1
        const managed = await this.deviceManager.acquire()
        const context = await this.contextFactory(managed.device)
        const compositor = this.compositorFactory(context, {
          memoryBudgetBytes: this.resources?.snapshot().budgetBytes
            ?? IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
        })
        const unsubscribeError = context.onError((error) => {
          this.emitFailure('initialization-failed', null, imageEditorGpuSceneErrorMessageV3(error), true)
        })
        return { managed, context, compositor, unsubscribeError }
      })
      if (this.disposed) return
      const wasRecovery = this.initializedOnce || recovered
      this.initializedOnce = true
      this.status = 'ready'
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
        if (!this.trimMemoryPressure(state.compositor)) {
          throw new Error('GPU Scene 当前视口与受保护资源超过会话显存预算')
        }
      }
      for (const [layerId, transform] of this.transientTransforms) {
        state.compositor.updateTransientTransform(layerId, transform)
      }
      this.flushPendingTiles(state.compositor)
      this.emit({
        type: 'ready',
        sceneGeneration: this.sequence.snapshot().sceneGeneration,
        deviceGeneration: state.managed.generation,
        recovered: wasRecovery,
      })
    } catch (error) {
      if (this.disposed) return
      this.status = 'fallback'
      this.emitFailure('initialization-failed', null, imageEditorGpuSceneErrorMessageV3(error), true)
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
    this.enterFallback(result.code, null, result.message, true)
    return false
  }

  private flushPendingTiles(compositor: ImageEditorGpuRasterCompositorV3Like): void {
    const pending = [...this.pendingTiles.values()]
    this.pendingTiles.clear()
    for (const entry of pending) {
      if (!this.admitTile(compositor, entry)) break
    }
  }

  private trimMemoryPressure(compositor: ImageEditorGpuRasterCompositorV3Like): boolean {
    return trimImageEditorGpuSceneMemoryV3({ resources: this.resources, preview: compositor,
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
      this.emitFailure('composition-not-ready', request.requestId, 'GPU Scene 等待源纹理', true)
      return
    }
    try {
      const result = await state.compositor.render(
        resolve,
        request.surfaceGeneration,
        () => this.acceptsRenderRequest(request)
          && this.states.isCurrent(state)
          && request.surfaceGeneration === (this.presentationSurface?.generation ?? 0),
      )
      if (!this.acceptsRenderRequest(request) || !this.states.isCurrent(state)) {
        if (result.presentation.kind === 'gpu-image-bitmap') result.presentation.bitmap.close()
        return
      }
      if (result.presentation.kind === 'webgpu-surface') this.surfaceFrameCount += 1
      this.resources.releaseProtection('stable-frame')
      for (const key of result.usedResourceKeys) this.resources.protect(key, 'stable-frame')
      this.recovery.validateFrame()
      const delivery = createImageEditorGpuSceneFrameDeliveryV3(
        request,
        state.managed.generation,
        result,
      )
      this.emit(delivery.event, delivery.transfer)
    } catch (error) {
      if (this.acceptsRenderRequest(request)) {
        this.enterFallback(
          'composition-not-ready', request.requestId, imageEditorGpuSceneErrorMessageV3(error), true,
        )
      }
    }
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
    if (!this.recovery.schedule(loss.recovery.retryAfterMs, recover)) this.status = 'fallback'
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
  ): void {
    this.emit(createImageEditorGpuSceneFailureEventV3({
      sceneGeneration: this.sequence.snapshot().sceneGeneration,
      deviceGeneration: this.deviceManager.getRecoveryStatus().generation,
      requestId, code, message, recoverable,
      deviceAcquireCount: this.deviceAcquireCount, surfaceFrameCount: this.surfaceFrameCount,
    }))
  }

  private enterFallback(
    code: ImageEditorGpuSceneFailedEventV3['code'],
    requestId: string | null,
    message: string,
    recoverable: boolean,
  ): void {
    if (this.status === 'fallback' || this.status === 'disposed') return
    this.status = 'fallback'
    this.exportRuntime?.cancelAll()
    this.exportRuntime = null
    this.pendingTiles.clear()
    this.resources?.clear()
    this.states.invalidate()
    this.emitFailure(code, requestId, message, recoverable)
  }
  private destroyGpuState(state: ImageEditorGpuSceneGpuStateV3): void {
    state.unsubscribeError()
    state.compositor.dispose()
    state.context.dispose()
  }
}
