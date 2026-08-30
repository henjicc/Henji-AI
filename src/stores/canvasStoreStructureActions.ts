import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import {
  reconcileAssetGroupGraph,
  setAssetGroupMemberExcludedGraph,
} from '@/features/canvas/application/assetGroupGraph';
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useCanvasTextStreamStore } from '@/stores/canvasTextStreamStore';
import type {
  CanvasStoreGet,
  CanvasStoreSet,
  CanvasStructureActions,
} from './canvasStore';
import {
  collectNodeIdsWithDescendants,
  createClosedCanvasImageViewerState,
  createSnapshot,
  getNodeSize,
  pushSnapshot,
  resolveAbsolutePosition,
  resolveActiveToolDialog,
  resolveSelectedNodeId,
} from './canvasStoreHelpers';

export function createCanvasStructureActions(
  set: CanvasStoreSet,
  get: CanvasStoreGet,
): CanvasStructureActions {
  return {
  deleteNode: (nodeId) => {
    get().deleteNodes([nodeId]);
  },

  deleteNodes: (nodeIds) => {
    const uniqueIds = Array.from(new Set(nodeIds.filter((nodeId) => nodeId.trim().length > 0)));
    if (uniqueIds.length === 0) {
      return;
    }

    let removedNodeIds: ReadonlySet<string> | null = null;

    set((state) => {
      const existingIds = uniqueIds.filter((nodeId) => state.nodes.some((node) => node.id === nodeId));
      if (existingIds.length === 0) {
        return {};
      }

      const deleteSet = collectNodeIdsWithDescendants(state.nodes, existingIds);
      const nextNodes = state.nodes.filter((node) => !deleteSet.has(node.id));
      const nextEdges = state.edges.filter(
        (edge) => !deleteSet.has(edge.source) && !deleteSet.has(edge.target)
      );
      const reconciled = reconcileAssetGroupGraph(nextNodes, nextEdges);
      removedNodeIds = deleteSet;

      return {
        nodes: reconciled.nodes,
        edges: reconciled.edges,
        selectedNodeId:
          state.selectedNodeId && deleteSet.has(state.selectedNodeId) ? null : state.selectedNodeId,
        activeToolDialog:
          state.activeToolDialog && deleteSet.has(state.activeToolDialog.nodeId)
            ? null
            : state.activeToolDialog,
        imageViewer:
          state.imageViewer.sourceNodeId && deleteSet.has(state.imageViewer.sourceNodeId)
            ? createClosedCanvasImageViewerState()
            : state.imageViewer,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });

    if (removedNodeIds) {
      useCanvasGenerationProgressStore.getState().clearProgress(removedNodeIds);
      useCanvasTextStreamStore.getState().clearPreviews(removedNodeIds);
    }
  },

  groupNodes: (nodeIds) => {
    const uniqueIds = Array.from(new Set(nodeIds.filter((nodeId) => nodeId.trim().length > 0)));
    if (uniqueIds.length < 2) {
      return null;
    }

    const state = get();
    const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const existingIds = uniqueIds.filter((nodeId) => nodeMap.has(nodeId));
    if (existingIds.length < 2) {
      return null;
    }

    const selectedSet = new Set(existingIds);
    const memberIds = existingIds.filter((nodeId) => {
      let currentParentId = nodeMap.get(nodeId)?.parentId;
      const visited = new Set<string>();
      while (currentParentId && !visited.has(currentParentId)) {
        if (selectedSet.has(currentParentId)) {
          return false;
        }
        visited.add(currentParentId);
        currentParentId = nodeMap.get(currentParentId)?.parentId;
      }
      return true;
    });
    if (memberIds.length < 2) {
      return null;
    }

    const memberSet = new Set(memberIds);
    const members = memberIds
      .map((id) => nodeMap.get(id))
      .filter((node): node is CanvasNode => Boolean(node));

    const absoluteBounds = members.reduce(
      (acc, node) => {
        const absolute = resolveAbsolutePosition(node, nodeMap);
        const size = getNodeSize(node);
        return {
          minX: Math.min(acc.minX, absolute.x),
          minY: Math.min(acc.minY, absolute.y),
          maxX: Math.max(acc.maxX, absolute.x + size.width),
          maxY: Math.max(acc.maxY, absolute.y + size.height),
        };
      },
      {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      }
    );

    if (!Number.isFinite(absoluteBounds.minX) || !Number.isFinite(absoluteBounds.minY)) {
      return null;
    }

    const SIDE_PADDING = 20;
    const TOP_PADDING = 34;
    const BOTTOM_PADDING = 20;
    const groupX = Math.round(absoluteBounds.minX - SIDE_PADDING);
    const groupY = Math.round(absoluteBounds.minY - TOP_PADDING);
    const groupWidth = Math.round(
      Math.max(220, absoluteBounds.maxX - absoluteBounds.minX + SIDE_PADDING * 2)
    );
    const groupHeight = Math.round(
      Math.max(140, absoluteBounds.maxY - absoluteBounds.minY + TOP_PADDING + BOTTOM_PADDING)
    );

    const existingGroupCount = state.nodes.filter((node) => node.type === CANVAS_NODE_TYPES.group).length;
    const groupDisplayName = `组 ${existingGroupCount + 1}`;
    const groupNode = canvasNodeFactory.createNode(
      CANVAS_NODE_TYPES.group,
      { x: groupX, y: groupY },
      {
        label: groupDisplayName,
        displayName: groupDisplayName,
      }
    );
    groupNode.style = { width: groupWidth, height: groupHeight };
    groupNode.selected = true;

    const updatedMemberMap = new Map<string, CanvasNode>();
    for (const node of members) {
      const absolute = resolveAbsolutePosition(node, nodeMap);
      updatedMemberMap.set(node.id, {
        ...node,
        parentId: groupNode.id,
        extent: 'parent',
        position: {
          x: Math.round(absolute.x - groupX),
          y: Math.round(absolute.y - groupY),
        },
        selected: false,
      });
    }

    const firstMemberIndex = state.nodes.reduce((acc, node, index) => {
      if (!memberSet.has(node.id)) {
        return acc;
      }
      return acc === -1 ? index : Math.min(acc, index);
    }, -1);

    const nextNodes: CanvasNode[] = [];
    let insertedGroup = false;
    for (let index = 0; index < state.nodes.length; index += 1) {
      const node = state.nodes[index];
      if (!insertedGroup && index === firstMemberIndex) {
        nextNodes.push(groupNode);
        insertedGroup = true;
      }

      const updatedMember = updatedMemberMap.get(node.id);
      if (updatedMember) {
        nextNodes.push(updatedMember);
      } else {
        nextNodes.push({
          ...node,
          selected: false,
        });
      }
    }

    if (!insertedGroup) {
      nextNodes.push(groupNode);
    }

    set({
      nodes: nextNodes,
      selectedNodeId: groupNode.id,
      activeToolDialog:
        state.activeToolDialog && memberSet.has(state.activeToolDialog.nodeId)
          ? null
          : state.activeToolDialog,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return groupNode.id;
  },

  ungroupNode: (groupNodeId) => {
    const state = get();
    const groupNode = state.nodes.find(
      (node) => node.id === groupNodeId && node.type === CANVAS_NODE_TYPES.group
    );
    if (!groupNode) {
      return false;
    }

    const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const children = state.nodes.filter((node) => node.parentId === groupNodeId);
    if (children.length === 0) {
      return false;
    }

    const nextNodes = state.nodes
      .filter((node) => node.id !== groupNodeId)
      .map((node) => {
        if (node.parentId !== groupNodeId) {
          return node;
        }

        const absolute = resolveAbsolutePosition(node, nodeMap);
        return {
          ...node,
          parentId: undefined,
          extent: undefined,
          position: {
            x: Math.round(absolute.x),
            y: Math.round(absolute.y),
          },
          selected: false,
        };
      });

    const nextEdges = state.edges.filter(
      (edge) => edge.source !== groupNodeId && edge.target !== groupNodeId
    );

    set({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeId: state.selectedNodeId === groupNodeId ? null : state.selectedNodeId,
      activeToolDialog:
        state.activeToolDialog?.nodeId === groupNodeId ? null : state.activeToolDialog,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return true;
  },

  deleteEdge: (edgeId) => {
    set((state) => {
      const edge = state.edges.find((item) => item.id === edgeId);
      if (!edge) {
        return {};
      }

      const managed = edge.data?.managedByAssetGroup;
      const changed = managed
        ? setAssetGroupMemberExcludedGraph(
            state.nodes,
            state.edges,
            managed.groupId,
            managed.bindingId,
            managed.memberId,
            true,
          )
        : reconcileAssetGroupGraph(state.nodes, state.edges.filter((item) => item.id !== edgeId));
      if (!changed) return {};

      return {
        nodes: changed.nodes,
        edges: changed.edges,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  setSelectedNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
  },

  openToolDialog: (dialog) => {
    set({ activeToolDialog: dialog });
  },

  closeToolDialog: () => {
    set({ activeToolDialog: null });
  },

  undo: () => {
    const state = get();
    const target = state.history.past[state.history.past.length - 1];
    if (!target) {
      return false;
    }

    const currentSnapshot = createSnapshot(state.nodes, state.edges);
    const nextPast = state.history.past.slice(0, -1);
    const reconciled = reconcileAssetGroupGraph(target.nodes, target.edges);

    set({
      nodes: reconciled.nodes,
      edges: reconciled.edges,
      selectedNodeId: resolveSelectedNodeId(state.selectedNodeId, reconciled.nodes),
      activeToolDialog: resolveActiveToolDialog(state.activeToolDialog, reconciled.nodes),
      history: {
        past: nextPast,
        future: pushSnapshot(state.history.future, currentSnapshot),
      },
      dragHistorySnapshot: null,
      activeHistoryGroup: null,
    });
    return true;
  },

  redo: () => {
    const state = get();
    const target = state.history.future[state.history.future.length - 1];
    if (!target) {
      return false;
    }

    const currentSnapshot = createSnapshot(state.nodes, state.edges);
    const nextFuture = state.history.future.slice(0, -1);
    const reconciled = reconcileAssetGroupGraph(target.nodes, target.edges);

    set({
      nodes: reconciled.nodes,
      edges: reconciled.edges,
      selectedNodeId: resolveSelectedNodeId(state.selectedNodeId, reconciled.nodes),
      activeToolDialog: resolveActiveToolDialog(state.activeToolDialog, reconciled.nodes),
      history: {
        past: pushSnapshot(state.history.past, currentSnapshot),
        future: nextFuture,
      },
      dragHistorySnapshot: null,
      activeHistoryGroup: null,
    });
    return true;
  },

  clearCanvas: () => {
    set((state) => {
      if (state.nodes.length === 0 && state.edges.length === 0 && !state.imageViewer.isOpen) {
        return {};
      }

      return {
        nodes: [],
        edges: [],
        selectedNodeId: null,
        activeToolDialog: null,
        imageViewer: createClosedCanvasImageViewerState(),
        history: {
          past: state.nodes.length > 0 || state.edges.length > 0
            ? pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges))
            : state.history.past,
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
    useCanvasGenerationProgressStore.getState().clearAllProgress();
    useCanvasTextStreamStore.getState().clearAllPreviews();
  },
  };
}
