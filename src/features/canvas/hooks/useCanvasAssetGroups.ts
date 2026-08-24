import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';

import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { resolveAssetGroupMemberKind } from '@/features/canvas/application/assetGroupGraph';
import { createAssetGroupRenderGraph } from '@/features/canvas/application/assetGroupRenderGraph';
import { isAssetGroupNode, type CanvasEdge, type CanvasNode } from '@/features/canvas/domain/canvasNodes';

interface UseCanvasAssetGroupsInput {
  wrapperRef: React.RefObject<HTMLDivElement>;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  onNodeDragStop: (event: ReactMouseEvent, node: CanvasNode) => void;
  addToAssetGroup: (groupId: string, memberIds: string[]) => void;
}

export function useCanvasAssetGroups(input: UseCanvasAssetGroupsInput) {
  const { wrapperRef, nodes, edges, selectedNodeId, selectedNodeIds, onNodeDragStop, addToAssetGroup } = input;
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

  const handleDragStop = useCallback((event: ReactMouseEvent, node: CanvasNode) => {
    onNodeDragStop(event, node);
    if (event.altKey || isAssetGroupNode(node) || !resolveAssetGroupMemberKind(node)) return;
    const draggedElement = wrapperRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${node.id}"]`);
    const rect = draggedElement?.getBoundingClientRect();
    if (!rect) return;
    const targetElement = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      .map((element) => element.closest<HTMLElement>('.react-flow__node[data-id]'))
      .find((element) => element && element.dataset.id !== node.id);
    const targetId = targetElement?.dataset.id;
    const target = targetId ? nodes.find((item) => item.id === targetId) : undefined;
    if (!target || !isAssetGroupNode(target)) return;
    const memberIds = selectedNodeIds.includes(node.id)
      ? selectedNodeIds.filter((id) => {
          const selected = nodes.find((item) => item.id === id);
          return Boolean(selected && !isAssetGroupNode(selected) && resolveAssetGroupMemberKind(selected));
        })
      : [node.id];
    addToAssetGroup(target.id, memberIds);
  }, [addToAssetGroup, nodes, onNodeDragStop, selectedNodeIds, wrapperRef]);

  const renderGraph = useMemo(
    () => createAssetGroupRenderGraph(nodes, edges, activeGroupId),
    [activeGroupId, edges, nodes],
  );

  return { activeGroupId, closeAssetGroup: () => setActiveGroupId(null), handleDragStop, renderGraph };
}
