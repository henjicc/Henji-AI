import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type NodeChange,
} from '@xyflow/react';

import {
  CANVAS_NODE_TYPES,
  resolveCanvasImageViewerMode,
  type CanvasEdge,
  type CanvasImageViewerRequest,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import {
  getCanvasNodeDefinition,
} from '@/features/canvas/domain/nodeRegistry';
import { DEFAULT_NODE_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import {
  resolveConnectionSourceMediaKind,
} from '@/features/canvas/application/graphValueResolver';
import {
  getAuthoritativeIncomingEdge,
  getNodeIndexById,
  wouldCreateCanvasCycle,
} from '@/features/canvas/domain/connectionIndex';
import {
  PROMPT_PARAM_ID,
  parseParamPortId,
} from '@/features/canvas/domain/socketTypes';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useCanvasTextStreamStore } from '@/stores/canvasTextStreamStore';
import {
  reconcileAssetGroupGraph,
} from '@/features/canvas/application/assetGroupGraph';
import type {
  CanvasConnectionActions,
  CanvasStoreGet,
  CanvasStoreSet,
  OpenCanvasImageViewer,
} from './canvasStore';
import {
  createClosedCanvasImageViewerState,
  createSnapshot,
  isManualSizeTrackingNodeType,
  pushSnapshot,
  resolveActiveToolDialog,
  resolveSelectedNodeId,
  withManualSizeLock,
} from './canvasStoreHelpers';
import {
  normalizeEdgesWithNodes,
  normalizeHandleId,
  normalizeHistory,
  normalizeNodes,
} from './canvasStoreNormalization';

export function createCanvasConnectionActions(
  set: CanvasStoreSet,
  get: CanvasStoreGet,
): CanvasConnectionActions {
  return {
  onNodesChange: (changes) => {
    set((state) => {
      const resizedNodeIds = new Set(
        changes
          .filter(
            (change): change is NodeChange<CanvasNode> & { id: string } =>
              change.type === 'dimensions'
              && 'resizing' in change
              && change.resizing === false
              && typeof change.id === 'string'
          )
          .map((change) => change.id)
      );

      let nextNodes = applyNodeChanges<CanvasNode>(changes, state.nodes);
      if (resizedNodeIds.size > 0) {
        nextNodes = nextNodes.map((node) => {
          if (!resizedNodeIds.has(node.id) || !isManualSizeTrackingNodeType(node.type)) {
            return node;
          }
          return withManualSizeLock(node);
        });
      }
      const hasMeaningfulChange = changes.some((change) => change.type !== 'select');
      const hasDragMove = changes.some(
        (change) =>
          change.type === 'position' &&
          'dragging' in change &&
          Boolean(change.dragging)
      );
      const hasDragEnd = changes.some(
        (change) =>
          change.type === 'position' &&
          'dragging' in change &&
          change.dragging === false
      );
      const hasResizeMove = changes.some(
        (change) =>
          change.type === 'dimensions' &&
          'resizing' in change &&
          Boolean(change.resizing)
      );
      const hasResizeEnd = changes.some(
        (change) =>
          change.type === 'dimensions' &&
          'resizing' in change &&
          change.resizing === false
      );
      const hasInteractionMove = hasDragMove || hasResizeMove;
      const hasInteractionEnd = hasDragEnd || hasResizeEnd;

      let nextHistory = state.history;
      let nextDragHistorySnapshot = state.dragHistorySnapshot;

      if (hasInteractionMove && !nextDragHistorySnapshot) {
        nextDragHistorySnapshot = createSnapshot(state.nodes, state.edges);
      }

      if (hasInteractionEnd) {
        const snapshot = nextDragHistorySnapshot ?? createSnapshot(state.nodes, state.edges);
        nextHistory = {
          past: pushSnapshot(state.history.past, snapshot),
          future: [],
        };
        nextDragHistorySnapshot = null;
      } else if (hasMeaningfulChange && !hasInteractionMove) {
        nextHistory = {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        };
        nextDragHistorySnapshot = null;
      }

      return {
        nodes: nextNodes,
        selectedNodeId: resolveSelectedNodeId(state.selectedNodeId, nextNodes),
        activeToolDialog: resolveActiveToolDialog(state.activeToolDialog, nextNodes),
        history: nextHistory,
        dragHistorySnapshot: nextDragHistorySnapshot,
      };
    });
  },

  onEdgesChange: (changes) => {
    set((state) => {
      const nextEdges = applyEdgeChanges<CanvasEdge>(changes, state.edges);
      const hasMeaningfulChange = changes.some((change) => change.type !== 'select');

      if (!hasMeaningfulChange) {
        return { edges: nextEdges };
      }

      return {
        edges: nextEdges,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  onConnect: (connection) => {
    const sourceHandle = normalizeHandleId(connection.sourceHandle) ?? 'source';
    const targetHandle = normalizeHandleId(connection.targetHandle) ?? 'target';
    const bridgePosition = get().findNodePosition(connection.source, 360, 220)
    set((state) => {
      const sourceNode = state.nodes.find((node) => node.id === connection.source)
      const targetNode = state.nodes.find((node) => node.id === connection.target)
      const sourceDefinition = sourceNode ? getCanvasNodeDefinition(sourceNode.type) : undefined
      const shouldLockSourceMedia = sourceDefinition?.connectivity.lockSourceMediaOnFirstConnection === true
      const sourceMediaKind = sourceNode && targetNode
        ? resolveConnectionSourceMediaKind(sourceNode, targetNode, sourceHandle, targetHandle)
        : undefined
      if (shouldLockSourceMedia && !sourceMediaKind) {
        return {}
      }
      if (
        targetNode?.type === CANVAS_NODE_TYPES.textAnnotation
        && getAuthoritativeIncomingEdge(state.edges, targetNode.id)
      ) {
        return {}
      }

      const currentLockedKind = shouldLockSourceMedia
        ? (sourceNode?.data as { lockedMediaKind?: DynamicValue } | undefined)?.lockedMediaKind
        : null
      if (currentLockedKind && currentLockedKind !== sourceMediaKind) {
        return {}
      }

      const shouldInsertTextDisplay = useSettingsStore.getState().autoInsertTextDisplayNode
        && sourceNode?.type === CANVAS_NODE_TYPES.textProcessing
        && targetNode?.type !== CANVAS_NODE_TYPES.textAnnotation
        && sourceHandle === 'source'
        && parseParamPortId(targetHandle) === PROMPT_PARAM_ID
      if (shouldInsertTextDisplay && sourceNode && targetNode) {
        const nodeById = getNodeIndexById(state.nodes)
        const existingBridgeEdge = state.edges.find((edge) => (
          edge.source === sourceNode.id
          && (edge.sourceHandle ?? 'source') === 'source'
          && nodeById.get(edge.target)?.type === CANVAS_NODE_TYPES.textAnnotation
        ))
        let nextNodes = state.nodes
        let nextEdges = state.edges
        let bridgeNodeId = existingBridgeEdge?.target
        if (!bridgeNodeId) {
          const bridgeNode = canvasNodeFactory.createNode(
            CANVAS_NODE_TYPES.textAnnotation,
            bridgePosition,
            { displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.textAnnotation] },
          )
          bridgeNodeId = bridgeNode.id
          nextNodes = [...nextNodes, bridgeNode]
          nextEdges = addEdge<CanvasEdge>({
            source: sourceNode.id,
            target: bridgeNode.id,
            sourceHandle: 'source',
            targetHandle: 'target',
            type: 'disconnectableEdge',
          }, nextEdges)
        }
        if (wouldCreateCanvasCycle(bridgeNodeId, targetNode.id, nextEdges)) return {}
        const connectedEdges = addEdge<CanvasEdge>({
          source: bridgeNodeId,
          target: targetNode.id,
          sourceHandle: 'source',
          targetHandle,
          type: 'disconnectableEdge',
        }, nextEdges)
        if (connectedEdges.length === state.edges.length && nextNodes === state.nodes) return {}
        const reconciled = reconcileAssetGroupGraph(nextNodes, connectedEdges);
        return {
          nodes: reconciled.nodes,
          edges: reconciled.edges,
          history: {
            past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
            future: [],
          },
          dragHistorySnapshot: null,
        }
      }

      if (sourceNode && targetNode && wouldCreateCanvasCycle(sourceNode.id, targetNode.id, state.edges)) {
        return {}
      }

      const nextEdges = addEdge<CanvasEdge>(
        { ...connection, sourceHandle, targetHandle, type: 'disconnectableEdge' },
        state.edges
      )
      if (nextEdges.length === state.edges.length) {
        return {}
      }

      const nextNodes = shouldLockSourceMedia && sourceNode && !currentLockedKind
        ? state.nodes.map((node) => node.id === sourceNode.id
          ? { ...node, data: { ...node.data, lockedMediaKind: sourceMediaKind } }
          : node)
        : state.nodes

      const reconciled = reconcileAssetGroupGraph(nextNodes, nextEdges);
      return {
        nodes: reconciled.nodes,
        edges: reconciled.edges,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      }
    });
  },

  connectMany: (connections) => {
    const normalized = connections.filter((connection) => (
      connection.source !== connection.target
      && connection.source.trim().length > 0
      && connection.target.trim().length > 0
    ));
    if (normalized.length === 0) return [];

    const createdEdgeIds: string[] = [];
    set((state) => {
      const nodeById = getNodeIndexById(state.nodes);
      let nextEdges = state.edges;
      let nextNodes = state.nodes;

      for (const connection of normalized) {
        const sourceNode = nodeById.get(connection.source);
        const targetNode = nodeById.get(connection.target);
        if (!sourceNode || !targetNode) continue;
        if (
          targetNode.type === CANVAS_NODE_TYPES.textAnnotation
          && getAuthoritativeIncomingEdge(nextEdges, targetNode.id)
        ) continue;
        if (wouldCreateCanvasCycle(sourceNode.id, targetNode.id, nextEdges)) continue;
        const duplicate = nextEdges.some((edge) => (
          edge.source === connection.source
          && edge.target === connection.target
          && (edge.sourceHandle ?? 'source') === connection.sourceHandle
          && (edge.targetHandle ?? 'target') === connection.targetHandle
        ));
        if (duplicate) continue;

        const beforeIds = new Set(nextEdges.map((edge) => edge.id));
        nextEdges = addEdge<CanvasEdge>({
          ...connection,
          type: 'disconnectableEdge',
        }, nextEdges);
        const createdEdge = nextEdges.find((edge) => !beforeIds.has(edge.id));
        if (createdEdge) createdEdgeIds.push(createdEdge.id);

        const sourceDefinition = getCanvasNodeDefinition(sourceNode.type);
        const currentLockedKind = (sourceNode.data as { lockedMediaKind?: DynamicValue }).lockedMediaKind;
        const mediaKind = resolveConnectionSourceMediaKind(
          sourceNode,
          targetNode,
          connection.sourceHandle,
          connection.targetHandle,
        );
        if (
          createdEdge
          && sourceDefinition?.connectivity.lockSourceMediaOnFirstConnection
          && !currentLockedKind
          && mediaKind
        ) {
          nextNodes = nextNodes.map((node) => node.id === sourceNode.id
            ? { ...node, data: { ...node.data, lockedMediaKind: mediaKind } }
            : node);
          nodeById.set(sourceNode.id, nextNodes.find((node) => node.id === sourceNode.id) as CanvasNode);
        }
      }

      if (createdEdgeIds.length === 0) return {};
      const reconciled = reconcileAssetGroupGraph(nextNodes, nextEdges);
      return {
        nodes: reconciled.nodes,
        edges: reconciled.edges,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
    return createdEdgeIds;
  },

  setCanvasData: (nodes, edges, history) => {
    const normalizedNodes = normalizeNodes(nodes);
    const normalizedEdges = normalizeEdgesWithNodes(edges, normalizedNodes);
    const reconciled = reconcileAssetGroupGraph(normalizedNodes, normalizedEdges);

    set({
      nodes: reconciled.nodes,
      edges: reconciled.edges,
      selectedNodeId: null,
      activeToolDialog: null,
      history: normalizeHistory(history),
      dragHistorySnapshot: null,
      activeHistoryGroup: null,
      imageViewer: createClosedCanvasImageViewerState(),
    });
    useCanvasGenerationProgressStore.getState().clearAllProgress();
    useCanvasTextStreamStore.getState().clearAllPreviews();
  },

  commitAssetGroupGraph: (graph, selectedNodeId) => {
    set((state) => {
      const reconciled = reconcileAssetGroupGraph(graph.nodes, graph.edges);
      return {
        nodes: reconciled.nodes,
        edges: reconciled.edges,
        selectedNodeId: selectedNodeId === undefined ? state.selectedNodeId : selectedNodeId,
        activeToolDialog: resolveActiveToolDialog(state.activeToolDialog, reconciled.nodes),
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  setViewportState: (viewport) => {
    set({ currentViewport: viewport });
  },

  setCanvasViewportSize: (size) => {
    set({ canvasViewportSize: size });
  },

  openImageViewer: ((requestOrUrl: CanvasImageViewerRequest | string, legacyImageList: string[] = []) => {
    const request = typeof requestOrUrl === 'string'
      ? { imageUrl: requestOrUrl, imageList: legacyImageList, mode: 'image' as const }
      : requestOrUrl;
    const imageUrl = request.imageUrl.trim();
    if (!imageUrl) return;
    const normalizedList = (request.imageList ?? [])
      .map((item) => item.trim())
      .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index);
    const list = normalizedList.length > 0 ? normalizedList : [imageUrl];
    if (!list.includes(imageUrl)) list.unshift(imageUrl);
    const index = list.indexOf(imageUrl);
    set({
      imageViewer: {
        isOpen: true,
        currentImageUrl: imageUrl,
        imageList: list,
        currentIndex: index >= 0 ? index : 0,
        mode: resolveCanvasImageViewerMode(request.mode),
        sourceNodeId:
          typeof request.sourceNodeId === 'string' && request.sourceNodeId.trim().length > 0
            ? request.sourceNodeId.trim()
            : null,
      },
    });
  }) as OpenCanvasImageViewer,

  closeImageViewer: () => {
    set({
      imageViewer: createClosedCanvasImageViewerState(),
    });
  },

  navigateImageViewer: (direction) => {
    const state = get();
    const { currentIndex, imageList } = state.imageViewer;
    if (direction === 'prev' && currentIndex > 0) {
      const newIndex = currentIndex - 1;
      set({
        imageViewer: {
          ...state.imageViewer,
          currentIndex: newIndex,
          currentImageUrl: imageList[newIndex],
        },
      });
    } else if (direction === 'next' && currentIndex < imageList.length - 1) {
      const newIndex = currentIndex + 1;
      set({
        imageViewer: {
          ...state.imageViewer,
          currentIndex: newIndex,
          currentImageUrl: imageList[newIndex],
        },
      });
    }
  },

  };
}
