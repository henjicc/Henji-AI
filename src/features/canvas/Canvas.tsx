import { reportCanvasOperationFailure } from '@/features/canvas/application/canvasOperationFeedback';
import { useNodeParameterContextMenu } from './hooks/useNodeParameterContextMenu';
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Background,
  BackgroundVariant,
  SelectionMode,
  useReactFlow,
  type DefaultEdgeOptions,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import '@xyflow/react/dist/style.css';
import { UiToast, type UiToastTone } from '@/components/ui';
import { UI_TOAST_DISPLAY_MS, UI_TOAST_EXIT_MS } from '@/components/ui/motion';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { registerCanvasNodeFocusHandler } from '@/features/canvas/application/canvasApplicationService';
import {
  type CanvasEdge,
  type CanvasNode,
  CANVAS_NODE_TYPES,
} from '@/features/canvas/domain/canvasNodes';
import { areStringListsEqual } from '@/features/canvas/application/graphMediaResolver';
import { DEFAULT_VIEWPORT } from './canvasUtils';
import { useCanvasContentLod } from './nodes/shared/useCanvasContentLod';
import { useCanvasDuplication } from './hooks/useCanvasDuplication';
import { useCanvasMediaDrag } from './hooks/useCanvasMediaDrag';
import { useCanvasNodeMenu } from './hooks/useCanvasNodeMenu';
import { useCanvasNodeFocusTracking, useFocusedCanvasNodeId } from './hooks/useCanvasNodeFocus';
import { useCanvasResumePolling } from './hooks/useCanvasResumePolling';
import { useCanvasShortcuts } from './hooks/useCanvasShortcuts';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { SelectedNodeOverlay } from './ui/SelectedNodeOverlay';
import { NodeToolDialogRouter } from './ui/NodeToolDialogRouter';
import { CameraStageNodeDialog } from './nodes/cameraStage/CameraStageNodeDialog';
import { CanvasOverlays } from './ui/CanvasOverlays';
import { CanvasMiniMap } from './ui/CanvasMiniMap';
import { useCanvasAssetDrop } from './hooks/useCanvasAssetDrop';
import { useCanvasGlassPerformance } from './hooks/useCanvasGlassPerformance';
import { AssetGroupFocusOverlay } from './ui/AssetGroupFocusOverlay';
import { disconnectAssetGroup } from './application/assetGroupApplicationService';
import { useCanvasConnectionActions } from './hooks/useCanvasConnectionActions';
import { useCanvasAssetGroups } from './hooks/useCanvasAssetGroups';
import { useCanvasPersistence } from './hooks/useCanvasPersistence';
import { deleteCanvasNodes } from './application/canvasMutationService';
import { maintainMultiLayerDocumentReleaseCandidates } from './application/multiLayerDocumentLifecycleService';
import { CanvasViewportFlow } from './ui/CanvasViewportFlow';

interface CanvasToastState {
  message: string;
  type: UiToastTone;
}

// 静态配置项提升到模块作用域：避免每次 Canvas 渲染都重建新引用传给 <ReactFlow>，
// 引用稳定才能让 ReactFlow 内部依赖这些 props 的 effect/memo 不被无谓触发。
const CANVAS_DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = { type: 'disconnectableEdge' };
const CANVAS_PRO_OPTIONS = { hideAttribution: true };
const CANVAS_MULTI_SELECTION_KEY_CODE = ['Control', 'Meta'];
const CANVAS_SELECTION_KEY_CODE = ['Control', 'Meta'];

/**
 * 画布点阵：直接引用主题 CSS 变量（辅助文字色 35%），切换主题由浏览器重算样式，不触发 React 渲染。
 * `line` 在深色预设下与画布底几乎同亮（点阵消失），辅助文字色两种模式都与底色拉开、压低透明度后
 * 深色与改版前的深灰点阵观感一致，纸白下为浅灰点。
 */
const CANVAS_GRID_DOT_COLOR = 'rgb(var(--text3-rgb) / 0.35)';

function CanvasGridBackground() {
  return <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={CANVAS_GRID_DOT_COLOR} />;
}

