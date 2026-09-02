import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  imageEditOutputSizeV3,
} from '@/core/imageEdit/v3'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import { ImageEditorPresentationSurfaceV3, type ImageEditorPresentationSurfaceElementsV3 } from './imageEditorPresentationSurfaceV3'
import {
  ImageEditorViewportCompositeClientV3,
  ImageEditorViewportCompositeDisposedErrorV3,
  ImageEditorViewportCompositeSupersededErrorV3,
} from './viewportCompositeClientV3'
import type {
  ImageEditorManagedViewportCompositeV3,
  ImageEditorViewportCompositeClientOptionsV3,
  ImageEditorViewportCompositeRequestV3,
  ImageEditorViewportRuntimeListenerV3,
} from './viewportCompositeTypesV3'
import { resolveImageEditorViewportAnalysisMipV3 } from './viewportGlobalAnalysisV3'
import { imageEditorRenderRuntimePatchV3 } from './imageEditorRenderRuntimeV3'

const registry = createBuiltInImageEditRenderNodeRegistry()
export interface ImageEditorRenderSnapshotV3 {
  document: ImageEditDocumentV3
  renderGeneration: number
  geometryHash: string
  quality: ImageEditRenderQuality
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
  eventTimestamp?: number
}

export interface ImageEditorRenderSessionDiagnosticsV3 {
  surfaceId: string | null
  renderGeneration: number
  geometryHash: string
  cameraSequence: number
  coverage: number
  targetMipCoverage: number
  targetMip: number | null
  eventToPresentMs: number | null
  rendering: boolean
  renderBackend: 'gpu' | 'cpu'
  deviceStatus: 'idle' | 'ready' | 'lost' | 'fallback'
  deviceGeneration: number
  fallbackRequired: boolean
  diagnostic: string | null
}

export interface ImageEditorRenderSessionStateV3 extends ImageEditorRenderSessionDiagnosticsV3 {
  result: ImageEditorManagedViewportCompositeV3 | null
}

export interface ImageEditorRenderSessionV3 {
  attachSurface(elements: ImageEditorPresentationSurfaceElementsV3): () => void
  updateSnapshot(snapshot: ImageEditorRenderSnapshotV3): void
  updateViewport(layout: ImageEditorViewportLayoutV3): void
  subscribeDiagnostics(listener: (value: ImageEditorRenderSessionDiagnosticsV3) => void): () => void
  setVisibility(visible: boolean): void
  dispose(): void
}

type ImageEditorRenderSessionLayoutV3 = ImageEditorViewportLayoutV3 & {
  cameraSequence: number
  timestamp: number
}

export interface ImageEditorRenderSessionDependenciesV3 {
  client?: {
    render(request: ImageEditorViewportCompositeRequestV3): Promise<ImageEditorManagedViewportCompositeV3>
    cancel(): void
    dispose(): void
    subscribeRuntime?(listener: ImageEditorViewportRuntimeListenerV3): () => void
  }
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function sameSnapshot(
  left: ImageEditorRenderSnapshotV3 | null,
  right: ImageEditorRenderSnapshotV3,
): boolean {
  return Boolean(left
    && left.document === right.document
    && left.renderGeneration === right.renderGeneration
    && left.geometryHash === right.geometryHash
    && left.quality === right.quality
    && left.resourceDescriptors === right.resourceDescriptors)
}

export class DefaultImageEditorRenderSessionV3 implements ImageEditorRenderSessionV3 {
  private readonly client: NonNullable<ImageEditorRenderSessionDependenciesV3['client']>
  private readonly compositor = new ImageEditorPresentationSurfaceV3()
  private readonly diagnosticsListeners = new Set<(value: ImageEditorRenderSessionDiagnosticsV3) => void>()
  private readonly stateListeners = new Set<(value: ImageEditorRenderSessionStateV3) => void>()
  private snapshot: ImageEditorRenderSnapshotV3 | null = null
  private layout: ImageEditorRenderSessionLayoutV3 | null = null
  private coarse: ImageEditorManagedViewportCompositeV3 | null = null
  private target: ImageEditorManagedViewportCompositeV3 | null = null
  private state: ImageEditorRenderSessionStateV3
  private epoch = 0
  private cameraSequence = 0
  private coarseInFlightEpoch: number | null = null
  private analysisInFlightEpoch: number | null = null
  private analysisMip: number | null = null
  private analysisReadyGeneration: number | null = null
  private targetFrame: number | null = null
  private cameraFrame: number | null = null
  private pendingLayout: ImageEditorViewportLayoutV3 | null = null
  private readonly unsubscribeRuntime: () => void
  private visible = true
  private disposed = false

