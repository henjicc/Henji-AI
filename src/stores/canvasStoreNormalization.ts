import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
  type StoryboardExportOptions,
  type StoryboardFrameItem,
} from '@/features/canvas/domain/canvasNodes';
import {
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from '@/features/canvas/domain/nodeRegistry';
import {
  migrateElementEditGenerationData,
  migrateExportImageResultKind,
  migrateGenerationNodeData,
  migrateGenerationPromptData,
  migrateLayerSeparationGenerationData,
  migrateLayerStackResultData,
  migrateLegacyGenerationDisplayName,
  migrateLegacyTargetHandle,
  migrateMultiAngleGenerationData,
  migratePanoramaGenerationData,
  migratePanoramaViewerData,
  migratePortraitTextureGenerationData,
  migrateRelightGenerationData,
  migrateStoryboardGenerationData,
  migrateUpscaleGenerationData,
  resetTransientNodeRuntimeState,
} from '@/features/canvas/domain/nodeMigrations';
import { nodeCatalog } from '@/features/canvas/application/nodeCatalog';
import type {
  CanvasHistorySnapshot,
  CanvasHistoryState,
} from './canvasStore';
import {
  MAX_HISTORY_STEPS,
  createDefaultStoryboardExportOptions,
} from './canvasStoreHelpers';

export function normalizeHandleId(value: DynamicValue): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
    return undefined;
  }
  return trimmed;
}

export function normalizeEdgesWithNodes(rawEdges: CanvasEdge[], nodes: CanvasNode[]): CanvasEdge[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));

  return rawEdges
    .filter((edge) => {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!sourceNode || !targetNode) {
        return false;
      }
      return nodeHasSourceHandle(sourceNode.type) && nodeHasTargetHandle(targetNode.type);
    })
    .map((edge) => {
      const targetNode = nodeMap.get(edge.target) as CanvasNode;
      const rawTargetHandle =
        normalizeHandleId((edge as CanvasEdge & { targetHandle?: DynamicValue }).targetHandle) ?? 'target';
      return {
        ...edge,
        type: edge.type ?? 'disconnectableEdge',
        sourceHandle:
          normalizeHandleId((edge as CanvasEdge & { sourceHandle?: DynamicValue }).sourceHandle) ?? 'source',
        targetHandle: migrateLegacyTargetHandle(targetNode, rawTargetHandle),
      };
    });
}

