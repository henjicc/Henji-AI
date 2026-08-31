import { create, type StoreApi } from 'zustand';
import type {
  Connection,
  EdgeChange,
  NodeChange,
  Viewport,
} from '@xyflow/react';

import type {
  ActiveToolDialog,
  CanvasConnectionInput,
  CanvasEdge,
  CanvasImageViewerMode,
  CanvasImageViewerRequest,
  CanvasNode,
  CanvasNodeData,
  CanvasNodeType,
  ExportImageNodeResultKind,
  NodeToolType,
  StoryboardFrameItem,
  UploadPlaceholderResolution,
} from '@/features/canvas/domain/canvasNodes';
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference';
import type { AssetGroupGraph } from '@/features/canvas/application/assetGroupGraph';
import { createCanvasConnectionActions } from './canvasStoreConnectionActions';
import { createCanvasNodeCreationActions } from './canvasStoreNodeCreationActions';
import { createCanvasNodeUpdateActions } from './canvasStoreNodeUpdateActions';
import { createCanvasStructureActions } from './canvasStoreStructureActions';
import { createClosedCanvasImageViewerState } from './canvasStoreHelpers';

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

export interface CanvasHistoryGroupOptions {
  historyGroup?: string;
  /** 惰性数据迁移/稳定 ID 修复使用：更新节点但不制造用户可见的撤销步骤。 */
  skipHistory?: boolean;
}

export interface CanvasState {
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
      imageEditSession?: ImageEditSessionReferenceV3;
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


export type CanvasStoreSet = StoreApi<CanvasState>['setState'];
export type CanvasStoreGet = StoreApi<CanvasState>['getState'];

export type CanvasConnectionActions = Pick<CanvasState,
  | 'onNodesChange'
  | 'onEdgesChange'
  | 'onConnect'
  | 'connectMany'
  | 'setCanvasData'
  | 'commitAssetGroupGraph'
  | 'setViewportState'
  | 'setCanvasViewportSize'
  | 'openImageViewer'
  | 'closeImageViewer'
  | 'navigateImageViewer'
>;

export type CanvasNodeCreationActions = Pick<CanvasState,
  | 'addNode'
  | 'addEdge'
  | 'ensureTextDisplayOutput'
  | 'findNodePosition'
  | 'addDerivedUploadNode'
  | 'addDerivedExportNode'
  | 'addStoryboardSplitNode'
>;

export type CanvasNodeUpdateActions = Pick<CanvasState,
  | 'updateNodeData'
  | 'resolveUploadPlaceholder'
  | 'endHistoryGroup'
  | 'setModelSelectorExpanded'
  | 'updateNodePosition'
  | 'updateStoryboardFrame'
  | 'reorderStoryboardFrame'
>;

export type CanvasStructureActions = Pick<CanvasState,
  | 'deleteNode'
  | 'deleteNodes'
  | 'groupNodes'
  | 'ungroupNode'
  | 'deleteEdge'
  | 'setSelectedNode'
  | 'openToolDialog'
  | 'closeToolDialog'
  | 'undo'
  | 'redo'
  | 'clearCanvas'
>;

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

  ...createCanvasConnectionActions(set, get),
  ...createCanvasNodeCreationActions(set, get),
  ...createCanvasNodeUpdateActions(set, get),
  ...createCanvasStructureActions(set, get),
}));
