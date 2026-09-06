import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  eventHandler: null as null | ((task: unknown) => void),
  projectHandler: null as null | ((state: unknown, previous: unknown) => void),
  canvasHandler: null as null | ((state: { nodes: unknown[] }, previous: { nodes: unknown[] }) => void),
  canvasNodes: [] as unknown[],
  projectState: { currentProjectId: 'canvas-1' as string | null, currentProject: { id: 'canvas-1', nodes: [] } as { id: string; nodes: unknown[] } | null },
  apply: vi.fn(),
  reconcile: vi.fn(),
  start: vi.fn(),
}));

vi.mock('@/commands/cameraStageRender', () => ({
  onCameraStageRenderEvent: (handler: (task: unknown) => void) => {
    mocks.order.push('subscribe-event');
    mocks.eventHandler = handler;
    return vi.fn();
  },
}));
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => mocks.projectState,
    subscribe: (handler: (state: unknown, previous: unknown) => void) => {
      mocks.projectHandler = handler;
      return vi.fn();
    },
  },
}));
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({ nodes: mocks.canvasNodes }),
    subscribe: (handler: (state: { nodes: unknown[] }, previous: { nodes: unknown[] }) => void) => {
      mocks.canvasHandler = handler;
      return vi.fn();
    },
  },
}));
vi.mock('./canvasServices', () => ({
  canvasEventBus: { subscribe: vi.fn(() => vi.fn()) },
}));
vi.mock('./cameraStageRenderApplicationService', () => ({
  applyCameraStageRenderTask: mocks.apply,
  reconcileCameraStageRenderTasks: (projectId: string) => {
    mocks.order.push('reconcile');
    return mocks.reconcile(projectId);
  },
  startCameraStageNodeRender: mocks.start,
}));

import { installCameraStageRenderLifecycleHost } from './cameraStageRenderLifecycle';

describe('CameraStageRenderLifecycleHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.canvasNodes = [];
    mocks.reconcile.mockResolvedValue(undefined);
    mocks.apply.mockResolvedValue(undefined);
    mocks.projectState = { currentProjectId: 'canvas-1', currentProject: { id: 'canvas-1', nodes: [] } };
  });

  it('subscribes before reconciling and reconciles again when the canvas project re-enters', async () => {
    const dispose = installCameraStageRenderLifecycleHost();
    expect(mocks.order).toEqual(['subscribe-event', 'reconcile']);
    expect(mocks.reconcile).toHaveBeenCalledWith('canvas-1');

    const previous = mocks.projectState;
    mocks.projectState = { currentProjectId: 'canvas-2', currentProject: { id: 'canvas-2', nodes: [] } };
    mocks.projectHandler?.(mocks.projectState, previous);
    await vi.waitFor(() => expect(mocks.reconcile).toHaveBeenLastCalledWith('canvas-2'));

    mocks.eventHandler?.({ requestId: 'request-1' });
    expect(mocks.apply).toHaveBeenCalledWith({ requestId: 'request-1' });
    dispose();
  });

  it('does not query again when only render progress changes', async () => {
    installCameraStageRenderLifecycleHost();
    await Promise.resolve();
    const previous = { nodes: mocks.canvasNodes };
    mocks.canvasNodes = [{ id: 'node-1', data: { renderTask: { requestId: 'request-1' } } }];
    mocks.canvasHandler?.({ nodes: mocks.canvasNodes }, previous);
    await vi.waitFor(() => expect(mocks.reconcile).toHaveBeenCalledTimes(2));
    const countAfterPending = mocks.reconcile.mock.calls.length;

    const progressPrevious = { nodes: mocks.canvasNodes };
    mocks.canvasNodes = [{ id: 'node-1', data: { renderTask: { requestId: 'request-1' }, videoProgress: 0.5 } }];
    mocks.canvasHandler?.({ nodes: mocks.canvasNodes }, progressPrevious);
    await Promise.resolve();
    expect(mocks.reconcile).toHaveBeenCalledTimes(countAfterPending);
  });
});
