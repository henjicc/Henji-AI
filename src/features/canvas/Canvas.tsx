import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  BackgroundVariant,
  SelectionMode,
  useReactFlow,
  type Connection,
  type DefaultEdgeOptions,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import '@xyflow/react/dist/style.css';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { registerCanvasNodeFocusHandler } from '@/features/canvas/application/agentCanvasActions';
import {
  type CanvasEdge,
  type CanvasNode,
  CANVAS_NODE_TYPES,
} from '@/features/canvas/domain/canvasNodes';
import { isConnectionCompatible } from '@/features/canvas/domain/nodeRegistry';
import { isParamPortId } from '@/features/canvas/domain/socketTypes';
import { validateParamConnection } from '@/features/canvas/application/graphValueResolver';
import { areStringListsEqual } from '@/features/canvas/application/graphMediaResolver';
import { canNodeBeManualConnectionSource, CANVAS_MINIMAP_Z_INDEX, DEFAULT_VIEWPORT } from './canvasUtils';
import { useCanvasContentLod } from './nodes/shared/useCanvasContentLod';
import { useCanvasDuplication } from './hooks/useCanvasDuplication';
import { useCanvasNodeMenu } from './hooks/useCanvasNodeMenu';
import { useCanvasResumePolling } from './hooks/useCanvasResumePolling';
import { useCanvasShortcuts } from './hooks/useCanvasShortcuts';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { CANVAS_GRID_ALT_HEX } from '@/core/theme/colorTokens';
import { SelectedNodeOverlay } from './ui/SelectedNodeOverlay';
import { NodeToolDialog } from './ui/NodeToolDialog';
import { CameraStageNodeDialog } from './nodes/cameraStage/CameraStageNodeDialog';
import { CanvasOverlays } from './ui/CanvasOverlays';
import { useCanvasAssetDrop } from './hooks/useCanvasAssetDrop';
import { useCanvasGlassPerformance } from './hooks/useCanvasGlassPerformance';

interface CanvasToastState {
  message: string;
  id: number;
  type: 'success' | 'error';
}

// 静态配置项提升到模块作用域：避免每次 Canvas 渲染都重建新引用传给 <ReactFlow>，
// 引用稳定才能让 ReactFlow 内部依赖这些 props 的 effect/memo 不被无谓触发。
const CANVAS_DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = { type: 'disconnectableEdge' };
const CANVAS_PRO_OPTIONS = { hideAttribution: true };
const CANVAS_MULTI_SELECTION_KEY_CODE = ['Control', 'Meta'];
const CANVAS_SELECTION_KEY_CODE = ['Control', 'Meta'];

function CanvasConnectionToast({ toast }: { toast: CanvasToastState | null }) {
  if (!toast) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-toast -translate-x-1/2">
      <div
        key={toast.id}
        className={`rounded-lg border px-4 py-2 text-sm font-medium shadow-panel ${
          toast.type === 'success'
            ? 'border-green-500/30 bg-green-500/20 text-green-100'
            : 'border-red-400/30 bg-red-500/15 text-red-100'
        }`}
      >
        {toast.message}
      </div>
    </div>
  );
}

