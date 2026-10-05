import type { ImageDocumentService } from '../services/image-editor-v3/image-document'
import type { CanvasLayerPackageService } from '../services/image-editor-v3/canvas-layers/canvas-layer-packages'
import {
  parseImageEditorV3CanvasLayersCommitPayload,
  parseImageEditorV3CanvasLayersPreparePayload,
  parseImageEditorV3CommitImageDocumentPayload,
  parseImageEditorV3CreateImageDocumentPayload,
  parseImageEditorV3DescribeImageDocumentPayload,
  parseImageEditorV3OpenImageDocumentPayload,
} from './image-editor-v3-payloads'
import { registerIpcHandler } from './registry'
import type { IpcMainInvokeEvent } from 'electron'

/*
 * 图片文档（`.henjiimg`，3.5）的 IPC：打开（解包到工作副本 / 恢复）、重新定位、新建草稿、写回。
 * 改名、移动、副本、回收站、删空草稿走通用文档 IPC（documents:*），由单文件包适配器完成。
 * 旧的“打开可编辑文件 / 另存可编辑文件”对话框入口已由图片文档取代并删除。
 * 同文件还登记画布内嵌图片文档（3.4）的准备（打开画布时）与写出（画布写回时）。
 */

type RunRequestV3 = <T>(
  operation: string,
  requestId: string,
  senderId: number,
  handler: (signal: AbortSignal) => Promise<T>,
  estimatedBytes?: number,
) => Promise<T>

export interface ImageEditorV3ImageDocumentIpcDependencies {
  imageDocuments: () => ImageDocumentService
  canvasLayers: () => CanvasLayerPackageService
  guard(event: IpcMainInvokeEvent): void
  runRequest: RunRequestV3
}

export function registerImageEditorV3ImageDocumentIpc(
  dependencies: ImageEditorV3ImageDocumentIpcDependencies,
): void {
  const { guard, runRequest, imageDocuments, canvasLayers } = dependencies
  registerIpcHandler('imageEditorV3:imageDocument:open', parseImageEditorV3OpenImageDocumentPayload, (payload, event) => (
    runRequest('image_document.open', payload.requestId, event.sender.id, () => (
      imageDocuments().open(payload.target, payload.recovery)
    ))
  ), guard)
  registerIpcHandler('imageEditorV3:imageDocument:describe', parseImageEditorV3DescribeImageDocumentPayload, (payload, event) => (
    runRequest('image_document.describe', payload.requestId, event.sender.id, () => (
      imageDocuments().describe(payload.target)
    ))
  ), guard)
  registerIpcHandler('imageEditorV3:imageDocument:create', parseImageEditorV3CreateImageDocumentPayload, (payload, event) => (
    runRequest('image_document.create', payload.requestId, event.sender.id, () => (
      imageDocuments().create({
        documentId: payload.documentId,
        container: payload.container,
        emptyUntilRevision: payload.emptyUntilRevision,
      })
    ))
  ), guard)
  registerIpcHandler('imageEditorV3:imageDocument:commit', parseImageEditorV3CommitImageDocumentPayload, (payload, event) => (
    runRequest('image_document.commit', payload.requestId, event.sender.id, () => (
      imageDocuments().commit({
        target: payload.target,
        expectedRevision: payload.expectedRevision,
        ...(payload.force ? { force: true } : {}),
        ...(payload.thumbnail ? { thumbnail: payload.thumbnail } : {}),
      })
    ))
  ), guard)
  registerIpcHandler('imageEditorV3:canvasLayers:prepare', parseImageEditorV3CanvasLayersPreparePayload, (payload, event) => (
    runRequest('canvas_layers.prepare', payload.requestId, event.sender.id, () => (
      canvasLayers().prepare({ canvasId: payload.canvasId, layers: payload.layers })
    ))
  ), guard)
  registerIpcHandler('imageEditorV3:canvasLayers:commit', parseImageEditorV3CanvasLayersCommitPayload, (payload, event) => (
    runRequest('canvas_layers.commit', payload.requestId, event.sender.id, () => (
      canvasLayers().commit({ canvasId: payload.canvasId, container: payload.container, documentIds: payload.documentIds })
    ))
  ), guard)
}
