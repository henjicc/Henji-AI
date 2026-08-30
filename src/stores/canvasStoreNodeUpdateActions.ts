import {
  CANVAS_NODE_TYPES,
  MODEL_SELECTOR_COLLAPSED_DEFAULT_HEIGHT,
  MODEL_SELECTOR_COLLAPSED_DEFAULT_WIDTH,
  MODEL_SELECTOR_EXPANDED_DEFAULT_HEIGHT,
  MODEL_SELECTOR_EXPANDED_DEFAULT_WIDTH,
  isStoryboardSplitNode,
  type CanvasNode,
  type CanvasNodeData,
  type StoryboardFrameItem,
} from '@/features/canvas/domain/canvasNodes';
import { findStaleParamEdgeIds } from '@/features/canvas/application/graphValueResolver';
import { nodeCatalog } from '@/features/canvas/application/nodeCatalog';
import { DEFAULT_NODE_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import { reconcileAssetGroupGraph } from '@/features/canvas/application/assetGroupGraph';
import type {
  CanvasNodeUpdateActions,
  CanvasStoreGet,
  CanvasStoreSet,
} from './canvasStore';
import {
  createSnapshot,
  isModelSelectorNodeType,
  maybeApplyMediaAutoResize,
  pushSnapshot,
} from './canvasStoreHelpers';

export function createCanvasNodeUpdateActions(
  set: CanvasStoreSet,
  _get: CanvasStoreGet,
): CanvasNodeUpdateActions {
  return {
  updateNodeData: (nodeId, data, options) => {
    set((state) => {
      let changed = false;
      const nextNodes = state.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        const hasDataChange = Object.entries(data).some(([key, nextValue]) => {
          const previousValue = (node.data as DynamicValueMap)[key];
          return !Object.is(previousValue, nextValue);
        });
        if (!hasDataChange) {
          return node;
        }

        const mergedData = {
          ...node.data,
          ...data,
        } as CanvasNodeData;
        const resizedNode = maybeApplyMediaAutoResize(node, mergedData, data);

        changed = true;
        return resizedNode;
      });

      if (!changed) {
        return {};
      }

      // 模型切换后旧参数端口（含媒体端口）可能不复存在，回收已失效的连线，
      // 避免连线在画布上视觉悬空、指向一个已不再渲染的端口。
      let nextEdges = state.edges;
      if ('modelId' in data || 'params' in data) {
        const targetNode = nextNodes.find((node) => node.id === nodeId);
        if (targetNode) {
          const staleEdgeIds = new Set(findStaleParamEdgeIds(targetNode, nextNodes, state.edges));
          if (staleEdgeIds.size > 0) {
            nextEdges = state.edges.filter((edge) => !staleEdgeIds.has(edge.id));
          }
        }
      }

      const reconciled = reconcileAssetGroupGraph(nextNodes, nextEdges);
      nextEdges = reconciled.edges;

      if (options?.skipHistory) {
        return { nodes: reconciled.nodes, edges: nextEdges };
      }

      const historyGroup = options?.historyGroup;
      const shouldRecordHistory = !options?.skipHistory
        && (!historyGroup || state.activeHistoryGroup !== historyGroup);
      return {
        nodes: reconciled.nodes,
        edges: nextEdges,
        history: shouldRecordHistory
          ? {
              past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
              future: [],
            }
          : state.history,
        activeHistoryGroup: options?.skipHistory
          ? state.activeHistoryGroup
          : historyGroup ?? null,
        dragHistorySnapshot: null,
      };
    });
  },

  resolveUploadPlaceholder: (nodeId, resolution) => {
    let resolved = false;
    set((state) => {
      const targetIndex = state.nodes.findIndex(
        (node) => node.id === nodeId && node.type === CANVAS_NODE_TYPES.universalUpload
      );
      if (targetIndex < 0) {
        return {};
      }

      const currentNode = state.nodes[targetIndex];
      const targetDefinition = nodeCatalog.getDefinition(resolution.type);
      const lockedMediaKind = (currentNode.data as { lockedMediaKind?: DynamicValue }).lockedMediaKind
      if (lockedMediaKind && targetDefinition.media?.kind !== lockedMediaKind) {
        return {}
      }
      const rawCurrentTitle = typeof currentNode.data.displayName === 'string'
        ? currentNode.data.displayName.trim()
        : '';
      const customTitle = rawCurrentTitle
        && rawCurrentTitle !== DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.universalUpload]
        ? rawCurrentTitle
        : '';
      const importedTitle = typeof resolution.data.displayName === 'string'
        ? resolution.data.displayName.trim()
        : '';
      const nextData = {
        ...targetDefinition.createDefaultData(),
        ...resolution.data,
        displayName: customTitle || importedTitle || targetDefinition.createDefaultData().displayName,
      } as CanvasNodeData;
      const nextStyle = { ...(currentNode.style ?? {}) };
      delete nextStyle.width;
      delete nextStyle.height;

      const nextNode: CanvasNode = {
        ...currentNode,
        type: resolution.type,
        data: nextData,
        measured: undefined,
        width: undefined,
        height: undefined,
        style: nextStyle,
      };
      const nextNodes = [...state.nodes];
      nextNodes[targetIndex] = nextNode;
      const nextEdges = state.edges.map((edge) => edge.source === nodeId
        ? { ...edge, sourceHandle: 'source' }
        : edge)
      resolved = true;

      return {
        nodes: nextNodes,
        edges: nextEdges,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
        activeHistoryGroup: null,
      };
    });
    return resolved;
  },

  endHistoryGroup: (historyGroup) => {
    set((state) => state.activeHistoryGroup === historyGroup ? { activeHistoryGroup: null } : {});
  },

  setModelSelectorExpanded: (nodeId, isExpanded, collapsedWidth) => {
    set((state) => {
      let changed = false;
      const nextNodes = state.nodes.map((node) => {
        if (node.id !== nodeId || !isModelSelectorNodeType(node.type)) {
          return node;
        }
        if (Boolean((node.data as { isExpanded?: boolean }).isExpanded) === isExpanded) {
          return node;
        }

        changed = true;
        const mergedData = { ...node.data, isExpanded } as CanvasNodeData;
        const width = isExpanded
          ? MODEL_SELECTOR_EXPANDED_DEFAULT_WIDTH
          : Math.round(collapsedWidth ?? MODEL_SELECTOR_COLLAPSED_DEFAULT_WIDTH);
        const height = isExpanded ? MODEL_SELECTOR_EXPANDED_DEFAULT_HEIGHT : MODEL_SELECTOR_COLLAPSED_DEFAULT_HEIGHT;

        return {
          ...node,
          data: mergedData,
          width,
          height,
          style: { ...(node.style ?? {}), width, height },
        };
      });

      if (!changed) {
        return {};
      }

      return {
        nodes: nextNodes,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  updateNodePosition: (nodeId, position) => {
    set((state) => {
      let changed = false;
      const nextNodes = state.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        if (node.position.x === position.x && node.position.y === position.y) {
          return node;
        }

        changed = true;
        return {
          ...node,
          position,
        };
      });

      if (!changed) {
        return {};
      }

      return { nodes: nextNodes };
    });
  },

  updateStoryboardFrame: (nodeId, frameId, data, options) => {
    set((state) => {
      let changed = false;
      const nextNodes = state.nodes.map((node) => {
        if (node.id !== nodeId || !isStoryboardSplitNode(node)) {
          return node;
        }

        const nextFrames = node.data.frames.map((frame) => {
          if (frame.id !== frameId) {
            return frame;
          }

          const patchEntries = Object.entries(data) as Array<
            [keyof StoryboardFrameItem, StoryboardFrameItem[keyof StoryboardFrameItem]]
          >;
          const hasFrameChange = patchEntries.some(([key, nextValue]) =>
            !Object.is(frame[key], nextValue)
          );
          if (!hasFrameChange) {
            return frame;
          }

          changed = true;
          return {
            ...frame,
            ...data,
          };
        });

        return {
          ...node,
          data: {
            ...node.data,
            frames: nextFrames,
          },
        };
      });

      if (!changed) {
        return {};
      }

      const historyGroup = options?.historyGroup;
      const shouldRecordHistory = !historyGroup || state.activeHistoryGroup !== historyGroup;
      return {
        nodes: nextNodes,
        history: shouldRecordHistory
          ? {
              past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
              future: [],
            }
          : state.history,
        activeHistoryGroup: historyGroup ?? null,
        dragHistorySnapshot: null,
      };
    });
  },

  reorderStoryboardFrame: (nodeId, draggedFrameId, targetFrameId) => {
    set((state) => {
      let changed = false;
      const nextNodes = state.nodes.map((node) => {
        if (node.id !== nodeId || !isStoryboardSplitNode(node)) {
          return node;
        }

        const frames = [...node.data.frames].sort((a, b) => a.order - b.order);
        const fromIndex = frames.findIndex((frame) => frame.id === draggedFrameId);
        const toIndex = frames.findIndex((frame) => frame.id === targetFrameId);

        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
          return node;
        }

        changed = true;
        const [movedFrame] = frames.splice(fromIndex, 1);
        frames.splice(toIndex, 0, movedFrame);

        return {
          ...node,
          data: {
            ...node.data,
            frames: frames.map((frame, index) => ({
              ...frame,
              order: index,
            })),
          },
        };
      });

      if (!changed) {
        return {};
      }

      return {
        nodes: nextNodes,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  };
}
