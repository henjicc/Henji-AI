import { isCanvasNodeUnavailable } from '../domain/nodeAvailability';
import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes';
import { isAssetGroupNode } from '../domain/canvasNodes';
import { summarizeAssetGroupBinding } from './assetGroupGraph';

export interface AssetGroupRenderGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * 素材组在画布上始终保持折叠投影；成员管理由独立工作面完成。
 * store 仍保存真实成员边，项目数据和 Undo 不记录管理工作面的打开状态。
 */
export function createAssetGroupRenderGraph(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): AssetGroupRenderGraph {
  nodes = projectUnavailableNodes(nodes);
  const assetGroups = nodes.filter(isAssetGroupNode);
  // 普通画布拖动只改变 nodes；保留原 edges 引用，避免让 ReactFlow 重建连线状态。
  if (assetGroups.length === 0) return { nodes, edges };
  const groupIds = new Set(assetGroups.map((group) => group.id));
  const renderNodes = nodes.map((node) => {
    if (!node.parentId || !groupIds.has(node.parentId)) return node;
    return { ...node, hidden: true };
  });

  const hiddenBindingIds = new Set<string>();
  const bundleEdges: CanvasEdge[] = [];
  for (const group of assetGroups) {
    for (const binding of group.data.bindings) {
      hiddenBindingIds.add(binding.id);
      const status = summarizeAssetGroupBinding(nodes, edges, group.id, binding);
      const targetHandle = Object.values(binding.targetPortByKind).find(Boolean) ?? 'target';
      bundleEdges.push({
        id: `asset-group-bundle:${binding.id}`,
        source: group.id,
        target: binding.targetNodeId,
        sourceHandle: 'source',
        targetHandle,
        type: 'assetGroupBundleEdge',
        selectable: true,
        data: {
          assetGroupBundle: {
            groupId: group.id,
            bindingId: binding.id,
            targetNodeId: binding.targetNodeId,
            ...status,
          },
        },
      });
    }
  }

  return {
    nodes: renderNodes,
    edges: [
      ...edges.filter((edge) => {
        const bindingId = edge.data?.managedByAssetGroup?.bindingId;
        return !bindingId || !hiddenBindingIds.has(bindingId);
      }),
      ...bundleEdges,
    ],
  };
}

const missingProjectionCache = new WeakMap<CanvasNode, CanvasNode>();
function projectUnavailableNodes(nodes: CanvasNode[]): CanvasNode[] {
  let changed = false;
  const projected = nodes.map((node) => {
    if (!isCanvasNodeUnavailable(node)) return node;
    changed = true;
    let projectedNode = missingProjectionCache.get(node);
    if (!projectedNode) {
      projectedNode = { ...node, type: 'missingNode' as CanvasNode['type'] };
      missingProjectionCache.set(node, projectedNode);
    }
    return projectedNode;
  });
  return changed ? projected : nodes;
}