export function Canvas() {
  const { t } = useTranslation();
  const reactFlowInstance = useReactFlow<CanvasNode, CanvasEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const handleMediaDrag = useCanvasMediaDrag();
  const { prepareGlassGesture, clearGlassGesture } = useCanvasGlassPerformance(wrapperRef);
  // 画布提示走共享 UiToast（任务 5.7 收敛）：压在画布上用玻璃、相对画布容器定位；停留与淡出时长同全局通知
  const toastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connectionToast, setConnectionToast] = useState<CanvasToastState | null>(null);
  const [connectionToastVisible, setConnectionToastVisible] = useState(false);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const applyNodesChange = useCanvasStore((state) => state.onNodesChange);
  const applyEdgesChange = useCanvasStore((state) => state.onEdgesChange);
  const connectNodes = useCanvasStore((state) => state.onConnect);
  const connectMany = useCanvasStore((state) => state.connectMany);
  const addNode = useCanvasStore((state) => state.addNode);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const deleteEdge = useCanvasStore((state) => state.deleteEdge);
  const groupNodes = useCanvasStore((state) => state.groupNodes);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const openToolDialog = useCanvasStore((state) => state.openToolDialog);
  const closeToolDialog = useCanvasStore((state) => state.closeToolDialog);
  const setViewportState = useCanvasStore((state) => state.setViewportState);
  const imageViewer = useCanvasStore((state) => state.imageViewer);
  const closeImageViewer = useCanvasStore((state) => state.closeImageViewer);
  const navigateImageViewer = useCanvasStore((state) => state.navigateImageViewer);
  const getCurrentProject = useProjectStore((state) => state.getCurrentProject);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const saveCurrentProjectViewport = useProjectStore((state) => state.saveCurrentProjectViewport);
  const cancelPendingViewportPersist = useProjectStore((state) => state.cancelPendingViewportPersist);
  const {
    schedulePersist: scheduleCanvasPersist,
    isRestoringRef: isRestoringCanvasRef,
    inspectionReadOnly,
  } = useCanvasPersistence(wrapperRef, reactFlowInstance);

  const clearToastTimers = useCallback(() => {
    if (toastHideTimerRef.current) clearTimeout(toastHideTimerRef.current);
    if (toastClearTimerRef.current) clearTimeout(toastClearTimerRef.current);
    toastHideTimerRef.current = null;
    toastClearTimerRef.current = null;
  }, []);

  const showConnectionToast = useCallback((message: string, type: UiToastTone = 'error') => {
    // 新提示到来时取消上一条的淡出与清除，避免上一条的清除计时器把新提示立刻清掉
    clearToastTimers();
    setConnectionToast({ message, type });
    setConnectionToastVisible(true);
    toastHideTimerRef.current = setTimeout(() => {
      setConnectionToastVisible(false);
      toastClearTimerRef.current = setTimeout(() => setConnectionToast(null), UI_TOAST_EXIT_MS);
    }, UI_TOAST_DISPLAY_MS);
  }, [clearToastTimers]);

  useEffect(() => clearToastTimers, [clearToastTimers]);

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
      const bundle = edge.data?.assetGroupBundle;
      if (bundle) void disconnectAssetGroup({ groupId: bundle.groupId, targetNodeId: bundle.targetNodeId }).catch(reportCanvasOperationFailure);
      else deleteEdge(edge.id);
      scheduleCanvasPersist(0);
    },
    [deleteEdge, scheduleCanvasPersist]
  );

  const {
    handleConnect,
    handleBatchConnect,
    createAssetGroup: handleCreateAssetGroup,
    addToAssetGroup: handleAddToAssetGroup,
    bindAssetGroup: handleBindAssetGroup,
  } = useCanvasConnectionActions({
    connectNodes,
    connectMany,
    schedulePersist: scheduleCanvasPersist,
    showToast: showConnectionToast,
    t,
  });

  const clearViewportGestureClasses = useCallback(() => {
    wrapperRef.current?.classList.remove('canvas-viewport-moving');
    clearGlassGesture();
  }, [clearGlassGesture]);

  // 视口状态只在 moveEnd 时同步进 store：平移/缩放过程中每帧 set() 会把
  // 全画布节点的 zustand 选择器（含 O(节点+边) 的图遍历）都跑一遍，是大画布掉帧主因之一。
  // 需要实时视口的调用方一律走 reactFlowInstance.getViewport()。
  const handleMoveEnd = useCallback(
    (_event: DynamicValue, viewport: Viewport) => {
      clearViewportGestureClasses();
      setViewportState(viewport);
      const project = getCurrentProject();
      if (!project || inspectionReadOnly || isRestoringCanvasRef.current) {
        return;
      }
      saveCurrentProjectViewport(viewport);
    },
    [clearViewportGestureClasses, getCurrentProject, inspectionReadOnly, isRestoringCanvasRef, saveCurrentProjectViewport, setViewportState]
  );

  const handleMoveStart = useCallback(
    () => {
      // 手势状态只承担不会改变文字光栅化的性能降级：暂停装饰动画，并在
      // 可见毛玻璃密度过高时临时取消滤镜。用 classList 避免多一次 React 渲染。
      prepareGlassGesture();
      wrapperRef.current?.classList.add('canvas-viewport-moving');
      cancelPendingViewportPersist();
    },
    [cancelPendingViewportPersist, prepareGlassGesture]
  );

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
  const selectedUploadTarget = useMemo(() => {
    if (selectedNodeIds.length !== 1) {
      return { nodeId: null, kinds: [] as Array<'image' | 'video' | 'audio'> };
    }
    const selectedNode = nodes.find((node) => node.id === selectedNodeIds[0]);
    if (selectedNode?.type === CANVAS_NODE_TYPES.universalUpload) {
      const lockedKind = selectedNode.data.lockedMediaKind;
      return {
        nodeId: selectedNode.id,
        kinds: lockedKind
          ? [lockedKind]
          : ['image', 'video', 'audio'] as Array<'image' | 'video' | 'audio'>,
      };
    }
    if (selectedNode?.type === CANVAS_NODE_TYPES.upload) {
      return { nodeId: selectedNode.id, kinds: ['image'] as Array<'image' | 'video' | 'audio'> };
    }
    if (selectedNode?.type === CANVAS_NODE_TYPES.videoUpload) {
      return { nodeId: selectedNode.id, kinds: ['video'] as Array<'image' | 'video' | 'audio'> };
    }
    if (selectedNode?.type === CANVAS_NODE_TYPES.audioUpload) {
      return { nodeId: selectedNode.id, kinds: ['audio'] as Array<'image' | 'video' | 'audio'> };
    }
    return { nodeId: null, kinds: [] as Array<'image' | 'video' | 'audio'> };
  }, [nodes, selectedNodeIds]);

  const { duplicateNodes, handleNodeDragStart, routeDuplicationChanges, handleNodeDragStop } = useCanvasDuplication({
    nodes,
    edges,
    selectedNodeIds,
    addNode,
    applyNodesChange,
    connectNodes,
    setSelectedNode,
    scheduleCanvasPersist,
  });

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      changes = routeDuplicationChanges(changes);
      if (changes.length === 0) return;
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
    [applyNodesChange, routeDuplicationChanges, scheduleCanvasPersist]
  );

  const {
    activeGroupId,
    closeAssetGroup,
    handleDragStop: handleCanvasNodeDragStop,
    renderGraph,
  } = useCanvasAssetGroups({
    wrapperRef,
    nodes,
    edges,
    selectedNodeId,
    selectedNodeIds,
    onNodeDragStop: handleNodeDragStop,
    addToAssetGroup: handleAddToAssetGroup,
  });

  // 应用重启后接着轮询未完成的异步生成任务
  useCanvasResumePolling();

  useCanvasNodeFocusTracking(wrapperRef);
  const focusedNodeId = useFocusedCanvasNodeId();

  useCanvasShortcuts({
    wrapperRef,
    reactFlowInstance,
    selectedUploadNodeId: selectedUploadTarget.nodeId,
    selectedUploadKinds: selectedUploadTarget.kinds,
    selectedNodeIds,
    selectedNodeId,
    focusedNodeId,
    nodes,
    edges,
    deleteNodes: async (nodeIds) => {
      if (!currentProjectId) return;
      await deleteCanvasNodes(currentProjectId, nodeIds);
    },
    groupNodes,
    createAssetGroup: handleCreateAssetGroup,
    undo: () => {
      const changed = undo();
      if (changed && currentProjectId) void maintainMultiLayerDocumentReleaseCandidates(currentProjectId);
      return changed;
    },
    redo: () => {
      const changed = redo();
      if (changed && currentProjectId) void maintainMultiLayerDocumentReleaseCandidates(currentProjectId);
      return changed;
    },
    scheduleCanvasPersist,
    duplicateNodes: (sourceNodeIds) => duplicateNodes(sourceNodeIds),
    addNode,
    setSelectedNode,
  });

  const {
    showNodeMenu,
    menuPosition,
    menuAllowedTypes,
    menuUploadKinds,
    previewConnectionVisual,
    handlePaneClick,
    handlePaneContextMenu,
    handleNodeSelect,
    handleConnectStart,
    handleConnectEnd,
    closeNodeMenu,
  } = useCanvasNodeMenu({
    wrapperRef,
    reactFlowInstance,
    nodes,
    addNode,
    connectNodes: handleConnect,
    scheduleCanvasPersist,
    setSelectedNode,
    connectAssetGroup: handleBindAssetGroup,
  });
  const assetDrop = useCanvasAssetDrop({ reactFlowInstance, addNode, schedulePersist: scheduleCanvasPersist });
  const { onNodeContextMenu, hideNodeContextMenu, nodeContextMenu } = useNodeParameterContextMenu(closeNodeMenu);
  // 低倍率内容 LOD：只在跨越阈值时翻转一次 class，节点正文的显隐全部由 CSS 承担
  const isContentLodLow = useCanvasContentLod();

  // 有意不开 onlyRenderVisibleElements：裁剪带来的节点挂载/卸载抖动是平移/缩放时
  // 数百毫秒长任务的主要来源（240 节点实测 zoom 长任务 550ms → 0）。
  return (
    <div
      ref={wrapperRef}
      onMouseDownCapture={handleMediaDrag}
      data-application-observation-region="canvas.viewport_observer"
      className={`relative h-full w-full ${isContentLodLow ? 'canvas-lod-low' : ''}`}
      onDragOver={assetDrop.onDragOver}
      onDrop={assetDrop.onDrop}
    >
      <CanvasViewportFlow
        nodes={renderGraph.nodes}
        edges={renderGraph.edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleCanvasNodeDragStop}
        onSelectionDragStart={(event, draggedNodes) => {
          if (draggedNodes[0]) handleNodeDragStart(event, draggedNodes[0]);
        }}
        onSelectionDragStop={(event, draggedNodes) => {
          if (draggedNodes[0]) handleCanvasNodeDragStop(event, draggedNodes[0]);
        }}
        onPaneClick={(event) => {
          hideNodeContextMenu();
          closeAssetGroup();
          handlePaneClick(event);
        }}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onMoveStart={handleMoveStart}
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
        className="bg-canvas"
      >
        <CanvasGridBackground />
        <CanvasMiniMap />

        <SelectedNodeOverlay
          onBatchConnect={handleBatchConnect}
          onCreateAssetGroup={handleCreateAssetGroup}
          onAddToAssetGroup={handleAddToAssetGroup}
        />
      </CanvasViewportFlow>

      <NodeToolDialogRouter />
      {nodeContextMenu}
      <CameraStageNodeDialog />
      {connectionToast && (
        <UiToast
          message={connectionToast.message}
          tone={connectionToast.type}
          visible={connectionToastVisible}
          surface="glass"
          placement="container"
        />
      )}
      {activeGroupId && (
        <AssetGroupFocusOverlay groupId={activeGroupId} onClose={closeAssetGroup} />
      )}

      <CanvasOverlays
        nodesCount={nodes.length} emptyTitle={t('canvas.emptyHintTitle')} emptySubtitle={t('canvas.emptyHintSubtitle')}
        showNodeMenu={showNodeMenu} previewConnectionVisual={previewConnectionVisual} menuPosition={menuPosition}
        menuAllowedTypes={menuAllowedTypes} menuUploadKinds={menuUploadKinds}
        onSelectNodeType={handleNodeSelect} onCloseNodeMenu={closeNodeMenu}
        imageViewerOpen={imageViewer.isOpen} imageViewerCurrentUrl={imageViewer.currentImageUrl || ''}
        imageViewerList={imageViewer.imageList} imageViewerIndex={imageViewer.currentIndex}
        onCloseImageViewer={closeImageViewer}
        onNavigateImageViewer={navigateImageViewer}
      />
    </div>
  );
}
