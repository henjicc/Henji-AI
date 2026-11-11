import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { useNodeHandlesSync } from '../hooks/useNodeHandlesSync';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';

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
  NODE_SURFACE_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { type PanoramaCaptureCurrentView } from '@/features/canvas/ui/specialInterfaces/panorama/PanoramaSphereCanvas';
import { usePanoramaImageResource } from '@/features/canvas/ui/specialInterfaces/panorama/usePanoramaImageResource';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { canvasViewStore, useCanvasStore } from '@/stores/canvasStore';
import { usePanoramaInlineViewerStore } from '@/stores/panoramaInlineViewerStore';

const logger = createLogger('features.canvas.panoramaViewerNode');
const DEFAULT_NODE_WIDTH = 448;
const MIN_NODE_WIDTH = 320;
/** 默认宽 448 的节点在两倍像素比、75° 视野下用到的贴图约 4300 宽，4K 看不出差别；要看细节进全屏查看器，那里用原图。 */
const INLINE_TEXTURE_MAX_WIDTH = 4096;

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
  const lastSourceRef = useRef<string | null>(null);
  const previewPersistRevisionRef = useRef(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasWebglFailure, setHasWebglFailure] = useState(false);
  const persistedPanoramaPreview = resolvePersistedPanoramaPreview(data.panoramaPreviewImageUrl);
  const [frozenPreviewUrl, setFrozenPreviewUrl] = useState<string | null>(
    () => persistedPanoramaPreview,
  );
  const upstreamImages = useStoreWithEqualityFn(
    canvasViewStore,
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
    INLINE_TEXTURE_MAX_WIDTH,
  );
  const resolvedWidth = Math.max(MIN_NODE_WIDTH, typeof width === 'number' ? width : DEFAULT_NODE_WIDTH);
  const viewportRatio = parsePanoramaViewportAspectRatio(data.viewportAspectRatio);
  const viewportHeight = Math.round(resolvedWidth / viewportRatio);
  const resolvedHeight = viewportHeight;
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

  // 节点数据里只存落盘后的文件地址：整段图片数据串进节点会让每次更新、保存和撤销快照都拖着几百 KB。
  // 序号只认最新一次截图：换图源、更晚的截图都会让还在编码或落盘的旧预览作废
  const persistPanoramaPreview = useCallback((previewDataUrl: string, revision: number): void => {
    logger.debug('全景节点视角预览开始落盘', {
      event: 'panorama.viewer_preview.persist.start',
      nodeId: id,
    });
    void persistImageLocally(previewDataUrl).then((persistedUrl) => {
      if (previewPersistRevisionRef.current !== revision) return;
      const canvas = useCanvasStore.getState();
      const currentNode = canvas.nodes.find((node) => node.id === id);
      if (!currentNode || currentNode.type !== CANVAS_NODE_TYPES.panoramaViewer) return;
      canvas.updateNodeData(id, { panoramaPreviewImageUrl: persistedUrl }, { skipHistory: true });
      logger.debug('全景节点视角预览已落盘', {
        event: 'panorama.viewer_preview.persist.completed',
        nodeId: id,
      });
    }).catch((error: unknown) => {
      if (previewPersistRevisionRef.current !== revision) return;
      logger.warn('全景节点视角预览落盘失败，预览只在本次打开期间显示', {
        event: 'panorama.viewer_preview.persist.failed',
        nodeId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [id]);


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

  /**
   * 截一帧当前视角作冻结预览：别的全景节点接走实时画面、节点缩小或重开画布时显示它。
   * 像素同步读出，编码与落盘都在后台，节点里只记文件地址。
   */
  const capturePreview = useCallback((view?: PanoramaCameraView): void => {
    const capture = captureRef.current;
    if (!capture) return;
    const revision = previewPersistRevisionRef.current + 1;
    previewPersistRevisionRef.current = revision;
    void capture(undefined, view ?? currentViewRef.current ?? undefined).then((previewUrl) => {
      if (!previewUrl || previewPersistRevisionRef.current !== revision) return;
      setFrozenPreviewUrl(previewUrl);
      persistPanoramaPreview(previewUrl, revision);
    });
  }, [persistPanoramaPreview]);

  // 实时球面一旦建立就一直保留，直到别的全景节点接走、切到平面、节点缩到看不清或卸载：
  // 每次重建都要新开 WebGL 上下文并把整张全景图重新传给显卡，跟着鼠标进出反复重建会让整个画布一顿一顿
  const requestSphere = useCallback(() => {
    if (!hasWebglFailure && !isContentLodLow && data.viewMode === 'sphere') claimInlineLease(id);
  }, [claimInlineLease, data.viewMode, hasWebglFailure, id, isContentLodLow]);

  const activateSphere = useCallback(() => {
    setSelectedNode(id);
    requestSphere();
  }, [id, requestSphere, setSelectedNode]);

  useEffect(() => {
    const sphereUnavailable = hasWebglFailure || isContentLodLow || data.viewMode !== 'sphere';
    if (!sphereUnavailable) return;
    releaseInlineLease(id);
  }, [data.viewMode, hasWebglFailure, id, isContentLodLow, releaseInlineLease]);

  useEffect(() => {
    if (lastSourceRef.current === source) return;
    const isFirstSource = lastSourceRef.current === null;
    lastSourceRef.current = source;
    // 换了图源：还在编码、落盘的旧视角预览一律作废；旧预览属于旧图，不再显示
    previewPersistRevisionRef.current += 1;
    setHasWebglFailure(false);
    setFrozenPreviewUrl(isFirstSource ? persistedPanoramaPreview : null);
  }, [persistedPanoramaPreview, source]);

  // 旧版本把预览以图片数据串存在节点里：打开时补落盘，换成文件地址
  useEffect(() => {
    if (!persistedPanoramaPreview?.startsWith('data:image/')) return;
    const revision = previewPersistRevisionRef.current + 1;
    previewPersistRevisionRef.current = revision;
    persistPanoramaPreview(persistedPanoramaPreview, revision);
  }, [persistPanoramaPreview, persistedPanoramaPreview]);

  // 选中一个还没有冻结预览的节点时建立实时球面，首帧出来后截一帧作预览
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
    previewPersistRevisionRef.current += 1;
    releaseInlineLease(id);
  }, [id, releaseInlineLease]);

  useNodeHandlesSync(id, `${resolvedHeight}:${resolvedWidth}`);

  const handleViewModeChange = useCallback((viewMode: PanoramaViewMode) => {
    if (viewMode === 'sphere') setHasWebglFailure(false);
    updateNodeData(id, { viewMode });
    if (viewMode === 'flat') releaseInlineLease(id);
    else if (!isContentLodLow) claimInlineLease(id);
  }, [claimInlineLease, id, isContentLodLow, releaseInlineLease, updateNodeData]);

  const handleContextLost = useCallback(() => {
    setHasWebglFailure(true);
    setFrozenPreviewUrl(persistedPanoramaPreview);
    releaseInlineLease(id);
  }, [id, persistedPanoramaPreview, releaseInlineLease]);

  const handleViewportAspectRatioChange = useCallback((
    viewportAspectRatio: PanoramaViewportAspectRatio,
  ) => {
    updateNodeData(id, { viewportAspectRatio });
  }, [id, updateNodeData]);

  // 改了视口比例：等画布按新尺寸画好（两帧）再重截冻结帧，否则被接走后显示的还是旧比例
  useEffect(() => {
    if (!hasInlineLease) return undefined;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => capturePreview());
    });
    return () => window.cancelAnimationFrame(frame);
    // 只跟着比例变化重截；租约与截图函数变化不需要重截
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.viewportAspectRatio]);

  const handleCameraViewChangeEnd = useCallback((view: PanoramaCameraView) => {
    commitCameraView(view);
    // 拖完立即截：读像素很快、编码在后台；等停顿再截的话，紧接着被别的全景节点接走时预览会停在上一个视角
    capturePreview(view);
  }, [capturePreview, commitCameraView]);

  const handleSphereFramePresented = useCallback(() => {
    if (persistedPanoramaPreview) return;
    capturePreview();
  }, [capturePreview, persistedPanoramaPreview]);

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
      const dataUrl = await capture(
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
      className={`group relative overflow-visible rounded-[var(--node-radius)] border ${NODE_SURFACE_CLASS} transition-colors duration-120 ${
        generationError
          ? NODE_GENERATION_ERROR_BORDER_CLASS
          : isActive ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_CLASS
      }`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<ICON_PANORAMA className={`${UI_ICON_SIZE_CLASS.md}`} />}
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
          controlsPinned={isActive}
          hasWebglFailure={hasWebglFailure}
          captureRef={captureRef}
          onRetry={() => setRetryRevision((revision) => revision + 1)}
          onRequestSphere={requestSphere}
          onInteractionStart={activateSphere}
          onOpenImmersiveViewer={openImmersiveViewer}
          onViewModeChange={handleViewModeChange}
          onViewportAspectRatioChange={handleViewportAspectRatioChange}
          onCameraViewChangeEnd={handleCameraViewChangeEnd}
          onSphereFramePresented={handleSphereFramePresented}
          onCapture={() => void handleCapture()}
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
