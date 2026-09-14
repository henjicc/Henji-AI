import {
  acknowledgeCameraStageRender,
  cancelCameraStageRender as cancelCameraStageRenderCommand,
  getCameraStageRenderTask as getCameraStageRenderTaskCommand,
  listCameraStageRenderTasks,
  startCameraStageRender,
} from '@/commands/cameraStageRender';
import { createLogger } from '@/core/logging';
import { collectCameraStageAsset } from '@/features/assets/services/cameraStageAssetCollection';
import {
  applyProjectEnvironmentImage,
  createStoredCameraStageProject,
  saveCurrentProject,
} from '@/features/cameraStage/projects/cameraStageProjectService';
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore';
import type {
  CameraStageRenderTaskScope,
  CameraStageRenderTaskSnapshot,
} from '@/platform/contracts/cameraStageRender';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

import { CANVAS_NODE_TYPES, isCameraStageNode, type CameraStageRenderTaskDescriptor } from '../domain/canvasNodes';
import { createDefaultGenerationOutputItems } from '../domain/generationOutputs';
import { confirmCanvasPersistence, runCanvasMutationStage, type CanvasTransactionRuntime } from './canvasPersistenceService';
import { commitCanvasGenerationOutputs } from './generationOutputApplicationService';

import { withCanvasProjectRuntime } from './canvasProjectRuntime';

const logger = createLogger('features.canvas.camera-stage-render');
const processing = new Set<string>();
const activeTaskSnapshots = new Map<string, CameraStageRenderTaskSnapshot>();
const deferredTaskSnapshots = new Map<string, CameraStageRenderTaskSnapshot>();
const startingNodes = new Set<string>();
const startingRequests = new Set<string>();

export type CameraStageNodeRenderTaskReference = CameraStageRenderTaskDescriptor;
export type CameraStageNodeRenderTaskScopeReference = CameraStageRenderTaskScope;
export interface CameraStageNodeRenderStartOptions {
  requestId?: string;
  resolutionPreset?: '720p' | '1080p';
  selectedTimeSec?: number;
  expectedOwner?: {
    canvasProjectId: string;
    cameraStageProjectId: string | null;
  };
}

function isTerminalTask(task: CameraStageRenderTaskSnapshot): boolean {
  return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
}

function isNewerTaskSnapshot(current: CameraStageRenderTaskSnapshot, candidate: CameraStageRenderTaskSnapshot): boolean {
  if (candidate.updatedAt !== current.updatedAt) return candidate.updatedAt > current.updatedAt;
  return isTerminalTask(candidate) && !isTerminalTask(current);
}

function scopeOf(task: CameraStageRenderTaskScope): CameraStageRenderTaskScope {
  return { requestId: task.requestId, canvasProjectId: task.canvasProjectId, nodeId: task.nodeId };
}

function currentCanvasProjectId(): string {
  const state = useProjectStore.getState();
  if (!state.currentProjectId || state.currentProject?.id !== state.currentProjectId) {
    throw new Error('当前画布项目不可用');
  }
  return state.currentProjectId;
}

function matchesTask(node: ReturnType<typeof useCanvasStore.getState>['nodes'][number], task: CameraStageRenderTaskSnapshot): boolean {
  if (!isCameraStageNode(node)) return false;
  const pending = node.data.renderTask;
  return pending?.requestId === task.requestId
    && pending.canvasProjectId === task.canvasProjectId
    && pending.nodeId === node.id
    && pending.cameraStageProjectId === task.cameraStageProjectId;
}

function terminalPatch(task: CameraStageRenderTaskSnapshot): DynamicValueMap {
  const message = task.status === 'failed' ? task.message : null;
  return task.outputKind === 'image'
    ? { renderTask: null, imageExporting: false, imageRenderRequestId: null, imageRenderError: message }
    : {
        renderTask: null,
        videoExporting: false,
        videoProgress: null,
        videoRenderPhase: null,
        videoRenderRequestId: null,
        videoRenderError: message,
      };
}

