import { imageEditorRenderResultMatchesViewV3 } from './imageEditorRenderSessionIdentityV3'
import type { ImageEditorRenderSnapshotV3 } from './imageEditorRenderSessionContractsV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'
import type { ImageEditorRenderSessionWorkLayoutV3 } from './imageEditorRenderSessionWorkV3'

interface ImageEditorRenderSessionScheduleOptionsV3 {
  epoch: number
  snapshot: ImageEditorRenderSnapshotV3
  layout: ImageEditorRenderSessionWorkLayoutV3
  stable: ImageEditorManagedViewportCompositeV3 | null
  draft: ImageEditorManagedViewportCompositeV3 | null
  analysisMip: number | null
  analysisReadyGeneration: number | null
  hasReusableClearFrame: boolean
  hasTaskPrefix(prefix: string): boolean
  publishClearFrame(): void
  startTask(token: string, run: () => Promise<void>): void
  renderDraft(viewKey: string): Promise<void>
  renderAnalysis(): Promise<void>
  renderBackdrop(): Promise<void>
  renderTarget(viewKey: string, preferredMip?: number): Promise<void>
}

export class ImageEditorRenderSessionScheduleV3 {
  private analysisScheduledGeneration: number | null = null
  private backdropScheduledEpoch: number | null = null
  private draftScheduledKey: string | null = null
  private targetScheduledKey: string | null = null
  private refinementScheduledKey: string | null = null

  reset(): void {
    this.analysisScheduledGeneration = null
    this.backdropScheduledEpoch = null
    this.draftScheduledKey = null
    this.targetScheduledKey = null
    this.refinementScheduledKey = null
  }

  schedule(options: ImageEditorRenderSessionScheduleOptionsV3): void {
    if (options.hasReusableClearFrame) {
      options.publishClearFrame()
      return
    }
    const viewKey = [
      options.epoch,
      options.snapshot.renderGeneration,
      options.layout.cameraSequence,
      options.layout.viewportKey,
    ].join(':')
    if (options.analysisMip === null
      && this.draftScheduledKey !== viewKey
      && !options.hasTaskPrefix('draft:')
      && !imageEditorRenderResultMatchesViewV3(
        options.stable,
        options.snapshot,
        options.layout,
      )) {
      this.draftScheduledKey = viewKey
      options.startTask(`draft:${viewKey}`, () => options.renderDraft(viewKey))
    }
    if (options.analysisReadyGeneration !== options.snapshot.renderGeneration
      && this.analysisScheduledGeneration !== options.snapshot.renderGeneration
      && !options.hasTaskPrefix('analysis:')) {
      this.analysisScheduledGeneration = options.snapshot.renderGeneration
      options.startTask(
        `analysis:${options.epoch}:${options.snapshot.renderGeneration}`,
        options.renderAnalysis,
      )
    }
    const hasCurrentViewportFrame = imageEditorRenderResultMatchesViewV3(
      options.draft ?? options.stable,
      options.snapshot,
      options.layout,
    )
    if (options.snapshot.quality === 'stable'
      && options.analysisMip === null
      && hasCurrentViewportFrame
      && this.backdropScheduledEpoch !== options.epoch) {
      this.backdropScheduledEpoch = options.epoch
      options.startTask(`backdrop:${options.epoch}`, options.renderBackdrop)
    }
    if (options.snapshot.quality === 'stable'
      && options.analysisReadyGeneration === options.snapshot.renderGeneration
      && this.targetScheduledKey !== viewKey
      && !options.hasTaskPrefix('target:')
      && !imageEditorRenderResultMatchesViewV3(
        options.stable,
        options.snapshot,
        options.layout,
      )) {
      this.targetScheduledKey = viewKey
      options.startTask(`target:${viewKey}`, () => options.renderTarget(viewKey))
    }
    const preferredMip = (options.stable?.mip ?? 1) - 1
    const refinementKey = `${viewKey}:${Math.max(0, preferredMip)}`
    if (options.snapshot.quality === 'stable'
      && options.layout.viewport.interacting !== true
      && options.analysisReadyGeneration === options.snapshot.renderGeneration
      && imageEditorRenderResultMatchesViewV3(options.stable, options.snapshot, options.layout)
      && (options.stable?.mip ?? 0) > 1
      && this.refinementScheduledKey !== refinementKey
      && !options.hasTaskPrefix('target:')) {
      this.refinementScheduledKey = refinementKey
      options.startTask(
        `target:refine:${refinementKey}`,
        () => options.renderTarget(viewKey, preferredMip),
      )
    }
  }
}
