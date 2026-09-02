import { describe, expect, it, vi } from 'vitest'

import type {
  ImageEditorViewportCompositeWorkerEventV3,
  ImageEditorViewportCompositeWorkerPortV3,
  ImageEditorViewportCompositeWorkerRequestV3,
} from './viewportCompositeProtocolV3'
import { ImageEditorViewportCompositeWorkerBrokerV3 } from './viewportCompositeWorkerBrokerV3'

class FakeWorker implements ImageEditorViewportCompositeWorkerPortV3 {
  onmessage: ((event: MessageEvent<ImageEditorViewportCompositeWorkerEventV3>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: ImageEditorViewportCompositeWorkerRequestV3[] = []
  readonly terminate = vi.fn()

  postMessage(message: ImageEditorViewportCompositeWorkerRequestV3): void {
    this.messages.push(message)
  }

  emit(event: ImageEditorViewportCompositeWorkerEventV3): void {
    this.onmessage?.({ data: event } as MessageEvent<ImageEditorViewportCompositeWorkerEventV3>)
  }
}

function renderRequest(requestId: string): ImageEditorViewportCompositeWorkerRequestV3 {
  return { type: 'render', requestId } as ImageEditorViewportCompositeWorkerRequestV3
}

function failed(requestId: string): ImageEditorViewportCompositeWorkerEventV3 {
  return {
    type: 'failed',
    requestId,
    sequence: 1,
    renderGeneration: 1,
    code: 'aborted',
    message: '取消',
  }
}

function runtime(requestId: string): ImageEditorViewportCompositeWorkerEventV3 {
  return {
    type: 'runtime', requestId, sequence: 1, renderGeneration: 1,
    status: 'device-lost', reason: 'adapter reset', deviceGeneration: null,
  }
}

describe('视口合成共享 Worker 代理', () => {
  it('多个 session 复用同一 Worker，事件严格返回所属 port', () => {
    const workers: FakeWorker[] = []
    const broker = new ImageEditorViewportCompositeWorkerBrokerV3(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
    const first = broker.acquire()
    const second = broker.acquire()
    const firstEvents = vi.fn()
    const secondEvents = vi.fn()
    first.onmessage = firstEvents
    second.onmessage = secondEvents

    first.postMessage(renderRequest('first'))
    second.postMessage(renderRequest('second'))
    expect(workers).toHaveLength(1)
    workers[0]?.emit(failed('second'))
    expect(secondEvents).toHaveBeenCalledOnce()
    expect(firstEvents).not.toHaveBeenCalled()

    workers[0]?.emit(runtime('first'))
    expect(firstEvents).toHaveBeenCalledOnce()
    workers[0]?.emit(failed('first'))
    expect(firstEvents).toHaveBeenCalledTimes(2)

    first.postMessage({ type: 'dispose' })
    expect(workers[0]?.terminate).not.toHaveBeenCalled()
    second.postMessage({ type: 'dispose' })
    expect(workers[0]?.messages.at(-1)).toEqual({ type: 'dispose' })
    expect(workers[0]?.terminate).toHaveBeenCalledOnce()
  })

  it('任一活动请求取消超时只退休所属 port，不中断其他 session', () => {
    const workers: FakeWorker[] = []
    const broker = new ImageEditorViewportCompositeWorkerBrokerV3(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
    const first = broker.acquire()
    const second = broker.acquire()
    const secondFailure = vi.fn()
    second.onerror = secondFailure
    first.postMessage(renderRequest('blocked'))
    second.postMessage(renderRequest('also-active'))

    first.terminate()
    expect(workers[0]?.terminate).not.toHaveBeenCalled()
    expect(workers[0]?.messages.at(-1)).toEqual({ type: 'cancel', requestId: 'blocked' })
    expect(secondFailure).not.toHaveBeenCalled()

    const closeLateBitmap = vi.fn()
    workers[0]?.emit({
      type: 'tile-rendered', requestId: 'blocked', sequence: 1, renderGeneration: 1,
      cameraSequence: 1, geometryHash: 'geometry', revision: 0, mip: 0, tileIndex: 0,
      tile: {
        bitmap: { close: closeLateBitmap } as unknown as ImageBitmap,
        outputRect: { x: 0, y: 0, width: 1, height: 1 },
      },
    })
    expect(closeLateBitmap).toHaveBeenCalledOnce()
    workers[0]?.emit(failed('also-active'))
    second.postMessage(renderRequest('after-recovery'))
    expect(workers).toHaveLength(1)
    second.postMessage({ type: 'dispose' })
    expect(workers[0]?.terminate).toHaveBeenCalledOnce()
  })
})
