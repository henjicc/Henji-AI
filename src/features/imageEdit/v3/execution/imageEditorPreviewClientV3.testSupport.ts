import { expect, vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorPreviewWorkerPortV3, ImageEditorPreviewWorkerEventV3, ImageEditorPreviewWorkerRequestV3 } from './previewProtocolV3'

export class FakePreviewWorker implements ImageEditorPreviewWorkerPortV3 {
  onmessage: ((event: MessageEvent<ImageEditorPreviewWorkerEventV3>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: ImageEditorPreviewWorkerRequestV3[] = []
  readonly transfers: Transferable[][] = []
  readonly terminate = vi.fn()

  postMessage(message: ImageEditorPreviewWorkerRequestV3, transfer: Transferable[] = []): void {
    this.messages.push(message)
    this.transfers.push(transfer)
  }

  emit(event: ImageEditorPreviewWorkerEventV3): void {
    this.onmessage?.({ data: event } as MessageEvent<ImageEditorPreviewWorkerEventV3>)
  }

  renders(): Extract<ImageEditorPreviewWorkerRequestV3, { type: 'render' }>[] {
    return this.messages.filter(
      (message): message is Extract<ImageEditorPreviewWorkerRequestV3, { type: 'render' }> => (
        message.type === 'render'
      ),
    )
  }
}

export function createDocument(revision: number) {
  return { ...createImageEditDocumentV3({ width: 800, height: 600, documentId: 'client-test' }), revision }
}

export function bitmap() {
  return { close: vi.fn(), width: 800, height: 600 } as unknown as ImageBitmap
}

export async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

export async function waitForRender(worker: FakePreviewWorker, count = 1): Promise<void> {
  for (let attempt = 0; attempt < 10 && worker.renders().length < count; attempt += 1) {
    await flush()
  }
  expect(worker.renders()).toHaveLength(count)
}
