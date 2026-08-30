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
        // 有序图层链中的局部效果会逐级扩大依赖范围；第二个模糊必须基于第一个
        // 已扩大的 dirty 区继续增加 halo，而不是永远只和最初区域取并集。
        dirtyRect = expandRect(dirtyRect, halo);
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
