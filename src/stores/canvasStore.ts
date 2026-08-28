import { create } from 'zustand';
import {
  Connection,
  EdgeChange,
  NodeChange,
  type Viewport,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react';

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_NODE_WIDTH,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  MODEL_SELECTOR_COLLAPSED_DEFAULT_HEIGHT,
  MODEL_SELECTOR_COLLAPSED_DEFAULT_WIDTH,
  MODEL_SELECTOR_EXPANDED_DEFAULT_HEIGHT,
  MODEL_SELECTOR_EXPANDED_DEFAULT_WIDTH,
  type ActiveToolDialog,
  type CanvasEdge,
  type CanvasConnectionInput,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
  type CanvasImageViewerMode,
  type CanvasImageViewerRequest,
  type ExportImageNodeResultKind,
  type NodeToolType,
  type StoryboardExportOptions,
  type StoryboardFrameItem,
  type UploadPlaceholderResolution,
  isStoryboardSplitNode,
  resolveCanvasImageViewerMode,
} from '@/features/canvas/domain/canvasNodes';
import {
  getCanvasNodeDefinition,
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from '@/features/canvas/domain/nodeRegistry';
import { DEFAULT_NODE_DISPLAY_NAME, EXPORT_RESULT_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import {
  migrateGenerationNodeData,
  migrateGenerationPromptData,
  migrateExportImageResultKind,
  migrateLegacyGenerationDisplayName,
  migrateLegacyTargetHandle,
  resetTransientNodeRuntimeState,
} from '@/features/canvas/domain/nodeMigrations';
import { nodeCatalog } from '@/features/canvas/application/nodeCatalog';
import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import {
  ensureAtLeastOneMinEdge,
  resolveAdaptiveAutoFitSize,
  resolveMinEdgeFittedSize,
  resolveSizeInsideTargetBox,
} from '@/features/canvas/application/imageNodeSizing';
import { CANVAS_BG_HEX, CANVAS_TEXT_HEX } from '@/core/theme/colorTokens';
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useCanvasTextStreamStore } from '@/stores/canvasTextStreamStore';
import {
  findStaleParamEdgeIds,
  resolveConnectionSourceMediaKind,
} from '@/features/canvas/application/graphValueResolver';
import { getNodeIndexById, wouldCreateCanvasCycle } from '@/features/canvas/domain/connectionIndex';
import { PROMPT_PARAM_ID, parseParamPortId } from '@/features/canvas/domain/socketTypes';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  reconcileAssetGroupGraph,
  setAssetGroupMemberExcludedGraph,
  type AssetGroupGraph,
} from '@/features/canvas/application/assetGroupGraph';

export type {
  ActiveToolDialog,
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  CanvasNodeType,
  NodeToolType,
  StoryboardFrameItem,
};

export interface CanvasHistorySnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasHistoryState {
  past: CanvasHistorySnapshot[];
  future: CanvasHistorySnapshot[];
}

export interface CanvasImageViewerState {
  isOpen: boolean;
  currentImageUrl: string | null;
  imageList: string[];
  currentIndex: number;
  mode: CanvasImageViewerMode;
  sourceNodeId: string | null;
}

export interface OpenCanvasImageViewer {
  (imageUrl: string, imageList?: string[]): void;
  (request: CanvasImageViewerRequest): void;
}

function createClosedCanvasImageViewerState(): CanvasImageViewerState {
  return {
    isOpen: false,
    currentImageUrl: null,
    imageList: [],
    currentIndex: 0,
    mode: 'image',
    sourceNodeId: null,
  };
}

export interface CanvasHistoryGroupOptions {
  historyGroup?: string;
  /** 惰性数据迁移/稳定 ID 修复使用：更新节点但不制造用户可见的撤销步骤。 */
  skipHistory?: boolean;
}

const MAX_HISTORY_STEPS = 50;
const IMAGE_NODE_VISUAL_MIN_EDGE = 96;

interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  activeToolDialog: ActiveToolDialog | null;
  history: CanvasHistoryState;
  dragHistorySnapshot: CanvasHistorySnapshot | null;
  activeHistoryGroup: string | null;
  currentViewport: Viewport;
  canvasViewportSize: { width: number; height: number };
  imageViewer: CanvasImageViewerState;

  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<CanvasEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  connectMany: (connections: CanvasConnectionInput[]) => string[];
  commitAssetGroupGraph: (graph: AssetGroupGraph, selectedNodeId?: string | null) => void;

  setCanvasData: (nodes: CanvasNode[], edges: CanvasEdge[], history?: CanvasHistoryState) => void;
  addNode: (
    type: CanvasNodeType,
    position: { x: number; y: number },
    data?: Partial<CanvasNodeData>
  ) => string;
  addEdge: (source: string, target: string) => string | null;
  /** 文本处理首次运行且没有输出时，原子创建并连接一个文本展示节点。 */
  ensureTextDisplayOutput: (
    sourceNodeId: string,
    data?: Partial<CanvasNodeData>
  ) => string | null;
  findNodePosition: (sourceNodeId: string, newNodeWidth: number, newNodeHeight: number) => { x: number; y: number };
  addDerivedUploadNode: (
    sourceNodeId: string,
    imageUrl: string,
    aspectRatio: string,
    previewImageUrl?: string
  ) => string | null;
  addDerivedExportNode: (
    sourceNodeId: string,
    imageUrl: string,
    aspectRatio: string,
    previewImageUrl?: string,
    options?: {
      defaultTitle?: string;
      resultKind?: ExportImageNodeResultKind;
      aspectRatioStrategy?: 'provided' | 'derivedFromSource';
      sizeStrategy?: 'generated' | 'autoMinEdge' | 'matchSource';
      matchSourceNodeSize?: boolean;
    }
  ) => string | null;
  addStoryboardSplitNode: (
    sourceNodeId: string,
    rows: number,
    cols: number,
    frames: StoryboardFrameItem[],
    frameAspectRatio?: string
  ) => string | null;

  updateNodeData: (
    nodeId: string,
    data: Partial<CanvasNodeData>,
    options?: CanvasHistoryGroupOptions
  ) => void;
  /** 受控媒体导入完成后，把类型待定的上传节点原位替换为具体媒体源节点。 */
  resolveUploadPlaceholder: (
    nodeId: string,
    resolution: UploadPlaceholderResolution
  ) => boolean;
  endHistoryGroup: (historyGroup: string) => void;
  /** 模型选择器节点展开/折叠专用：collapsedWidth 由组件按当前选中模型 chip 的实测内容宽度传入，
   * 让折叠态节点尺寸精确收紧到内容可容纳的最小宽度，而不是固定常量。 */
  setModelSelectorExpanded: (nodeId: string, isExpanded: boolean, collapsedWidth?: number) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  updateStoryboardFrame: (
    nodeId: string,
    frameId: string,
    data: Partial<StoryboardFrameItem>,
    options?: CanvasHistoryGroupOptions
  ) => void;
  reorderStoryboardFrame: (
    nodeId: string,
    draggedFrameId: string,
    targetFrameId: string
  ) => void;

  deleteNode: (nodeId: string) => void;
  deleteNodes: (nodeIds: string[]) => void;
  groupNodes: (nodeIds: string[]) => string | null;
  ungroupNode: (groupNodeId: string) => boolean;
  deleteEdge: (edgeId: string) => void;
  setSelectedNode: (nodeId: string | null) => void;

  openToolDialog: (dialog: ActiveToolDialog) => void;
  closeToolDialog: () => void;
  setViewportState: (viewport: Viewport) => void;
  setCanvasViewportSize: (size: { width: number; height: number }) => void;
  openImageViewer: OpenCanvasImageViewer;
  closeImageViewer: () => void;
  navigateImageViewer: (direction: 'prev' | 'next') => void;

  undo: () => boolean;
  redo: () => boolean;

  clearCanvas: () => void;
}

function normalizeHandleId(value: DynamicValue): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
    return undefined;
  }
  return trimmed;
}