  constructor(
    options: ImageEditorViewportCompositeClientOptionsV3,
    dependencies: ImageEditorRenderSessionDependenciesV3 = {},
  ) {
    this.client = dependencies.client ?? new ImageEditorViewportCompositeClientV3(options)
    this.state = {
      surfaceId: null, renderGeneration: 0, geometryHash: '', cameraSequence: 0,
      coverage: 0, targetMipCoverage: 0, targetMip: null, eventToPresentMs: null,
      renderBackend: 'cpu', deviceStatus: 'idle', deviceGeneration: 0,
      rendering: false, fallbackRequired: false, diagnostic: null, result: null,
    }
    this.unsubscribeRuntime = this.client.subscribeRuntime?.((event) => {
      if (event.renderGeneration !== this.snapshot?.renderGeneration) return
      this.publish(imageEditorRenderRuntimePatchV3(event, this.state.diagnostic))
    }) ?? (() => undefined)
  }

  attachSurface(elements: ImageEditorPresentationSurfaceElementsV3): () => void {
    this.assertUsable()
    this.compositor.attach(elements)
    this.publish({ surfaceId: elements.surfaceId })
    this.present()
    return () => {
      this.compositor.detach(elements)
      if (this.state.surfaceId === elements.surfaceId) this.publish({ surfaceId: null })
    }
  }

  updateSnapshot(snapshot: ImageEditorRenderSnapshotV3): void {
    this.assertUsable()
    if (sameSnapshot(this.snapshot, snapshot)) return
    this.snapshot = snapshot
    this.analysisMip = resolveImageEditorViewportAnalysisMipV3(
      snapshot.document,
      compileImageEditRenderPlanV3(snapshot.document, registry, snapshot.quality),
    )
    this.analysisReadyGeneration = this.analysisMip === null ? snapshot.renderGeneration : null
    const epoch = ++this.epoch
    if (this.targetFrame !== null) cancelAnimationFrame(this.targetFrame)
    this.targetFrame = null
    this.client.cancel()
    this.releaseTarget()
    this.publish({
      renderGeneration: snapshot.renderGeneration,
      geometryHash: snapshot.geometryHash,
      rendering: true,
      fallbackRequired: false,
      diagnostic: null,
      targetMipCoverage: 0,
      targetMip: null,
      result: this.coarse,
    })
    this.present()
    this.scheduleCoarse(epoch, snapshot)
  }

  updateViewport(layout: ImageEditorViewportLayoutV3): void {
    this.assertUsable()
    if (!this.layout) {
      this.applyViewport(layout)
      return
    }
    if (this.pendingLayout?.viewportKey === layout.viewportKey
      && this.pendingLayout.viewport.interacting === layout.viewport.interacting) return
    this.pendingLayout = layout
    if (this.cameraFrame !== null) return
    this.cameraFrame = requestAnimationFrame(() => {
      this.cameraFrame = null
      const pending = this.pendingLayout
      this.pendingLayout = null
      if (pending && !this.disposed) this.applyViewport(pending, true)
    })
  }

  private applyViewport(
    layout: ImageEditorViewportLayoutV3,
    presentTargetImmediately = false,
  ): void {
    const previous = this.layout
    if (previous?.viewportKey === layout.viewportKey
      && previous.viewport.interacting === layout.viewport.interacting) return
    const elapsedSeconds = previous
      ? Math.max(0.001, (now() - previous.timestamp) / 1_000)
      : 1
    this.cameraSequence += 1
    this.layout = {
      ...layout,
      cameraSequence: this.cameraSequence,
      timestamp: now(),
      viewport: {
        ...layout.viewport,
        velocityX: previous
          ? (layout.viewport.documentX - previous.viewport.documentX) / elapsedSeconds
          : 0,
        velocityY: previous
          ? (layout.viewport.documentY - previous.viewport.documentY) / elapsedSeconds
          : 0,
      },
    }
    this.publish({ cameraSequence: this.cameraSequence })
    this.present()
    if (this.coarse?.renderGeneration === this.snapshot?.renderGeneration) {
      this.scheduleAnalysisOrTarget(presentTargetImmediately)
    } else if (this.snapshot) {
      this.scheduleCoarse(this.epoch, this.snapshot)
    }
  }

