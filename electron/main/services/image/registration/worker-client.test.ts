import type { TransferListItem } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RegistrationFrame, RegistrationResult } from './types'
import {
  createRegistrationWorkerExecutor,
  type RegistrationWorkerHandle,
} from './worker-client'
import {
  REGISTRATION_WORKER_PROTOCOL_VERSION,
  type RegistrationWorkerRequest,
} from './worker-contracts'

const IDENTITY_RESULT: RegistrationResult = {
  success: true,
  model: 'identity',
  transform: { a: 1, b: 0, tx: 0, ty: 0 },
  confidence: 1,
  diagnostics: {
    referenceKeypoints: 0,
    movingKeypoints: 0,
    matches: 0,
    inliers: 0,
    inlierRatio: 0,
    coverage: 1,
    medianError: 0,
    structuralScore: 1,
    changedFraction: 0,
    scale: 1,
    rotationDegrees: 0,
    translationX: 0,
    translationY: 0,
    elapsedMs: 1,
  },
}

class FakeRegistrationWorker implements RegistrationWorkerHandle {
  posted: RegistrationWorkerRequest | null = null
  transfer: readonly TransferListItem[] = []
  terminated = false
  onPost: ((message: RegistrationWorkerRequest) => void) | null = null
  private readonly messageListeners = new Set<(message: unknown) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly exitListeners = new Set<(code: number) => void>()

  postMessage(message: RegistrationWorkerRequest, transfer: readonly TransferListItem[]): void {
    this.posted = message
    this.transfer = transfer
    this.onPost?.(message)
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  onExit(listener: (code: number) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  terminate(): void {
    this.terminated = true
  }

  emitMessage(message: unknown): void {
    for (const listener of this.messageListeners) listener(message)
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }

  emitExit(code: number): void {
    for (const listener of this.exitListeners) listener(code)
  }
}

function frame(data: Uint8Array, validMask?: Uint8Array): RegistrationFrame {
  return { width: 2, height: 2, components: 1, data, validMask }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('图像配准 Worker 客户端', () => {
  it('转移像素所有权并在完成后归还移动帧', async () => {
    const worker = new FakeRegistrationWorker()
    const sharedMask = new Uint8Array([255, 255, 255, 255])
    const reference = frame(new Uint8Array([1, 2, 3, 4]), sharedMask)
    const moving = frame(new Uint8Array([5, 6, 7, 8]), sharedMask)
    worker.onPost = (request) => {
      queueMicrotask(() => worker.emitMessage({
        type: 'registration.result',
        protocolVersion: REGISTRATION_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true,
        result: IDENTITY_RESULT,
        movingData: request.movingFrame.data,
      }))
    }

    const execute = createRegistrationWorkerExecutor(() => worker)
    const result = await execute(reference, moving, 'fast', false, { requestId: 'registration-1' })

    expect(result.result).toEqual(IDENTITY_RESULT)
    expect([...result.movingData]).toEqual([5, 6, 7, 8])
    expect(worker.posted?.requestId).toBe('registration-1')
    expect(new Set(worker.transfer).size).toBe(3)
    expect(worker.terminated).toBe(true)
  })

  it('非独占视图先隔离再转移，避免连带分离共享缓冲', async () => {
    const worker = new FakeRegistrationWorker()
    const backing = new Uint8Array([99, 1, 2, 3, 4, 88])
    const sliced = backing.subarray(1, 5)
    worker.onPost = (request) => queueMicrotask(() => worker.emitMessage({
      type: 'registration.result',
      protocolVersion: REGISTRATION_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: IDENTITY_RESULT,
      movingData: request.movingFrame.data,
    }))

    const execute = createRegistrationWorkerExecutor(() => worker)
    const result = await execute(frame(sliced), frame(new Uint8Array([5, 6, 7, 8])), 'fast')

    expect(worker.posted?.referenceFrame.data.buffer).not.toBe(backing.buffer)
    expect([...result.movingData]).toEqual([5, 6, 7, 8])
  })

  it('超时会立即拒绝并终止计算线程', async () => {
    vi.useFakeTimers()
    const worker = new FakeRegistrationWorker()
    const execute = createRegistrationWorkerExecutor(() => worker)
    const pending = execute(
      frame(new Uint8Array(4)),
      frame(new Uint8Array(4)),
      'fast',
      false,
      { timeoutMs: 25 },
    )
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })

    await vi.advanceTimersByTimeAsync(25)

    await rejected
    expect(worker.terminated).toBe(true)
  })

  it('AbortSignal 会拒绝并终止计算线程', async () => {
    const worker = new FakeRegistrationWorker()
    const controller = new AbortController()
    const execute = createRegistrationWorkerExecutor(() => worker)
    const pending = execute(
      frame(new Uint8Array(4)),
      frame(new Uint8Array(4)),
      'precise',
      false,
      { signal: controller.signal },
    )

    controller.abort('USER_CANCELLED')

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })

  it('线程异常退出时不会留下悬空任务', async () => {
    const worker = new FakeRegistrationWorker()
    const execute = createRegistrationWorkerExecutor(() => worker)
    const pending = execute(frame(new Uint8Array(4)), frame(new Uint8Array(4)), 'fast')

    worker.emitExit(17)

    await expect(pending).rejects.toThrow('意外退出（17）')
    expect(worker.terminated).toBe(true)
  })
})
