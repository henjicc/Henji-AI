import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { canvasDocumentContainer } from '@/features/canvas/application/canvasProjectInstances';
import { useProjectStore } from '@/stores/projectStore';
import { useTranslation } from 'react-i18next';

import { UiLoading, UiModal } from '@/components/ui';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { isCameraStageNode } from '@/features/canvas/domain/canvasNodes';
// 静态引入会把整个 three.js 场景（约 2.7MB）钉进画布 chunk，切到画布就要下载并编译一遍；
// 而它只有在双击 3D 节点、打开这个全屏对话框时才用得到。
const CameraStageEditor = lazy(() => import('@/features/cameraStage/CameraStageEditor'));
import {
  applyProjectEnvironmentImage,
  createNamedCameraStageDocumentInEditor,
  loadProjectIntoScene,
} from '@/features/cameraStage/projects/cameraStageProjectService';
import { saveCameraStageProjectRuntime } from '@/features/cameraStage/application/cameraStageProjectRuntime';
import { createLogger } from '@/core/logging';
import { useCanvasStore } from '@/stores/canvasStore';

const logger = createLogger('features.canvas.cameraStage');

export function CameraStageNodeDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const node = useCanvasStore((state) => nodeId
    ? state.nodes.find((item) => item.id === nodeId) ?? null
    : null);
  const isActiveCameraStageNode = isCameraStageNode(node);
  const nodeProjectId = isActiveCameraStageNode ? node.data.projectId : null;
  const nodeDisplayName = isActiveCameraStageNode ? node.data.displayName : undefined;
  const nodeEnvironmentImageUrl = isActiveCameraStageNode
    ? node.data.environmentImageUrl ?? null
    : null;
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);

  useEffect(() => canvasEventBus.subscribe('camera-stage/open', ({ nodeId: nextNodeId }) => {
    setNodeId(nextNodeId);
  }), []);

  useEffect(() => {
    if (!nodeId || !isActiveCameraStageNode) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const loaded = nodeProjectId
          ? await loadProjectIntoScene(nodeProjectId)
          : false;
        if (!loaded) {
          // 节点内嵌的镜头参考：已命名的文档（不是草稿），建在画布所在的容器里（项目或作品目录“镜头参考”）
          const canvasId = useProjectStore.getState().currentProjectId;
          const created = await createNamedCameraStageDocumentInEditor(nodeDisplayName || '3D 镜头参考',
            canvasId ? canvasDocumentContainer(canvasId) : undefined);
          if (!cancelled) updateNodeData(nodeId, { projectId: created.id });
        }
        logger.info('画布 3D 镜头参考已打开', {
          event: 'canvas.camera_stage.opened',
          context: { nodeId, projectId: nodeProjectId },
        });
      } catch (error) {
        logger.error('画布 3D 镜头参考打开失败', error, {
          event: 'canvas.camera_stage.open.failed',
          context: { nodeId },
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isActiveCameraStageNode, nodeDisplayName, nodeId, nodeProjectId, updateNodeData]);

  useEffect(() => {
    if (!isActiveCameraStageNode || !nodeProjectId) return;
    void applyProjectEnvironmentImage(
      nodeProjectId,
      nodeEnvironmentImageUrl,
    ).catch((error: unknown) => {
      logger.error('打开编辑器时同步全景环境失败', error, {
        event: 'canvas.camera_stage.environment_sync.failed',
        context: { nodeId, projectId: nodeProjectId },
      });
    });
  }, [isActiveCameraStageNode, nodeEnvironmentImageUrl, nodeId, nodeProjectId]);

  const close = useCallback(() => {
    if (nodeProjectId) void saveCameraStageProjectRuntime(nodeProjectId).catch((error: unknown) => {
      logger.error('画布里的镜头参考保存失败', error, {
        event: 'canvas.camera_stage.save.failed',
        context: { nodeId },
      });
    });
    setNodeId(null);
  }, [nodeId, nodeProjectId]);

  useEffect(() => {
    if (!nodeId) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [close, nodeId]);

  const syncOutputKind = useCallback((outputKind: 'image' | 'video'): void => {
    if (!nodeId) return;
    const currentNode = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
    if (!isCameraStageNode(currentNode) || currentNode.data.outputKind === outputKind) return;
    updateNodeData(nodeId, { outputKind });
  }, [nodeId, updateNodeData]);

  if (!nodeId || !isCameraStageNode(node)) return null;

  return (
    <UiModal
      isOpen
      title={t('node.menu.cameraStage')}
      onClose={close}
      hideHeader
      size="fullscreen"
      contentClassName="min-h-0 flex-1"
    >
      <div className="h-full overflow-hidden">
        {loading ? (
          <UiLoading className="h-full" message={t('node.cameraStageLoading')} />
        ) : (
          <Suspense fallback={(
            <UiLoading className="h-full" message={t('node.cameraStageLoading')} />
          )}>
          <CameraStageEditor
            onBackToList={close}
            backLabel={t('node.backToCanvas')}
            embeddedOutput={{
              assetTarget: {
                enabled: node.data.assetCollectionEnabled === true,
                libraryId: node.data.assetCollectionLibraryId ?? null,
              },
              onAssetTargetChange: (target) => updateNodeData(nodeId, {
                assetCollectionEnabled: target.enabled,
                assetCollectionLibraryId: target.libraryId,
              }),
              onFrame: ({ mediaUrl, selectedTimeSec, aspectRatio }) => updateNodeData(nodeId, {
                imageUrl: mediaUrl,
                previewImageUrl: mediaUrl,
                selectedTimeSec,
                aspectRatio,
              }),
              onVideo: (result) => {
                updateNodeData(nodeId, {
                  videoUrl: result.mediaUrl,
                  durationSec: result.durationSeconds,
                  videoExporting: false,
                  videoProgress: null,
                  videoRenderPhase: null,
                  videoRenderRequestId: null,
                  videoRenderError: null,
                });
              },
              onProgress: (videoProgress) => updateNodeData(nodeId, {
                videoExporting: videoProgress !== null,
                videoProgress,
              }),
              onOutputKindChange: syncOutputKind,
            }}
          />
          </Suspense>
        )}
      </div>
    </UiModal>
  );
}
