import type { IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import type { ImageDocumentService } from '../services/image-editor-v3/image-document'
import type { CanvasLayerPackageService } from '../services/image-editor-v3/canvas-layers/canvas-layer-packages'
import { registerImageEditorV3ImageDocumentIpc } from './image-editor-v3-package'

const registered = vi.hoisted(() => new Map<string, (payload: unknown, event: IpcMainInvokeEvent) => Promise<unknown>>())
vi.mock('./registry', () => ({ registerIpcHandler: (channel: string, _parse: unknown,
  handler: (payload: unknown, event: IpcMainInvokeEvent) => Promise<unknown>) => { registered.set(channel, handler) } }))

it('图片文档与画布保存沿既有请求通道传递取消信号', async () => {
  const controller = new AbortController()
  const imageCommit = vi.fn(async () => ({}))
  const canvasCommit = vi.fn(async () => ({}))
  registerImageEditorV3ImageDocumentIpc({
    imageDocuments: () => ({ commit: imageCommit }) as unknown as ImageDocumentService,
    canvasLayers: () => ({ commit: canvasCommit }) as unknown as CanvasLayerPackageService,
    guard: () => undefined,
    runRequest: (_operation, _requestId, _senderId, handler) => handler(controller.signal),
  })
  const event = { sender: { id: 1 } } as IpcMainInvokeEvent
  await registered.get('imageEditorV3:imageDocument:commit')!({ requestId: 'save', target: { id: 'doc' }, expectedRevision: 0 }, event)
  await registered.get('imageEditorV3:canvasLayers:commit')!({ requestId: 'canvas', canvasId: 'canvas', container: { kind: 'user' }, documentIds: ['doc'] }, event)
  expect(imageCommit).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
  expect(canvasCommit).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
})
