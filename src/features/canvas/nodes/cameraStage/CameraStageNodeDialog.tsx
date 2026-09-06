import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UiModal } from '@/components/ui';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { isCameraStageNode } from '@/features/canvas/domain/canvasNodes';
// 静态引入会把整个 three.js 场景（约 2.7MB）钉进画布 chunk，切到画布就要下载并编译一遍；
// 而它只有在双击 3D 节点、打开这个全屏对话框时才用得到。
const CameraStageEditor = lazy(() => import('@/features/cameraStage/CameraStageEditor'));
import {
  applyProjectEnvironmentImage,
  createNewProject,
  loadProjectIntoScene,
  saveCurrentProject,
} from '@/features/cameraStage/projects/cameraStageProjectService';
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
    const nextNode = useCanvasStore.getState().nodes.find((item) => item.id === nextNodeId);
    if (isCameraStageNode(nextNode) && (nextNode.data.videoExporting || nextNode.data.imageExporting)) {
      logger.warn('3D 渲染期间已阻止打开编辑器', {
        event: 'canvas.camera_stage.open.blocked_rendering',
        context: {
          nodeId: nextNodeId,
          requestId: nextNode.data.imageRenderRequestId ?? nextNode.data.videoRenderRequestId,
        },
      });
      return;
    }
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
          const created = await createNewProject(nodeDisplayName || '3D 镜头参考');
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
    void saveCurrentProject().catch((error: unknown) => {
      logger.error('画布 3D 工程保存失败', error, {
        event: 'canvas.camera_stage.save.failed',
        context: { nodeId },
      });
    });
    setNodeId(null);
  }, [nodeId]);

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
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            加载 3D 镜头参考…
          </div>
        ) : (
          <Suspense fallback={(
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              加载 3D 镜头参考…
            </div>
          )}>
          <CameraStageEditor
            onBackToList={close}
            backLabel="返回画布"
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
