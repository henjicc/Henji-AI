import { initFromDevice, type Gpu } from 'vgpu'

import {
  ImageEditWebGpuDeviceManager,
  type ImageEditWebGpuDeviceLoss,
  type ManagedWebGpuDevice,
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
  IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
  imageEditorGpuSceneTileKeyV3,
  type ImageEditorGpuSceneFailedEventV3,
  type ImageEditorGpuSceneUploadTileV3,
  type ImageEditorGpuSceneWorkerEventV3,
  type ImageEditorGpuSceneWorkerRequestV3,
} from './imageEditorGpuSceneProtocolV3'
import { ImageEditorGpuSceneResourceRegistryV3 } from './imageEditorGpuSceneResourceRegistryV3'
import { ImageEditorGpuSceneSequenceGateV3 } from './imageEditorGpuSceneSequenceV3'

interface ImageEditorGpuSceneDeviceManagerV3 {
  onDeviceLost(handler: (reason: string, loss: ImageEditWebGpuDeviceLoss) => void): void
  acquire(): Promise<ManagedWebGpuDevice>
  getRecoveryStatus(): { generation: number; retryAfterMs: number }
  destroy(): void
}

interface ImageEditorGpuSceneContextV3 {
  onError(listener: (error: unknown) => void): () => void
  dispose(): void
}

interface ImageEditorGpuSceneGpuStateV3 {
  managed: ManagedWebGpuDevice
  context: ImageEditorGpuSceneContextV3
  compositor: ImageEditorGpuRasterCompositorV3Like
  unsubscribeError: () => void
}

export interface ImageEditorGpuSceneRuntimeDependenciesV3 {
  deviceManager?: ImageEditorGpuSceneDeviceManagerV3
  contextFactory?: (device: GpuDevice) => Promise<ImageEditorGpuSceneContextV3>
  compositorFactory?: (context: ImageEditorGpuSceneContextV3) => ImageEditorGpuRasterCompositorV3Like
}

export type ImageEditorGpuSceneRuntimeStatusV3 =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'lost'
  | 'recovering'
  | 'fallback'
  | 'disposed'

