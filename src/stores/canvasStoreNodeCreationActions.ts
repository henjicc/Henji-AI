import { addEdge } from '@xyflow/react';

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type CanvasEdge,
  type CanvasNodeData,
  type ExportImageNodeResultKind,
} from '@/features/canvas/domain/canvasNodes';
import { parseCanvasEditV3NodeSession } from '@/features/canvas/imageEditV3/canvasEditV3Contracts';
import {
  getCanvasNodeDefinition,
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from '@/features/canvas/domain/nodeRegistry';
import { getSourcePortMediaKind } from '@/features/canvas/domain/nodePorts';
import {
  resolveMediaTargetHandle,
  type RowMediaKind,
} from '@/features/canvas/domain/socketTypes';
import { getAuthoritativeIncomingEdge } from '@/features/canvas/domain/connectionIndex';
import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { findCanvasPositionRightOf } from '@/features/canvas/application/canvasNodePlacement';
import {
  EXPORT_RESULT_DISPLAY_NAME,
} from '@/features/canvas/domain/nodeDisplay';
import type {
  CanvasNodeCreationActions,
  CanvasStoreGet,
  CanvasStoreSet,
} from './canvasStore';
import {
  createDefaultStoryboardExportOptions,
  createSnapshot,
  withCanvasHistoryBoundary,
  getDerivedNodePosition,
  getNodeSize,
  pushSnapshot,
  resolveAutoImageNodeDimensions,
  resolveDerivedAspectRatio,
  resolveGeneratedImageNodeDimensions,
} from './canvasStoreHelpers';

export function createCanvasNodeCreationActions(
  set: CanvasStoreSet,
  get: CanvasStoreGet,
): CanvasNodeCreationActions {
  set = withCanvasHistoryBoundary(set);
  return {
  addNode: (type, position, data = {}) => {
    const state = get();
    const newNode = canvasNodeFactory.createNode(type, position, data);
    set({
      nodes: [...state.nodes, newNode],
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });
    return newNode.id;
  },

  addEdge: (source, target) => {
    const state = get();
    // Check if both nodes exist
    const sourceNode = state.nodes.find((n) => n.id === source);
    const targetNode = state.nodes.find((n) => n.id === target);
    if (!sourceNode || !targetNode) {
      return null;
    }
    if (!nodeHasSourceHandle(sourceNode.type) || !nodeHasTargetHandle(targetNode.type)) {
      return null;
    }

    const edgeId = `e-${source}-${target}`;
    // Check if edge already exists
    if (state.edges.some((e) => e.id === edgeId)) {
      return edgeId;
    }
    if (
      targetNode.type === CANVAS_NODE_TYPES.textAnnotation
      && getAuthoritativeIncomingEdge(state.edges, targetNode.id)
    ) {
      return null;
    }

    const sourceDefinition = getCanvasNodeDefinition(sourceNode.type);
    const mediaKind = getSourcePortMediaKind(sourceDefinition?.ports, 'source');
    const targetHandle = mediaKind && ['image', 'video', 'audio'].includes(mediaKind)
      ? resolveMediaTargetHandle(targetNode.type, mediaKind as RowMediaKind)
      : 'target';
    const newEdge: CanvasEdge = {
      id: edgeId,
      source,
      target,
      sourceHandle: 'source',
      targetHandle,
      type: 'disconnectableEdge',
    };

    set({
      edges: [...state.edges, newEdge],
    });

    return edgeId;
  },

  ensureTextDisplayOutput: (sourceNodeId, data = {}) => {
    const position = get().findNodePosition(sourceNodeId, 360, 220)
    let createdNodeId: string | null = null
    set((state) => {
      const sourceNode = state.nodes.find((node) => node.id === sourceNodeId)
      if (!sourceNode || sourceNode.type !== CANVAS_NODE_TYPES.textProcessing) return {}
      const hasOutput = state.edges.some((edge) => (
        edge.source === sourceNodeId && (edge.sourceHandle ?? 'source') === 'source'
      ))
      if (hasOutput) return {}

      const displayNode = canvasNodeFactory.createNode(
        CANVAS_NODE_TYPES.textAnnotation,
        position,
        data,
      )
      const nextEdges = addEdge<CanvasEdge>({
        source: sourceNodeId,
        target: displayNode.id,
        sourceHandle: 'source',
        targetHandle: 'target',
        type: 'disconnectableEdge',
      }, state.edges)
      createdNodeId = displayNode.id
      return {
        nodes: [...state.nodes, displayNode],
        edges: nextEdges,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      }
    })
    return createdNodeId
  },

  findNodePosition: (sourceNodeId, newNodeWidth, newNodeHeight) => {
    const state = get();
    return findCanvasPositionRightOf(
      { nodes: state.nodes, viewport: state.currentViewport, viewportSize: state.canvasViewportSize },
      sourceNodeId,
      { width: newNodeWidth, height: newNodeHeight },
    );
  },

  addDerivedUploadNode: (sourceNodeId, imageUrl, aspectRatio, previewImageUrl) => {
    const state = get();
    const position = getDerivedNodePosition(state.nodes, sourceNodeId);
    const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
    const resolvedAspectRatio = resolveDerivedAspectRatio(sourceNode, aspectRatio);
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, position, {
      imageUrl,
      previewImageUrl: previewImageUrl ?? null,
      aspectRatio: resolvedAspectRatio,
    });
    set({
      nodes: [...state.nodes, node],
      selectedNodeId: node.id,
      activeToolDialog: null,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return node.id;
  },

  addDerivedExportNode: (sourceNodeId, imageUrl, aspectRatio, previewImageUrl, options) => {
    const state = get();
    const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
    const aspectRatioStrategy = options?.aspectRatioStrategy ?? 'provided';
    const resolvedAspectRatio = aspectRatioStrategy === 'derivedFromSource'
      ? resolveDerivedAspectRatio(sourceNode, aspectRatio)
      : (aspectRatio || resolveDerivedAspectRatio(sourceNode, DEFAULT_ASPECT_RATIO));
    const autoSize = resolveAutoImageNodeDimensions(resolvedAspectRatio, {
      minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
      minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
    });
    const generatedSize = resolveGeneratedImageNodeDimensions(resolvedAspectRatio, {
      minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
      minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
    });
    const sourceSize = sourceNode ? getNodeSize(sourceNode) : null;
    const sizeStrategy = options?.sizeStrategy
      ?? (options?.matchSourceNodeSize ? 'matchSource' : 'generated');
    let derivedSize = generatedSize;
    if (sizeStrategy === 'autoMinEdge') {
      derivedSize = autoSize;
    } else if (sizeStrategy === 'matchSource' && sourceSize) {
      derivedSize = {
        width: Math.max(1, Math.round(sourceSize.width)),
        height: Math.max(1, Math.round(sourceSize.height)),
      };
    }
    const position = state.findNodePosition(
      sourceNodeId,
      derivedSize.width,
      derivedSize.height
    );
    const exportNodeData: Partial<CanvasNodeData> = {
      imageUrl,
      previewImageUrl: previewImageUrl ?? null,
      aspectRatio: resolvedAspectRatio,
    };
    if (options?.defaultTitle) {
      (exportNodeData as { displayName?: string }).displayName = options.defaultTitle;
    }
    if (options?.resultKind) {
      (exportNodeData as { resultKind?: ExportImageNodeResultKind }).resultKind = options.resultKind;
      if (!options.defaultTitle) {
        (exportNodeData as { displayName?: string }).displayName =
          EXPORT_RESULT_DISPLAY_NAME[options.resultKind];
      }
    }
    if (options?.imageEditSession) {
      const session = parseCanvasEditV3NodeSession(options.imageEditSession, imageUrl);
      if (!session) throw new Error('画布图片编辑派生结果缺少有效会话引用');
      (exportNodeData as { imageEditSession?: typeof session }).imageEditSession = session;
    }
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, position, {
      ...exportNodeData,
    });
    node.width = derivedSize.width;
    node.height = derivedSize.height;
    node.style = {
      ...(node.style ?? {}),
      width: derivedSize.width,
      height: derivedSize.height,
    };

    set({
      nodes: [...state.nodes, node],
      selectedNodeId: node.id,
      activeToolDialog: null,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return node.id;
  },

  addStoryboardSplitNode: (sourceNodeId, rows, cols, frames, frameAspectRatio) => {
    const state = get();
    const position = getDerivedNodePosition(state.nodes, sourceNodeId);
    const resolvedFrameAspectRatio =
      frameAspectRatio ??
      frames.find((frame) => typeof frame.aspectRatio === 'string')?.aspectRatio ??
      DEFAULT_ASPECT_RATIO;

    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.storyboardSplit, position, {
      gridRows: rows,
      gridCols: cols,
      frames,
      aspectRatio: resolvedFrameAspectRatio,
      frameAspectRatio: resolvedFrameAspectRatio,
      exportOptions: createDefaultStoryboardExportOptions(),
    });

    set({
      nodes: [...state.nodes, node],
      selectedNodeId: node.id,
      activeToolDialog: null,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return node.id;
  },

  };
}
