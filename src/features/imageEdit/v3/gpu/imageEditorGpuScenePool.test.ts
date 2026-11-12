import { describe, expect, it, vi } from 'vitest'

import { ImageEditorGpuScenePool } from './imageEditorGpuScenePool'
import type {
  ImageEditorGpuSceneWorkerEventV3,
  ImageEditorGpuSceneWorkerPortV3,
  ImageEditorGpuSceneWorkerRequestV3,
} from './imageEditorGpuSceneProtocolV3'

function createPort() {
  const messages: ImageEditorGpuSceneWorkerRequestV3[] = []
  const port: ImageEditorGpuSceneWorkerPortV3 = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn((message) => { messages.push(message) }),
    terminate: vi.fn(),
  }
  return {
    messages,
    port,
    emit: (event: ImageEditorGpuSceneWorkerEventV3) => {
      port.onmessage?.({ data: event } as MessageEvent<ImageEditorGpuSceneWorkerEventV3>)
    },
  }
}

function createPool() {
  const ports: ReturnType<typeof createPort>[] = []
  const pool = new ImageEditorGpuScenePool(() => {
    const port = createPort()
    ports.push(port)
    return port.port
  })
  return { pool, ports }
}

describe('ImageEditorGpuScenePool', () => {
  it('只预热一个待命线程，预热完成后领用标为已就绪；线程正被使用时不再另起一个', () => {
    const { pool, ports } = createPool()
    pool.prewarm()
    pool.prewarm()
    expect(ports).toHaveLength(1)
    expect(ports[0]?.messages).toEqual([expect.objectContaining({ type: 'warm' })])
    ports[0]?.emit({ type: 'warmed', sceneGeneration: 0, deviceGeneration: 1 })

    const warm = pool.acquire()
    expect(warm.warmth).toBe('ready')
    pool.prewarm()
    expect(ports).toHaveLength(1)
    const cold = pool.acquire()
    expect(cold.warmth).toBe('cold')
    expect(ports).toHaveLength(2)
  })

  it('归还后丢弃上一个会话的事件，多出来的线程直接结束，再领用的是设备还在的待命线程', () => {
    const { pool, ports } = createPool()
    const first = pool.acquire()
    const second = pool.acquire()
    first.release?.()
    expect(ports[0]?.messages.at(-1)).toEqual({ type: 'release' })
    second.release?.()
    expect(ports[1]?.port.terminate).toHaveBeenCalledOnce()
    expect(ports[0]?.port.terminate).not.toHaveBeenCalled()

    const closeStale = vi.fn()
    ports[0]?.emit({
      type: 'frame-ready', requestId: 'old-session', sceneGeneration: 1, deviceGeneration: 1,
      cameraSequence: 1, interactionSequence: 0, surfaceGeneration: 0, quality: 'stable',
      bitmap: { close: closeStale } as unknown as ImageBitmap,
    })
    ports[0]?.emit({ type: 'released', sceneGeneration: 0, deviceGeneration: 1, deviceReady: true, deviceLossHistory: false })
    expect(closeStale).toHaveBeenCalledOnce()

    const reused = pool.acquire()
    expect(ports).toHaveLength(2)
    expect(reused.warmth).toBe('ready')
    const listener = vi.fn()
    reused.onmessage = listener
    ports[0]?.emit({ type: 'ready', sceneGeneration: 0, deviceGeneration: 1, recovered: false })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'ready' }) }))
  })

  it('待命期间设备丢失就重新预热；带设备丢失历史归还的线程换成新线程', () => {
    const { pool, ports } = createPool()
    pool.prewarm()
    ports[0]?.emit({ type: 'warmed', sceneGeneration: 0, deviceGeneration: 1 })
    ports[0]?.emit({ type: 'device-lost', sceneGeneration: 0, deviceGeneration: 1, reason: 'reset', retryAfterMs: 0 })
    expect(ports[0]?.messages.filter((message) => message.type === 'warm')).toHaveLength(2)

    const worker = pool.acquire()
    expect(worker.warmth).toBe('warming')
    worker.release?.()
    ports[0]?.emit({ type: 'released', sceneGeneration: 0, deviceGeneration: 2, deviceReady: true, deviceLossHistory: true })
    expect(ports[0]?.port.terminate).toHaveBeenCalledOnce()
    expect(ports).toHaveLength(2)
    expect(ports[1]?.messages).toEqual([expect.objectContaining({ type: 'warm' })])
  })
})