export class ImageEditorGpuSceneRuntimeV3 {
  private readonly deviceManager: ImageEditorGpuSceneDeviceManagerV3
  private readonly contextFactory: (device: GpuDevice) => Promise<ImageEditorGpuSceneContextV3>
  private readonly compositorFactory: (
    context: ImageEditorGpuSceneContextV3,
  ) => ImageEditorGpuRasterCompositorV3Like
  private readonly states: SingleflightRuntimeState<ImageEditorGpuSceneGpuStateV3>
  private readonly sequence = new ImageEditorGpuSceneSequenceGateV3()
  private readonly transientTransforms = new Map<string, ImageEditTransformV3>()
  private resources: ImageEditorGpuSceneResourceRegistryV3<ImageEditorGpuRasterTextureV3> | null = null
  private readonly pendingTiles = new Map<string, ImageEditorGpuSceneUploadTileV3>()
  private scene: ImageEditorGpuRasterSceneV3 | null = null
  private layout: ImageEditorViewportLayoutV3 | null = null
  private sessionId: string | null = null
  private status: ImageEditorGpuSceneRuntimeStatusV3 = 'idle'
  private initializedOnce = false
  private disposed = false

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
      ?? ((context) => new ImageEditorGpuRasterCompositorV3(context as Gpu))
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
        this.transientTransforms.clear()
        this.pendingTiles.clear()
        this.resources?.releaseProtection('viewport')
        this.resources?.releaseProtection('stable-frame')
        {
          const compilation = compileImageEditorGpuRasterSceneV3(
            request.document,
            request.resourceDescriptors,
          )
          this.scene = compilation.supported ? compilation.scene : null
          for (const key of this.scene?.requiredResourceKeys ?? []) {
            this.resources?.protect(key, 'viewport')
            this.resources?.protect(key, 'stable-frame')
          }
          this.states.peek()?.compositor.syncScene(this.scene)
        }
        return
      case 'upload-tiles':
        this.uploadTiles(request)
        return
      case 'update-transform':
        if (!this.sequence.updateInteraction(request.sceneGeneration, request.interactionSequence)) return
        if (request.transform) this.transientTransforms.set(request.layerId, [...request.transform])
        else this.transientTransforms.delete(request.layerId)
        this.states.peek()?.compositor.updateTransientTransform(request.layerId, request.transform)
        return
      case 'update-viewport':
        if (!this.sequence.updateCamera(request.sceneGeneration, request.cameraSequence)) return
        this.layout = request.layout
        this.states.peek()?.compositor.updateViewport(request.layout)
        return
      case 'render':
        if (!this.acceptsRenderRequest(request)) return
        void this.render(request)
        return
      case 'export':
        if (request.sceneGeneration !== this.sequence.snapshot().sceneGeneration) return
        this.emitFailure('export-not-ready', request.requestId, 'GPU Scene 导出将在任务 5.1 接入', true)
    }
  }

  getStatus(): ImageEditorGpuSceneRuntimeStatusV3 {
    return this.status
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.status = 'disposed'
    this.resources?.dispose()
    this.resources = null
    this.pendingTiles.clear()
    this.scene = null
    this.layout = null
    this.transientTransforms.clear()
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
    if (!this.resources) {
      try {
        this.resources = new ImageEditorGpuSceneResourceRegistryV3({
          memoryBudgetBytes: request.memoryBudgetBytes,
          disposePayload: (payload) => payload.destroy(),
        })
      } catch (error) {
        this.status = 'fallback'
        this.emitFailure('initialization-failed', null, errorMessage(error), false)
        return
      }
    }
    this.status = recovered || this.initializedOnce ? 'recovering' : 'initializing'
    try {
      const state = await this.states.acquire(async () => {
        const managed = await this.deviceManager.acquire()
        const context = await this.contextFactory(managed.device)
        const compositor = this.compositorFactory(context)
        const unsubscribeError = context.onError((error) => {
          this.emitFailure('initialization-failed', null, errorMessage(error), true)
        })
        return { managed, context, compositor, unsubscribeError }
      })
      if (this.disposed) return
      const wasRecovery = this.initializedOnce || recovered
      this.initializedOnce = true
      this.status = 'ready'
      state.compositor.syncScene(this.scene)
      if (this.layout) state.compositor.updateViewport(this.layout)
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
      this.emitFailure('initialization-failed', null, errorMessage(error), true)
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
    let payload: ImageEditorGpuRasterTextureV3 | null = null
    try {
      payload = compositor.uploadTile(entry.key, entry.tile)
      const registration = this.resources.register(
        entry.key,
        payload,
        entry.estimatedGpuBytes,
        entry.protections,
      )
      payload = null
      if (registration.admitted) return true
      this.emitFailure(
        'resource-budget-exceeded',
        null,
        'GPU Scene 资源超过 256 MiB 会话预算且没有可淘汰资源',
        true,
      )
      return false
    } catch (error) {
      payload?.destroy()
      this.emitFailure('composition-not-ready', null, errorMessage(error), true)
      return false
    }
  }

  private flushPendingTiles(compositor: ImageEditorGpuRasterCompositorV3Like): void {
    const pending = [...this.pendingTiles.values()]
    this.pendingTiles.clear()
    for (const entry of pending) {
      if (!this.admitTile(compositor, entry)) break
    }
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
      const result = await state.compositor.render(resolve)
      if (!this.acceptsRenderRequest(request) || !this.states.isCurrent(state)) {
        result.bitmap.close()
        return
      }
      this.emit({
        type: 'frame-ready',
        sceneGeneration: request.sceneGeneration,
        deviceGeneration: state.managed.generation,
        requestId: request.requestId,
        cameraSequence: request.cameraSequence,
        interactionSequence: request.interactionSequence,
        quality: request.quality,
        bitmap: result.bitmap,
        diagnostics: result.stats,
      }, [result.bitmap])
    } catch (error) {
      if (this.acceptsRenderRequest(request)) {
        this.emitFailure('composition-not-ready', request.requestId, errorMessage(error), true)
      }
    }
  }

  private handleDeviceLost(loss: ImageEditWebGpuDeviceLoss): void {
    if (this.disposed) return
    const missing = this.resources?.clear() ?? []
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
    if (missing.length > 0) {
      this.emit({
        type: 'tiles-needed',
        sceneGeneration,
        deviceGeneration: loss.generation,
        keys: missing,
      })
    }
    if (!this.sessionId || loss.recovery.retryAfterMs > 0) {
      this.status = 'fallback'
      return
    }
    void this.initialize({
      type: 'initialize',
      protocolVersion: IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
      sessionId: this.sessionId,
      memoryBudgetBytes: this.resources?.snapshot().budgetBytes ?? 0,
    }, true)
  }

  private acceptsRenderRequest(
    request: Extract<ImageEditorGpuSceneWorkerRequestV3, { type: 'render' }>,
  ): boolean {
    const current = this.sequence.snapshot()
    return request.sceneGeneration === current.sceneGeneration
      && request.cameraSequence === current.cameraSequence
      && request.interactionSequence === current.interactionSequence
  }

  private emitFailure(
    code: ImageEditorGpuSceneFailedEventV3['code'],
    requestId: string | null,
    message: string,
    recoverable: boolean,
  ): void {
    this.emit({
      type: 'failed',
      sceneGeneration: this.sequence.snapshot().sceneGeneration,
      deviceGeneration: this.deviceManager.getRecoveryStatus().generation,
      requestId,
      code,
      message,
      recoverable,
    })
  }

  private destroyGpuState(state: ImageEditorGpuSceneGpuStateV3): void {
    state.unsubscribeError()
    state.compositor.dispose()
    state.context.dispose()
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
