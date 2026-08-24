import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes';
import { isAssetGroupNode } from '../domain/canvasNodes';
import { summarizeAssetGroupBinding } from './assetGroupGraph';

export interface AssetGroupRenderGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * 素材组的折叠/展开仅是渲染投影：store 始终保存真实成员边，项目数据和 Undo 不记录焦点态。
 */
export function createAssetGroupRenderGraph(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  activeGroupId: string | null,
): AssetGroupRenderGraph {
  const assetGroups = nodes.filter(isAssetGroupNode);
  const groupIds = new Set(assetGroups.map((group) => group.id));
  const renderNodes = nodes.map((node) => {
    if (!node.parentId || !groupIds.has(node.parentId)) return node;
    return { ...node, hidden: node.parentId !== activeGroupId };
  });

  const hiddenBindingIds = new Set<string>();
  const bundleEdges: CanvasEdge[] = [];
  for (const group of assetGroups) {
    if (group.id === activeGroupId) continue;
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