function normalizeEdgesWithNodes(rawEdges: CanvasEdge[], nodes: CanvasNode[]): CanvasEdge[] {
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

function normalizeNodes(rawNodes: CanvasNode[]): CanvasNode[] {
  return rawNodes
    .map((node) => {
      if (!Object.values(CANVAS_NODE_TYPES).includes(node.type as CanvasNodeType)) {
        return null;
      }

      const definition = nodeCatalog.getDefinition(node.type as CanvasNodeType);
      const mergedData = {
        ...definition.createDefaultData(),
        ...(node.data as Partial<CanvasNodeData>),
      } as CanvasNodeData;

      if (node.type === CANVAS_NODE_TYPES.storyboardSplit) {
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
        node.type === CANVAS_NODE_TYPES.imageEdit
        || node.type === CANVAS_NODE_TYPES.storyboardGen
      ) {
        migrateGenerationNodeData(mergedData as DynamicValueMap);
      }

      if (
        node.type === CANVAS_NODE_TYPES.imageEdit
        || node.type === CANVAS_NODE_TYPES.videoGen
        || node.type === CANVAS_NODE_TYPES.audioGen
        || node.type === CANVAS_NODE_TYPES.textProcessing
      ) {
        migrateGenerationPromptData(mergedData as DynamicValueMap);
      }

      if (node.type === CANVAS_NODE_TYPES.exportImage) {
        if (!Object.prototype.hasOwnProperty.call(node.data, 'resultKind')) {
          (mergedData as DynamicValueMap).resultKind = 'image';
        }
        migrateExportImageResultKind(mergedData as DynamicValueMap);
      }

      if ('aspectRatio' in mergedData && !mergedData.aspectRatio) {
        mergedData.aspectRatio = DEFAULT_ASPECT_RATIO;
      }

      migrateLegacyGenerationDisplayName(
        node.type as CanvasNodeType,
        mergedData as DynamicValueMap
      );

      // 后台任务不会跨应用重启恢复，统一清理节点内持久化的瞬时运行态。
      resetTransientNodeRuntimeState(
        node.type as CanvasNodeType,
        mergedData as DynamicValueMap
      );

      return {
        ...node,
        type: node.type as CanvasNodeType,
        data: mergedData,
      };
    })
    .filter((node): node is CanvasNode => Boolean(node));
}

function normalizeHistory(history?: CanvasHistoryState): CanvasHistoryState {
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

function createSnapshot(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasHistorySnapshot {
  return { nodes, edges };
}

function collectNodeIdsWithDescendants(nodes: CanvasNode[], seedIds: string[]): Set<string> {
  const deleteSet = new Set(seedIds);
  let changed = true;

  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!node.parentId || deleteSet.has(node.id)) {
        continue;
      }
      if (deleteSet.has(node.parentId)) {
        deleteSet.add(node.id);
        changed = true;
      }
    }
  }

  return deleteSet;
}

function getNodeSize(node: CanvasNode): { width: number; height: number } {
  return {
    width:
      typeof node.measured?.width === 'number'
        ? node.measured.width
        : typeof node.width === 'number'
          ? node.width
          : DEFAULT_NODE_WIDTH,
    height:
      typeof node.measured?.height === 'number'
        ? node.measured.height
        : typeof node.height === 'number'
          ? node.height
          : 200,
  };
}

function isMediaAutoResizableType(type: CanvasNodeType): boolean {
  return type === CANVAS_NODE_TYPES.upload
    || type === CANVAS_NODE_TYPES.imageEdit
    || type === CANVAS_NODE_TYPES.exportImage
    || type === CANVAS_NODE_TYPES.exportVideo
    || type === CANVAS_NODE_TYPES.videoUpload;
}

function isManualSizeTrackingNodeType(type: CanvasNodeType): boolean {
  return isMediaAutoResizableType(type)
    || type === CANVAS_NODE_TYPES.videoGen
    || type === CANVAS_NODE_TYPES.audioGen;
}

