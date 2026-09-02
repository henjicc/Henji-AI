import type { ImageEditorViewportCompositeRuntimeEventV3 } from './viewportCompositeProtocolV3'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import { ImageEditorViewportCompositeClientV3 } from './viewportCompositeClientV3'
import { ImageEditorSourcePyramidWarmupV3 } from './imageEditorSourcePyramidWarmupV3'
import {
  acquireImageEditorSessionResourceBudgetV3,
  type ImageEditorSessionResourceBudgetLeaseV3,
} from './imageEditorSessionResourceBudgetV3'
import type {
  ImageEditorManagedViewportCompositeV3,
  ImageEditorViewportCompositeClientOptionsV3,
  ImageEditorViewportCompositeRequestV3,
  ImageEditorViewportRuntimeListenerV3,
} from './viewportCompositeTypesV3'
import { ImageEditorViewportTileCacheV3 } from './viewportTileCacheV3'
import { ImageEditorViewportTileSchedulerV3 } from './viewportTileSchedulerV3'

export interface ImageEditorRenderClientV3 {
  render(request: ImageEditorViewportCompositeRequestV3): Promise<ImageEditorManagedViewportCompositeV3>
  cancel(): void
  dispose(): void
  subscribeRuntime?(listener: ImageEditorViewportRuntimeListenerV3): () => void
}

export interface ImageEditorRenderSessionClientDependenciesV3 {
  /** 测试或定制宿主可注入同一客户端；生产环境始终使用三个独立任务通道。 */
  client?: ImageEditorRenderClientV3
  clients?: {
    draft: ImageEditorRenderClientV3
    target: ImageEditorRenderClientV3
    analysis: ImageEditorRenderClientV3
  }
}

export interface ImageEditorRenderSessionClientLanesV3 {
  draft: ImageEditorRenderClientV3
  target: ImageEditorRenderClientV3
  analysis: ImageEditorRenderClientV3
  warmSource(
    document: ImageEditDocumentV3,
    descriptors: readonly ImageEditorV3ResourceDescriptor[],
  ): void
  cancelInteractive(): void
  cancelAll(): void
  subscribeRuntime(listener: (event: ImageEditorViewportCompositeRuntimeEventV3) => void): () => void
  dispose(): void
}

let renderSessionClientSequence = 0

function uniqueClients(
  lanes: Pick<ImageEditorRenderSessionClientLanesV3, 'draft' | 'target' | 'analysis'>,
): ImageEditorRenderClientV3[] {
  return [...new Set([lanes.draft, lanes.target, lanes.analysis])]
}

export function createImageEditorRenderSessionClientLanesV3(
  options: ImageEditorViewportCompositeClientOptionsV3,
  dependencies: ImageEditorRenderSessionClientDependenciesV3,
): ImageEditorRenderSessionClientLanesV3 {
  let budgetLease: ImageEditorSessionResourceBudgetLeaseV3 | null = null
  let sharedSourceCache: ImageEditorViewportTileCacheV3 | null = null
  const sourceWarmup = dependencies.client || dependencies.clients
    ? null
    : new ImageEditorSourcePyramidWarmupV3()
  let lanes: Pick<ImageEditorRenderSessionClientLanesV3, 'draft' | 'target' | 'analysis'>
  if (dependencies.clients) {
    lanes = dependencies.clients
  } else if (dependencies.client) {
    lanes = {
      draft: dependencies.client,
      target: dependencies.client,
      analysis: dependencies.client,
    }
  } else {
    budgetLease = options.resourceBudget
      ? null
      : acquireImageEditorSessionResourceBudgetV3(options.sessionId, {
          consumerId: options.resourceBudgetConsumerId
            ?? `render-session:${++renderSessionClientSequence}`,
        })
    const resourceBudget = options.resourceBudget ?? budgetLease!.budget
    sharedSourceCache = new ImageEditorViewportTileCacheV3({ resourceBudget })
    const clientOptions = (lane: 'draft' | 'target' | 'analysis') => ({
      ...options,
      sessionId: `${options.sessionId}:${lane}`,
      resourceBudget,
      resourceBudgetConsumerId: undefined,
      scheduler: new ImageEditorViewportTileSchedulerV3({
        sessionId: `${options.sessionId}:${lane}:source`,
        cache: sharedSourceCache!,
        disposeCache: false,
      }),
    })
    lanes = {
      draft: new ImageEditorViewportCompositeClientV3(clientOptions('draft')),
      target: new ImageEditorViewportCompositeClientV3(clientOptions('target')),
      analysis: new ImageEditorViewportCompositeClientV3(clientOptions('analysis')),
    }
  }
  const clients = uniqueClients(lanes)
  return {
    ...lanes,
    warmSource: (document, descriptors) => sourceWarmup?.warm(document, descriptors),
    cancelInteractive: () => {
      for (const client of new Set([lanes.draft, lanes.target])) client.cancel()
    },
    cancelAll: () => {
      for (const client of clients) client.cancel()
    },
    subscribeRuntime: (listener) => {
      const unsubscribes = clients.map((client) => client.subscribeRuntime?.(listener))
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe?.()
      }
    },
    dispose: () => {
      for (const client of clients) client.dispose()
      sharedSourceCache?.dispose()
      sharedSourceCache = null
      sourceWarmup?.dispose()
      budgetLease?.release()
      budgetLease = null
    },
  }
}
