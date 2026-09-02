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

    first.postMessage({ type: 'dispose' })
    expect(workers[0]?.terminate).not.toHaveBeenCalled()
    workers[0]?.emit(failed('first'))
    expect(firstEvents).not.toHaveBeenCalled()
    second.postMessage({ type: 'dispose' })
    expect(workers[0]?.messages.at(-1)).toEqual({ type: 'dispose' })
    expect(workers[0]?.terminate).toHaveBeenCalledOnce()
  })

  it('任一活动请求取消超时时重建物理 Worker，并通知其他 session', () => {
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
    expect(workers[0]?.terminate).toHaveBeenCalledOnce()
    expect(secondFailure).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('取消超时'),
    }))

    second.postMessage(renderRequest('after-recovery'))
    expect(workers).toHaveLength(2)
    second.postMessage({ type: 'dispose' })
  })
})