function isModelSelectorNodeType(type: CanvasNodeType): boolean {
  return type === CANVAS_NODE_TYPES.imageModelSelector
    || type === CANVAS_NODE_TYPES.videoModelSelector
    || type === CANVAS_NODE_TYPES.audioModelSelector;
}

/** 上传类节点（图片/视频）始终按当前尺寸自适应重新贴合，不受手动调整锁定影响 */
function isAdaptiveUploadNodeType(type: CanvasNodeType): boolean {
  return type === CANVAS_NODE_TYPES.upload || type === CANVAS_NODE_TYPES.videoUpload;
}

function withManualSizeLock(node: CanvasNode): CanvasNode {
  const nodeData = node.data as CanvasNodeData & { isSizeManuallyAdjusted?: boolean };
  if (nodeData.isSizeManuallyAdjusted) {
    return node;
  }

  return {
    ...node,
    data: {
      ...node.data,
      isSizeManuallyAdjusted: true,
    } as CanvasNodeData,
  };
}

function resolveAutoImageNodeDimensions(
  aspectRatio: string,
  options?: {
    minWidth?: number;
    minHeight?: number;
  }
): { width: number; height: number } {
  const minWidth = options?.minWidth ?? EXPORT_RESULT_NODE_MIN_WIDTH;
  const minHeight = options?.minHeight ?? EXPORT_RESULT_NODE_MIN_HEIGHT;
  return resolveMinEdgeFittedSize(aspectRatio, { minWidth, minHeight });
}

function resolveGeneratedImageNodeDimensions(
  aspectRatio: string,
  options?: {
    minWidth?: number;
    minHeight?: number;
  }
): { width: number; height: number } {
  const size = resolveSizeInsideTargetBox(aspectRatio, {
    width: EXPORT_RESULT_NODE_DEFAULT_WIDTH,
    height: EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  });
  const minWidth = options?.minWidth ?? IMAGE_NODE_VISUAL_MIN_EDGE;
  const minHeight = options?.minHeight ?? IMAGE_NODE_VISUAL_MIN_EDGE;

  return ensureAtLeastOneMinEdge(size, { minWidth, minHeight });
}

function resolveDerivedAspectRatio(
  sourceNode: CanvasNode | undefined,
  fallbackAspectRatio: string
): string {
  if (!sourceNode) {
    return fallbackAspectRatio;
  }

  if (sourceNode.type === CANVAS_NODE_TYPES.storyboardGen) {
    const data = sourceNode.data as { requestAspectRatio?: string; aspectRatio?: string };
    const preferred = data.requestAspectRatio && data.requestAspectRatio !== 'auto'
      ? data.requestAspectRatio
      : data.aspectRatio;
    return preferred || fallbackAspectRatio;
  }

  if (sourceNode.type === CANVAS_NODE_TYPES.storyboardSplit) {
    const data = sourceNode.data as { frameAspectRatio?: string; aspectRatio?: string };
    return data.frameAspectRatio || data.aspectRatio || fallbackAspectRatio;
  }

  if (sourceNode.type === CANVAS_NODE_TYPES.imageEdit) {
    const data = sourceNode.data as { requestAspectRatio?: string; aspectRatio?: string };
    const preferred = data.requestAspectRatio && data.requestAspectRatio !== 'auto'
      ? data.requestAspectRatio
      : data.aspectRatio;
    return preferred || fallbackAspectRatio;
  }

  const imageLikeAspect = (sourceNode.data as { aspectRatio?: string }).aspectRatio;
  return imageLikeAspect || fallbackAspectRatio;
}

/**
 * node 为补丁应用前的原始节点，mergedData 为已合并的新数据。
 * 上传类节点（图片/视频）每次内容变化都会重新计算尺寸：
 * - 首次上传内容为空 -> 参考尺寸退化为最小尺寸，结果即为最小可拖拽尺寸
 * - 重新上传已有内容 -> 参考尺寸取节点当前尺寸，按新比例自适应贴合，不低于最小可拖拽尺寸
 * 其余类型（AI 编辑结果、导出结果）维持原有“手动调整后锁定”行为。
 */