export function Canvas() {
  const { t } = useTranslation();
  const reactFlowInstance = useReactFlow<CanvasNode, CanvasEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { prepareGlassGesture, clearGlassGesture } = useCanvasGlassPerformance(wrapperRef);
  const isRestoringCanvasRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connectionToast, setConnectionToast] = useState<CanvasToastState | null>(null);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const history = useCanvasStore((state) => state.history);
  const dragHistorySnapshot = useCanvasStore((state) => state.dragHistorySnapshot);
  const applyNodesChange = useCanvasStore((state) => state.onNodesChange);
  const applyEdgesChange = useCanvasStore((state) => state.onEdgesChange);
  const connectNodes = useCanvasStore((state) => state.onConnect);
  const setCanvasData = useCanvasStore((state) => state.setCanvasData);
  const addNode = useCanvasStore((state) => state.addNode);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const deleteEdge = useCanvasStore((state) => state.deleteEdge);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const deleteNodes = useCanvasStore((state) => state.deleteNodes);
  const groupNodes = useCanvasStore((state) => state.groupNodes);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const openToolDialog = useCanvasStore((state) => state.openToolDialog);
  const closeToolDialog = useCanvasStore((state) => state.closeToolDialog);
  const setViewportState = useCanvasStore((state) => state.setViewportState);
  const setCanvasViewportSize = useCanvasStore((state) => state.setCanvasViewportSize);
  const imageViewer = useCanvasStore((state) => state.imageViewer);
  const closeImageViewer = useCanvasStore((state) => state.closeImageViewer);
  const navigateImageViewer = useCanvasStore((state) => state.navigateImageViewer);
  const getCurrentProject = useProjectStore((state) => state.getCurrentProject);
  const saveCurrentProject = useProjectStore((state) => state.saveCurrentProject);
  const saveCurrentProjectViewport = useProjectStore((state) => state.saveCurrentProjectViewport);
  const cancelPendingViewportPersist = useProjectStore((state) => state.cancelPendingViewportPersist);
  const persistCanvasSnapshot = useCallback(() => {
    if (isRestoringCanvasRef.current) {
      return;
    }

    const currentProject = getCurrentProject();
    if (!currentProject) {
      return;
    }

    const currentNodes = useCanvasStore.getState().nodes;
    const currentEdges = useCanvasStore.getState().edges;
    const currentHistory = useCanvasStore.getState().history;
    saveCurrentProject(
      currentNodes,
      currentEdges,
      reactFlowInstance.getViewport(),
      currentHistory
    );
  }, [getCurrentProject, reactFlowInstance, saveCurrentProject]);

  const scheduleCanvasPersist = useCallback(
    (delayMs = 140) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        persistCanvasSnapshot();
      }, delayMs);
    },
    [persistCanvasSnapshot]
  );

  const showConnectionToast = useCallback((message: string, type: CanvasToastState['type'] = 'error') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setConnectionToast({ message, id: Date.now(), type });
    toastTimerRef.current = setTimeout(() => {
      setConnectionToast(null);
      toastTimerRef.current = null;
    }, 2400);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const unsubscribeToast = canvasEventBus.subscribe('canvas/toast', ({ message, type }) => {
      showConnectionToast(message, type);
    });
    const unsubscribeOpen = canvasEventBus.subscribe('tool-dialog/open', (payload) => {
      openToolDialog(payload);
    });
    const unsubscribeClose = canvasEventBus.subscribe('tool-dialog/close', () => {
      closeToolDialog();
    });

    return () => {
      unsubscribeToast();
      unsubscribeOpen();
      unsubscribeClose();
    };
  }, [openToolDialog, closeToolDialog, showConnectionToast]);

  useEffect(() => registerCanvasNodeFocusHandler(async (nodeId) => {
    setSelectedNode(nodeId);
    await reactFlowInstance.fitView({
      nodes: [{ id: nodeId }],
      padding: 0.35,
      maxZoom: 1.2,
      duration: 250,
    });
  }), [reactFlowInstance, setSelectedNode]);

  useEffect(() => {
    isRestoringCanvasRef.current = true;
    const project = getCurrentProject();
    if (project) {
      setCanvasData(project.nodes, project.edges, project.history);
      setViewportState(project.viewport ?? DEFAULT_VIEWPORT);
      requestAnimationFrame(() => {
        reactFlowInstance.setViewport(project.viewport ?? DEFAULT_VIEWPORT, { duration: 0 });
      });
    } else {
      setViewportState(DEFAULT_VIEWPORT);
    }
    const restoreTimer = setTimeout(() => {
      isRestoringCanvasRef.current = false;
    }, 0);

    return () => {
      clearTimeout(restoreTimer);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      persistCanvasSnapshot();
    };
  }, [getCurrentProject, persistCanvasSnapshot, reactFlowInstance, setCanvasData, setViewportState]);

  useEffect(() => {
    if (isRestoringCanvasRef.current || dragHistorySnapshot) {
      return;
    }

    scheduleCanvasPersist();
  }, [nodes, edges, history, dragHistorySnapshot, scheduleCanvasPersist]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setCanvasViewportSize({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [setCanvasViewportSize]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      applyNodesChange(changes);

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

      if (hasInteractionMove) {
        return;
      }

      if (hasInteractionEnd) {
        scheduleCanvasPersist(0);
        return;
      }

      scheduleCanvasPersist();
    },
    [applyNodesChange, scheduleCanvasPersist]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      applyEdgesChange(changes);
      scheduleCanvasPersist();
    },
    [applyEdgesChange, scheduleCanvasPersist]
  );

  const handleEdgeDoubleClick = useCallback(
    (event: ReactMouseEvent, edge: CanvasEdge) => {
      event.preventDefault();
      event.stopPropagation();
      deleteEdge(edge.id);
      scheduleCanvasPersist(0);
    },
    [deleteEdge, scheduleCanvasPersist]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!canNodeBeManualConnectionSource(connection.source, nodes)) {
        return;
      }
      const sourceNode = nodes.find((node) => node.id === connection.source);
      const targetNode = nodes.find((node) => node.id === connection.target);
      if (!sourceNode || !targetNode) {
        return;
      }
      // 参数端口连线走插槽类型兼容；整节点媒体连线走媒体端口兼容
      const paramValidation = isParamPortId(connection.targetHandle)
        ? validateParamConnection(sourceNode, targetNode, connection.targetHandle, nodes, edges, connection.sourceHandle)
        : null;
      const compatible = paramValidation
        ? paramValidation.compatible
        : isConnectionCompatible(sourceNode.type, targetNode.type, connection.sourceHandle);
      if (!compatible) {
        if (paramValidation?.reason === 'media-limit-exceeded') {
          const mediaLabel = paramValidation.mediaKind
            ? t(`node.mediaRow.${paramValidation.mediaKind}`)
            : t('canvas.connection.mediaFallback');
          showConnectionToast(t('canvas.connection.mediaLimitExceeded', {
            media: mediaLabel,
            max: paramValidation.maxCount ?? 0,
          }));
        } else {
          showConnectionToast(t('canvas.connection.typeMismatch'));
        }
        return;
      }
      connectNodes(connection);
      scheduleCanvasPersist(0);
    },
    [connectNodes, edges, nodes, scheduleCanvasPersist, showConnectionToast, t]
  );

  /**
   * 合成层提升只给「平移」，不给「缩放」。
   *
   * 提升的本质是把整棵节点树按**手势开始那一刻的倍率**光栅化成一张位图，之后由合成器
   * 搬运。平移是 translate，像素一一对应，画面依然清晰且能拿满 60fps；缩放是 scale，
   * 会把这张位图拉伸，表现就是"缩放中全糊、松手才清晰"。
   *
   * 而缩放恰恰是最需要看清的时候（用户缩放就是为了看内容），平移才需要跟手。原先两种
   * 手势共用一个 class，等于把优化用在了反方向。
   *
   * 判定方式刻意不看事件类型（wheel / 单指 / 双指在不同设备上并不可靠），而是比对
   * 视口倍率：手势内只要 zoom 变过一次，就立刻撤掉提升并且本次手势不再恢复。
   * 纯平移全程保留提升；滚轮缩放在第一个 onMove 就会撤掉，最多糊一帧。
   */
  const gestureStartZoomRef = useRef<number | null>(null);
  const isPanPromotedRef = useRef(false);

  const clearViewportGestureClasses = useCallback(() => {
    wrapperRef.current?.classList.remove('canvas-viewport-moving');
    wrapperRef.current?.classList.remove('canvas-viewport-panning');
    clearGlassGesture();
    gestureStartZoomRef.current = null;
    isPanPromotedRef.current = false;
  }, [clearGlassGesture]);

  // 视口状态只在 moveEnd 时同步进 store：平移/缩放过程中每帧 set() 会把
  // 全画布节点的 zustand 选择器（含 O(节点+边) 的图遍历）都跑一遍，是大画布掉帧主因之一。
  // 需要实时视口的调用方一律走 reactFlowInstance.getViewport()。
  const handleMoveEnd = useCallback(
    (_event: DynamicValue, viewport: Viewport) => {
      // 手势结束撤掉合成层提升：常驻 will-change 会让缩放后的文字停留在旧倍率
      // 光栅位图上（表现为放大后模糊、点击节点局部重绘才变清晰）；
      // 撤掉后浏览器立刻按当前倍率重新光栅化，文字恢复清晰。
      clearViewportGestureClasses();
      setViewportState(viewport);
      const project = getCurrentProject();
      if (!project || isRestoringCanvasRef.current) {
        return;
      }
      saveCurrentProjectViewport(viewport);
    },
    [clearViewportGestureClasses, getCurrentProject, saveCurrentProjectViewport, setViewportState]
  );

  const handleMoveStart = useCallback(
    (_event: DynamicValue, viewport: Viewport) => {
      // 用 classList 直改 DOM，避免手势起点多一次 React 渲染。
      // `moving` 覆盖整个手势（暂停连线动画等）；`panning` 只在确认是平移时保留。
      prepareGlassGesture();
      wrapperRef.current?.classList.add('canvas-viewport-moving');
      wrapperRef.current?.classList.add('canvas-viewport-panning');
      gestureStartZoomRef.current = viewport.zoom;
      isPanPromotedRef.current = true;
      cancelPendingViewportPersist();
    },
    [cancelPendingViewportPersist, prepareGlassGesture]
  );

  // 每帧调用：只做一次数值比较和一次 classList 操作，不触发 React 渲染，
  // 也不写 store（视口仍然只在 moveEnd 落库）。
  const handleMove = useCallback((_event: DynamicValue, viewport: Viewport) => {
    if (!isPanPromotedRef.current) {
      return;
    }
    const startZoom = gestureStartZoomRef.current;
    if (startZoom === null || viewport.zoom === startZoom) {
      return;
    }
    wrapperRef.current?.classList.remove('canvas-viewport-panning');
    isPanPromotedRef.current = false;
  }, []);

  const rawSelectedNodeIds = useMemo(
    () => nodes.filter((node) => Boolean(node.selected)).map((node) => node.id),
    [nodes]
  );
  const selectedNodeIdsRef = useRef<string[]>([]);
  // nodes 引用几乎每次交互都变（包括与选中无关的字段编辑），但选中的 id 集合通常不变；
  // 这里按内容比较复用旧引用，避免下游 useEffect/useCallback（依赖 selectedNodeIds）被无谓触发。
  if (!areStringListsEqual(selectedNodeIdsRef.current, rawSelectedNodeIds)) {
    selectedNodeIdsRef.current = rawSelectedNodeIds;
  }
  const selectedNodeIds = selectedNodeIdsRef.current;
  const selectedUploadNodeId = useMemo(() => {
    if (selectedNodeIds.length !== 1) {
      return null;
    }
    const selectedNode = nodes.find((node) => node.id === selectedNodeIds[0]);
    if (!selectedNode || selectedNode.type !== CANVAS_NODE_TYPES.upload) {
      return null;
    }
    return selectedNode.id;
  }, [nodes, selectedNodeIds]);

  const { duplicateNodes, handleNodeDragStart, handleNodeDrag, handleNodeDragStop } = useCanvasDuplication({
    nodes,
    edges,
    selectedNodeIds,
    addNode,
    applyNodesChange,
    connectNodes,
    setSelectedNode,
    scheduleCanvasPersist,
  });

  // 应用重启后接着轮询未完成的异步生成任务
  useCanvasResumePolling();

  useCanvasShortcuts({
    wrapperRef,
    reactFlowInstance,
    selectedUploadNodeId,
    selectedNodeIds,
    selectedNodeId,
    nodes,
    edges,
    deleteNode,
    deleteNodes,
    groupNodes,
    undo,
    redo,
    scheduleCanvasPersist,
    duplicateNodes: (sourceNodeIds) => duplicateNodes(sourceNodeIds),
    addNode,
    setSelectedNode,
  });

  const {
    showNodeMenu,
    menuPosition,
    menuAllowedTypes,
    previewConnectionVisual,
    handlePaneClick,
    handleNodeSelect,
    handleConnectStart,
    handleConnectEnd,
    closeNodeMenu,
  } = useCanvasNodeMenu({
    wrapperRef,
    reactFlowInstance,
    nodes,
    addNode,
    connectNodes,
    scheduleCanvasPersist,
    setSelectedNode,
  });
  const assetDrop = useCanvasAssetDrop({ reactFlowInstance, addNode, schedulePersist: scheduleCanvasPersist });
  // 低倍率内容 LOD：只在跨越阈值时翻转一次 class，节点正文的显隐全部由 CSS 承担
  const isContentLodLow = useCanvasContentLod();

  // 有意不开 onlyRenderVisibleElements：视口层已合成化（storyboard.css 的 will-change），
  // 视口外内容不参与光栅、裁剪收益基本消失；而裁剪带来的节点挂载/卸载抖动是
  // 平移/缩放时数百毫秒长任务的主要来源（240 节点实测 zoom 长任务 550ms → 0）。
  return (
    <div
      ref={wrapperRef}
      className={`relative h-full w-full ${isContentLodLow ? 'canvas-lod-low' : ''}`}
      onDragOver={assetDrop.onDragOver}
      onDrop={assetDrop.onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={handlePaneClick}
        onMoveStart={handleMoveStart}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={CANVAS_DEFAULT_EDGE_OPTIONS}
        defaultViewport={DEFAULT_VIEWPORT}
        minZoom={0.1}
        maxZoom={5}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={CANVAS_MULTI_SELECTION_KEY_CODE}
        selectionKeyCode={CANVAS_SELECTION_KEY_CODE}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        proOptions={CANVAS_PRO_OPTIONS}
        className="bg-bg-dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={CANVAS_GRID_ALT_HEX} />
        <MiniMap
          className="canvas-minimap nopan nowheel !border-border-dark !bg-surface-dark"
          style={{ pointerEvents: 'all', zIndex: CANVAS_MINIMAP_Z_INDEX }}
          nodeColor="rgba(120, 120, 120, 0.92)"
          maskColor="rgba(0, 0, 0, 0.62)"
          pannable
          zoomable
        />

        <SelectedNodeOverlay />
      </ReactFlow>

      <NodeToolDialog />
      <CameraStageNodeDialog />
      <CanvasConnectionToast toast={connectionToast} />

      <CanvasOverlays
        nodesCount={nodes.length} emptyTitle={t('canvas.emptyHintTitle')} emptySubtitle={t('canvas.emptyHintSubtitle')}
        showNodeMenu={showNodeMenu} previewConnectionVisual={previewConnectionVisual} menuPosition={menuPosition}
        menuAllowedTypes={menuAllowedTypes} onSelectNodeType={handleNodeSelect} onCloseNodeMenu={closeNodeMenu}
        imageViewerOpen={imageViewer.isOpen} imageViewerCurrentUrl={imageViewer.currentImageUrl || ''}
        imageViewerList={imageViewer.imageList} imageViewerIndex={imageViewer.currentIndex}
        onCloseImageViewer={closeImageViewer}
        onNavigateImageViewer={navigateImageViewer}
      />
    </div>
  );
}