  subscribeDiagnostics(listener: (value: ImageEditorRenderSessionDiagnosticsV3) => void): () => void {
    this.diagnosticsListeners.add(listener)
    listener(this.state)
    return () => this.diagnosticsListeners.delete(listener)
  }

  subscribeState(listener: (value: ImageEditorRenderSessionStateV3) => void): () => void {
    this.stateListeners.add(listener)
    listener(this.state)
    return () => this.stateListeners.delete(listener)
  }

  setVisibility(visible: boolean): void {
    this.assertUsable()
    if (this.visible === visible) return
    this.visible = visible
    if (!visible && this.coarse?.renderGeneration === this.snapshot?.renderGeneration) {
      this.client.cancel()
      this.publish({ rendering: false })
      return
    }
    if (visible) {
      this.present()
      if (this.coarse?.renderGeneration === this.snapshot?.renderGeneration) {
        this.scheduleAnalysisOrTarget()
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.epoch += 1
    if (this.targetFrame !== null) cancelAnimationFrame(this.targetFrame)
    this.targetFrame = null
    if (this.cameraFrame !== null) cancelAnimationFrame(this.cameraFrame)
    this.cameraFrame = null
    this.pendingLayout = null
    this.unsubscribeRuntime()
    this.client.dispose()
    this.releaseTarget()
    this.coarse?.release()
    this.coarse = null
    this.diagnosticsListeners.clear()
    this.stateListeners.clear()
  }

  private async renderCoarse(epoch: number, snapshot: ImageEditorRenderSnapshotV3): Promise<void> {
    const layout = this.layout
    if (!layout) return
    try {
      const result = await this.client.render({
        ...snapshot,
        viewport: layout.viewport,
        viewportKey: `coarse:${snapshot.renderGeneration}`,
        phase: 'coarse',
        cameraSequence: layout.cameraSequence,
        preferredMip: 30,
        coverage: 'document',
        overscanViewports: 0,
        forwardPrefetchViewports: 0,
        quality: 'draft',
      })
      if (!this.accepts(epoch, snapshot)) {
        result.release()
        return
      }
      const previousCoarse = this.coarse
      this.coarse = result
      this.releaseTarget()
      this.present()
      previousCoarse?.release()
      this.publish({ rendering: false, fallbackRequired: false, diagnostic: null, result })
      this.scheduleAnalysisOrTarget()
    } catch (error) {
      this.handleFailure(epoch, error)
    }
  }

  private scheduleCoarse(epoch: number, snapshot: ImageEditorRenderSnapshotV3): void {
    if (!this.layout || this.coarseInFlightEpoch === epoch) return
    this.coarseInFlightEpoch = epoch
    void this.renderCoarse(epoch, snapshot).finally(() => {
      if (this.coarseInFlightEpoch === epoch) this.coarseInFlightEpoch = null
    })
  }

  private scheduleTarget(immediate = false): void {
    if (immediate && this.targetFrame !== null) {
      cancelAnimationFrame(this.targetFrame)
      this.targetFrame = null
    }
    if (!this.visible
      || this.targetFrame !== null
      || !this.snapshot
      || !this.layout
      || this.analysisReadyGeneration !== this.snapshot.renderGeneration) return
    if (immediate) {
      void this.renderTarget(this.epoch, this.snapshot, this.layout)
      return
    }
    this.targetFrame = requestAnimationFrame(() => {
      this.targetFrame = null
      void this.renderTarget(this.epoch, this.snapshot!, this.layout!)
    })
  }

  private async renderTarget(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionLayoutV3,
  ): Promise<void> {
    if (!this.visible
      || this.coarse?.renderGeneration !== snapshot.renderGeneration
      || this.analysisReadyGeneration !== snapshot.renderGeneration) return
    this.publish({ rendering: true })
    let progressiveCoverage = 0
    try {
      const result = await this.client.render({
        ...snapshot,
        viewport: layout.viewport,
        viewportKey: layout.viewportKey,
        phase: 'target',
        cameraSequence: layout.cameraSequence,
        coverage: 'viewport',
        previousMip: this.target?.mip,
        onTileReady: (progress) => {
          if (!this.accepts(epoch, snapshot)
            || this.layout?.cameraSequence !== layout.cameraSequence) return
          const contribution = this.compositor.presentTile(
            progress.tile,
            progress.mip,
            imageEditOutputSizeV3(snapshot.document.geometry),
            snapshot.document.geometry,
            layout,
            {
              renderGeneration: progress.renderGeneration,
              cameraSequence: progress.cameraSequence,
              geometryHash: progress.geometryHash,
            },
          )
          if (contribution === null) return
          progressiveCoverage = Math.min(1, progressiveCoverage + contribution)
          this.publish({
            coverage: 1,
            targetMipCoverage: progressiveCoverage,
            targetMip: progress.mip,
            eventToPresentMs: snapshot.eventTimestamp === undefined
              ? null
              : Math.max(0, now() - snapshot.eventTimestamp),
          })
        },
      })
      if (!this.accepts(epoch, snapshot) || this.layout?.cameraSequence !== layout.cameraSequence) {
        result.release()
        this.scheduleTarget()
        return
      }
      const previousTarget = this.target
      this.target = result
      this.present()
      previousTarget?.release()
      this.publish({ rendering: false, result, targetMip: result.mip })
    } catch (error) {
      this.handleFailure(epoch, error)
    }
  }

  private present(): void {
    if (!this.layout || !this.coarse || !this.snapshot) return
    const presented = this.compositor.present(
      this.coarse,
      this.target,
      this.layout,
      this.layout.cameraSequence,
      this.snapshot.document.geometry,
      this.snapshot.geometryHash,
    )
    if (!presented) return
    this.publish({
      ...presented,
      eventToPresentMs: this.snapshot?.eventTimestamp === undefined
        ? null
        : Math.max(0, now() - this.snapshot.eventTimestamp),
    })
  }

  private scheduleAnalysisOrTarget(presentTargetImmediately = false): void {
    if (!this.snapshot || !this.layout || !this.visible) return
    if (this.analysisReadyGeneration === this.snapshot.renderGeneration) {
      this.scheduleTarget(presentTargetImmediately)
      return
    }
    if (this.analysisInFlightEpoch === this.epoch) return
    const epoch = this.epoch
    this.analysisInFlightEpoch = epoch
    void this.renderAnalysis(epoch, this.snapshot, this.layout).finally(() => {
      if (this.analysisInFlightEpoch === epoch) this.analysisInFlightEpoch = null
      if (this.visible
        && this.epoch === epoch
        && this.analysisReadyGeneration !== this.snapshot?.renderGeneration
        && this.state.diagnostic === null) this.scheduleAnalysisOrTarget()
    })
  }

  private async renderAnalysis(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionLayoutV3,
  ): Promise<void> {
    if (this.analysisMip === null) {
      this.analysisReadyGeneration = snapshot.renderGeneration
      this.scheduleTarget()
      return
    }
    this.publish({ rendering: true })
    try {
      const result = await this.client.render({
        ...snapshot,
        viewport: layout.viewport,
        viewportKey: `analysis:${snapshot.renderGeneration}:${this.analysisMip}`,
        phase: 'analysis',
        cameraSequence: layout.cameraSequence,
        preferredMip: this.analysisMip,
        coverage: 'document',
        overscanViewports: 0,
        forwardPrefetchViewports: 0,
        analysisRequested: true,
      })
      if (!this.accepts(epoch, snapshot)) {
        result.release()
        return
      }
      const previousCoarse = this.coarse
      this.coarse = result
      this.analysisReadyGeneration = snapshot.renderGeneration
      this.present()
      previousCoarse?.release()
      this.publish({ rendering: false, fallbackRequired: false, diagnostic: null, result })
      this.scheduleTarget()
    } catch (error) {
      this.handleFailure(epoch, error)
    }
  }

  private handleFailure(epoch: number, error: unknown): void {
    if (epoch !== this.epoch
      || error instanceof ImageEditorViewportCompositeSupersededErrorV3
      || error instanceof ImageEditorViewportCompositeDisposedErrorV3) return
    this.publish({
      rendering: false,
      fallbackRequired: this.coarse === null,
      diagnostic: error instanceof Error ? error.message : String(error),
    })
  }

  private accepts(epoch: number, snapshot: ImageEditorRenderSnapshotV3): boolean {
    return !this.disposed && epoch === this.epoch && this.snapshot === snapshot
  }

  private releaseTarget(): void {
    this.target?.release()
    this.target = null
  }

  private publish(patch: Partial<ImageEditorRenderSessionStateV3>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.diagnosticsListeners) listener(this.state)
    for (const listener of this.stateListeners) listener(this.state)
  }

  private assertUsable(): void {
    if (this.disposed) throw new ImageEditorViewportCompositeDisposedErrorV3()
  }
}