function maybeApplyMediaAutoResize(
  node: CanvasNode,
  mergedData: CanvasNodeData,
  patch: Partial<CanvasNodeData>
): CanvasNode {
  if (!isMediaAutoResizableType(node.type)) {
    return { ...node, data: mergedData };
  }

  const previousData = node.data as CanvasNodeData & {
    imageUrl?: string | null;
    videoUrl?: string | null;
  };
  const nextData = mergedData as CanvasNodeData & {
    imageUrl?: string | null;
    videoUrl?: string | null;
    aspectRatio?: string;
    isSizeManuallyAdjusted?: boolean;
  };
  const patchData = patch as Partial<CanvasNodeData> & {
    imageUrl?: string | null;
    videoUrl?: string | null;
    aspectRatio?: string;
  };

  const hasMediaRelatedChange = 'imageUrl' in patchData
    || 'videoUrl' in patchData
    || 'previewImageUrl' in patchData
    || 'aspectRatio' in patchData;
  if (!hasMediaRelatedChange) {
    return { ...node, data: mergedData };
  }

  const isAdaptiveUploadType = isAdaptiveUploadNodeType(node.type);
  if (nextData.isSizeManuallyAdjusted && !isAdaptiveUploadType) {
    return { ...node, data: mergedData };
  }

  // 上传类节点只要新比例到位就立即重新适配，不必等真正的图片/视频地址落地——
  // 否则会先维持旧尺寸，等地址写入后才突然跳变，产生明显的“慢半拍”感。
  // 其余类型（AI 编辑结果、图片/视频结果）仍要求媒体地址已写入才计算尺寸。
  const readyToResize = isAdaptiveUploadType
    ? 'aspectRatio' in patchData
    : (typeof nextData.imageUrl === 'string' && nextData.imageUrl.trim().length > 0)
      || (typeof nextData.videoUrl === 'string' && nextData.videoUrl.trim().length > 0);
  if (!readyToResize) {
    return { ...node, data: mergedData };
  }

  const nextAspectRatio = nextData.aspectRatio ?? DEFAULT_ASPECT_RATIO;

  let nextSize: { width: number; height: number };
  if (isAdaptiveUploadType) {
    const previousContentUrl = previousData.imageUrl ?? previousData.videoUrl;
    const hadExistingContent = typeof previousContentUrl === 'string' && previousContentUrl.trim().length > 0;
    const baseConstraints = { minWidth: EXPORT_RESULT_NODE_MIN_WIDTH, minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT };
    const referenceSize = hadExistingContent
      ? getNodeSize(node)
      : { width: baseConstraints.minWidth, height: baseConstraints.minHeight };
    nextSize = resolveAdaptiveAutoFitSize(nextAspectRatio, referenceSize, baseConstraints);
  } else {
    nextSize = node.type === CANVAS_NODE_TYPES.exportImage || node.type === CANVAS_NODE_TYPES.exportVideo
      ? resolveAutoImageNodeDimensions(nextAspectRatio, {
        minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
        minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
      })
      : resolveAutoImageNodeDimensions(nextAspectRatio);
  }

  return {
    ...node,
    data: mergedData,
    width: nextSize.width,
    height: nextSize.height,
    style: {
      ...(node.style ?? {}),
      width: nextSize.width,
      height: nextSize.height,
    },
  };
}

function resolveAbsolutePosition(
  node: CanvasNode,
  nodeMap: Map<string, CanvasNode>
): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let currentParentId = node.parentId;
  const visited = new Set<string>();

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parent = nodeMap.get(currentParentId);
    if (!parent) {
      break;
    }
    x += parent.position.x;
    y += parent.position.y;
    currentParentId = parent.parentId;
  }

  return { x, y };
}

function pushSnapshot(
  snapshots: CanvasHistorySnapshot[],
  snapshot: CanvasHistorySnapshot
): CanvasHistorySnapshot[] {
  const last = snapshots[snapshots.length - 1];
  if (last && last.nodes === snapshot.nodes && last.edges === snapshot.edges) {
    return snapshots;
  }

  const next = [...snapshots, snapshot];
  if (next.length > MAX_HISTORY_STEPS) {
    next.shift();
  }
  return next;
}

