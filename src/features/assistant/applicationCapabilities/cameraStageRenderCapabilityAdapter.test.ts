import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  read: vi.fn(),
  start: vi.fn(),
  readPersisted: vi.fn(),
  projectState: { currentProjectId: 'canvas-1', currentProject: { id: 'canvas-1' } } as {
    currentProjectId: string | null
    currentProject: { id: string } | null
  },
  nodes: [{
    id: 'stage-node',
    type: 'cameraStageNode',
    position: { x: 0, y: 0 },
    data: { projectId: 'stage-1', renderTask: null, imageRenderError: null },
  }] as Array<Record<string, unknown>>,
  persistedNodes: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/features/canvas/application/cameraStageRenderApplicationService', () => ({
  cancelCameraStageNodeRenderTask: mocks.cancel,
  readCameraStageNodeRenderTask: mocks.read,
  startCameraStageNodeRender: mocks.start,
}))
vi.mock('@/features/canvas/application/canvasQueryService', () => ({
  readPersistedCanvasProjectSnapshot: mocks.readPersisted,
  readCanvasProjectSnapshot: async (id: string) => ({ id, nodes: mocks.nodes }),
}))
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => mocks.projectState },
}))
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: { getState: () => ({ nodes: mocks.nodes }) },
}))

import {
  cancelCameraStageRenderTask,
  createCameraStageRenderTaskRef,
  getCameraStageRenderTask,
  parseCameraStageRenderTaskRef,
  renderCameraStageOutput,
} from './cameraStageRenderCapabilityAdapter'

const projectRef = { kind: 'canvas.project' as const, id: 'canvas-1' }
const nodeRef = { kind: 'canvas.node' as const, id: 'canvas-1:stage-node' }
const identity = {
  version: 1 as const,
  canvasProjectId: 'canvas-1',
  nodeId: 'stage-node',
  requestId: 'camera-stage-capability:tool-call-1',
  cameraStageProjectId: 'stage-1',
  resolutionPreset: '1080p' as const,
  outputKind: 'image' as const,
  selectedTimeSec: 1.25,
}

