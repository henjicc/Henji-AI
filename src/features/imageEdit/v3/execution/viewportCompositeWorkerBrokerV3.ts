import type {
  ImageEditorViewportCompositeWorkerEventV3,
  ImageEditorViewportCompositeWorkerFactoryV3,
  ImageEditorViewportCompositeWorkerPortV3,
  ImageEditorViewportCompositeWorkerRequestV3,
} from './viewportCompositeProtocolV3'

function createNativeWorker(): ImageEditorViewportCompositeWorkerPortV3 {
  if (typeof Worker === 'undefined') throw new Error('当前环境不支持视口分块 Worker')
  return new Worker(new URL('./imageEditorViewportComposite.worker.ts', import.meta.url), {
    type: 'module',
    name: 'image-editor-v3-viewport-composite',
  })
}

class VirtualViewportCompositeWorkerPortV3 implements ImageEditorViewportCompositeWorkerPortV3 {
  onmessage: ((event: MessageEvent<ImageEditorViewportCompositeWorkerEventV3>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  private released = false

  constructor(private readonly broker: ImageEditorViewportCompositeWorkerBrokerV3) {}

  postMessage(message: ImageEditorViewportCompositeWorkerRequestV3, transfer?: Transferable[]): void {
    if (this.released) return
    if (message.type === 'dispose') {
      this.released = true
      this.broker.release(this)
      return
    }
    this.broker.post(this, message, transfer)
  }

  terminate(): void {
    if (this.released) return
    this.released = true
    this.broker.retire(this)
  }

  deliver(event: MessageEvent<ImageEditorViewportCompositeWorkerEventV3>): void {
    if (!this.released) this.onmessage?.(event)
  }

  fail(message: string): void {
    if (this.released) return
    this.onerror?.({ message } as ErrorEvent)
  }
}

/**
 * 渲染进程内只保留一个合成 Worker。虚拟 port 按 requestId 隔离 session，
 * 最后一个 session 释放时才真正销毁 Worker/GPU 资源。
 */
export class ImageEditorViewportCompositeWorkerBrokerV3 {
  private worker: ImageEditorViewportCompositeWorkerPortV3 | null = null
  private readonly ports = new Set<VirtualViewportCompositeWorkerPortV3>()
  private readonly ownerByRequestId = new Map<string, VirtualViewportCompositeWorkerPortV3>()

  constructor(private readonly workerFactory: ImageEditorViewportCompositeWorkerFactoryV3) {}

  acquire(): ImageEditorViewportCompositeWorkerPortV3 {
    const port = new VirtualViewportCompositeWorkerPortV3(this)
    this.ports.add(port)
    return port
  }

  post(
    port: VirtualViewportCompositeWorkerPortV3,
    message: Exclude<ImageEditorViewportCompositeWorkerRequestV3, { type: 'dispose' }>,
    transfer?: Transferable[],
  ): void {
    if (!this.ports.has(port)) return
    if (message.type === 'render') {
      if (this.ownerByRequestId.has(message.requestId)) {
        throw new Error(`视口 Worker 请求 ID 重复：${message.requestId}`)
      }
      this.ownerByRequestId.set(message.requestId, port)
    }
    this.ensureWorker().postMessage(message, transfer)
  }

  release(port: VirtualViewportCompositeWorkerPortV3): void {
    if (!this.ports.delete(port)) return
    this.cancelOwnedRequests(port)
    if (this.ports.size === 0) this.closeWorker()
  }

  retire(port: VirtualViewportCompositeWorkerPortV3): void {
    if (!this.ports.delete(port)) return
    const hadActiveRequest = [...this.ownerByRequestId.values()].includes(port)
    this.cancelOwnedRequests(port)
    if (hadActiveRequest) {
      this.resetWorker('共享视口 Worker 取消超时，已重建合成宿主')
    } else if (this.ports.size === 0) {
      this.closeWorker()
    }
  }

  private ensureWorker(): ImageEditorViewportCompositeWorkerPortV3 {
    if (this.worker) return this.worker
    const worker = this.workerFactory()
    worker.onmessage = (event) => this.handleEvent(event)
    worker.onerror = (event) => this.resetWorker(event.message || '共享视口 Worker 异常')
    this.worker = worker
    return worker
  }

  private handleEvent(event: MessageEvent<ImageEditorViewportCompositeWorkerEventV3>): void {
    const owner = this.ownerByRequestId.get(event.data.requestId)
    if (!owner) {
      if (event.data.type === 'tile-rendered') event.data.tile.bitmap.close()
      return
    }
    if (event.data.type === 'rendered' || event.data.type === 'failed') {
      this.ownerByRequestId.delete(event.data.requestId)
    }
    owner.deliver(event)
  }

  private cancelOwnedRequests(port: VirtualViewportCompositeWorkerPortV3): void {
    for (const [requestId, owner] of [...this.ownerByRequestId]) {
      if (owner !== port) continue
      this.ownerByRequestId.delete(requestId)
      this.worker?.postMessage({ type: 'cancel', requestId })
    }
  }

  private resetWorker(message: string): void {
    const worker = this.worker
    if (!worker) return
    this.worker = null
    this.ownerByRequestId.clear()
    worker.terminate()
    for (const port of [...this.ports]) port.fail(message)
  }

  private closeWorker(): void {
    const worker = this.worker
    this.worker = null
    this.ownerByRequestId.clear()
    if (!worker) return
    worker.postMessage({ type: 'dispose' })
    worker.terminate()
  }
}

const sharedViewportCompositeWorkerBrokerV3 = new ImageEditorViewportCompositeWorkerBrokerV3(
  createNativeWorker,
)

export function acquireSharedImageEditorViewportCompositeWorkerV3(): ImageEditorViewportCompositeWorkerPortV3 {
  return sharedViewportCompositeWorkerBrokerV3.acquire()
}
