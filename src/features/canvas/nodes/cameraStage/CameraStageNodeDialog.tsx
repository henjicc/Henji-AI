import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UiModal } from '@/components/ui';
import {
  onCameraStageRenderEvent,
  startCameraStageRender,
} from '@/commands/cameraStageRender';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { isCameraStageNode } from '@/features/canvas/domain/canvasNodes';
import CameraStageEditor from '@/features/cameraStage/CameraStageEditor';
import {
  createNewProject,
  loadProjectIntoScene,
  saveCurrentProject,
} from '@/features/cameraStage/projects/cameraStageProjectService';
import { createLogger } from '@/core/logging';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore';

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
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);

  useEffect(() => canvasEventBus.subscribe('camera-stage/open', ({ nodeId: nextNodeId }) => {
    const nextNode = useCanvasStore.getState().nodes.find((item) => item.id === nextNodeId);
    if (isCameraStageNode(nextNode) && nextNode.data.videoExporting) {
      logger.warn('3D 视频渲染期间已阻止打开编辑器', {
        event: 'canvas.camera_stage.open.blocked_rendering',
        context: { nodeId: nextNodeId, requestId: nextNode.data.videoRenderRequestId },
      });
      return;
    }
    setNodeId(nextNodeId);
  }), []);

  const startBackgroundRender = useCallback(async (nextNodeId: string): Promise<void> => {
    const currentNode = useCanvasStore.getState().nodes.find((item) => item.id === nextNodeId);
    if (!isCameraStageNode(currentNode)) return;
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
      updateNodeData(nextNodeId, {
        videoExporting: true,
        videoProgress: 0,
        videoRenderPhase: 'preparing',
        videoRenderRequestId: requestId,
        videoRenderError: null,
      });
      await startCameraStageRender({
        requestId,
        nodeId: nextNodeId,
        projectId,
        resolutionPreset: '720p',
      });
      logger.info('画布 3D 视频后台渲染已提交', {
        event: 'canvas.camera_stage.background_render.started',
        requestId,
        context: { nodeId: nextNodeId, projectId },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateNodeData(nextNodeId, {
        videoExporting: false,
        videoProgress: null,
        videoRenderPhase: null,
        videoRenderRequestId: null,
        videoRenderError: message,
      });
      logger.error('画布 3D 视频后台渲染提交失败', error, {
        event: 'canvas.camera_stage.background_render.start_failed',
        requestId,
        context: { nodeId: nextNodeId, projectId },
      });
    }
  }, [updateNodeData]);

  useEffect(() => canvasEventBus.subscribe('camera-stage/render-video', ({ nodeId: nextNodeId }) => {
    void startBackgroundRender(nextNodeId);
  }), [startBackgroundRender]);

  useEffect(() => onCameraStageRenderEvent((event) => {
    const currentNode = useCanvasStore.getState().nodes.find((item) => item.id === event.nodeId);
    if (!isCameraStageNode(currentNode) || currentNode.data.videoRenderRequestId !== event.requestId) return;
    if (event.type === 'progress') {
      updateNodeData(event.nodeId, {
        videoExporting: true,
        videoProgress: event.progress,
        videoRenderPhase: event.phase,
      });
      return;
    }
    if (event.type === 'completed') {
      updateNodeData(event.nodeId, {
        videoUrl: event.result.mediaUrl,
        durationSec: event.result.durationSeconds,
        videoExporting: false,
        videoProgress: null,
        videoRenderPhase: null,
        videoRenderRequestId: null,
        videoRenderError: null,
      });
      canvasEventBus.publish('camera-stage/output', { nodeId: event.nodeId, kind: 'video' });
      return;
    }
    updateNodeData(event.nodeId, {
      videoExporting: false,
      videoProgress: null,
      videoRenderPhase: null,
      videoRenderRequestId: null,
      videoRenderError: event.type === 'failed' ? event.message : null,
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
      overlayClassName="!z-[90]"
      widthClassName="flex h-full w-full flex-col overflow-hidden !rounded-none !border-0"
      contentClassName="min-h-0 flex-1"
    >
      <div className="h-full overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            加载 3D 镜头参考…
          </div>
        ) : (
          <CameraStageEditor
            onBackToList={close}
            backLabel="返回画布"
            embeddedOutput={{
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
        )}
      </div>
    </UiModal>
  );
}
