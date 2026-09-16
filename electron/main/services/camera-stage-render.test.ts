import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cleanupAllVideoFrameExports: vi.fn(() => Promise.resolve()),
  ownerSend: vi.fn(),
  workerSend: vi.fn(),
  readProject: vi.fn(() => ({ sceneJson: '{"objects":[]}' })),
  currentWindow: null as {
    destroyed: boolean
    webContents: { id: number }
  } | null,
  nextWebContentsId: 100,
  persistedTasks: [] as Array<{ requestId: string }>,
}))

vi.mock('electron', () => {
  class MockBrowserWindow {
    destroyed = false
    private readonly listeners = new Map<string, Array<() => void>>()
    readonly webContents = {
      id: ++mocks.nextWebContentsId,
      send: mocks.workerSend,
      setAudioMuted: vi.fn(),
      on: vi.fn(),
    }

    constructor() {
      mocks.currentWindow = this
    }

    isDestroyed(): boolean {
      return this.destroyed
    }

    destroy(): void {
      this.destroyed = true
      for (const listener of this.listeners.get('closed') ?? []) listener()
    }

    close(): void {
      this.destroy()
    }

    on(event: string, listener: () => void): void {
      const listeners = this.listeners.get(event) ?? []
      listeners.push(listener)
      this.listeners.set(event, listeners)
    }

    loadFile(): Promise<void> {
      return Promise.resolve()
    }

    loadURL(): Promise<void> {
      return Promise.resolve()
    }
  }

  return {
    BrowserWindow: MockBrowserWindow,
    powerSaveBlocker: {
      isStarted: vi.fn(() => false),
      start: vi.fn(() => 1),
      stop: vi.fn(),
    },
    webContents: {
      fromId: vi.fn(() => ({ isDestroyed: () => false, send: mocks.ownerSend })),
    },
  }
})

// 任务落盘由 camera-stage-render-task-registry.test.ts 与原生测试覆盖；
// 本文件只验证渲染工作器生命周期，不打开真实 SQLite。
vi.mock('./camera-stage-render-task-storage', () => ({
  cameraStageRenderTaskStorage: {
    load: () => mocks.persistedTasks,
    save: (task: { requestId: string }) => {
      const index = mocks.persistedTasks.findIndex((item) => item.requestId === task.requestId)
      if (index >= 0) mocks.persistedTasks[index] = task
      else mocks.persistedTasks.push(task)
    },
  },
}))

vi.mock('./video/frame-export', () => ({
  cleanupAllVideoFrameExports: mocks.cleanupAllVideoFrameExports,
}))

vi.mock('./camera-stage-projects', () => ({ getCameraStageProject: mocks.readProject }))

vi.mock('./logging/main-logger', () => ({
  createMainLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

function imageRequest(requestId: string) {
  return {
    requestId,
    canvasProjectId: 'canvas-project-1',
    nodeId: 'node-1',
    cameraStageProjectId: 'project-1',
    resolutionPreset: '720p' as const,
    outputKind: 'image' as const,
    selectedTimeSec: 1,
  }
}

describe('camera stage background render recovery', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    mocks.cleanupAllVideoFrameExports.mockClear()
    mocks.ownerSend.mockClear()
    mocks.workerSend.mockClear()
    mocks.currentWindow = null
    mocks.persistedTasks.length = 0
    mocks.readProject.mockReset().mockReturnValue({ sceneJson: '{"objects":[]}' })
  })

  it('固定提交时的场景快照，排队后修改原工程不改变输出，重复请求也不重取快照', async () => {
    const service = await import('./camera-stage-render')
    mocks.readProject.mockReturnValue({ sceneJson: '{"name":"原场景"}' })
    service.startCameraStageRenderTask(imageRequest('frozen-scene'), 1)
    mocks.readProject.mockReturnValue({ sceneJson: '{"name":"后续编辑"}' })
    expect(service.startCameraStageRenderTask(imageRequest('frozen-scene'), 1).idempotent).toBe(true)
    service.markCameraStageRenderWorkerReady(mocks.currentWindow!.webContents.id)
    expect(mocks.readProject).toHaveBeenCalledTimes(1)
    expect(mocks.workerSend).toHaveBeenCalledWith('cameraStageRender:workerJob', expect.objectContaining({ sceneJson: '{"name":"原场景"}' }))
  })

  it('快照读取失败留下确定失败的任务，不能因重复请求重新输出', async () => {
    const service = await import('./camera-stage-render')
    mocks.readProject.mockImplementationOnce(() => { throw new Error('storage-unavailable') })
    const request = imageRequest('snapshot-failed')
    expect(service.startCameraStageRenderTask(request, 1).task.status).toBe('failed')
    const repeated = service.startCameraStageRenderTask(request, 1)
    expect(repeated.idempotent).toBe(true)
    expect(repeated.task.status).toBe('failed')
    expect(mocks.workerSend).not.toHaveBeenCalled()
  })

  it('fails an image task and recycles the worker after prolonged inactivity', async () => {
    const service = await import('./camera-stage-render')
    service.startCameraStageRenderTask(imageRequest('request-timeout'), 1)
    expect(mocks.currentWindow).not.toBeNull()
    service.markCameraStageRenderWorkerReady(mocks.currentWindow!.webContents.id)

    expect(mocks.workerSend).toHaveBeenCalledWith(
      'cameraStageRender:workerJob',
      expect.objectContaining({ requestId: 'request-timeout', outputKind: 'image' }),
    )

    vi.advanceTimersByTime(45_000)

    expect(mocks.ownerSend).toHaveBeenCalledWith(
      'cameraStageRender:event',
      expect.objectContaining({
        status: 'failed',
        requestId: 'request-timeout',
        message: expect.stringContaining('长时间没有进展'),
      }),
    )
    expect(mocks.currentWindow?.destroyed).toBe(true)
    expect(mocks.cleanupAllVideoFrameExports).toHaveBeenCalledWith('camera_stage_render_inactivity_timeout')
  })

  it('rejects a video result returned for an image request', async () => {
    const service = await import('./camera-stage-render')
    service.startCameraStageRenderTask(imageRequest('request-mismatch'), 1)
    expect(mocks.currentWindow).not.toBeNull()
    service.markCameraStageRenderWorkerReady(mocks.currentWindow!.webContents.id)

    service.handleCameraStageRenderWorkerEvent({
      type: 'completed',
      requestId: 'request-mismatch',
      nodeId: 'node-1',
      result: {
        kind: 'video',
        mediaUrl: 'media://video.webm',
        mediaPath: 'C:/video.webm',
        savedPath: 'C:/video.webm',
        durationSeconds: 0,
        frameCount: 1,
        width: 1280,
        height: 720,
      },
    }, mocks.currentWindow!.webContents.id)

    expect(mocks.ownerSend).toHaveBeenCalledWith(
      'cameraStageRender:event',
      expect.objectContaining({
        status: 'failed',
        requestId: 'request-mismatch',
        message: expect.stringContaining('类型与请求不一致'),
      }),
    )
    expect(mocks.currentWindow?.destroyed).toBe(true)
    expect(mocks.cleanupAllVideoFrameExports).toHaveBeenCalledWith('camera_stage_render_result_kind_mismatch')
  })
})