function requireCurrentNode(projectId: string, nodeId: string, requestId?: string | null, runtime?: CanvasTransactionRuntime) {
  const project = useProjectStore.getState();
  if (runtime ? !runtime.isCurrent() : project.currentProjectId !== projectId || project.currentProject?.id !== projectId) {
    throw new Error('当前画布项目已切换，请返回原项目后重试');
  }
  const node = (runtime?.store ?? useCanvasStore).getState().nodes.find((candidate) => candidate.id === nodeId);
  if (!isCameraStageNode(node)) throw new Error('3D 镜头节点已不存在');
  if (requestId !== undefined && (node.data.renderTask?.requestId ?? null) !== requestId) {
    throw new Error('3D 后台渲染任务身份已经变化');
  }
  return node;
}

async function persistNodePatch(
  projectId: string,
  nodeId: string,
  patch: DynamicValueMap,
  expectedRequestId?: string | null,
  runtime?: CanvasTransactionRuntime,
): Promise<void> {
  requireCurrentNode(projectId, nodeId, expectedRequestId, runtime);
  runCanvasMutationStage({}, () => (runtime?.store ?? useCanvasStore).getState().updateNodeData(nodeId, patch));
  await (runtime ? runtime.persist() : confirmCanvasPersistence(projectId));
}

async function applyCompletedTask(task: CameraStageRenderTaskSnapshot, runtime: CanvasTransactionRuntime): Promise<void> {
  if (!task.result || task.result.kind !== task.outputKind) throw new Error('3D 渲染结果类型与请求不一致');
  const canvas = (runtime?.store ?? useCanvasStore).getState();
  const sourceNode = canvas.nodes.find((node) => node.id === task.nodeId);
  if (!sourceNode || !matchesTask(sourceNode, task)) return;
  const mediaType = task.result.kind;
  const resultNodeType = mediaType === 'image' ? CANVAS_NODE_TYPES.exportImage : CANVAS_NODE_TYPES.exportVideo;
  const committed = await commitCanvasGenerationOutputs({
    sourceNodeId: task.nodeId,
    resultNodeType,
    resultNodeData: {
      displayName: mediaType === 'image' ? '3D 镜头图片' : '3D 镜头视频',
      aspectRatio: sourceNode.data.aspectRatio,
      cameraStageRenderReceipt: {
        version: 1,
        requestId: task.requestId,
        canvasProjectId: task.canvasProjectId,
        nodeId: task.nodeId,
        cameraStageProjectId: task.cameraStageProjectId,
        resolutionPreset: task.resolutionPreset,
        outputKind: task.outputKind,
        selectedTimeSec: task.selectedTimeSec,
      },
      ...(mediaType === 'image' ? { resultKind: 'generic' } : {}),
    },
    completionId: `camera-stage-render:${task.requestId}`,
    contract: {
      version: 1,
      strategy: 'single',
      resultKind: mediaType,
      expectedOutputCount: 1,
      outputs: createDefaultGenerationOutputItems({
        sources: [task.result.mediaPath],
        mediaType,
        resultKind: mediaType,
        semanticKind: 'camera-stage-render',
      }),
    },
  }, { projectId: task.canvasProjectId, runtime });
  const latestSourceNode = requireCurrentNode(task.canvasProjectId, task.nodeId, task.requestId, runtime);
  const resultNode = (runtime?.store ?? useCanvasStore).getState().nodes.find((node) => node.id === committed.resultNodeIds[0]);
  if (!resultNode) throw new Error('3D 渲染结果节点没有完成落图');
  const patch = mediaType === 'image'
    ? {
        ...terminalPatch(task),
        imageUrl: resultNode.data.imageUrl,
        previewImageUrl: resultNode.data.previewImageUrl ?? resultNode.data.imageUrl,
        aspectRatio: task.result.aspectRatio,
        selectedTimeSec: task.result.selectedTimeSec,
        videoRenderError: null,
      }
    : {
        ...terminalPatch(task),
        videoUrl: resultNode.data.videoUrl,
        durationSec: task.result.durationSeconds,
        imageRenderError: null,
      };
  const assetTarget = {
    enabled: latestSourceNode.data.assetCollectionEnabled === true,
    libraryId: latestSourceNode.data.assetCollectionLibraryId ?? null,
  };
  const asset = await collectCameraStageAsset({
    filePath: task.result.mediaPath,
    mediaType,
    displayName: `${latestSourceNode.data.displayName || '3D 镜头参考'}-${mediaType === 'image' ? '图片' : '视频'}`,
    target: assetTarget,
    requestId: task.requestId,
  });
  if (assetTarget.enabled && !asset) throw new Error('3D 渲染结果尚未完成资产收录，将在重入工程后重试');
  await persistNodePatch(task.canvasProjectId, task.nodeId, patch, task.requestId, runtime);
}

