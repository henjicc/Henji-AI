import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';

import { UI_DURATION } from '@/components/ui/motion';
import { createLogger } from '@/core/logging';
import { ICON_PANORAMA } from '@/core/theme/icons';
import { commitPanoramaViewSnapshot } from '@/features/canvas/application/panoramaSnapshotApplicationService';
import {
  areMediaOutputListsEqual,
  collectInputMediaByKind,
} from '@/features/canvas/application/graphMediaResolver';
import { persistImageLocally, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  CANVAS_NODE_TYPES,
  type PanoramaViewerNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import {
  PANORAMA_DEFAULT_CAMERA_VIEW,
  normalizePanoramaCameraView,
  parsePanoramaViewportAspectRatio,
  resolvePanoramaCaptureSize,
  type PanoramaCameraView,
  type PanoramaViewMode,
  type PanoramaViewportAspectRatio,
} from '@/features/canvas/domain/panoramaViewer';
import { getSocketColor } from '@/features/canvas/domain/socketTypes';
import { PanoramaViewerPanel } from '@/features/canvas/nodes/panoramaViewer/PanoramaViewerPanel';
import { useCanvasContentLod } from '@/features/canvas/nodes/shared/useCanvasContentLod';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import {
  NODE_GENERATION_ERROR_BORDER_CLASS,
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { type PanoramaCaptureCurrentView } from '@/features/canvas/ui/specialInterfaces/panorama/PanoramaSphereCanvas';
import { usePanoramaImageResource } from '@/features/canvas/ui/specialInterfaces/panorama/usePanoramaImageResource';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { useCanvasStore } from '@/stores/canvasStore';
import { usePanoramaInlineViewerStore } from '@/stores/panoramaInlineViewerStore';

const logger = createLogger('features.canvas.panoramaViewerNode');
const DEFAULT_NODE_WIDTH = 448;
const MIN_NODE_WIDTH = 320;
const CONTROL_AREA_HEIGHT = 48;

function resolvePersistedPanoramaPreview(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

type PanoramaViewerNodeProps = NodeProps & {
  id: string;
  data: PanoramaViewerNodeData;
  selected?: boolean;
};

export const PanoramaViewerNode = memo(({
  id,
  data,
  selected,
  width,
}: PanoramaViewerNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const openImageViewer = useCanvasStore((state) => state.openImageViewer);
  const isSelectedById = useCanvasStore((state) => state.selectedNodeId === id);
  const connectionFlags = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id),
  );
  const hasTargetConnections = connectionFlags?.hasMainTarget ?? false;
  const hasSourceConnections = connectionFlags?.hasMainSource ?? false;
  const isContentLodLow = useCanvasContentLod();
  const hasInlineLease = usePanoramaInlineViewerStore((state) => state.activeNodeId === id);
  const claimInlineLease = usePanoramaInlineViewerStore((state) => state.claim);
  const releaseInlineLease = usePanoramaInlineViewerStore((state) => state.release);
  const captureRef = useRef<PanoramaCaptureCurrentView | null>(null);
  const currentViewRef = useRef<PanoramaCameraView | null>(null);
  const autoPreviewCaptureRef = useRef(false);
  const freezeDelayTimerRef = useRef<number | null>(null);
  const interactionActiveRef = useRef(false);
  const lastSourceRef = useRef<string | null>(null);
  const pointerInsideNodeRef = useRef(false);
  const previewCaptureFrameRef = useRef<number | null>(null);
  const previewPersistRevisionRef = useRef(0);
  const pendingFreezeReleaseRef = useRef(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasWebglFailure, setHasWebglFailure] = useState(false);
  const persistedPanoramaPreview = resolvePersistedPanoramaPreview(data.panoramaPreviewImageUrl);
  const [frozenPreviewUrl, setFrozenPreviewUrl] = useState<string | null>(
    () => persistedPanoramaPreview,
  );
  const upstreamImages = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputMediaByKind(id, state.nodes, state.edges, 'image'),
    areMediaOutputListsEqual,
  );
  const upstreamSource = upstreamImages[0]?.url ?? null;
  const lastUpstreamSourceRef = useRef<string | null>(null);

  const isActive = Boolean(selected) || isSelectedById;
  const source = upstreamSource || data.imageUrl || data.previewImageUrl || '';
  const resource = usePanoramaImageResource(
    source,
    Boolean(source),
    retryRevision,
    id,
    data.panoramaProjectionMode,
  );
  const resolvedWidth = Math.max(MIN_NODE_WIDTH, typeof width === 'number' ? width : DEFAULT_NODE_WIDTH);
  const viewportRatio = parsePanoramaViewportAspectRatio(data.viewportAspectRatio);
  const viewportHeight = Math.round(resolvedWidth / viewportRatio);
  const resolvedHeight = viewportHeight + CONTROL_AREA_HEIGHT;
  const generationError = typeof data.generationError === 'string' ? data.generationError : null;
  const title = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.panoramaViewer, data),
    [data],
  );

  useEffect(() => {
    const previousUpstreamSource = lastUpstreamSourceRef.current;
    lastUpstreamSourceRef.current = upstreamSource;
    if (upstreamSource) {
      if (data.imageUrl === upstreamSource) return;
      updateNodeData(id, {
        imageUrl: upstreamSource,
        previewImageUrl: upstreamImages[0]?.previewUrl ?? upstreamSource,
        panoramaPreviewImageUrl: null,
      }, { skipHistory: true });
      return;
    }
    if (previousUpstreamSource && data.imageUrl === previousUpstreamSource) {
      updateNodeData(id, {
        imageUrl: null,
        previewImageUrl: null,
        panoramaPreviewImageUrl: null,
      }, { skipHistory: true });
    }
  }, [data.imageUrl, id, updateNodeData, upstreamImages, upstreamSource]);

  const persistPanoramaPreview = useCallback((previewDataUrl: string): void => {
    const revision = previewPersistRevisionRef.current + 1;
    previewPersistRevisionRef.current = revision;
    logger.debug('全景节点视角预览开始落盘', {
      event: 'panorama.viewer_preview.persist.start',
      nodeId: id,
    });
    void persistImageLocally(previewDataUrl).then((persistedUrl) => {
      if (previewPersistRevisionRef.current !== revision) return;
      const canvas = useCanvasStore.getState();
      const currentNode = canvas.nodes.find((node) => node.id === id);
      if (
        !currentNode
        || currentNode.type !== CANVAS_NODE_TYPES.panoramaViewer
        || currentNode.data.panoramaPreviewImageUrl !== previewDataUrl
      ) return;
      canvas.updateNodeData(id, { panoramaPreviewImageUrl: persistedUrl }, { skipHistory: true });
      logger.debug('全景节点视角预览已落盘', {
        event: 'panorama.viewer_preview.persist.completed',
        nodeId: id,
      });
    }).catch((error: unknown) => {
      if (previewPersistRevisionRef.current !== revision) return;
      logger.warn('全景节点视角预览落盘失败，保留内嵌预览', {
        event: 'panorama.viewer_preview.persist.failed',
        nodeId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [id]);

  const storePanoramaPreview = useCallback((previewDataUrl: string): void => {
    updateNodeData(
      id,
      { panoramaPreviewImageUrl: previewDataUrl },
      { skipHistory: true },
    );
  }, [id, updateNodeData]);

  const commitCameraView = useCallback((view: PanoramaCameraView): void => {
    const normalized = normalizePanoramaCameraView(view);
    const current = normalizePanoramaCameraView(data.cameraView);
    if (
      normalized.yaw === current.yaw
      && normalized.pitch === current.pitch
      && normalized.fov === current.fov
    ) return;
    updateNodeData(id, { cameraView: normalized });
  }, [data.cameraView, id, updateNodeData]);

  const cancelScheduledFreeze = useCallback((): void => {
    if (freezeDelayTimerRef.current === null) return;
    window.clearTimeout(freezeDelayTimerRef.current);
    freezeDelayTimerRef.current = null;
  }, []);

  const requestSphere = useCallback(() => {
    cancelScheduledFreeze();
    autoPreviewCaptureRef.current = false;
    pendingFreezeReleaseRef.current = false;
    if (!hasWebglFailure && !isContentLodLow && data.viewMode === 'sphere') claimInlineLease(id);
  }, [cancelScheduledFreeze, claimInlineLease, data.viewMode, hasWebglFailure, id, isContentLodLow]);

  const activateSphere = useCallback(() => {
    interactionActiveRef.current = true;
    setSelectedNode(id);
    requestSphere();
  }, [id, requestSphere, setSelectedNode]);

  useEffect(() => {
    const sphereUnavailable = hasWebglFailure || isContentLodLow || data.viewMode !== 'sphere';
    if (!sphereUnavailable) return;
    cancelScheduledFreeze();
    releaseInlineLease(id);
  }, [cancelScheduledFreeze, data.viewMode, hasWebglFailure, id, isContentLodLow, releaseInlineLease]);

  useEffect(() => {
    if (lastSourceRef.current === source) return;
    lastSourceRef.current = source;
    autoPreviewCaptureRef.current = false;
    pendingFreezeReleaseRef.current = false;
    setHasWebglFailure(false);
    setFrozenPreviewUrl(persistedPanoramaPreview);
  }, [persistedPanoramaPreview, source]);

  useEffect(() => {
    if (!persistedPanoramaPreview?.startsWith('data:image/')) return;
    persistPanoramaPreview(persistedPanoramaPreview);
  }, [persistPanoramaPreview, persistedPanoramaPreview]);

  useEffect(() => {
    if (
      !isActive
      || persistedPanoramaPreview
      || data.viewMode !== 'sphere'
      || hasWebglFailure
      || isContentLodLow
      || resource.status !== 'ready'
      || !resource.isEquirectangular
    ) return;
    autoPreviewCaptureRef.current = true;
    claimInlineLease(id);
  }, [
    claimInlineLease,
    data.viewMode,
    hasWebglFailure,
    id,
    isActive,
    isContentLodLow,
    persistedPanoramaPreview,
    resource,
  ]);

  useEffect(() => () => {
    cancelScheduledFreeze();
    if (previewCaptureFrameRef.current !== null) {
      window.cancelAnimationFrame(previewCaptureFrameRef.current);
      previewCaptureFrameRef.current = null;
    }
    previewPersistRevisionRef.current += 1;
    pendingFreezeReleaseRef.current = false;
    releaseInlineLease(id);
  }, [cancelScheduledFreeze, id, releaseInlineLease]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  const handleViewModeChange = useCallback((viewMode: PanoramaViewMode) => {
    cancelScheduledFreeze();
    interactionActiveRef.current = false;
    pendingFreezeReleaseRef.current = false;
    if (viewMode === 'sphere') setHasWebglFailure(false);
    updateNodeData(id, { viewMode });
    if (viewMode === 'flat') releaseInlineLease(id);
    else if (!isContentLodLow) claimInlineLease(id);
  }, [cancelScheduledFreeze, claimInlineLease, id, isContentLodLow, releaseInlineLease, updateNodeData]);

  const handleContextLost = useCallback(() => {
    cancelScheduledFreeze();
    interactionActiveRef.current = false;
    autoPreviewCaptureRef.current = false;
    pendingFreezeReleaseRef.current = false;
    setHasWebglFailure(true);
    setFrozenPreviewUrl(persistedPanoramaPreview);
    releaseInlineLease(id);
  }, [cancelScheduledFreeze, id, persistedPanoramaPreview, releaseInlineLease]);

  const handleViewportAspectRatioChange = useCallback((
    viewportAspectRatio: PanoramaViewportAspectRatio,
  ) => {
    updateNodeData(id, { viewportAspectRatio });
  }, [id, updateNodeData]);

  const handleCameraViewChangeEnd = useCallback((view: PanoramaCameraView) => {
    commitCameraView(view);
    if (previewCaptureFrameRef.current !== null) {
      window.cancelAnimationFrame(previewCaptureFrameRef.current);
    }
    previewCaptureFrameRef.current = window.requestAnimationFrame(() => {
      previewCaptureFrameRef.current = null;
      const previewUrl = captureRef.current?.(undefined, view);
      if (previewUrl) storePanoramaPreview(previewUrl);
    });
  }, [commitCameraView, storePanoramaPreview]);

  const handleSphereFramePresented = useCallback(() => {
    if (persistedPanoramaPreview) return;
    const previewUrl = captureRef.current?.(undefined, currentViewRef.current ?? undefined);
    if (!previewUrl) return;
    storePanoramaPreview(previewUrl);
    if (!autoPreviewCaptureRef.current) return;
    autoPreviewCaptureRef.current = false;
    pendingFreezeReleaseRef.current = true;
    setFrozenPreviewUrl(previewUrl);
  }, [persistedPanoramaPreview, storePanoramaPreview]);

  const freezeInlineView = useCallback(() => {
    if (!hasInlineLease) return;
    if (previewCaptureFrameRef.current !== null) {
      window.cancelAnimationFrame(previewCaptureFrameRef.current);
      previewCaptureFrameRef.current = null;
    }
    const currentView = currentViewRef.current;
    if (currentView) commitCameraView(currentView);
    const capture = captureRef.current;
    if (capture) {
      const previewUrl = capture(undefined, currentView ?? undefined);
      if (previewUrl) storePanoramaPreview(previewUrl);
      if (previewUrl && previewUrl !== frozenPreviewUrl) {
        pendingFreezeReleaseRef.current = true;
        setFrozenPreviewUrl(previewUrl);
        return;
      }
    }
    releaseInlineLease(id);
  }, [
    commitCameraView,
    frozenPreviewUrl,
    hasInlineLease,
    id,
    releaseInlineLease,
    storePanoramaPreview,
  ]);

  const scheduleFreezeInlineView = useCallback((): void => {
    cancelScheduledFreeze();
    if (interactionActiveRef.current) return;
    freezeDelayTimerRef.current = window.setTimeout(() => {
      freezeDelayTimerRef.current = null;
      freezeInlineView();
    }, UI_DURATION.viewer);
  }, [cancelScheduledFreeze, freezeInlineView]);

  const finishSphereInteraction = useCallback((): void => {
    interactionActiveRef.current = false;
    if (!pointerInsideNodeRef.current) scheduleFreezeInlineView();
  }, [scheduleFreezeInlineView]);

  const handleFrozenPreviewReady = useCallback(() => {
    if (!pendingFreezeReleaseRef.current) return;
    pendingFreezeReleaseRef.current = false;
    releaseInlineLease(id);
  }, [id, releaseInlineLease]);

  const handleCapture = useCallback(async (): Promise<void> => {
    if (isCapturing) return;
    setIsCapturing(true);
    try {
      if (!captureRef.current) {
        requestSphere();
        await new Promise<void>((resolve) => {
          const deadline = performance.now() + 2_000;
          const waitForCapture = (): void => {
            if (captureRef.current || performance.now() >= deadline) {
              resolve();
              return;
            }
            window.requestAnimationFrame(waitForCapture);
          };
          waitForCapture();
        });
      }
      const capture = captureRef.current;
      if (!capture) throw new Error('未能恢复全景视角渲染');
      const dataUrl = capture(
        resolvePanoramaCaptureSize(data.viewportAspectRatio),
        currentViewRef.current ?? undefined,
      );
      if (!dataUrl) throw new Error('未获取到当前全景视角');
      await commitPanoramaViewSnapshot({
        sourceNodeId: id,
        dataUrl,
        title: t('viewer.panorama.snapshotTitle'),
      });
    } catch (error) {
      logger.error('截取全景视角失败', error, {
        event: 'panorama.snapshot.capture.failed',
        nodeId: id,
      });
      canvasEventBus.publish('canvas/toast', {
        message: t('viewer.panorama.captureFailed'),
        type: 'error',
      });
    } finally {
      setIsCapturing(false);
    }
  }, [data.viewportAspectRatio, id, isCapturing, requestSphere, t]);

  const openImmersiveViewer = useCallback(() => {
    if (!source) return;
    const imageUrl = resolveImageDisplayUrl(source);
    openImageViewer({
      imageUrl,
      imageList: [imageUrl],
      mode: 'panorama',
      sourceNodeId: id,
    });
  }, [id, openImageViewer, source]);

  const renderSphere = data.viewMode === 'sphere'
    && !isContentLodLow
    && !hasWebglFailure
    && hasInlineLease
    && resource.status === 'ready'
    && resource.isEquirectangular;

  return (
    <div
      data-panorama-viewer-node-id={id}
      data-panorama-view-mode={data.viewMode}
      data-panorama-viewport-ratio={data.viewportAspectRatio}
      className={`group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 transition-colors duration-150 ${
        generationError
          ? NODE_GENERATION_ERROR_BORDER_CLASS
          : isActive ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_CLASS
      }`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
      onPointerEnter={() => {
        pointerInsideNodeRef.current = true;
        cancelScheduledFreeze();
      }}
      onPointerLeave={() => {
        pointerInsideNodeRef.current = false;
        scheduleFreezeInlineView();
      }}
      onBlurCapture={(event) => {
        const focusStayedInside = event.currentTarget.contains(
          event.relatedTarget as globalThis.Node | null,
        );
        const windowLostFocus = !document.hasFocus();
        if (!focusStayedInside && (!pointerInsideNodeRef.current || windowLostFocus)) {
          scheduleFreezeInlineView();
        }
      }}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<ICON_PANORAMA className="h-4 w-4" />}
        titleText={title}
        editable
        onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      />

      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit]">
        <PanoramaViewerPanel
          resource={resource}
          viewMode={data.viewMode}
          viewportAspectRatio={data.viewportAspectRatio}
          cameraView={normalizePanoramaCameraView(data.cameraView ?? PANORAMA_DEFAULT_CAMERA_VIEW)}
          currentViewRef={currentViewRef}
          frozenPreviewUrl={frozenPreviewUrl}
          renderSphere={renderSphere}
          isGenerating={data.isGenerating === true}
          generationError={generationError}
          isCapturing={isCapturing}
          hasWebglFailure={hasWebglFailure}
          captureRef={captureRef}
          onRetry={() => setRetryRevision((revision) => revision + 1)}
          onRequestSphere={requestSphere}
          onInteractionStart={activateSphere}
          onInteractionEnd={finishSphereInteraction}
          onOpenImmersiveViewer={openImmersiveViewer}
          onViewModeChange={handleViewModeChange}
          onViewportAspectRatioChange={handleViewportAspectRatioChange}
          onCameraViewChangeEnd={handleCameraViewChangeEnd}
          onSphereFramePresented={handleSphereFramePresented}
          onCapture={() => void handleCapture()}
          onFrozenPreviewReady={handleFrozenPreviewReady}
          onContextLost={handleContextLost}
        />
      </div>
      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className={`${NODE_PORT_NODE_CLASS} ${hasTargetConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor('IMAGE'), left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor('IMAGE'), right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
      />
    </div>
  );
});

PanoramaViewerNode.displayName = 'PanoramaViewerNode';
