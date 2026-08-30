import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_NODE_WIDTH,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type ActiveToolDialog,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
  type StoryboardExportOptions,
} from '@/features/canvas/domain/canvasNodes';
import { getCanvasNodeDefinition } from '@/features/canvas/domain/nodeRegistry';
import {
  ensureAtLeastOneMinEdge,
  resolveAdaptiveAutoFitSize,
  resolveMinEdgeFittedSize,
  resolveSizeInsideTargetBox,
} from '@/features/canvas/application/imageNodeSizing';
import { getNodeIndexById } from '@/features/canvas/domain/connectionIndex';
import { CANVAS_BG_HEX, CANVAS_TEXT_HEX } from '@/core/theme/colorTokens';
import type {
  CanvasHistorySnapshot,
  CanvasImageViewerState,
} from './canvasStore';

export const MAX_HISTORY_STEPS = 50;
const IMAGE_NODE_VISUAL_MIN_EDGE = 96;

export function createClosedCanvasImageViewerState(): CanvasImageViewerState {
  return {
    isOpen: false,
    currentImageUrl: null,
    imageList: [],
    currentIndex: 0,
    mode: 'image',
    sourceNodeId: null,
  };
}

export function createSnapshot(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasHistorySnapshot {
  return { nodes, edges };
}

export function collectNodeIdsWithDescendants(nodes: CanvasNode[], seedIds: string[]): Set<string> {
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

export function getNodeSize(node: CanvasNode): { width: number; height: number } {
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

export function isMediaAutoResizableType(type: CanvasNodeType): boolean {
  return type === CANVAS_NODE_TYPES.upload
    || type === CANVAS_NODE_TYPES.imageEdit
    || type === CANVAS_NODE_TYPES.exportImage
    || type === CANVAS_NODE_TYPES.exportVideo
    || type === CANVAS_NODE_TYPES.videoUpload;
}

export function isManualSizeTrackingNodeType(type: CanvasNodeType): boolean {
  return isMediaAutoResizableType(type)
    || getCanvasNodeDefinition(type)?.executionKind === 'standard-generation';
}

export function isModelSelectorNodeType(type: CanvasNodeType): boolean {
  return type === CANVAS_NODE_TYPES.imageModelSelector
    || type === CANVAS_NODE_TYPES.videoModelSelector
    || type === CANVAS_NODE_TYPES.audioModelSelector;
}

/** 上传类节点（图片/视频）始终按当前尺寸自适应重新贴合，不受手动调整锁定影响 */
export function isAdaptiveUploadNodeType(type: CanvasNodeType): boolean {
  return type === CANVAS_NODE_TYPES.upload || type === CANVAS_NODE_TYPES.videoUpload;
}

export function withManualSizeLock(node: CanvasNode): CanvasNode {
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

export function resolveAutoImageNodeDimensions(
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

export function resolveGeneratedImageNodeDimensions(
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

export function resolveDerivedAspectRatio(
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
export function maybeApplyMediaAutoResize(
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

export function resolveAbsolutePosition(
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

export function pushSnapshot(
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

export function getDerivedNodePosition(nodes: CanvasNode[], sourceNodeId: string): { x: number; y: number } {
  const sourceNode = nodes.find((node) => node.id === sourceNodeId);
  if (!sourceNode) {
    return { x: 100, y: 100 };
  }

  return {
    x: sourceNode.position.x + DEFAULT_NODE_WIDTH + 100,
    y: sourceNode.position.y,
  };
}

export function resolveSelectedNodeId(selectedNodeId: string | null, nodes: CanvasNode[]): string | null {
  if (!selectedNodeId) {
    return null;
  }
  // 这两个 resolve 函数总是在同一次 set() 里用同一份 nodes 引用各调一次；
  // 复用 getNodeIndexById 的单槎缓存，O(n) 建一次索引比两次各自 O(n) 的 .some() 扫描更省，
  // 且建好的索引能被同一帧内其他消费者（如 DisconnectableEdge 的 selector）直接复用。
  return getNodeIndexById(nodes).has(selectedNodeId) ? selectedNodeId : null;
}

export function resolveActiveToolDialog(
  activeToolDialog: ActiveToolDialog | null,
  nodes: CanvasNode[]
): ActiveToolDialog | null {
  if (!activeToolDialog) {
    return null;
  }
  return getNodeIndexById(nodes).has(activeToolDialog.nodeId) ? activeToolDialog : null;
}

export function createDefaultStoryboardExportOptions(): StoryboardExportOptions {
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
