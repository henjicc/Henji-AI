import { useCallback, useEffect, useMemo, useState } from 'react';

import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { resolveAssetGroupMemberKind } from '@/features/canvas/application/assetGroupGraph';
import { createAssetGroupRenderGraph } from '@/features/canvas/application/assetGroupRenderGraph';
import { isAssetGroupNode, type CanvasEdge, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { useCanvasSceneView } from '@/features/canvas/scene/useCanvasScene';

interface UseCanvasAssetGroupsInput {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  onNodeDragStop: (event: Pick<MouseEvent, 'altKey'>, node: CanvasNode) => boolean;
  addToAssetGroup: (groupId: string, memberIds: string[]) => void;
}

export function useCanvasAssetGroups(input: UseCanvasAssetGroupsInput) {
  const { nodes, edges, selectedNodeId, selectedNodeIds, onNodeDragStop, addToAssetGroup } = input;
  const sceneView = useCanvasSceneView();
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  useEffect(() => canvasEventBus.subscribe('asset-group/open', ({ groupId }) => {
    setActiveGroupId(groupId);
  }), []);

  useEffect(() => {
    if (!activeGroupId) return;
    if (!nodes.some((node) => node.id === activeGroupId && isAssetGroupNode(node))) {
      setActiveGroupId(null);
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveGroupId(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeGroupId, nodes]);

  useEffect(() => {
    if (!activeGroupId || !selectedNodeId) return;
    const selected = nodes.find((node) => node.id === selectedNodeId);
    if (selected && selected.id !== activeGroupId && selected.parentId !== activeGroupId) setActiveGroupId(null);
  }, [activeGroupId, nodes, selectedNodeId]);

  const handleDragStop = useCallback((event: Pick<MouseEvent, 'altKey'>, node: CanvasNode) => {
    if (onNodeDragStop(event, node)) return;
    if (event.altKey || isAssetGroupNode(node) || !resolveAssetGroupMemberKind(node)) return;
    // 落点问画布场景：被拖的节点和素材组都不一定挂着真 DOM
    const scene = sceneView.scene.read();
    const dragged = scene.node(node.id);
    if (!dragged) return;
    const center = { x: dragged.x + dragged.width / 2, y: dragged.y + dragged.height / 2 };
    const targetId = scene.hitNode(center, (id) => id === node.id)?.id;
    const target = targetId ? nodes.find((item) => item.id === targetId) : undefined;
    if (!target || !isAssetGroupNode(target)) return;
    const memberIds = selectedNodeIds.includes(node.id)
      ? selectedNodeIds.filter((id) => {
          const selected = nodes.find((item) => item.id === id);
          return Boolean(selected && !isAssetGroupNode(selected) && resolveAssetGroupMemberKind(selected));
        })
      : [node.id];
    addToAssetGroup(target.id, memberIds);
  }, [addToAssetGroup, nodes, onNodeDragStop, sceneView, selectedNodeIds]);

  const renderGraph = useMemo(
    () => createAssetGroupRenderGraph(nodes, edges),
    [edges, nodes],
  );

  return { activeGroupId, closeAssetGroup: () => setActiveGroupId(null), handleDragStop, renderGraph };
}
