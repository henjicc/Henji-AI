import type { ImageEditRect } from './tileGeometry';
import type { ImageEditRenderPlan, ImageEditRenderPlanNode } from './renderPlan';
import type { ImageEditRenderNodeRegistry } from './renderNodeDefinition';

export type ImageEditInvalidationCause =
  | { kind: 'content'; layerId: string; dirtyRect: ImageEditRect; mip: number }
  | { kind: 'parameters'; layerId: string; dirtyRect: ImageEditRect; mip: number }
  | { kind: 'reorder'; layerId: string }
  | { kind: 'crop' };

export interface ImageEditInvalidationResult {
  invalidatedNodeIds: readonly string[];
  dirtyRect: ImageEditRect | null;
  invalidatedAnalysisNodeIds: readonly string[];
  retainedUnderlyingCaches: boolean;
}

function nodeIdentity(node: ImageEditRenderPlanNode): string {
  return `${node.layerId}:${node.definitionId}`;
}

function expandRect(rect: ImageEditRect, halo: number): ImageEditRect {
  return {
    x: rect.x - halo,
    y: rect.y - halo,
    width: rect.width + halo * 2,
    height: rect.height + halo * 2,
  };
}

function unionRect(left: ImageEditRect, right: ImageEditRect): ImageEditRect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

export function computeImageEditPlanInvalidationV3(
  previous: ImageEditRenderPlan,
  next: ImageEditRenderPlan,
  cause: ImageEditInvalidationCause,
  registry: ImageEditRenderNodeRegistry,
): ImageEditInvalidationResult {
  if (cause.kind === 'crop') {
    return {
      invalidatedNodeIds: [],
      dirtyRect: null,
      invalidatedAnalysisNodeIds: [],
      retainedUnderlyingCaches: true,
    };
  }
  const previousHashes = new Map(previous.nodes.map((node) => [nodeIdentity(node), node.subtreeHash]));
  const changedNodes = next.nodes.filter((node) => (
    previousHashes.get(nodeIdentity(node)) !== node.subtreeHash
  ));
  const invalidatedNodeIds = changedNodes.map((node) => node.id);
  const analysisNodeIds: string[] = [];
  const localCause = cause.kind === 'content' || cause.kind === 'parameters' ? cause : null;
  let dirtyRect = localCause?.dirtyRect ?? null;

  if (dirtyRect) {
    for (const node of changedNodes) {
      const definition = registry.get(node.definitionId);
      if (definition?.category === 'global-analysis') analysisNodeIds.push(node.id);
      if (definition?.localHalo && localCause) {
        const halo = definition.localHalo(node.parameters, localCause.mip);
        dirtyRect = unionRect(dirtyRect, expandRect(localCause.dirtyRect, halo));
      }
    }
  } else {
    for (const node of changedNodes) {
      if (registry.get(node.definitionId)?.category === 'global-analysis') analysisNodeIds.push(node.id);
    }
  }

  return {
    invalidatedNodeIds,
    dirtyRect,
    invalidatedAnalysisNodeIds: analysisNodeIds,
    retainedUnderlyingCaches: true,
  };
}
