import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraStageRenderTaskRegistry, type CameraStageRenderRequestDto } from './camera-stage-render-task-registry'

function request(overrides: Partial<CameraStageRenderRequestDto> = {}): CameraStageRenderRequestDto {
  return {
    requestId: 'request-1',
    canvasProjectId: 'canvas-1',
    nodeId: 'node-1',
    cameraStageProjectId: 'stage-1',
    resolutionPreset: '720p',
    outputKind: 'image',
    selectedTimeSec: 1,
    ...overrides,
  }
}

describe('CameraStageRenderTaskRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deduplicates an identical request and rejects conflicting reuse', () => {
    const registry = new CameraStageRenderTaskRegistry()
    expect(registry.register(request(), 7).idempotent).toBe(false)
    expect(registry.register(request(), 7)).toMatchObject({ idempotent: true, task: { status: 'queued' } })
    expect(() => registry.register(request({ outputKind: 'video' }), 7)).toThrow('identity conflicts')
    expect(() => registry.register(request(), 8)).toThrow('identity conflicts')
  })

  it('retains terminal results until the owning project acknowledges them', () => {
    const registry = new CameraStageRenderTaskRegistry()
    registry.register(request(), 7)
    registry.markRunning('request-1')
    registry.applyEvent({
      type: 'completed', requestId: 'request-1', nodeId: 'node-1',
      result: {
        kind: 'image', mediaUrl: 'media://image.png', mediaPath: '/image.png', savedPath: '/image.png',
        width: 1280, height: 720, aspectRatio: '16:9', selectedTimeSec: 1,
      },
    })
    expect(registry.list('canvas-1', 7)).toEqual([
      expect.objectContaining({ requestId: 'request-1', status: 'completed' }),
    ])
    expect(() => registry.acknowledge({ requestId: 'request-1', canvasProjectId: 'other', nodeId: 'node-1' }, 7))
      .toThrow('does not belong')
    registry.acknowledge({ requestId: 'request-1', canvasProjectId: 'canvas-1', nodeId: 'node-1' }, 7)
    expect(registry.list('canvas-1', 7)).toEqual([])
    expect(() => registry.register(request(), 7)).toThrow('already completed and acknowledged')
    expect(() => registry.register(request({ nodeId: 'node-other' }), 7)).toThrow('identity conflicts')
    vi.advanceTimersByTime(60 * 60 * 1000 + 1)
    expect(registry.register(request(), 7).idempotent).toBe(false)
  })

  it('scopes query and list to the renderer host and canvas project', () => {
    const registry = new CameraStageRenderTaskRegistry()
    registry.register(request(), 7)
    registry.register(request({ requestId: 'request-2', canvasProjectId: 'canvas-2' }), 7)
    expect(registry.list('canvas-1', 7).map((task) => task.requestId)).toEqual(['request-1'])
    expect(registry.list('canvas-1', 8)).toEqual([])
    expect(() => registry.require({ requestId: 'request-1', canvasProjectId: 'canvas-1', nodeId: 'node-1' }, 8))
      .toThrow('does not belong')
    expect(registry.require({ requestId: 'missing', canvasProjectId: 'canvas-1', nodeId: 'node-1' }, 7)).toBeNull()
  })

  it('bounds acknowledged tombstones even when many existing tasks finish without another start', () => {
    const registry = new CameraStageRenderTaskRegistry()
    for (let index = 0; index <= 500; index += 1) {
      registry.register(request({ requestId: `request-${index}` }), 7)
    }
    for (let index = 0; index <= 500; index += 1) {
      const scope = { requestId: `request-${index}`, canvasProjectId: 'canvas-1', nodeId: 'node-1' }
      registry.applyEvent({ type: 'failed', requestId: scope.requestId, nodeId: scope.nodeId, message: 'failed' })
      registry.acknowledge(scope, 7)
    }

    expect(registry.register(request({ requestId: 'request-0' }), 7).idempotent).toBe(false)
    expect(() => registry.register(request({ requestId: 'request-500' }), 7))
      .toThrow('already completed and acknowledged')
  })
})