function getDerivedNodePosition(nodes: CanvasNode[], sourceNodeId: string): { x: number; y: number } {
  const sourceNode = nodes.find((node) => node.id === sourceNodeId);
  if (!sourceNode) {
    return { x: 100, y: 100 };
  }

  return {
    x: sourceNode.position.x + DEFAULT_NODE_WIDTH + 100,
    y: sourceNode.position.y,
  };
}

function resolveSelectedNodeId(selectedNodeId: string | null, nodes: CanvasNode[]): string | null {
  if (!selectedNodeId) {
    return null;
  }
  // 这两个 resolve 函数总是在同一次 set() 里用同一份 nodes 引用各调一次；
  // 复用 getNodeIndexById 的单槎缓存，O(n) 建一次索引比两次各自 O(n) 的 .some() 扫描更省，
  // 且建好的索引能被同一帧内其他消费者（如 DisconnectableEdge 的 selector）直接复用。
  return getNodeIndexById(nodes).has(selectedNodeId) ? selectedNodeId : null;
}

function resolveActiveToolDialog(
  activeToolDialog: ActiveToolDialog | null,
  nodes: CanvasNode[]
): ActiveToolDialog | null {
  if (!activeToolDialog) {
    return null;
  }
  return getNodeIndexById(nodes).has(activeToolDialog.nodeId) ? activeToolDialog : null;
}

