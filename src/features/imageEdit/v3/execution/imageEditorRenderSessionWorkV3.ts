import { imageEditOutputSizeV3 } from '@/core/imageEdit/v3'
import {
  imageEditorViewportTileCoverageContributionV3,
} from './imageEditorPresentationSurfaceV3'
import { imageEditorRenderResultMatchesViewV3 } from './imageEditorRenderSessionIdentityV3'
import { logImageEditorRenderSessionPhaseV3 } from './imageEditorRenderSessionLoggingV3'
import {
  createImageEditorAnalysisRequestV3,
  createImageEditorBackdropRequestV3,
  createImageEditorDraftRequestV3,
  createImageEditorTargetRequestV3,
} from './imageEditorRenderSessionRequestsV3'
import type {
  ImageEditorRenderSnapshotV3,
} from './imageEditorRenderSessionContractsV3'
import type { ImageEditorRenderSessionClientLanesV3 } from './imageEditorRenderSessionClientsV3'
import type {
  ImageEditorManagedViewportCompositeV3,
} from './viewportCompositeTypesV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'

export type ImageEditorRenderSessionWorkLayoutV3 = ImageEditorViewportLayoutV3 & {
  cameraSequence: number
  timestamp: number
}

interface ImageEditorRenderSessionWorkDependenciesV3 {
  clients: ImageEditorRenderSessionClientLanesV3
  getStable(): ImageEditorManagedViewportCompositeV3 | null
  accepts(epoch: number, snapshot: ImageEditorRenderSnapshotV3): boolean
  acceptsView(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionWorkLayoutV3,
    viewKey: string,
  ): boolean
  acceptsSupersededDraft(epoch: number, snapshot: ImageEditorRenderSnapshotV3): boolean
  acceptsSupersededDraftView(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionWorkLayoutV3,
  ): boolean
  acceptDraft(result: ImageEditorManagedViewportCompositeV3): void
  acceptAnalysis(result: ImageEditorManagedViewportCompositeV3, current: boolean): void
  acceptBackdrop(result: ImageEditorManagedViewportCompositeV3): void
  acceptTarget(result: ImageEditorManagedViewportCompositeV3): void
  publishTargetProgress(coverage: number, mip: number): void
  handleFailure(epoch: number, error: unknown, snapshot: ImageEditorRenderSnapshotV3): void
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export class ImageEditorRenderSessionWorkV3 {
  constructor(private readonly dependencies: ImageEditorRenderSessionWorkDependenciesV3) {}

  async renderDraft(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionWorkLayoutV3,
    viewKey: string,
  ): Promise<void> {
    const startedAt = now()
    try {
      const result = await this.dependencies.clients.draft.render(
        createImageEditorDraftRequestV3(snapshot, layout),
      )
      const acceptsCurrent = this.dependencies.acceptsView(epoch, snapshot, layout, viewKey)
      if (!acceptsCurrent
        && !this.dependencies.acceptsSupersededDraftView(epoch, snapshot, layout)) {
        result.release()
        return
      }
      if (acceptsCurrent
        && imageEditorRenderResultMatchesViewV3(this.dependencies.getStable(), snapshot, layout)) {
        result.release()
        return
      }
      this.dependencies.acceptDraft(result)
      logImageEditorRenderSessionPhaseV3(
        'draft', snapshot, layout.cameraSequence, startedAt, now(), result.mip,
      )
    } catch (error) {
      this.dependencies.handleFailure(epoch, error, snapshot)
    }
  }

  async renderAnalysis(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionWorkLayoutV3,
    analysisMip: number,
  ): Promise<void> {
    const startedAt = now()
    try {
      const result = await this.dependencies.clients.analysis.render(
        createImageEditorAnalysisRequestV3(snapshot, layout, analysisMip),
      )
      const acceptsCurrent = this.dependencies.accepts(epoch, snapshot)
      if (!acceptsCurrent && !this.dependencies.acceptsSupersededDraft(epoch, snapshot)) {
        result.release()
        return
      }
      this.dependencies.acceptAnalysis(result, acceptsCurrent)
      logImageEditorRenderSessionPhaseV3(
        'analysis', snapshot, layout.cameraSequence, startedAt, now(), analysisMip,
      )
    } catch (error) {
      this.dependencies.handleFailure(epoch, error, snapshot)
    }
  }

  async renderBackdrop(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionWorkLayoutV3,
  ): Promise<void> {
    const startedAt = now()
    try {
      const result = await this.dependencies.clients.analysis.render(
        createImageEditorBackdropRequestV3(snapshot, layout),
      )
      if (!this.dependencies.accepts(epoch, snapshot)) {
        result.release()
        return
      }
      this.dependencies.acceptBackdrop(result)
      logImageEditorRenderSessionPhaseV3(
        'backdrop', snapshot, layout.cameraSequence, startedAt, now(), result.mip,
      )
    } catch (error) {
      this.dependencies.handleFailure(epoch, error, snapshot)
    }
  }

  async renderTarget(
    epoch: number,
    snapshot: ImageEditorRenderSnapshotV3,
    layout: ImageEditorRenderSessionWorkLayoutV3,
    viewKey: string,
    preferredMip?: number,
  ): Promise<void> {
    const startedAt = now()
    let progressiveCoverage = 0
    try {
      const result = await this.dependencies.clients.target.render({
        ...createImageEditorTargetRequestV3(
          snapshot,
          layout,
          this.dependencies.getStable()?.mip,
        ),
        ...(preferredMip === undefined ? {} : { preferredMip }),
        onTileReady: (progress) => {
          if (!this.dependencies.acceptsView(epoch, snapshot, layout, viewKey)) return
          progressiveCoverage = Math.min(1, progressiveCoverage
            + imageEditorViewportTileCoverageContributionV3(
              progress.tile,
              progress.mip,
              imageEditOutputSizeV3(snapshot.document.geometry),
              layout,
            ))
          this.dependencies.publishTargetProgress(progressiveCoverage, progress.mip)
        },
      })
      if (!this.dependencies.acceptsView(epoch, snapshot, layout, viewKey)) {
        result.release()
        return
      }
      this.dependencies.acceptTarget(result)
      logImageEditorRenderSessionPhaseV3(
        'target', snapshot, layout.cameraSequence, startedAt, now(), result.mip,
      )
    } catch (error) {
      this.dependencies.handleFailure(epoch, error, snapshot)
    }
  }
}
