import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  imageEditOutputSizeV3,
} from '@/core/imageEdit/v3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import {
  ImageEditorPresentationSurfaceV3,
  imageEditorViewportResultCoverageV3,
  imageEditorViewportTileCoverageContributionV3,
  type ImageEditorPresentationSurfaceElementsV3,
} from './imageEditorPresentationSurfaceV3'
import {
  createImageEditorRenderSessionClientLanesV3,
  type ImageEditorRenderSessionClientLanesV3,
} from './imageEditorRenderSessionClientsV3'
import type {
  ImageEditorRenderSessionDependenciesV3,
  ImageEditorRenderSessionDiagnosticsV3,
  ImageEditorRenderSessionStateV3,
  ImageEditorRenderSessionV3,
  ImageEditorRenderSnapshotV3,
} from './imageEditorRenderSessionContractsV3'
import {
  imageEditorRenderResultMatchesViewV3,
  sameImageEditorRenderSnapshotV3,
} from './imageEditorRenderSessionIdentityV3'
import { logImageEditorRenderSessionPhaseV3 } from './imageEditorRenderSessionLoggingV3'
import { presentImageEditorRenderSessionFrameV3 } from './imageEditorRenderSessionPresentationV3'
import {
  createImageEditorAnalysisRequestV3,
  createImageEditorBackdropRequestV3,
  createImageEditorDraftRequestV3,
  createImageEditorTargetRequestV3,
} from './imageEditorRenderSessionRequestsV3'
import {
  ImageEditorViewportCompositeDisposedErrorV3,
  ImageEditorViewportCompositeSupersededErrorV3,
} from './viewportCompositeClientV3'
import type {
  ImageEditorManagedViewportCompositeV3,
  ImageEditorViewportCompositeClientOptionsV3,
} from './viewportCompositeTypesV3'
import { resolveImageEditorViewportAnalysisMipV3 } from './viewportGlobalAnalysisV3'
import { imageEditorRenderRuntimePatchV3 } from './imageEditorRenderRuntimeV3'

const registry = createBuiltInImageEditRenderNodeRegistry()

export type {
  ImageEditorRenderSessionDependenciesV3,
  ImageEditorRenderSessionDiagnosticsV3,
  ImageEditorRenderSessionStateV3,
  ImageEditorRenderSessionV3,
  ImageEditorRenderSnapshotV3,
} from './imageEditorRenderSessionContractsV3'

