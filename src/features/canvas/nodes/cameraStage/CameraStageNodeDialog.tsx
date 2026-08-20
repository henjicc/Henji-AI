import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UiModal } from '@/components/ui';
import {
  cancelCameraStageRender,
  onCameraStageRenderEvent,
  startCameraStageRender,
} from '@/commands/cameraStageRender';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { isCameraStageNode } from '@/features/canvas/domain/canvasNodes';
// 静态引入会把整个 three.js 场景（约 2.7MB）钉进画布 chunk，切到画布就要下载并编译一遍；
// 而它只有在双击 3D 节点、打开这个全屏对话框时才用得到。
const CameraStageEditor = lazy(() => import('@/features/cameraStage/CameraStageEditor'));
import {
  createNewProject,
  loadProjectIntoScene,
  saveCurrentProject,
} from '@/features/cameraStage/projects/cameraStageProjectService';
import { createLogger } from '@/core/logging';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore';
import { collectCameraStageAsset, type CameraStageAssetTarget } from '@/features/assets/services/cameraStageAssetCollection';

const logger = createLogger('features.canvas.cameraStage');
const renderRequests = new Map<string, {
  kind: 'image' | 'video';
  target: CameraStageAssetTarget;
}>();

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
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);

  useEffect(() => {
    for (const candidate of useCanvasStore.getState().nodes) {
      if (!isCameraStageNode(candidate)) continue;
      const requestId = candidate.data.imageRenderRequestId ?? candidate.data.videoRenderRequestId;
      if ((!candidate.data.imageExporting && !candidate.data.videoExporting)
        || (requestId && renderRequests.has(requestId))) continue;
      if (requestId) void cancelCameraStageRender(requestId);
      updateNodeData(candidate.id, {
        imageExporting: false,
        imageRenderRequestId: null,
        imageRenderError: candidate.data.imageExporting ? '上一次图片渲染会话已中断，请重新输出' : null,
        videoExporting: false,
        videoProgress: null,
        videoRenderPhase: null,
        videoRenderRequestId: null,
        videoRenderError: candidate.data.videoExporting ? '上一次视频渲染会话已中断，请重新输出' : null,
      });
    }
  }, [updateNodeData]);

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

  const startBackgroundRender = useCallback(async (
    nextNodeId: string,
    outputKind: 'image' | 'video',
  ): Promise<void> => {
    const currentNode = useCanvasStore.getState().nodes.find((item) => item.id === nextNodeId);
    if (!isCameraStageNode(currentNode)) return;
    if (currentNode.data.imageExporting || currentNode.data.videoExporting) return;
    let projectId = currentNode.data.projectId;
    const requestId = crypto.randomUUID();
    try {
      if (!projectId) {
        const created = await createNewProject(currentNode.data.displayName || '3D 镜头参考');
        projectId = created.id;
        updateNodeData(nextNodeId, { projectId });
      } else if (useCameraStageStore.getState().currentProjectId === projectId) {
        await saveCurrentProject();
      }
      updateNodeData(nextNodeId, outputKind === 'image'
        ? {
            imageExporting: true,
            imageRenderRequestId: requestId,
            imageRenderError: null,
            videoRenderError: null,
          }
        : {
            videoExporting: true,
            videoProgress: 0,
            videoRenderPhase: 'preparing',
            videoRenderRequestId: requestId,
            videoRenderError: null,
            imageRenderError: null,
          });
      renderRequests.set(requestId, {
        kind: outputKind,
        target: {
          enabled: currentNode.data.assetCollectionEnabled === true,
          libraryId: currentNode.data.assetCollectionLibraryId ?? null,
        },
      });
      await startCameraStageRender({
        requestId,
        nodeId: nextNodeId,
        projectId,
        resolutionPreset: '720p',
        outputKind,
        selectedTimeSec: outputKind === 'image' ? currentNode.data.selectedTimeSec : undefined,
      });
      logger.info('画布 3D 后台渲染已提交', {
        event: 'canvas.camera_stage.background_render.started',
        requestId,
        context: { nodeId: nextNodeId, projectId, outputKind },
      });
    } catch (error) {
      renderRequests.delete(requestId);
      const message = error instanceof Error ? error.message : String(error);
      updateNodeData(nextNodeId, outputKind === 'image'
        ? {
            imageExporting: false,
            imageRenderRequestId: null,
            imageRenderError: message,
          }
        : {
            videoExporting: false,
            videoProgress: null,
            videoRenderPhase: null,
            videoRenderRequestId: null,
            videoRenderError: message,
          });
      logger.error('画布 3D 后台渲染提交失败', error, {
        event: 'canvas.camera_stage.background_render.start_failed',
        requestId,
        context: { nodeId: nextNodeId, projectId, outputKind },
      });
    }
  }, [updateNodeData]);

  useEffect(() => canvasEventBus.subscribe('camera-stage/render-image', ({ nodeId: nextNodeId }) => {
    void startBackgroundRender(nextNodeId, 'image');
  }), [startBackgroundRender]);

  useEffect(() => canvasEventBus.subscribe('camera-stage/render-video', ({ nodeId: nextNodeId }) => {
    void startBackgroundRender(nextNodeId, 'video');
  }), [startBackgroundRender]);

  useEffect(() => onCameraStageRenderEvent((event) => {
    const pending = renderRequests.get(event.requestId);
    if (!pending) return;
    const currentNode = useCanvasStore.getState().nodes.find((item) => item.id === event.nodeId);
    const matchesNode = isCameraStageNode(currentNode) && (
      pending.kind === 'image'
        ? currentNode.data.imageRenderRequestId === event.requestId
        : currentNode.data.videoRenderRequestId === event.requestId
    );
    if (!matchesNode || !isCameraStageNode(currentNode)) return;
    if (event.type === 'progress') {
      if (pending.kind === 'video') {
        updateNodeData(event.nodeId, {
          videoExporting: true,
          videoProgress: event.progress,
          videoRenderPhase: event.phase,
        });
      }
      return;
    }
    if (event.type === 'completed') {
      renderRequests.delete(event.requestId);
      if (event.result.kind !== pending.kind) {
        const expectedLabel = pending.kind === 'image' ? '图片' : '视频';
        const actualLabel = event.result.kind === 'image' ? '图片' : '视频';
        const message = `渲染结果类型异常：请求${expectedLabel}，实际收到${actualLabel}，请重试`;
        updateNodeData(event.nodeId, pending.kind === 'image'
          ? {
              imageExporting: false,
              imageRenderRequestId: null,
              imageRenderError: message,
            }
          : {
              videoExporting: false,
              videoProgress: null,
              videoRenderPhase: null,
              videoRenderRequestId: null,
              videoRenderError: message,
            });
        logger.error('画布 3D 后台渲染结果类型异常', {
          event: 'canvas.camera_stage.background_render.kind_mismatch',
          requestId: event.requestId,
          context: { nodeId: event.nodeId, expectedKind: pending.kind, actualKind: event.result.kind },
        });
        return;
      }
      if (event.result.kind === 'image') {
        updateNodeData(event.nodeId, {
          imageUrl: event.result.mediaUrl,
          previewImageUrl: event.result.mediaUrl,
          aspectRatio: event.result.aspectRatio,
          selectedTimeSec: event.result.selectedTimeSec,
          imageExporting: false,
          imageRenderRequestId: null,
          imageRenderError: null,
          videoRenderError: null,
        });
        canvasEventBus.publish('camera-stage/output', { nodeId: event.nodeId, kind: 'image' });
      } else {
        updateNodeData(event.nodeId, {
          videoUrl: event.result.mediaUrl,
          durationSec: event.result.durationSeconds,
          videoExporting: false,
          videoProgress: null,
          videoRenderPhase: null,
          videoRenderRequestId: null,
          videoRenderError: null,
          imageRenderError: null,
        });
        canvasEventBus.publish('camera-stage/output', { nodeId: event.nodeId, kind: 'video' });
      }
      if (pending.target) {
        void collectCameraStageAsset({
          filePath: event.result.mediaPath,
          mediaType: event.result.kind,
          displayName: `${currentNode.data.displayName || '3D 镜头参考'}-${event.result.kind === 'image' ? '图片' : '视频'}`,
          target: pending.target,
          requestId: event.requestId,
        });
      }
      return;
    }
    renderRequests.delete(event.requestId);
    const message = event.type === 'failed' ? event.message : null;
    updateNodeData(event.nodeId, pending.kind === 'image'
      ? {
          imageExporting: false,
          imageRenderRequestId: null,
          imageRenderError: message,
        }
      : {
          videoExporting: false,
          videoProgress: null,
          videoRenderPhase: null,
          videoRenderRequestId: null,
          videoRenderError: message,
        });
  }), [updateNodeData]);

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
