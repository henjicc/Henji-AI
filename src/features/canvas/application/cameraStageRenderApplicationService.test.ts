import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acknowledge: vi.fn(),
  cancel: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  start: vi.fn(),
  confirm: vi.fn(),
  commit: vi.fn(),
  collect: vi.fn(),
  createProject: vi.fn(),
  saveProject: vi.fn(),
  applyEnvironment: vi.fn(),
  nodes: [] as Array<Record<string, unknown>>,
  updateNodeData: vi.fn(),
  projectState: { currentProjectId: 'canvas-1', currentProject: null as null | { id: string; nodes: unknown[] } },
}));

vi.mock('@/commands/cameraStageRender', () => ({
  acknowledgeCameraStageRender: mocks.acknowledge,
  cancelCameraStageRender: mocks.cancel,
  getCameraStageRenderTask: mocks.get,
  listCameraStageRenderTasks: mocks.list,
  startCameraStageRender: mocks.start,
}));
vi.mock('@/features/assets/services/cameraStageAssetCollection', () => ({ collectCameraStageAsset: mocks.collect }));
vi.mock('@/features/cameraStage/projects/cameraStageProjectService', () => ({
  applyProjectEnvironmentImage: mocks.applyEnvironment,
  createStoredCameraStageProject: mocks.createProject,
  saveCurrentProject: mocks.saveProject,
}));
vi.mock('@/features/cameraStage/store/cameraStageStore', () => ({
  useCameraStageStore: { getState: () => ({ currentProjectId: null }) },
}));
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => mocks.projectState },
}));
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({
      nodes: mocks.nodes,
      updateNodeData: mocks.updateNodeData,
    }),
  },
}));
vi.mock('./canvasPersistenceService', () => ({
  confirmCanvasPersistence: mocks.confirm,
  runCanvasMutationStage: (_options: unknown, mutation: () => unknown) => mutation(),
}));
vi.mock('./canvasProjectRuntime', () => ({
  withCanvasProjectRuntime: async (projectId: string, execute: (runtime: unknown) => Promise<unknown>) => execute({
    store: { getState: () => ({ nodes: mocks.nodes, updateNodeData: mocks.updateNodeData }) },
    isCurrent: () => mocks.projectState.currentProjectId === projectId,
    persist: () => mocks.confirm(projectId),
    pause: () => () => undefined,
  }),
}));
vi.mock('./generationOutputApplicationService', () => ({ commitCanvasGenerationOutputs: mocks.commit }));

import {
  applyCameraStageRenderTask,
  cancelCameraStageNodeRenderTask,
  readCameraStageNodeRenderTask,
  reconcileCameraStageRenderTasks,
  startCameraStageNodeRender,
} from './cameraStageRenderApplicationService';

function descriptor() {
  return {
    version: 1 as const,
    requestId: 'request-1',
    canvasProjectId: 'canvas-1',
    nodeId: 'node-1',
    cameraStageProjectId: 'stage-1',
    resolutionPreset: '720p' as const,
    outputKind: 'image' as const,
    selectedTimeSec: 1,
  };
}

function task(status: 'queued' | 'completed' = 'completed') {
  return {
    ...descriptor(),
    status,
    phase: status === 'queued' ? 'preparing' as const : null,
    progress: status === 'queued' ? 0 : 1,
    result: status === 'completed' ? {
      kind: 'image' as const,
      mediaUrl: 'media://raw.png', mediaPath: '/raw.png', savedPath: '/raw.png',
      width: 1280, height: 720, aspectRatio: '16:9', selectedTimeSec: 1,
    } : null,
    message: null,
    createdAt: 1,
    updatedAt: 2,
  };
}

function setupNode(renderTask: ReturnType<typeof descriptor> | null = null): void {
  mocks.nodes.splice(0, mocks.nodes.length, {
    id: 'node-1', type: 'cameraStageNode', position: { x: 0, y: 0 },
    data: {
      displayName: '镜头', projectId: 'stage-1', aspectRatio: '16:9', selectedTimeSec: 1,
      imageUrl: null, videoUrl: null, durationSec: null, renderTask,
    },
  });
  mocks.updateNodeData.mockImplementation((nodeId: string, patch: Record<string, unknown>) => {
    const node = mocks.nodes.find((candidate) => candidate.id === nodeId);
    if (node) node.data = { ...(node.data as object), ...patch };
  });
}