type ImageEditorRenderSessionLayoutV3 = ImageEditorViewportLayoutV3 & {
  cameraSequence: number
  timestamp: number
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export class DefaultImageEditorRenderSessionV3 implements ImageEditorRenderSessionV3 {
  private readonly clients: ImageEditorRenderSessionClientLanesV3
  private readonly compositor = new ImageEditorPresentationSurfaceV3()
  private readonly diagnosticsListeners = new Set<(value: ImageEditorRenderSessionDiagnosticsV3) => void>()
  private readonly stateListeners = new Set<(value: ImageEditorRenderSessionStateV3) => void>()
  private readonly inFlightTasks = new Set<string>()
  private snapshot: ImageEditorRenderSnapshotV3 | null = null
  private layout: ImageEditorRenderSessionLayoutV3 | null = null
  private stable: ImageEditorManagedViewportCompositeV3 | null = null
  private draft: ImageEditorManagedViewportCompositeV3 | null = null
  private backdrop: ImageEditorManagedViewportCompositeV3 | null = null
  private state: ImageEditorRenderSessionStateV3
  private epoch = 0
  private cameraSequence = 0
  private analysisMip: number | null = null
  private analysisReadyGeneration: number | null = null
  private analysisScheduledGeneration: number | null = null
  private backdropScheduledEpoch: number | null = null
  private draftScheduledKey: string | null = null
  private targetScheduledKey: string | null = null
  private refinementScheduledKey: string | null = null
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
    this.state = {
      surfaceId: null, renderGeneration: 0, geometryHash: '', cameraSequence: 0,
      coverage: 0, targetMipCoverage: 0, targetMip: null, eventToPresentMs: null,
      renderBackend: 'cpu', deviceStatus: 'idle', deviceGeneration: 0,
      rendering: false, fallbackRequired: false, diagnostic: null, result: null,
    }
    this.unsubscribeRuntime = this.clients.subscribeRuntime((event) => {
      if (event.renderGeneration !== this.snapshot?.renderGeneration) return
      this.publish(imageEditorRenderRuntimePatchV3(event, this.state.diagnostic))
    })
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
    if (sameImageEditorRenderSnapshotV3(this.snapshot, snapshot)) return
    const previousSnapshot = this.snapshot
    const coalesceDraft = previousSnapshot?.quality === 'draft'
      && snapshot.quality === 'draft'
      && previousSnapshot.geometryHash === snapshot.geometryHash
    this.snapshot = snapshot
    const plan = compileImageEditRenderPlanV3(snapshot.document, registry, snapshot.quality)
    this.analysisMip = resolveImageEditorViewportAnalysisMipV3(
      snapshot.document, plan, snapshot.quality,
    )
    this.analysisReadyGeneration = this.analysisMip === null ? snapshot.renderGeneration : null
    this.analysisScheduledGeneration = null
    this.backdropScheduledEpoch = null
    this.draftScheduledKey = null
    this.targetScheduledKey = null
    this.refinementScheduledKey = null
    if (!coalesceDraft) {
      this.epoch += 1
      this.clients.cancelAll()
      this.inFlightTasks.clear()
      if (this.stable || this.backdrop) this.releaseDraft()
    }
    this.publish({
      renderGeneration: snapshot.renderGeneration,
      geometryHash: snapshot.geometryHash,
      rendering: this.inFlightTasks.size > 0,
      fallbackRequired: this.stable === null && this.draft === null && this.backdrop === null,
      diagnostic: null,
      targetMipCoverage: 0,
      targetMip: null,
      result: this.currentResult(),
    })
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
    if (previous) {
      this.clients.cancelInteractive()
      this.removeInteractiveTasks()
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
      this.clients.cancelAll()
      this.inFlightTasks.clear()
      this.draftScheduledKey = this.targetScheduledKey = null
      this.refinementScheduledKey = null
      this.analysisScheduledGeneration = this.backdropScheduledEpoch = null
      this.publish({ rendering: false })
      return
    }
    this.present()
    this.scheduleCurrentWork()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.epoch += 1
    if (this.cameraFrame !== null) cancelAnimationFrame(this.cameraFrame)
    this.cameraFrame = null
    this.pendingLayout = null
    this.unsubscribeRuntime()
    this.clients.dispose()
    this.compositor.dispose()
    this.releaseResults()
    this.diagnosticsListeners.clear()
    this.stateListeners.clear()
  }

  private scheduleCurrentWork(): void {
    if (!this.visible || !this.snapshot || !this.layout) return
    if (this.hasReusableClearFrame()) {
      this.publish({ targetMipCoverage: 1, targetMip: this.stable?.mip ?? null })
      return
    }
    const viewKey = [
      this.epoch,
      this.snapshot.renderGeneration,
      this.layout.cameraSequence,
      this.layout.viewportKey,
    ].join(':')
    // 大半径模糊、扩散和辉光必须先建立整图共享分析。分析未完成时按视口瓦片
    // 计算草稿会让每个 512px 分区得到不同结果，形成肉眼可见的接缝和色块。
    if (this.analysisMip === null
      && this.draftScheduledKey !== viewKey
      && !this.hasTaskPrefix('draft:')
      && !imageEditorRenderResultMatchesViewV3(this.stable, this.snapshot, this.layout)) {
      this.draftScheduledKey = viewKey
      this.startTask(`draft:${viewKey}`, () => this.renderDraft(
        this.epoch, this.snapshot!, this.layout!, viewKey,
      ))
    }
    if (this.analysisReadyGeneration !== this.snapshot.renderGeneration
      && this.analysisScheduledGeneration !== this.snapshot.renderGeneration
      && !this.hasTaskPrefix('analysis:')) {
      this.analysisScheduledGeneration = this.snapshot.renderGeneration
      this.startTask(`analysis:${this.epoch}:${this.snapshot.renderGeneration}`, () => this.renderAnalysis(
        this.epoch, this.snapshot!, this.layout!,
      ))
    }
    const hasCurrentViewportFrame = imageEditorRenderResultMatchesViewV3(
      this.draft ?? this.stable, this.snapshot, this.layout,
    )
    if (this.snapshot.quality === 'stable'
      && this.analysisMip === null
      && hasCurrentViewportFrame
      && this.backdropScheduledEpoch !== this.epoch) {
      this.backdropScheduledEpoch = this.epoch
      this.startTask(`backdrop:${this.epoch}`, () => this.renderBackdrop(
        this.epoch, this.snapshot!, this.layout!,
      ))
    }
    if (this.snapshot.quality === 'stable'
      && this.analysisReadyGeneration === this.snapshot.renderGeneration
      && this.targetScheduledKey !== viewKey
      && !this.hasTaskPrefix('target:')
      && !imageEditorRenderResultMatchesViewV3(this.stable, this.snapshot, this.layout)) {
      this.targetScheduledKey = viewKey
      this.startTask(`target:${viewKey}`, () => this.renderTarget(
        this.epoch, this.snapshot!, this.layout!, viewKey,
      ))
    }
    const refinementKey = `${viewKey}:${Math.max(0, (this.stable?.mip ?? 1) - 1)}`
    if (this.snapshot.quality === 'stable'
      && this.layout.viewport.interacting !== true
      && this.analysisReadyGeneration === this.snapshot.renderGeneration
      && imageEditorRenderResultMatchesViewV3(this.stable, this.snapshot, this.layout)
      && (this.stable?.mip ?? 0) > 1
      && this.refinementScheduledKey !== refinementKey
      && !this.hasTaskPrefix('target:')) {
      this.refinementScheduledKey = refinementKey
      const preferredMip = this.stable!.mip - 1
      this.startTask(`target:refine:${refinementKey}`, () => this.renderTarget(
        this.epoch, this.snapshot!, this.layout!, viewKey, preferredMip,
      ))
    }
  }

  private async renderDraft(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionLayoutV3,
    viewKey: string,
  ): Promise<void> {
    const startedAt = now()
    try {
      const result = await this.clients.draft.render(createImageEditorDraftRequestV3(snapshot, layout))
      const acceptsCurrent = this.acceptsView(epoch, snapshot, layout, viewKey)
      if (!acceptsCurrent && !this.acceptsSupersededDraftView(epoch, snapshot, layout)) {
        result.release()
        return
      }
      if (acceptsCurrent && imageEditorRenderResultMatchesViewV3(this.stable, snapshot, layout)) {
        result.release()
        return
      }
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
      logImageEditorRenderSessionPhaseV3('draft', snapshot, layout.cameraSequence, startedAt, now(), result.mip)
      this.scheduleCurrentWork()
    } catch (error) {
      this.handleFailure(epoch, error, snapshot)
    }
  }

  private async renderAnalysis(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionLayoutV3,
  ): Promise<void> {
    if (this.analysisMip === null) return
    const startedAt = now()
    try {
      const result = await this.clients.analysis.render(createImageEditorAnalysisRequestV3(
        snapshot, layout, this.analysisMip,
      ))
      const acceptsCurrent = this.accepts(epoch, snapshot)
      if (!acceptsCurrent && !this.acceptsSupersededDraft(epoch, snapshot)) {
        result.release()
        return
      }
      this.replaceBackdrop(result)
      if (acceptsCurrent) this.analysisReadyGeneration = snapshot.renderGeneration
      this.present()
      this.publish({ fallbackRequired: false, result: this.currentResult() })
      logImageEditorRenderSessionPhaseV3('analysis', snapshot, layout.cameraSequence, startedAt, now(), this.analysisMip)
      this.scheduleCurrentWork()
    } catch (error) {
      this.handleFailure(epoch, error, snapshot)
    }
  }

  private async renderBackdrop(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionLayoutV3,
  ): Promise<void> {
    const startedAt = now()
    try {
      const result = await this.clients.analysis.render(createImageEditorBackdropRequestV3(
        snapshot, layout,
      ))
      if (!this.accepts(epoch, snapshot)) {
        result.release()
        return
      }
      this.replaceBackdrop(result)
      this.present()
      this.publish({ fallbackRequired: false, result: this.currentResult() })
      logImageEditorRenderSessionPhaseV3('backdrop', snapshot, layout.cameraSequence, startedAt, now(), result.mip)
    } catch (error) {
      this.handleFailure(epoch, error, snapshot)
    }
  }

  private async renderTarget(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionLayoutV3,
    viewKey: string,
    preferredMip?: number,
  ): Promise<void> {
    const startedAt = now()
    let progressiveCoverage = 0
    try {
      const result = await this.clients.target.render({
        ...createImageEditorTargetRequestV3(snapshot, layout, this.stable?.mip),
        ...(preferredMip === undefined ? {} : { preferredMip }),
        onTileReady: (progress) => {
          if (!this.acceptsView(epoch, snapshot, layout, viewKey)) return
          progressiveCoverage = Math.min(1, progressiveCoverage
            + imageEditorViewportTileCoverageContributionV3(
              progress.tile,
              progress.mip,
              imageEditOutputSizeV3(snapshot.document.geometry),
              layout,
            ))
          this.publish({ targetMipCoverage: progressiveCoverage, targetMip: progress.mip })
        },
      })
      if (!this.acceptsView(epoch, snapshot, layout, viewKey)) {
        result.release()
        return
      }
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
      logImageEditorRenderSessionPhaseV3('target', snapshot, layout.cameraSequence, startedAt, now(), result.mip)
      this.scheduleCurrentWork()
    } catch (error) {
      this.handleFailure(epoch, error, snapshot)
    }
  }

  private present(): void {
    if (!this.layout || !this.snapshot) return
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

  private startTask(token: string, run: () => Promise<void>): void {
    this.inFlightTasks.add(token)
    this.publish({ rendering: true })
    void run().finally(() => {
      this.inFlightTasks.delete(token)
      this.publish({ rendering: this.inFlightTasks.size > 0 })
      this.scheduleCurrentWork()
    })
  }

  private removeInteractiveTasks(): void {
    for (const token of [...this.inFlightTasks]) {
      if (token.startsWith('draft:') || token.startsWith('target:')) this.inFlightTasks.delete(token)
    }
  }

  private hasTaskPrefix(prefix: string): boolean {
    for (const token of this.inFlightTasks) {
      if (token.startsWith(prefix)) return true
    }
    return false
  }

  private handleFailure(
    epoch: number,
    error: unknown,
    snapshot?: ImageEditorRenderSnapshotV3,
  ): void {
    if (epoch !== this.epoch
      || (snapshot !== undefined && snapshot !== this.snapshot)
      || error instanceof ImageEditorViewportCompositeSupersededErrorV3
      || error instanceof ImageEditorViewportCompositeDisposedErrorV3) return
    this.publish({
      fallbackRequired: this.stable === null && this.draft === null && this.backdrop === null,
      diagnostic: error instanceof Error ? error.message : String(error),
    })
  }

  private accepts(epoch: number, snapshot: ImageEditorRenderSnapshotV3): boolean {
    return !this.disposed && epoch === this.epoch && this.snapshot === snapshot
  }

  private acceptsView(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionLayoutV3,
    viewKey: string,
  ): boolean {
    return this.accepts(epoch, snapshot)
      && this.layout === layout
      && viewKey === [
        this.epoch,
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
      && epoch === this.epoch
      && snapshot.quality === 'draft'
      && this.snapshot?.quality === 'draft'
      && snapshot.geometryHash === this.snapshot.geometryHash
  }

  private acceptsSupersededDraftView(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionLayoutV3,
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