function liveTask(status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled') {
  return {
    ...identity,
    status,
    phase: status === 'queued' || status === 'running' ? 'rendering' as const : null,
    progress: status === 'completed' ? 1 : 0.5,
    result: status === 'completed' ? {
      kind: 'image' as const,
      mediaUrl: 'media://result.png',
      mediaPath: '/result.png',
      savedPath: '/result.png',
      width: 1280,
      height: 720,
      aspectRatio: '16:9',
      selectedTimeSec: identity.selectedTimeSec,
    } : null,
    message: status === 'failed' ? '渲染失败' : null,
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('cameraStageRenderCapabilityAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.projectState = { currentProjectId: 'canvas-1', currentProject: { id: 'canvas-1' } }
    mocks.nodes.splice(0, mocks.nodes.length, {
      id: 'stage-node', type: 'cameraStageNode', position: { x: 0, y: 0 },
      data: { projectId: 'stage-1', renderTask: null, imageRenderError: null },
    })
    mocks.persistedNodes.splice(0, mocks.persistedNodes.length)
    mocks.readPersisted.mockImplementation(async () => ({ id: 'canvas-1', nodes: mocks.persistedNodes }))
    mocks.read.mockResolvedValue(null)
    mocks.start.mockImplementation(async (_nodeId, outputKind, options) => ({
      version: 1,
      requestId: options.requestId,
      canvasProjectId: 'canvas-1',
      nodeId: 'stage-node',
      cameraStageProjectId: 'stage-1',
      resolutionPreset: options.resolutionPreset,
      outputKind,
      selectedTimeSec: options.selectedTimeSec,
    }))
  })

  it('round-trips an opaque task ref and rejects malformed refs', () => {
    const ref = createCameraStageRenderTaskRef(identity)
    expect(parseCameraStageRenderTaskRef(ref)).toEqual(identity)
    expect(() => parseCameraStageRenderTaskRef({
      kind: 'camera_stage.render_task', id: 'invalid',
    })).toThrow('INVALID_INPUT')
    const negativeTimeRef = {
      kind: 'camera_stage.render_task' as const,
      id: `v1.${encodeURIComponent(JSON.stringify([
        'canvas-1', 'stage-node', 'request-1', 'stage-1', '720p', 'image', -1,
      ]))}`,
    }
    expect(() => parseCameraStageRenderTaskRef(negativeTimeRef)).toThrow('INVALID_INPUT')
    const videoWithTimeRef = {
      kind: 'camera_stage.render_task' as const,
      id: `v1.${encodeURIComponent(JSON.stringify([
        'canvas-1', 'stage-node', 'request-1', 'stage-1', '720p', 'video', 0,
      ]))}`,
    }
    expect(() => parseCameraStageRenderTaskRef(videoWithTimeRef)).toThrow('INVALID_INPUT')
  })

  it('keeps a normal UUID based task reference within the application ref contract', () => {
    const ref = createCameraStageRenderTaskRef({
      version: 1,
      canvasProjectId: '388d76c8-c141-4d2b-8b95-31d237dc42ae',
      nodeId: 'a7130971-bad8-4f6e-9fd3-9f9ea378cb02',
      requestId: 'camera-stage-capability:call_5d07865f-1f4a-4ead-82d5-99fd697960de',
      cameraStageProjectId: '1e794d44-f753-4ac2-842b-4a4946878021',
      resolutionPreset: '1080p',
      outputKind: 'video',
    })
    expect(ref.id.length).toBeLessThanOrEqual(500)
  })

  it('uses the unique toolCallId instead of the runId and delegates to the shared node service', async () => {
    const result = await renderCameraStageOutput({
      projectRef, nodeRef, outputKind: 'image', resolutionPreset: '1080p', selectedTimeSec: 1.25,
    }, { signal: new AbortController().signal, requestId: 'run-1', taskId: 'tool-call-1' })

    expect(mocks.start).toHaveBeenCalledWith('stage-node', 'image', {
      requestId: 'camera-stage-capability:tool-call-1',
      resolutionPreset: '1080p',
      selectedTimeSec: 1.25,
      expectedOwner: { canvasProjectId: 'canvas-1', cameraStageProjectId: 'stage-1' },
    })
    expect(parseCameraStageRenderTaskRef(result.taskRef as ReturnType<typeof createCameraStageRenderTaskRef>))
      .toEqual(identity)
    expect(result).toMatchObject({ status: 'submitted' })
  })

  it('rejects a node ref outside its project before starting', async () => {
    await expect(renderCameraStageOutput({
      projectRef,
      nodeRef: { kind: 'canvas.node', id: 'canvas-2:stage-node' },
      outputKind: 'image',
      resolutionPreset: '720p',
    }, { signal: new AbortController().signal, taskId: 'tool-call-1' })).rejects.toThrow('完整稳定引用')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('keeps the original target when the visible canvas switches during the persisted-result lookup', async () => {
    let finishRead!: () => void
    mocks.readPersisted.mockImplementationOnce(async () => await new Promise((resolve) => {
      finishRead = () => resolve({ id: 'canvas-1', nodes: [] })
    }))
    const rendering = renderCameraStageOutput({
      projectRef, nodeRef, outputKind: 'image', resolutionPreset: '1080p', selectedTimeSec: 1.25,
    }, { signal: new AbortController().signal, requestId: 'run-1', taskId: 'tool-call-1' })
    await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'))
    mocks.projectState = { currentProjectId: 'canvas-2', currentProject: { id: 'canvas-2' } }
    finishRead()

    await expect(rendering).resolves.toMatchObject({ status: 'submitted' })
    expect(mocks.start).toHaveBeenCalledWith('stage-node', 'image', expect.objectContaining({ expectedOwner: { canvasProjectId: 'canvas-1', cameraStageProjectId: 'stage-1' } }))
  })

  it('does not submit after the source node is rebound during the persisted-result lookup', async () => {
    let finishRead!: () => void
    mocks.readPersisted.mockImplementationOnce(async () => await new Promise((resolve) => {
      finishRead = () => resolve({ id: 'canvas-1', nodes: [] })
    }))
    const rendering = renderCameraStageOutput({
      projectRef, nodeRef, outputKind: 'image', resolutionPreset: '1080p', selectedTimeSec: 1.25,
    }, { signal: new AbortController().signal, requestId: 'run-1', taskId: 'tool-call-1' })
    await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'))
    mocks.nodes[0].data = {
      ...(mocks.nodes[0].data as Record<string, unknown>),
      projectId: 'stage-2',
    }
    finishRead()

    await expect(rendering).rejects.toThrow('目标 3D 镜头节点已经变化')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('rejects an oversized task ref before creating or submitting a background task', async () => {
    mocks.projectState = {
      currentProjectId: `canvas-${'x'.repeat(190)}`,
      currentProject: { id: `canvas-${'x'.repeat(190)}` },
    }
    mocks.nodes[0].data = { projectId: `stage-${'y'.repeat(190)}` }
    const projectId = mocks.projectState.currentProjectId!

    await expect(renderCameraStageOutput({
      projectRef: { kind: 'canvas.project', id: projectId },
      nodeRef: { kind: 'canvas.node', id: `${projectId}:stage-node` },
      outputKind: 'image',
      resolutionPreset: '720p',
    }, { signal: new AbortController().signal, taskId: 'tool-call-1' }))
      .rejects.toThrow('稳定引用长度限制')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('rejects the same active tool call when its requested payload has changed', async () => {
    mocks.start.mockResolvedValue(identity)

    await expect(renderCameraStageOutput({
      projectRef, nodeRef, outputKind: 'image', resolutionPreset: '720p', selectedTimeSec: 1.25,
    }, { signal: new AbortController().signal, requestId: 'run-1', taskId: 'tool-call-1' }))
      .rejects.toThrow('当前已经在处理图片、1080p，时间 1.25 秒')
  })

  it('treats a persisted completion as the only completed proof and does not rerender it', async () => {
    mocks.persistedNodes.push({
      id: 'result-node', type: 'exportImageNode', position: { x: 1, y: 1 },
      data: {
        generationOutputCommitId: `camera-stage-render:${identity.requestId}`,
        cameraStageRenderReceipt: identity,
      },
    })
    const taskRef = createCameraStageRenderTaskRef(identity)

    const submitted = await renderCameraStageOutput({
      projectRef, nodeRef, outputKind: 'image', resolutionPreset: '1080p', selectedTimeSec: 1.25,
    }, { signal: new AbortController().signal, requestId: 'run-1', taskId: 'tool-call-1' })
    const observed = await getCameraStageRenderTask(taskRef)

    expect(submitted).toMatchObject({ status: 'submitted', taskRef })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(observed).toMatchObject({
      status: 'completed',
      resultRefs: [{ kind: 'canvas.node', id: 'canvas-1:result-node' }],
    })
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('rejects a reused completed tool call when its payload differs from the persisted receipt', async () => {
    mocks.persistedNodes.push({
      id: 'result-node', type: 'exportImageNode', position: { x: 1, y: 1 },
      data: {
        generationOutputCommitId: `camera-stage-render:${identity.requestId}`,
        cameraStageRenderReceipt: identity,
      },
    })

    await expect(renderCameraStageOutput({
      projectRef, nodeRef, outputKind: 'image', resolutionPreset: '720p', selectedTimeSec: 1.25,
    }, { signal: new AbortController().signal, requestId: 'run-1', taskId: 'tool-call-1' }))
      .rejects.toThrow('已经提交为图片、1080p，时间 1.25 秒')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('does not accept a persisted receipt on the wrong output node type as completion proof', async () => {
    mocks.persistedNodes.push({
      id: 'wrong-result-node', type: 'exportVideoNode', position: { x: 1, y: 1 },
      data: {
        generationOutputCommitId: `camera-stage-render:${identity.requestId}`,
        cameraStageRenderReceipt: identity,
      },
    })

    await expect(getCameraStageRenderTask(createCameraStageRenderTaskRef(identity)))
      .rejects.toThrow('节点类型与请求回执不一致')
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('does not report main-process completed until the result node is durably persisted', async () => {
    mocks.read.mockResolvedValue(liveTask('completed'))

    await expect(getCameraStageRenderTask(createCameraStageRenderTaskRef(identity))).resolves.toMatchObject({
      status: 'awaiting_persistence',
      progress: 0.99,
      resultRefs: [],
    })
  })

  it('rejects an authoritative task whose payload does not match the stable task ref', async () => {
    mocks.read.mockResolvedValue({ ...liveTask('running'), resolutionPreset: '720p' })

    await expect(getCameraStageRenderTask(createCameraStageRenderTaskRef(identity)))
      .rejects.toThrow('权威 3D 输出任务与稳定引用不一致')
  })

  it('reports interrupted when neither authoritative task nor persisted completion exists', async () => {
    mocks.nodes[0].data = {
      imageRenderError: '另一个请求失败',
      renderTask: { requestId: 'different-request' },
    }

    await expect(getCameraStageRenderTask(createCameraStageRenderTaskRef(identity))).resolves.toMatchObject({
      status: 'interrupted',
      resultRefs: [],
    })
  })

  it('reports interrupted after the owning canvas project has been deleted', async () => {
    mocks.readPersisted.mockRejectedValue(new Error('PROJECT_NOT_FOUND'))

    await expect(getCameraStageRenderTask(createCameraStageRenderTaskRef(identity))).resolves.toMatchObject({
      status: 'interrupted',
      resultRefs: [],
    })
  })

  it('cancels only an active authoritative task', async () => {
    mocks.read.mockResolvedValue(liveTask('queued'))
    const taskRef = createCameraStageRenderTaskRef(identity)

    await expect(cancelCameraStageRenderTask(taskRef)).resolves.toMatchObject({
      status: 'cancellation_requested',
    })
    expect(mocks.cancel).toHaveBeenCalledWith({
      requestId: identity.requestId,
      canvasProjectId: 'canvas-1',
      nodeId: 'stage-node',
    })
  })

  it('never acknowledges or cancels completed media that is still awaiting persistence', async () => {
    mocks.read.mockResolvedValue(liveTask('completed'))

    await expect(cancelCameraStageRenderTask(createCameraStageRenderTaskRef(identity))).resolves.toMatchObject({
      status: 'awaiting_persistence',
      verification: { verified: true, condition: expect.stringContaining('无需发送取消') },
    })
    expect(mocks.cancel).not.toHaveBeenCalled()
  })
})
