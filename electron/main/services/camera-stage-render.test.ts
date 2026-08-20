import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cleanupAllVideoFrameExports: vi.fn(() => Promise.resolve()),
  ownerSend: vi.fn(),
  workerSend: vi.fn(),
  currentWindow: null as {
    destroyed: boolean
    webContents: { id: number }
  } | null,
  nextWebContentsId: 100,
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

vi.mock('./video/frame-export', () => ({
  cleanupAllVideoFrameExports: mocks.cleanupAllVideoFrameExports,
}))

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
    nodeId: 'node-1',
    projectId: 'project-1',
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
        type: 'failed',
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
        type: 'failed',
        requestId: 'request-mismatch',
        message: expect.stringContaining('类型与请求不一致'),
      }),
    )
    expect(mocks.currentWindow?.destroyed).toBe(true)
    expect(mocks.cleanupAllVideoFrameExports).toHaveBeenCalledWith('camera_stage_render_result_kind_mismatch')
  })
})
