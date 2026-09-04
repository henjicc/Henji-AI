import { initFromDevice, type Gpu } from 'vgpu'

import {
  ImageEditWebGpuDeviceManager,
  type ImageEditWebGpuDeviceLoss,
  type ManagedWebGpuDevice,
} from '@/core/imageEdit/webgpu/deviceManager'
import { SingleflightRuntimeState } from '@/core/imageEdit/worker/gpuRuntimeLifecycle'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import {
  IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
  type ImageEditorGpuSceneFailedEventV3,
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
  unsubscribeError: () => void
}

export interface ImageEditorGpuSceneRuntimeDependenciesV3 {
  deviceManager?: ImageEditorGpuSceneDeviceManagerV3
  contextFactory?: (device: GpuDevice) => Promise<ImageEditorGpuSceneContextV3>
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
  private readonly states: SingleflightRuntimeState<ImageEditorGpuSceneGpuStateV3>
  private readonly sequence = new ImageEditorGpuSceneSequenceGateV3()
  private readonly transientTransforms = new Map<string, ImageEditTransformV3>()
  private resources: ImageEditorGpuSceneResourceRegistryV3<ImageEditorV3SourceTile> | null = null
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
        return
      case 'upload-tiles':
        this.uploadTiles(request)
        return
      case 'update-transform':
        if (!this.sequence.updateInteraction(request.sceneGeneration, request.interactionSequence)) return
        if (request.transform) this.transientTransforms.set(request.layerId, [...request.transform])
        else this.transientTransforms.delete(request.layerId)
        return
      case 'update-viewport':
        this.sequence.updateCamera(request.sceneGeneration, request.cameraSequence)
        return
      case 'render':
        if (!this.acceptsRenderRequest(request)) return
        this.emitFailure('composition-not-ready', request.requestId, 'GPU Scene 合成器将在任务 2.1 接入', true)
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
        const unsubscribeError = context.onError((error) => {
          this.emitFailure('initialization-failed', null, errorMessage(error), true)
        })
        return { managed, context, unsubscribeError }
      })
      if (this.disposed) return
      const wasRecovery = this.initializedOnce || recovered
      this.initializedOnce = true
      this.status = 'ready'
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
    for (const entry of request.tiles) {
      const registration = this.resources.register(
        entry.key,
        entry.tile,
        entry.estimatedGpuBytes,
        entry.protections,
      )
      if (!registration.admitted) {
        this.emitFailure(
          'resource-budget-exceeded',
          null,
          'GPU Scene 资源超过 256 MiB 会话预算且没有可淘汰资源',
          true,
        )
        return
      }
    }
  }

  private handleDeviceLost(loss: ImageEditWebGpuDeviceLoss): void {
    if (this.disposed) return
    this.states.invalidate()
    this.status = 'lost'
    const missing = this.resources?.clear() ?? []
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
    state.context.dispose()
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