function createDefaultStoryboardExportOptions(): StoryboardExportOptions {
  return {
    showFrameIndex: false,
    showFrameNote: false,
    notePlacement: 'overlay',
    imageFit: 'cover',
    frameIndexPrefix: 'S',
    cellGap: 8,
    outerPadding: 0,
    fontSize: 4,
    backgroundColor: CANVAS_BG_HEX,
    textColor: CANVAS_TEXT_HEX,
  };
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  activeToolDialog: null,
  history: { past: [], future: [] },
  dragHistorySnapshot: null,
  activeHistoryGroup: null,
  currentViewport: { x: 0, y: 0, zoom: 1 },
  canvasViewportSize: { width: 0, height: 0 },
  imageViewer: createClosedCanvasImageViewerState(),

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

    const newEdge: CanvasEdge = {
      id: edgeId,
      source,
      target,
      sourceHandle: 'source',
      targetHandle: 'target',
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
    const sourceNode = state.nodes.find((n) => n.id === sourceNodeId);
    if (!sourceNode) {
      return { x: 100, y: 100 };
    }

    // Helper to check if a position collides with existing nodes.
    const collides = (x: number, y: number, width: number, height: number) => {
      return state.nodes.some((node) => {
        const nodeWidth = node.measured?.width ?? DEFAULT_NODE_WIDTH;
        const nodeHeight = node.measured?.height ?? 200;
        const margin = 8;
        return (
          x < node.position.x + nodeWidth + margin &&
          x + width + margin > node.position.x &&
          y < node.position.y + nodeHeight + margin &&
          y + height + margin > node.position.y
        );
      });
    };

    const sourceWidth = sourceNode.measured?.width ?? DEFAULT_NODE_WIDTH;
    const sourceHeight = sourceNode.measured?.height ?? 200;
    const anchorX = sourceNode.position.x + sourceWidth + 28;
    const anchorY = sourceNode.position.y;

    const zoom = Math.max(0.01, state.currentViewport.zoom || 1);
    const viewportWidth = state.canvasViewportSize.width;
    const viewportHeight = state.canvasViewportSize.height;
    const hasViewportBounds = viewportWidth > 0 && viewportHeight > 0;
    const visibleBounds = hasViewportBounds
      ? {
          minX: -state.currentViewport.x / zoom,
          minY: -state.currentViewport.y / zoom,
          maxX: -state.currentViewport.x / zoom + viewportWidth / zoom,
          maxY: -state.currentViewport.y / zoom + viewportHeight / zoom,
        }
      : null;

    const overflowAmount = (x: number, y: number): number => {
      if (!visibleBounds) {
        return 0;
      }
      const overLeft = Math.max(0, visibleBounds.minX - x);
      const overTop = Math.max(0, visibleBounds.minY - y);
      const overRight = Math.max(0, x + newNodeWidth - visibleBounds.maxX);
      const overBottom = Math.max(0, y + newNodeHeight - visibleBounds.maxY);
      return overLeft + overTop + overRight + overBottom;
    };

    const stepX = Math.max(newNodeWidth + 12, 110);
    const stepY = Math.max(Math.round(newNodeHeight * 0.35), 54);
    const baseCandidates = [
      { x: anchorX, y: anchorY },
      { x: sourceNode.position.x, y: sourceNode.position.y + sourceHeight + 20 },
      { x: sourceNode.position.x - newNodeWidth - 20, y: sourceNode.position.y },
      { x: sourceNode.position.x, y: sourceNode.position.y - newNodeHeight - 20 },
    ];

    let bestInView: { x: number; y: number; score: number } | null = null;
    let bestOutOfView: { x: number; y: number; score: number } | null = null;

    const evaluateCandidate = (x: number, y: number) => {
      if (collides(x, y, newNodeWidth, newNodeHeight)) {
        return;
      }

      const dx = x - anchorX;
      const dy = y - anchorY;
      const distanceScore = Math.hypot(dx, dy);
      const upwardPenalty = dy < 0 ? Math.abs(dy) * 0.25 : 0;
      const overflow = overflowAmount(x, y);
      const score = distanceScore + upwardPenalty + overflow * 1000;
      const candidate = { x, y, score };

      if (overflow === 0) {
        if (!bestInView || score < bestInView.score) {
          bestInView = candidate;
        }
      } else if (!bestOutOfView || score < bestOutOfView.score) {
        bestOutOfView = candidate;
      }
    };

    for (const base of baseCandidates) {
      evaluateCandidate(base.x, base.y);
    }

    for (let ring = 1; ring <= 8; ring += 1) {
      const offsets = [
        { x: ring, y: 0 },
        { x: ring, y: 1 },
        { x: ring, y: -1 },
        { x: 0, y: ring },
        { x: 0, y: -ring },
        { x: -ring, y: 0 },
        { x: ring, y: 2 },
        { x: ring, y: -2 },
        { x: -ring, y: 1 },
        { x: -ring, y: -1 },
      ];
      for (const offset of offsets) {
        evaluateCandidate(anchorX + offset.x * stepX, anchorY + offset.y * stepY);
      }
    }

    // If ring sampling misses an available slot in current viewport,
    // run a denser viewport sweep before falling back outside view.
    if (!bestInView && visibleBounds) {
      const padding = 8;
      const minX = visibleBounds.minX + padding;
      const maxX = visibleBounds.maxX - newNodeWidth - padding;
      const minY = visibleBounds.minY + padding;
      const maxY = visibleBounds.maxY - newNodeHeight - padding;

      if (maxX >= minX && maxY >= minY) {
        const scanStepX = Math.max(42, Math.round(newNodeWidth * 0.32));
        const scanStepY = Math.max(42, Math.round(newNodeHeight * 0.32));

        for (let y = minY; y <= maxY; y += scanStepY) {
          for (let x = minX; x <= maxX; x += scanStepX) {
            evaluateCandidate(x, y);
          }
        }

        // Ensure boundary positions are also considered.
        evaluateCandidate(minX, minY);
        evaluateCandidate(maxX, minY);
        evaluateCandidate(minX, maxY);
        evaluateCandidate(maxX, maxY);
      }
    }

    const resolvedCandidate = (bestInView || bestOutOfView) as
      | { x: number; y: number; score: number }
      | null;
    if (resolvedCandidate) {
      return { x: resolvedCandidate.x, y: resolvedCandidate.y };
    }

    return { x: anchorX + 2 * stepX, y: anchorY };
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
    const derivedSize = resolveGeneratedImageNodeDimensions(resolvedAspectRatio);
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
}));