describe('cameraStageRenderApplicationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupNode();
    mocks.projectState = { currentProjectId: 'canvas-1', currentProject: { id: 'canvas-1', nodes: mocks.nodes } };
    mocks.confirm.mockResolvedValue(undefined);
    mocks.applyEnvironment.mockResolvedValue(undefined);
    mocks.createProject.mockResolvedValue({ id: 'stage-created' });
    mocks.collect.mockResolvedValue(null);
    mocks.get.mockResolvedValue(null);
    mocks.list.mockResolvedValue([]);
    mocks.start.mockImplementation(async (request) => ({ task: {
      ...request, status: 'queued', phase: 'preparing', progress: 0, result: null,
      message: null, createdAt: 1, updatedAt: 1,
    }, idempotent: false }));
  });

  it('persists the recoverable descriptor before starting the main-process task', async () => {
    const order: string[] = [];
    mocks.confirm.mockImplementation(async () => { order.push('persist'); });
    mocks.start.mockImplementation(async (request) => {
      order.push('start');
      return { task: { ...request, status: 'queued', phase: 'preparing', progress: 0, result: null,
        message: null, createdAt: 1, updatedAt: 1 }, idempotent: false };
    });
    const reference = await startCameraStageNodeRender('node-1', 'image', {
      requestId: 'capability-call-1',
      resolutionPreset: '1080p',
      selectedTimeSec: 2,
    });
    expect(order).toEqual(['persist', 'start']);
    expect(reference).toMatchObject({
      canvasProjectId: 'canvas-1', nodeId: 'node-1', cameraStageProjectId: 'stage-1', outputKind: 'image',
    });
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      canvasProjectId: 'canvas-1', nodeId: 'node-1', cameraStageProjectId: 'stage-1',
      requestId: 'capability-call-1', resolutionPreset: '1080p', selectedTimeSec: 2,
    }));
  });

  it('creates an unbound node project through the non-navigating persistence service', async () => {
    (mocks.nodes[0].data as Record<string, unknown>).projectId = null;
    mocks.createProject.mockResolvedValue({ id: 'stage-created' });

    await startCameraStageNodeRender('node-1', 'image');

    expect(mocks.createProject).toHaveBeenCalledWith('镜头');
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      cameraStageProjectId: 'stage-created',
    }));
  });

  it('rejects a stale assistant owner before writing or submitting to another canvas', async () => {
    mocks.projectState = { currentProjectId: 'canvas-2', currentProject: { id: 'canvas-2', nodes: mocks.nodes } };

    await expect(startCameraStageNodeRender('node-1', 'image', {
      expectedOwner: { canvasProjectId: 'canvas-1', cameraStageProjectId: 'stage-1' },
    })).rejects.toThrow('当前画布项目已切换');

    expect(mocks.updateNodeData).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('does not overwrite a node rebound while its background project is being created', async () => {
    (mocks.nodes[0].data as Record<string, unknown>).projectId = null;
    let finishCreate!: () => void;
    mocks.createProject.mockImplementationOnce(async () => await new Promise((resolve) => {
      finishCreate = () => resolve({ id: 'stage-created' });
    }));
    const rendering = startCameraStageNodeRender('node-1', 'image', {
      expectedOwner: { canvasProjectId: 'canvas-1', cameraStageProjectId: null },
    });
    await vi.waitFor(() => expect(finishCreate).toBeTypeOf('function'));
    (mocks.nodes[0].data as Record<string, unknown>).projectId = 'stage-user-selected';
    finishCreate();

    await expect(rendering).rejects.toThrow('绑定的工程已经变化');
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.updateNodeData).not.toHaveBeenCalled();
    expect(mocks.nodes[0].data).toMatchObject({
      projectId: 'stage-user-selected',
      renderTask: null,
    });
  });

  it('exposes scoped task lookup and cancellation for shared application capabilities', async () => {
    mocks.get.mockResolvedValue(task('queued'));

    await expect(readCameraStageNodeRenderTask(descriptor())).resolves.toMatchObject({
      requestId: 'request-1', status: 'queued',
    });
    await cancelCameraStageNodeRenderTask(descriptor());

    expect(mocks.get).toHaveBeenCalledWith({
      requestId: 'request-1', canvasProjectId: 'canvas-1', nodeId: 'node-1',
    });
    expect(mocks.cancel).toHaveBeenCalledWith({
      requestId: 'request-1', canvasProjectId: 'canvas-1', nodeId: 'node-1',
    });
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it('does not acknowledge or cancel a terminal task through the public cancel helper', async () => {
    mocks.get.mockResolvedValue(task('completed'));

    await cancelCameraStageNodeRenderTask(descriptor());

    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it('commits a completed result once and only acknowledges after durable node state', async () => {
    setupNode(descriptor());
    mocks.nodes.push({ id: 'result-1', type: 'exportImage', data: {
      imageUrl: 'managed://image.png', previewImageUrl: 'managed://preview.png',
    }, position: { x: 1, y: 1 } });
    mocks.commit.mockResolvedValue({ resultNodeIds: ['result-1'] });
    const order: string[] = [];
    mocks.confirm.mockImplementation(async () => { order.push('persist'); });
    mocks.acknowledge.mockImplementation(async () => { order.push('ack'); });
    await applyCameraStageRenderTask(task());
    await applyCameraStageRenderTask(task());
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({
      completionId: 'camera-stage-render:request-1',
      resultNodeData: expect.objectContaining({ cameraStageRenderReceipt: descriptor() }),
    }), expect.objectContaining({ projectId: 'canvas-1' }));
    expect(order).toEqual(['persist', 'ack', 'persist', 'ack']);
    expect((mocks.nodes[0].data as Record<string, unknown>).imageUrl).toBe('managed://image.png');
  });

  it('does not acknowledge a failed save and retries persistence without adding output again', async () => {
    setupNode(descriptor());
    mocks.nodes.push({ id: 'result-1', type: 'exportImage', data: { imageUrl: 'managed://image.png' }, position: { x: 1, y: 1 } });
    mocks.commit.mockResolvedValue({ resultNodeIds: ['result-1'] });
    mocks.confirm.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined);
    await applyCameraStageRenderTask(task());
    expect(mocks.acknowledge).not.toHaveBeenCalled();
    await applyCameraStageRenderTask(task());
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.acknowledge).toHaveBeenCalledTimes(1);
  });

  it('marks a persisted pending descriptor interrupted when the restarted host has no task', async () => {
    setupNode(descriptor());
    mocks.list.mockResolvedValue([]);

    await reconcileCameraStageRenderTasks('canvas-1');

    expect((mocks.nodes[0].data as Record<string, unknown>)).toMatchObject({
      renderTask: null,
      imageExporting: false,
      imageRenderError: expect.stringContaining('已中断'),
    });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledWith('canvas-1');
  });

  it('coalesces concurrent starts and does not let reconcile interrupt a request being registered', async () => {
    let releasePersistence!: () => void;
    mocks.confirm.mockImplementationOnce(async () => await new Promise<void>((resolve) => {
      releasePersistence = resolve;
    }));
    mocks.start.mockImplementation(async (request) => ({ task: {
      ...request, status: 'queued', phase: 'preparing', progress: 0, result: null,
      message: null, createdAt: 1, updatedAt: 1,
    }, idempotent: false }));

    const first = startCameraStageNodeRender('node-1', 'image');
    const second = startCameraStageNodeRender('node-1', 'image');
    await vi.waitFor(() => expect((mocks.nodes[0].data as Record<string, unknown>).renderTask).toBeTruthy());
    await reconcileCameraStageRenderTasks('canvas-1');
    expect((mocks.nodes[0].data as Record<string, unknown>).renderTask).toBeTruthy();
    releasePersistence();
    await Promise.all([first, second]);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it('keeps the pending identity when start and the authoritative query are both uncertain', async () => {
    mocks.start.mockRejectedValue(new Error('ipc disconnected'));
    mocks.get.mockRejectedValue(new Error('query disconnected'));

    await expect(startCameraStageNodeRender('node-1', 'image')).rejects.toThrow('ipc disconnected');

    expect((mocks.nodes[0].data as Record<string, unknown>).renderTask).toMatchObject({
      canvasProjectId: 'canvas-1', nodeId: 'node-1',
    });
  });

  it('retains the descriptor and does not acknowledge while requested asset collection is incomplete', async () => {
    setupNode(descriptor());
    (mocks.nodes[0].data as Record<string, unknown>).assetCollectionEnabled = true;
    mocks.nodes.push({ id: 'result-1', type: 'exportImage', data: { imageUrl: 'managed://image.png' }, position: { x: 1, y: 1 } });
    mocks.commit.mockResolvedValue({ resultNodeIds: ['result-1'] });
    mocks.collect.mockResolvedValue(null);

    await applyCameraStageRenderTask(task());

    expect((mocks.nodes[0].data as Record<string, unknown>).renderTask).toMatchObject({ requestId: 'request-1' });
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it('does not patch another project when the canvas switches during asynchronous preparation', async () => {
    let releaseEnvironment!: () => void;
    mocks.applyEnvironment.mockImplementationOnce(async () => await new Promise<void>((resolve) => {
      releaseEnvironment = resolve;
    }));
    const started = startCameraStageNodeRender('node-1', 'image');
    await vi.waitFor(() => expect(releaseEnvironment).toBeTypeOf('function'));
    mocks.projectState = { currentProjectId: 'canvas-2', currentProject: { id: 'canvas-2', nodes: [] } };
    releaseEnvironment();

    await expect(started).rejects.toThrow('已切换');
    expect(mocks.start).not.toHaveBeenCalled();
    expect((mocks.nodes[0].data as Record<string, unknown>).renderTask).toBeNull();
  });

  it('does not apply a completed task after the canvas switches during output persistence', async () => {
    setupNode(descriptor());
    let releaseCommit!: () => void;
    mocks.commit.mockImplementationOnce(async () => await new Promise((resolve) => {
      releaseCommit = () => resolve({ resultNodeIds: ['result-1'] });
    }));
    const applying = applyCameraStageRenderTask(task());
    await vi.waitFor(() => expect(releaseCommit).toBeTypeOf('function'));
    mocks.projectState = { currentProjectId: 'canvas-2', currentProject: { id: 'canvas-2', nodes: [] } };
    releaseCommit();
    await applying;

    expect((mocks.nodes[0].data as Record<string, unknown>).renderTask).toMatchObject({ requestId: 'request-1' });
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it('waits for the transaction persistence boundary before deciding a temporarily removed task is orphaned', async () => {
    setupNode(descriptor());
    const retainedNode = mocks.nodes[0];
    mocks.nodes.splice(0, mocks.nodes.length);
    let releasePersistence!: () => void;
    mocks.confirm.mockImplementationOnce(async () => await new Promise<void>((resolve) => {
      releasePersistence = resolve;
    }));

    const applying = applyCameraStageRenderTask(task('queued'));
    await vi.waitFor(() => expect(releasePersistence).toBeTypeOf('function'));
    mocks.nodes.push(retainedNode);
    releasePersistence();
    await applying;

    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it('keeps a terminal event when an older queued snapshot arrives while persistence is blocked', async () => {
    setupNode(descriptor());
    const retainedNode = mocks.nodes[0];
    mocks.nodes.splice(0, mocks.nodes.length);
    let releasePersistence!: () => void;
    mocks.confirm.mockImplementationOnce(async () => await new Promise<void>((resolve) => {
      releasePersistence = resolve;
    }));
    mocks.nodes.push({ id: 'result-1', type: 'exportImage', data: {
      imageUrl: 'managed://image.png', previewImageUrl: 'managed://preview.png',
    }, position: { x: 1, y: 1 } });
    mocks.commit.mockResolvedValue({ resultNodeIds: ['result-1'] });

    const progress = applyCameraStageRenderTask(task('queued'));
    await vi.waitFor(() => expect(releasePersistence).toBeTypeOf('function'));
    const completed = applyCameraStageRenderTask(task('completed'));
    const staleQueued = applyCameraStageRenderTask({ ...task('queued'), updatedAt: 1 });
    const sameTimestampQueued = applyCameraStageRenderTask(task('queued'));
    mocks.nodes.unshift(retainedNode);
    releasePersistence();
    await Promise.all([progress, completed, staleQueued, sameTimestampQueued]);

    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.acknowledge).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['queued', 'cancel'],
    ['completed', 'acknowledge'],
  ] as const)('coordinates a durably removed %s task through %s', async (status, expected) => {
    setupNode(descriptor());
    mocks.nodes.splice(0, mocks.nodes.length);

    await applyCameraStageRenderTask(task(status));

    expect(mocks.confirm).toHaveBeenCalledWith('canvas-1');
    if (expected === 'cancel') {
      expect(mocks.cancel).toHaveBeenCalledWith({
        requestId: 'request-1', canvasProjectId: 'canvas-1', nodeId: 'node-1',
      });
      expect(mocks.acknowledge).not.toHaveBeenCalled();
    } else {
      expect(mocks.acknowledge).toHaveBeenCalledWith({
        requestId: 'request-1', canvasProjectId: 'canvas-1', nodeId: 'node-1',
      });
      expect(mocks.cancel).not.toHaveBeenCalled();
    }
  });

  it('does not coordinate an absent task against a different project after persistence unblocks', async () => {
    setupNode(descriptor());
    mocks.nodes.splice(0, mocks.nodes.length);
    let releasePersistence!: () => void;
    mocks.confirm.mockImplementationOnce(async () => await new Promise<void>((resolve) => {
      releasePersistence = resolve;
    }));

    const applying = applyCameraStageRenderTask(task('completed'));
    await vi.waitFor(() => expect(releasePersistence).toBeTypeOf('function'));
    mocks.projectState = { currentProjectId: 'canvas-2', currentProject: { id: 'canvas-2', nodes: [] } };
    releasePersistence();
    await applying;

    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });
});