export async function applyCameraStageRenderTask(task: CameraStageRenderTaskSnapshot): Promise<void> {
  await withCanvasProjectRuntime(task.canvasProjectId, (runtime) => applyTaskInRuntime(task, runtime));
}

async function applyTaskInRuntime(task: CameraStageRenderTaskSnapshot, runtime: CanvasTransactionRuntime): Promise<void> {
  if (processing.has(task.requestId)) {
    const latest = deferredTaskSnapshots.get(task.requestId) ?? activeTaskSnapshots.get(task.requestId);
    if (!latest || isNewerTaskSnapshot(latest, task)) deferredTaskSnapshots.set(task.requestId, task);
    return;
  }
  processing.add(task.requestId);
  activeTaskSnapshots.set(task.requestId, task);
  try {
    let node = runtime.store.getState().nodes.find((candidate) => candidate.id === task.nodeId);
    if (!node || !matchesTask(node, task)) {
      // 删除可能只是批事务中的瞬时内存态。独立生命周期任务可以等待外层释放持久化租约；
      // 写盘完成后必须重新核对工程和任务身份，回滚恢复的任务继续接管，不能误取消。
      await runtime.persist();
      if (!runtime.isCurrent()) return;
      node = runtime.store.getState().nodes.find((candidate) => candidate.id === task.nodeId);
      if (!node || !matchesTask(node, task)) {
        if (task.status === 'queued' || task.status === 'running') {
          await cancelCameraStageRenderCommand(scopeOf(task));
        } else {
          await acknowledgeCameraStageRender(scopeOf(task));
        }
        return;
      }
    }
    if (task.status === 'queued' || task.status === 'running') {
      if (task.outputKind === 'video') runtime.store.getState().updateNodeData(task.nodeId, {
        videoExporting: true,
        videoProgress: task.progress,
        videoRenderPhase: task.phase,
      }, { skipHistory: true });
      return;
    }
    if (task.status === 'completed') await applyCompletedTask(task, runtime);
    else await persistNodePatch(task.canvasProjectId, task.nodeId, terminalPatch(task), task.requestId, runtime);
    await acknowledgeCameraStageRender(scopeOf(task));
  } catch (error) {
    logger.error('3D 后台渲染终态接管失败', error, {
      event: 'canvas.camera_stage.background_render.apply.failed',
      requestId: task.requestId,
      projectId: task.canvasProjectId,
      context: { nodeId: task.nodeId, status: task.status },
    });
  } finally {
    processing.delete(task.requestId);
    activeTaskSnapshots.delete(task.requestId);
    const deferred = deferredTaskSnapshots.get(task.requestId);
    if (deferred) {
      deferredTaskSnapshots.delete(task.requestId);
      await applyTaskInRuntime(deferred, runtime);
    }
  }
}

export async function startCameraStageNodeRender(
  nodeId: string,
  outputKind: 'image' | 'video',
  options: CameraStageNodeRenderStartOptions = {},
): Promise<CameraStageNodeRenderTaskReference | null> {
  const canvasProjectId = options.expectedOwner?.canvasProjectId ?? currentCanvasProjectId();
  return await withCanvasProjectRuntime(canvasProjectId, (runtime) => startRenderInRuntime(nodeId, outputKind, options, canvasProjectId, runtime));
}

