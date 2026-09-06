import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import { isUiInspectionReadOnly } from '@/platform/runtime'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import { ImageEditorPresentationSurfaceV3, imageEditorViewportResultCoverageV3, type ImageEditorPresentationSurfaceElementsV3 } from './imageEditorPresentationSurfaceV3'
import { createImageEditorRenderSessionClientLanesV3, type ImageEditorRenderSessionClientLanesV3 } from './imageEditorRenderSessionClientsV3'
import type { ImageEditorRenderSessionDependenciesV3, ImageEditorRenderSessionDiagnosticsV3, ImageEditorRenderSessionStateV3, ImageEditorRenderSessionV3, ImageEditorRenderSnapshotV3 } from './imageEditorRenderSessionContractsV3'
import { imageEditorRenderResultMatchesViewV3, sameImageEditorRenderSnapshotV3 } from './imageEditorRenderSessionIdentityV3'
import { presentImageEditorRenderSessionFrameV3 } from './imageEditorRenderSessionPresentationV3'
import { ImageEditorViewportCompositeDisposedErrorV3, ImageEditorViewportCompositeSupersededErrorV3 } from './viewportCompositeClientV3'
import type { ImageEditorManagedViewportCompositeV3, ImageEditorViewportCompositeClientOptionsV3 } from './viewportCompositeTypesV3'
import { imageEditorRenderRuntimePatchV3 } from './imageEditorRenderRuntimeV3'
import { ImageEditorRenderSessionGpuBridgeV3 } from './imageEditorRenderSessionGpuBridgeV3'
import { ImageEditorRenderSessionGpuPresentationV3 } from './imageEditorRenderSessionGpuPresentationV3'
import { ImageEditorRenderSessionWorkV3, type ImageEditorRenderSessionWorkLayoutV3 } from './imageEditorRenderSessionWorkV3'
import { ImageEditorRenderSessionScheduleV3 } from './imageEditorRenderSessionScheduleV3'
import { ImageEditorRenderSessionCpuWorkV3 } from './imageEditorRenderSessionCpuWorkV3'

