import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { createLogger } from '@/core/logging';
import { ICON_PANORAMA } from '@/core/theme/icons';
import { commitPanoramaViewSnapshot } from '@/features/canvas/application/panoramaSnapshotApplicationService';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
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
  const hasTargetConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainTarget ?? false,
  );
  const hasSourceConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false,
  );
  const isContentLodLow = useCanvasContentLod();
  const hasInlineLease = usePanoramaInlineViewerStore((state) => state.activeNodeId === id);
  const claimInlineLease = usePanoramaInlineViewerStore((state) => state.claim);
  const releaseInlineLease = usePanoramaInlineViewerStore((state) => state.release);
  const captureRef = useRef<PanoramaCaptureCurrentView | null>(null);
  const currentViewRef = useRef<PanoramaCameraView | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasWebglFailure, setHasWebglFailure] = useState(false);
  const [frozenPreviewUrl, setFrozenPreviewUrl] = useState<string | null>(null);

  const isActive = Boolean(selected) || isSelectedById;
  const source = data.imageUrl || data.previewImageUrl || '';
  const resource = usePanoramaImageResource(source, Boolean(source), retryRevision, id);
  const resolvedWidth = Math.max(MIN_NODE_WIDTH, typeof width === 'number' ? width : DEFAULT_NODE_WIDTH);
  const viewportRatio = parsePanoramaViewportAspectRatio(data.viewportAspectRatio);
  const viewportHeight = Math.round(resolvedWidth / viewportRatio);
  const resolvedHeight = viewportHeight + CONTROL_AREA_HEIGHT;
  const generationError = typeof data.generationError === 'string' ? data.generationError : null;
  const title = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.panoramaViewer, data),
    [data],
  );

  const requestSphere = useCallback(() => {
    if (!hasWebglFailure && !isContentLodLow && data.viewMode === 'sphere') claimInlineLease(id);
  }, [claimInlineLease, data.viewMode, hasWebglFailure, id, isContentLodLow]);

  const activateSphere = useCallback(() => {
    setSelectedNode(id);
    requestSphere();
  }, [id, requestSphere, setSelectedNode]);

  useEffect(() => {
    const sphereUnavailable = hasWebglFailure || isContentLodLow || data.viewMode !== 'sphere';
    if (isActive && !sphereUnavailable) {
      claimInlineLease(id);
    } else if (sphereUnavailable) {
      releaseInlineLease(id);
    }
  }, [claimInlineLease, data.viewMode, hasWebglFailure, id, isActive, isContentLodLow, releaseInlineLease]);

  useEffect(() => {
    setHasWebglFailure(false);
    setFrozenPreviewUrl(null);
  }, [source]);

  useEffect(() => () => releaseInlineLease(id), [id, releaseInlineLease]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  const handleViewModeChange = useCallback((viewMode: PanoramaViewMode) => {
    if (viewMode === 'sphere') setHasWebglFailure(false);
    updateNodeData(id, { viewMode });
    if (viewMode === 'flat') releaseInlineLease(id);
    else if (!isContentLodLow) claimInlineLease(id);
  }, [claimInlineLease, id, isContentLodLow, releaseInlineLease, updateNodeData]);

  const handleContextLost = useCallback(() => {
    setHasWebglFailure(true);
    releaseInlineLease(id);
  }, [id, releaseInlineLease]);

  const handleViewportAspectRatioChange = useCallback((
    viewportAspectRatio: PanoramaViewportAspectRatio,
  ) => {
    updateNodeData(id, { viewportAspectRatio });
  }, [id, updateNodeData]);

  const handleCameraViewChangeEnd = useCallback((view: PanoramaCameraView) => {
    const normalized = normalizePanoramaCameraView(view);
    const current = normalizePanoramaCameraView(data.cameraView);
    if (
      normalized.yaw === current.yaw
      && normalized.pitch === current.pitch
      && normalized.fov === current.fov
    ) return;
    updateNodeData(id, { cameraView: normalized });
  }, [data.cameraView, id, updateNodeData]);

  const freezeInlineView = useCallback(() => {
    if (!hasInlineLease) return;
    const currentView = currentViewRef.current;
    if (currentView) handleCameraViewChangeEnd(currentView);
    const capture = captureRef.current;
    if (capture) {
      const previewUrl = capture();
      if (previewUrl) setFrozenPreviewUrl(previewUrl);
    }
    releaseInlineLease(id);
  }, [handleCameraViewChangeEnd, hasInlineLease, id, releaseInlineLease]);

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
      const dataUrl = capture(resolvePanoramaCaptureSize(data.viewportAspectRatio));
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
      onPointerLeave={freezeInlineView}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) {
          freezeInlineView();
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
        onOpenImmersiveViewer={openImmersiveViewer}
        onViewModeChange={handleViewModeChange}
        onViewportAspectRatioChange={handleViewportAspectRatioChange}
        onCameraViewChangeEnd={handleCameraViewChangeEnd}
        onCapture={() => void handleCapture()}
        onContextLost={handleContextLost}
      />

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