async function startRenderInRuntime(nodeId: string, outputKind: 'image' | 'video', options: CameraStageNodeRenderStartOptions, canvasProjectId: string, runtime: CanvasTransactionRuntime): Promise<CameraStageNodeRenderTaskReference | null> {
  if (options.expectedOwner && options.expectedOwner.canvasProjectId !== canvasProjectId) {
    throw new Error('目标画布项目已经切换，请重新读取节点后再输出');
  }
  const startKey = `${canvasProjectId}:${nodeId}`;
  const requireUnchangedOwner = (expectedCameraStageProjectId: string | null) => {
    const current = requireCurrentNode(canvasProjectId, nodeId, undefined, runtime);
    if (current.data.projectId !== expectedCameraStageProjectId) {
      throw new Error('3D 镜头节点绑定的工程已经变化，请重新读取节点后再输出');
    }
    return current;
  };
  if (startingNodes.has(startKey)) {
    const current = options.expectedOwner
      ? requireUnchangedOwner(options.expectedOwner.cameraStageProjectId)
      : runtime.store.getState().nodes.find((candidate) => candidate.id === nodeId);
    return isCameraStageNode(current) ? current.data.renderTask ?? null : null;
  }
  startingNodes.add(startKey);
  const node = (runtime?.store ?? useCanvasStore).getState().nodes.find((candidate) => candidate.id === nodeId);
  let ownedCameraStageProjectId = isCameraStageNode(node) ? node.data.projectId : null;
  try {
    if (!isCameraStageNode(node)) return null;
    if (options.expectedOwner && node.data.projectId !== options.expectedOwner.cameraStageProjectId) {
      throw new Error('3D 镜头节点绑定的工程已经变化，请重新读取节点后再输出');
    }
    if (node.data.renderTask) return node.data.renderTask;
    let cameraStageProjectId = node.data.projectId;
    if (!cameraStageProjectId) {
      cameraStageProjectId = (await createStoredCameraStageProject(node.data.displayName || '3D 镜头参考')).id;
    } else if (useCameraStageStore.getState().currentProjectId === cameraStageProjectId) {
      await saveCurrentProject();
    }
    const latestNode = requireUnchangedOwner(ownedCameraStageProjectId);
    requireCurrentNode(canvasProjectId, nodeId, null, runtime);
    await applyProjectEnvironmentImage(cameraStageProjectId, latestNode.data.environmentImageUrl ?? null);
    requireUnchangedOwner(ownedCameraStageProjectId);
    requireCurrentNode(canvasProjectId, nodeId, null, runtime);
    const task: CameraStageRenderTaskDescriptor = {
      version: 1,
      requestId: options.requestId ?? crypto.randomUUID(),
      canvasProjectId,
      nodeId,
      cameraStageProjectId,
      resolutionPreset: options.resolutionPreset ?? '720p',
      outputKind,
      selectedTimeSec: outputKind === 'image'
        ? options.selectedTimeSec ?? latestNode.data.selectedTimeSec
        : undefined,
    };
    startingRequests.add(task.requestId);
    let preservePending = false;
    const pendingPatch = outputKind === 'image'
      ? { projectId: cameraStageProjectId, renderTask: task, imageExporting: true, imageRenderRequestId: task.requestId, imageRenderError: null }
      : {
          projectId: cameraStageProjectId,
          renderTask: task,
          videoExporting: true,
          videoProgress: 0,
          videoRenderPhase: 'preparing',
          videoRenderRequestId: task.requestId,
          videoRenderError: null,
        };
    try {
      await persistNodePatch(canvasProjectId, nodeId, pendingPatch, null, runtime);
      ownedCameraStageProjectId = cameraStageProjectId;
      try {
        const registration = await startCameraStageRender(task);
        await applyTaskInRuntime(registration.task, runtime);
        return task;
      } catch (error) {
        let authoritative: CameraStageRenderTaskSnapshot | null;
        try {
          authoritative = await getCameraStageRenderTaskCommand(scopeOf(task));
        } catch (queryError) {
          preservePending = true;
          logger.error('3D 后台渲染启动结果暂时无法确认', queryError, {
            event: 'canvas.camera_stage.background_render.start_unknown',
            requestId: task.requestId,
            projectId: canvasProjectId,
            context: { nodeId },
          });
          authoritative = null;
        }
        if (preservePending) throw error;
        if (authoritative) {
          await applyTaskInRuntime(authoritative, runtime);
          return task;
        }
        throw error;
      }
    } catch (error) {
      // 主进程尚未收到请求时，内存中的 pending 不是可恢复任务；明确清理，绝不盲重放。
      if (!preservePending
        && (requireCurrentNode(canvasProjectId, nodeId, undefined, runtime).data.renderTask?.requestId ?? null) === task.requestId) {
        runtime.store.getState().updateNodeData(nodeId, terminalPatch({
          ...task, status: 'failed', phase: null, progress: 0, result: null,
          message: error instanceof Error ? error.message : String(error), createdAt: 0, updatedAt: 0,
        }));
      }
      throw error;
    } finally {
      startingRequests.delete(task.requestId);
    }
  } catch (error) {
    try {
      const current = requireCurrentNode(canvasProjectId, nodeId, undefined, runtime);
      if (!current.data.renderTask && current.data.projectId === ownedCameraStageProjectId) {
        const message = error instanceof Error ? error.message : String(error);
        await persistNodePatch(canvasProjectId, nodeId, outputKind === 'image'
          ? { imageExporting: false, imageRenderRequestId: null, imageRenderError: message }
          : {
              videoExporting: false,
              videoProgress: null,
              videoRenderPhase: null,
              videoRenderRequestId: null,
              videoRenderError: message,
            }, null, runtime);
      }
    } catch (persistenceError) {
      logger.error('3D 后台渲染启动失败状态尚未保存', persistenceError, {
        event: 'canvas.camera_stage.background_render.start_failure_persist.failed',
        projectId: canvasProjectId,
        context: { nodeId, outputKind },
      });
    }
    throw error;
  } finally {
    startingNodes.delete(startKey);
  }
}

