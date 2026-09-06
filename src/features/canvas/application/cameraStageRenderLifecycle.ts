import { onCameraStageRenderEvent } from '@/commands/cameraStageRender';
import { createLogger } from '@/core/logging';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

import { canvasEventBus } from './canvasServices';
import {
  applyCameraStageRenderTask,
  reconcileCameraStageRenderTasks,
  startCameraStageNodeRender,
} from './cameraStageRenderApplicationService';

const logger = createLogger('features.canvas.camera-stage-render-lifecycle');

export function installCameraStageRenderLifecycleHost(): () => void {
  let disposed = false;
  let lastIdentity = '';
  let reconcileRunning = false;
  let reconcileQueued = false;
  const report = (message: string, error: unknown, context: Record<string, unknown>): void => {
    logger.error(message, error, { event: 'canvas.camera_stage.background_render.lifecycle.failed', context });
  };
  const stopEvents = onCameraStageRenderEvent((task) => {
    void applyCameraStageRenderTask(task).catch((error) => report('3D 后台渲染事件接管失败', error, {
      requestId: task.requestId, nodeId: task.nodeId,
    }));
  });
  const start = (nodeId: string, outputKind: 'image' | 'video'): void => {
    void startCameraStageNodeRender(nodeId, outputKind).catch((error) => report('3D 后台渲染启动失败', error, {
      nodeId, outputKind,
    }));
  };
  const stopImage = canvasEventBus.subscribe('camera-stage/render-image', ({ nodeId }) => {
    start(nodeId, 'image');
  });
  const stopVideo = canvasEventBus.subscribe('camera-stage/render-video', ({ nodeId }) => {
    start(nodeId, 'video');
  });
  const reconcileCurrent = (): void => {
    const project = useProjectStore.getState();
    const projectId = project.currentProjectId;
    if (!projectId || project.currentProject?.id !== projectId) return;
    const canvasNodes = useCanvasStore.getState().nodes;
    const canvasNodeIds = canvasNodes.map((node) => node.id).sort();
    const persistedNodeIds = project.currentProject.nodes.map((node) => node.id).sort();
    const loaded = canvasNodeIds.length === persistedNodeIds.length
      && canvasNodeIds.every((nodeId, index) => nodeId === persistedNodeIds[index]);
    const taskIdentity = canvasNodes.flatMap((node) => (
      'renderTask' in node.data && node.data.renderTask
        ? [`${node.id}:${node.data.renderTask.requestId}`]
        : []
    )).sort().join('\u0001');
    const identity = `${projectId}\u0000${loaded ? 'loaded' : 'loading'}\u0000${taskIdentity}`;
    if (identity === lastIdentity) return;
    if (reconcileRunning) {
      reconcileQueued = true;
      return;
    }
    lastIdentity = identity;
    reconcileRunning = true;
    void reconcileCameraStageRenderTasks(projectId).catch((error) => report(
      '3D 后台渲染恢复查询失败', error, { projectId },
    )).finally(() => {
      reconcileRunning = false;
      if (!disposed && reconcileQueued) {
        reconcileQueued = false;
        reconcileCurrent();
      }
    });
  };
  const stopProjects = useProjectStore.subscribe((state, previous) => {
    if (state.currentProjectId !== previous.currentProjectId
      || state.currentProject?.id !== previous.currentProject?.id) reconcileCurrent();
  });
  const stopCanvas = useCanvasStore.subscribe((state, previous) => {
    if (state.nodes !== previous.nodes) reconcileCurrent();
  });
  reconcileCurrent();
  return () => {
    disposed = true;
    stopEvents(); stopImage(); stopVideo(); stopProjects(); stopCanvas();
  };
}