export function normalizeNodes(rawNodes: CanvasNode[]): CanvasNode[] {
  return rawNodes
    .map((node) => {
      if (!Object.values(CANVAS_NODE_TYPES).includes(node.type as CanvasNodeType)) {
        return null;
      }

      const normalizedType = node.type as CanvasNodeType;
      const definition = nodeCatalog.getDefinition(normalizedType);
      const mergedData = {
        ...definition.createDefaultData(),
        ...(node.data as Partial<CanvasNodeData>),
      } as CanvasNodeData;

      if (normalizedType === CANVAS_NODE_TYPES.storyboardSplit) {
        const frames = (mergedData as { frames?: StoryboardFrameItem[] }).frames ?? [];
        const firstFrameAspectRatio = frames.find((frame) => typeof frame.aspectRatio === 'string')
          ?.aspectRatio;
        const normalizedFrameAspectRatio =
          (typeof (mergedData as { frameAspectRatio?: DynamicValue }).frameAspectRatio === 'string'
            ? (mergedData as { frameAspectRatio?: string }).frameAspectRatio
            : null) ??
          firstFrameAspectRatio ??
          DEFAULT_ASPECT_RATIO;

        (mergedData as { frameAspectRatio: string }).frameAspectRatio = normalizedFrameAspectRatio;
        (mergedData as { frames: StoryboardFrameItem[] }).frames = frames.map((frame, index) => ({
          id: frame.id,
          imageUrl: frame.imageUrl ?? null,
          previewImageUrl: frame.previewImageUrl ?? null,
          aspectRatio:
            typeof frame.aspectRatio === 'string'
              ? frame.aspectRatio
              : normalizedFrameAspectRatio,
          note: frame.note ?? '',
          ...(frame.noteDocument ? { noteDocument: frame.noteDocument } : {}),
          order: Number.isFinite(frame.order) ? frame.order : index,
        }));

        const rawExportOptions = (mergedData as { exportOptions?: Partial<StoryboardExportOptions> })
          .exportOptions;
        const rawFontSize = Number.isFinite(rawExportOptions?.fontSize)
          ? Number(rawExportOptions?.fontSize)
          : createDefaultStoryboardExportOptions().fontSize;
        const normalizedFontSize = rawFontSize > 20
          ? Math.round(rawFontSize / 6)
          : rawFontSize;
        (mergedData as { exportOptions: StoryboardExportOptions }).exportOptions = {
          ...createDefaultStoryboardExportOptions(),
          ...(rawExportOptions ?? {}),
          fontSize: Math.max(1, Math.min(20, Math.round(normalizedFontSize))),
        };
      }

      if (
        normalizedType === CANVAS_NODE_TYPES.imageEdit
        || normalizedType === CANVAS_NODE_TYPES.panoramaGen
        || normalizedType === CANVAS_NODE_TYPES.relightGen
        || normalizedType === CANVAS_NODE_TYPES.upscaleGen
        || normalizedType === CANVAS_NODE_TYPES.portraitTextureGen
        || normalizedType === CANVAS_NODE_TYPES.elementEditGen
        || normalizedType === CANVAS_NODE_TYPES.layerSeparationGen
        || normalizedType === CANVAS_NODE_TYPES.storyboardGen
      ) {
        migrateGenerationNodeData(mergedData as DynamicValueMap);
      }

      if (
        normalizedType === CANVAS_NODE_TYPES.imageEdit
        || normalizedType === CANVAS_NODE_TYPES.panoramaGen
        || normalizedType === CANVAS_NODE_TYPES.relightGen
        || normalizedType === CANVAS_NODE_TYPES.multiAngleGen
        || normalizedType === CANVAS_NODE_TYPES.upscaleGen
        || normalizedType === CANVAS_NODE_TYPES.portraitTextureGen
        || normalizedType === CANVAS_NODE_TYPES.elementEditGen
        || normalizedType === CANVAS_NODE_TYPES.layerSeparationGen
        || normalizedType === CANVAS_NODE_TYPES.videoGen
        || normalizedType === CANVAS_NODE_TYPES.audioGen
        || normalizedType === CANVAS_NODE_TYPES.textProcessing
      ) {
        migrateGenerationPromptData(mergedData as DynamicValueMap);
      }

      if (normalizedType === CANVAS_NODE_TYPES.panoramaGen) {
        migratePanoramaGenerationData(mergedData as DynamicValueMap);
      }

      if (normalizedType === CANVAS_NODE_TYPES.relightGen) {
        migrateRelightGenerationData(mergedData as DynamicValueMap);
      }

      if (normalizedType === CANVAS_NODE_TYPES.multiAngleGen) {
        migrateMultiAngleGenerationData(mergedData as DynamicValueMap);
      }

      if (normalizedType === CANVAS_NODE_TYPES.upscaleGen) {
        migrateUpscaleGenerationData(mergedData as DynamicValueMap);
      }

      if (normalizedType === CANVAS_NODE_TYPES.portraitTextureGen) {
        migratePortraitTextureGenerationData(mergedData as DynamicValueMap);
      }

      if (normalizedType === CANVAS_NODE_TYPES.elementEditGen) {
        migrateElementEditGenerationData(mergedData as DynamicValueMap);
      }

      if (normalizedType === CANVAS_NODE_TYPES.layerSeparationGen) {
        migrateLayerSeparationGenerationData(mergedData as DynamicValueMap);
      }

      if (normalizedType === CANVAS_NODE_TYPES.layerStackResult) {
        migrateLayerStackResultData(mergedData as DynamicValueMap);
      }

      if (normalizedType === CANVAS_NODE_TYPES.storyboardGen) {
        migrateStoryboardGenerationData(mergedData as DynamicValueMap);
      }

      if (normalizedType === CANVAS_NODE_TYPES.exportImage) {
        if (!Object.prototype.hasOwnProperty.call(node.data, 'resultKind')) {
          (mergedData as DynamicValueMap).resultKind = 'image';
        }
        migrateExportImageResultKind(mergedData as DynamicValueMap);
      }

      if (normalizedType === CANVAS_NODE_TYPES.panoramaViewer) {
        migratePanoramaViewerData(mergedData as DynamicValueMap);
      }

      if ('aspectRatio' in mergedData && !mergedData.aspectRatio) {
        mergedData.aspectRatio = DEFAULT_ASPECT_RATIO;
      }

      migrateLegacyGenerationDisplayName(
        normalizedType,
        mergedData as DynamicValueMap
      );

      // 后台任务不会跨应用重启恢复，统一清理节点内持久化的瞬时运行态。
      resetTransientNodeRuntimeState(
        normalizedType,
        mergedData as DynamicValueMap
      );

      const normalizedNode: CanvasNode = {
        ...node,
        type: normalizedType,
        data: mergedData,
      };
      return normalizedNode;
    })
    .filter((node): node is CanvasNode => Boolean(node));
}

export function normalizeHistory(history?: CanvasHistoryState): CanvasHistoryState {
  if (!history) {
    return { past: [], future: [] };
  }

  const normalizeSnapshot = (snapshot: CanvasHistorySnapshot): CanvasHistorySnapshot => {
    const normalizedNodes = normalizeNodes(snapshot.nodes);
    return {
      nodes: normalizedNodes,
      edges: normalizeEdgesWithNodes(snapshot.edges, normalizedNodes),
    };
  };

  return {
    past: history.past.slice(-MAX_HISTORY_STEPS).map(normalizeSnapshot),
    future: history.future.slice(-MAX_HISTORY_STEPS).map(normalizeSnapshot),
  };
}