export type {
  ImageEditorRenderSessionDependenciesV3,
  ImageEditorRenderSessionDiagnosticsV3,
  ImageEditorRenderSessionStateV3,
  ImageEditorRenderSessionV3,
  ImageEditorRenderSnapshotV3,
} from './imageEditorRenderSessionContractsV3'

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export class DefaultImageEditorRenderSessionV3 implements ImageEditorRenderSessionV3 {
  private readonly clients: ImageEditorRenderSessionClientLanesV3
  private readonly gpuBridge: ImageEditorRenderSessionGpuBridgeV3
  private readonly work: ImageEditorRenderSessionWorkV3
  private readonly cpu: ImageEditorRenderSessionCpuWorkV3
  private readonly schedule = new ImageEditorRenderSessionScheduleV3()
  private readonly compositor = new ImageEditorPresentationSurfaceV3()
  private readonly gpuPresentation = new ImageEditorRenderSessionGpuPresentationV3(this.compositor)
  private readonly diagnosticsListeners = new Set<(value: ImageEditorRenderSessionDiagnosticsV3) => void>()
  private readonly stateListeners = new Set<(value: ImageEditorRenderSessionStateV3) => void>()
  private snapshot: ImageEditorRenderSnapshotV3 | null = null
  private layout: ImageEditorRenderSessionWorkLayoutV3 | null = null
  private stable: ImageEditorManagedViewportCompositeV3 | null = null
  private draft: ImageEditorManagedViewportCompositeV3 | null = null
  private backdrop: ImageEditorManagedViewportCompositeV3 | null = null
  private state: ImageEditorRenderSessionStateV3
  private cameraSequence = 0
  private cameraFrame: number | null = null
  private pendingLayout: ImageEditorViewportLayoutV3 | null = null
  private readonly unsubscribeRuntime: () => void
  private visible = true
  private disposed = false

  constructor(
    options: ImageEditorViewportCompositeClientOptionsV3,
    dependencies: ImageEditorRenderSessionDependenciesV3 = {},
  ) {
    this.clients = createImageEditorRenderSessionClientLanesV3(options, dependencies)
    this.cpu = new ImageEditorRenderSessionCpuWorkV3(this.clients,
      () => this.compositor.updateRuntimeDiagnostics(this.cpu.renderPlanCompileCount, this.cpu.taskStartCount),
      (settled) => {
        this.publish({ rendering: this.cpu.rendering })
        if (settled) this.scheduleCurrentWork()
      })
    this.state = {
      surfaceId: null, renderGeneration: 0, geometryHash: '', cameraSequence: 0,
      coverage: 0, targetMipCoverage: 0, targetMip: null, eventToPresentMs: null,
      compositionBackend: 'cpu', effectBackend: 'cpu', presentationBackend: 'canvas2d',
      deviceStatus: 'idle', deviceGeneration: 0,
      rendering: false, fallbackRequired: false, diagnostic: null, result: null,
    }
    this.unsubscribeRuntime = this.clients.subscribeRuntime((event) => {
      if (this.cpu.suspended || event.renderGeneration !== this.snapshot?.renderGeneration) return
      this.publish(imageEditorRenderRuntimePatchV3(event, this.state.diagnostic))
    })
    this.gpuBridge = new ImageEditorRenderSessionGpuBridgeV3(
      options.sessionId,
      dependencies.gpuSceneClient,
      (patch) => this.publish(patch),
      isUiInspectionReadOnly(),
      (event, layout, eventToPresentMs) => {
        if (!this.visible) return 'deferred'
        if (this.disposed) return false
        const presented = this.gpuPresentation.present(event, layout, eventToPresentMs)
        if (presented) this.suspendCpuAfterGpuPresentation()
        return presented
      },
      () => this.resumeCpuFallback(),
    )
    this.work = new ImageEditorRenderSessionWorkV3({
      clients: this.clients,
      getStable: () => this.stable,
      accepts: (epoch, snapshot) => this.accepts(epoch, snapshot),
      acceptsView: (epoch, snapshot, layout, viewKey) => this.acceptsView(epoch, snapshot, layout, viewKey),
      acceptsSupersededDraft: (epoch, snapshot) => this.acceptsSupersededDraft(epoch, snapshot),
      acceptsSupersededDraftView: (epoch, snapshot, layout) => this.acceptsSupersededDraftView(epoch, snapshot, layout),
      acceptDraft: (result) => this.acceptDraftResult(result),
      acceptAnalysis: (result, current) => this.acceptAnalysisResult(result, current),
      acceptBackdrop: (result) => this.acceptBackdropResult(result),
      acceptTarget: (result) => this.acceptTargetResult(result),
      publishTargetProgress: (coverage, mip) => this.publish({ targetMipCoverage: coverage, targetMip: mip }),
      handleFailure: (epoch, error, snapshot) => this.handleFailure(epoch, error, snapshot),
    })
  }

  attachSurface(elements: ImageEditorPresentationSurfaceElementsV3): () => void {
    this.assertUsable()
    const gpuSurface = this.compositor.attach(elements)
    if (gpuSurface) {
      this.gpuPresentation.fallback(() => this.present())
      this.gpuBridge.attachPresentationSurface(gpuSurface)
      if (this.snapshot) this.gpuBridge.requestFrame(this.snapshot.quality)
    }
    this.compositor.updateRuntimeDiagnostics(
      this.cpu.renderPlanCompileCount, this.cpu.taskStartCount,
    )
    this.publish({ surfaceId: elements.surfaceId })
    if (!gpuSurface) this.present()
    return () => {
      this.compositor.detach(elements)
      if (this.state.surfaceId === elements.surfaceId) this.publish({ surfaceId: null })
    }
  }

  updateSnapshot(snapshot: ImageEditorRenderSnapshotV3): void {
    this.assertUsable()
    if (sameImageEditorRenderSnapshotV3(this.snapshot, snapshot)) return
    const previousSnapshot = this.snapshot
    const coalesceDraft = previousSnapshot?.quality === 'draft'
      && snapshot.quality === 'draft'
      && previousSnapshot.geometryHash === snapshot.geometryHash
    this.snapshot = snapshot
    if (previousSnapshot && previousSnapshot.document.id !== snapshot.document.id) {
      this.releaseResults()
      if (!this.cpu.resume()) this.cpu.cancel()
      this.gpuPresentation.fallback(() => this.compositor.resetDocumentFrame())
    }
    this.schedule.reset()
    if (!coalesceDraft && !this.cpu.suspended) {
      this.cpu.cancel()
      if (this.stable || this.backdrop) this.releaseDraft()
    }
    this.publish({
      renderGeneration: snapshot.renderGeneration,
      geometryHash: snapshot.geometryHash,
      rendering: this.cpu.rendering,
      fallbackRequired: this.stable === null && this.draft === null && this.backdrop === null,
      diagnostic: null,
      targetMipCoverage: 0,
      targetMip: null,
      result: this.currentResult(),
    })
    this.gpuBridge.syncSnapshot(snapshot)
    this.clients.warmSource(snapshot.document, snapshot.resourceDescriptors)
    this.present()
    this.scheduleCurrentWork()
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
      if (pending && !this.disposed) this.applyViewport(pending)
    })
  }

  private applyViewport(layout: ImageEditorViewportLayoutV3): void {
    const previous = this.layout
    if (previous?.viewportKey === layout.viewportKey
      && previous.viewport.interacting === layout.viewport.interacting) return
    const timestamp = now()
    const elapsedSeconds = previous ? Math.max(0.001, (timestamp - previous.timestamp) / 1_000) : 1
    this.cameraSequence += 1
    this.layout = {
      ...layout,
      cameraSequence: this.cameraSequence,
      timestamp,
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
    this.gpuBridge.updateViewport(this.cameraSequence, this.layout)
    if (previous && !this.cpu.suspended) {
      this.clients.cancelInteractive()
      this.cpu.removeInteractiveTasks()
    }
    this.publish({ cameraSequence: this.cameraSequence, targetMipCoverage: 0 })
    this.present()
    this.scheduleCurrentWork()
  }

  subscribeDiagnostics(listener: (value: ImageEditorRenderSessionDiagnosticsV3) => void): () => void {
    this.diagnosticsListeners.add(listener)
    listener(this.state)
    return () => this.diagnosticsListeners.delete(listener)
  }

  updateTransientLayerTransform(
    layerId: string,
    transform: ImageEditTransformV3,
    interactionSequence: number,
    eventTimestamp?: number,
  ): void {
    this.assertUsable()
    this.gpuBridge.updateTransientLayerTransform(
      layerId, transform, interactionSequence, eventTimestamp,
    )
  }

  clearTransientLayerTransform(layerId: string, interactionSequence: number): void {
    this.assertUsable()
    this.gpuBridge.clearTransientLayerTransform(layerId, interactionSequence)
  }

  requestFrame(quality: ImageEditRenderQuality): void {
    this.assertUsable()
    this.gpuBridge.requestFrame(quality)
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
    if (!visible) {
      this.cpu.cancel()
      this.schedule.reset()
      this.publish({ rendering: false })
      return
    }
    if (this.snapshot) this.gpuBridge.requestFrame(this.snapshot.quality)
    this.present()
    this.scheduleCurrentWork()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cpu.dispose()
    if (this.cameraFrame !== null) cancelAnimationFrame(this.cameraFrame)
    this.cameraFrame = null
    this.pendingLayout = null
    this.unsubscribeRuntime()
    this.gpuBridge.dispose()
    this.clients.dispose()
    this.compositor.dispose()
    this.releaseResults()
    this.diagnosticsListeners.clear()
    this.stateListeners.clear()
  }

  private scheduleCurrentWork(): void {
    if (this.cpu.suspended || !this.visible || !this.snapshot || !this.layout) return
    const snapshot = this.snapshot
    const layout = this.layout
    this.cpu.prepare(snapshot)
    const epoch = this.cpu.epoch
    this.schedule.schedule({
      epoch,
      snapshot,
      layout,
      stable: this.stable,
      draft: this.draft,
      analysisMip: this.cpu.analysisMip,
      analysisReadyGeneration: this.cpu.analysisReadyGeneration,
      hasReusableClearFrame: this.hasReusableClearFrame(),
      hasTaskPrefix: (prefix) => this.cpu.hasTaskPrefix(prefix),
      publishClearFrame: () => this.publish({
        targetMipCoverage: 1,
        targetMip: this.stable?.mip ?? null,
      }),
      startTask: (token, run) => this.cpu.startTask(token, run),
      renderDraft: async (viewKey) => this.work.renderDraft(
        epoch, snapshot, layout, viewKey,
      ),
      renderAnalysis: async () => this.work.renderAnalysis(
        epoch, snapshot, layout, this.cpu.analysisMip!,
      ),
      renderBackdrop: async () => this.work.renderBackdrop(epoch, snapshot, layout),
      renderTarget: async (viewKey, preferredMip) => this.work.renderTarget(
        epoch, snapshot, layout, viewKey, preferredMip,
      ),
    })
  }

  private acceptDraftResult(result: ImageEditorManagedViewportCompositeV3): void {
    const previousDraft = this.draft
    this.draft = result
    this.present()
    if (previousDraft && previousDraft !== this.stable) previousDraft.release()
    this.publish({
      fallbackRequired: false,
      diagnostic: null,
      result,
      targetMip: result.mip,
    })
    this.scheduleCurrentWork()
  }

  private acceptAnalysisResult(
    result: ImageEditorManagedViewportCompositeV3,
    current: boolean,
  ): void {
    this.replaceBackdrop(result)
    if (current) this.cpu.analysisReadyGeneration = result.renderGeneration
    this.present()
    this.publish({ fallbackRequired: false, result: this.currentResult() })
    this.scheduleCurrentWork()
  }

  private acceptBackdropResult(result: ImageEditorManagedViewportCompositeV3): void {
    this.replaceBackdrop(result)
    this.present()
    this.publish({ fallbackRequired: false, result: this.currentResult() })
  }

  private acceptTargetResult(result: ImageEditorManagedViewportCompositeV3): void {
    const previousStable = this.stable
    const previousDraft = this.draft
    this.stable = result
    this.draft = null
    this.present()
    if (previousStable && previousStable !== result) previousStable.release()
    if (previousDraft && previousDraft !== previousStable) previousDraft.release()
    this.publish({
      fallbackRequired: false,
      diagnostic: null,
      result,
      targetMipCoverage: 1,
      targetMip: result.mip,
    })
    this.scheduleCurrentWork()
  }

  private present(): void {
    if (!this.layout || !this.snapshot) return
    if (this.gpuPresentation.isActive()) return
    const presented = presentImageEditorRenderSessionFrameV3({
      compositor: this.compositor,
      snapshot: this.snapshot,
      layout: this.layout,
      stable: this.stable,
      draft: this.draft,
      backdrop: this.backdrop,
    })
    if (!presented) return
    this.publish({
      ...presented,
      eventToPresentMs: this.snapshot.eventTimestamp === undefined
        ? null
        : Math.max(0, now() - this.snapshot.eventTimestamp),
    })
  }

  private suspendCpuAfterGpuPresentation(): void {
    if (this.cpu.suspend()) {
      this.schedule.reset()
      this.publish({ rendering: false })
    }
    if (!this.snapshot || !this.layout) return
    const documentId = this.snapshot.document.id
    this.cpu.captureSafetyOnce(this.snapshot, this.layout, this.backdrop,
      (result) => {
        if (this.snapshot?.document.id !== documentId) { result.release(); return }
        this.replaceBackdrop(result)
      })
  }

  private resumeCpuFallback(): void {
    if (this.disposed) return
    if (this.cpu.resume()) this.schedule.reset()
    this.gpuPresentation.fallback(() => this.present())
    this.scheduleCurrentWork()
  }

  private handleFailure(
    epoch: number,
    error: unknown,
    snapshot?: ImageEditorRenderSnapshotV3,
  ): void {
    if (this.cpu.suspended || epoch !== this.cpu.epoch
      || (snapshot !== undefined && snapshot !== this.snapshot)
      || error instanceof ImageEditorViewportCompositeSupersededErrorV3
      || error instanceof ImageEditorViewportCompositeDisposedErrorV3) return
    this.publish({
      fallbackRequired: this.stable === null && this.draft === null && this.backdrop === null,
      diagnostic: error instanceof Error ? error.message : String(error),
    })
  }

  private accepts(epoch: number, snapshot: ImageEditorRenderSnapshotV3): boolean {
    return !this.disposed && !this.cpu.suspended && epoch === this.cpu.epoch && this.snapshot === snapshot
  }

  private acceptsView(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionWorkLayoutV3,
    viewKey: string,
  ): boolean {
    return this.accepts(epoch, snapshot)
      && this.layout === layout
      && viewKey === [
        this.cpu.epoch,
        snapshot.renderGeneration,
        layout.cameraSequence,
        layout.viewportKey,
      ].join(':')
  }

  private acceptsSupersededDraft(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
  ): boolean {
    return !this.disposed
      && !this.cpu.suspended
      && epoch === this.cpu.epoch
      && snapshot.quality === 'draft'
      && this.snapshot?.quality === 'draft'
      && snapshot.geometryHash === this.snapshot.geometryHash
  }

  private acceptsSupersededDraftView(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionWorkLayoutV3,
  ): boolean {
    return this.acceptsSupersededDraft(epoch, snapshot)
      && this.layout === layout
  }

  private currentResult(): ImageEditorManagedViewportCompositeV3 | null {
    if (imageEditorRenderResultMatchesViewV3(this.stable, this.snapshot, this.layout)) return this.stable
    if (imageEditorRenderResultMatchesViewV3(this.draft, this.snapshot, this.layout)) return this.draft
    return this.backdrop ?? this.stable ?? this.draft
  }

  private hasReusableClearFrame(): boolean {
    return this.stable !== null
      && this.snapshot !== null
      && this.layout !== null
      && this.stable.renderGeneration === this.snapshot.renderGeneration
      && this.stable.geometryHash === this.snapshot.geometryHash
      && this.stable.mip <= 1
      && imageEditorViewportResultCoverageV3(this.stable, this.layout) >= 0.999_999
  }

  private releaseDraft(): void {
    if (this.draft && this.draft !== this.stable) this.draft.release()
    this.draft = null
  }
  private releaseResults(): void {
    const results = new Set([this.stable, this.draft, this.backdrop])
    this.stable = null
    this.draft = null
    this.backdrop = null
    for (const result of results) result?.release()
  }
  private replaceBackdrop(result: ImageEditorManagedViewportCompositeV3): void {
    const previous = this.backdrop
    this.backdrop = result
    if (previous && previous !== this.stable && previous !== this.draft) previous.release()
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