export async function readCameraStageNodeRenderTask(
  reference: CameraStageNodeRenderTaskScopeReference,
): Promise<CameraStageRenderTaskSnapshot | null> {
  return await getCameraStageRenderTaskCommand(scopeOf(reference));
}

export async function cancelCameraStageNodeRenderTask(
  reference: CameraStageNodeRenderTaskScopeReference,
): Promise<void> {
  const task = await readCameraStageNodeRenderTask(reference);
  if (!task) return;
  if (task.status === 'queued' || task.status === 'running') {
    await cancelCameraStageRenderCommand(scopeOf(reference));
  }
}

export async function reconcileCameraStageRenderTasks(canvasProjectId: string): Promise<void> {
  const project = useProjectStore.getState();
  const canvasNodeIds = useCanvasStore.getState().nodes.map((node) => node.id).sort();
  const persistedNodeIds = project.currentProject?.nodes.map((node) => node.id).sort() ?? [];
  if (project.currentProjectId !== canvasProjectId
    || project.currentProject?.id !== canvasProjectId
    || canvasNodeIds.length !== persistedNodeIds.length
    || canvasNodeIds.some((nodeId, index) => nodeId !== persistedNodeIds[index])) return;
  const tasks = await listCameraStageRenderTasks(canvasProjectId);
  const byId = new Map(tasks.map((task) => [task.requestId, task]));
  for (const task of tasks) void applyCameraStageRenderTask(task);
  for (const node of useCanvasStore.getState().nodes) {
    if (!isCameraStageNode(node) || !node.data.renderTask || node.data.renderTask.canvasProjectId !== canvasProjectId) continue;
    if (byId.has(node.data.renderTask.requestId) || startingRequests.has(node.data.renderTask.requestId)) continue;
    await persistNodePatch(canvasProjectId, node.id, {
      ...terminalPatch({ ...node.data.renderTask, status: 'failed', phase: null, progress: 0, result: null,
        message: '上一次 3D 渲染会话已中断，请重新输出', createdAt: 0, updatedAt: 0 }),
    }, node.data.renderTask.requestId);
  }
}

export async function cancelCameraStageNodeTasks(projectId: string, descriptors: CameraStageRenderTaskDescriptor[]): Promise<void> {
  for (const descriptor of descriptors) {
    if (descriptor.canvasProjectId !== projectId) continue;
    const scope = scopeOf(descriptor);
    const task = await getCameraStageRenderTaskCommand(scope);
    if (!task) continue;
    if (task.status === 'queued' || task.status === 'running') await cancelCameraStageRenderCommand(scope);
    else await acknowledgeCameraStageRender(scope);
  }
}
