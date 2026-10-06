import { retryImageEditDocumentSaveV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOperations'
import { splitImageEditV3DocumentRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'
import type { ApplicationRef } from '@/core/application-control/applicationCapabilities'

import { commitImageEdit } from '@/features/imageEdit/application/imageEditApplicationService'

import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'
import { createImageEditPreviewFromRef } from '@/features/imageEdit/application/imageSourceCapabilityService'
import { readImageEditPreview } from '@/features/imageEdit/application/imageEditSessionRegistry'
import { parseCapabilityInput, throwIfCapabilityAborted } from '@/features/application-control/capabilities/handlerUtils'
import { registerDocumentCreator, registerDocumentOpener, registerDocumentReleaser } from '@/features/documents/documentOperations'
import { UI_WHITE_HEX } from '@/components/ui/styleTokens'
import { createBlankImageDataUrl } from '@/features/imageMark/standalone/blankImage'
import { createImageDocumentFromSource } from '@/features/imageMark/standalone/imageDocumentFromSource'
import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'
import { releaseImageDocument } from '@/features/imageEdit/documents/imageDocumentRuntime'
import { requestImageDocumentInEditor } from '@/features/imageEdit/documents/imageDocumentWorkspace'

export function registerImageEditCapabilityHandlers(registrar: ApplicationCapabilityHandlerRegistrar): void {
  // 图片文档的通用打开与后台释放（3.5）：列出、新建、移动、副本、回收站、改名走通用文档能力，
  // 这里只登记“打开到哪里”（工具箱图片编辑页接手，离开当前文档时按草稿规则询问）和后台会话怎么释放。
  registerDocumentOpener('image_document', (document) => {
    requestImageDocumentInEditor({ id: document.id, path: document.path })
    openApplicationSurface('tool.image_edit')
  })
  registerDocumentReleaser('image_document', releaseImageDocument)
  // 在剪辑里新建图片文档（4.1）：按剪辑序列的画面尺寸建一张空白图片，草稿放在所在项目里，再交给图片编辑页打开
  registerDocumentCreator('image_document', async (container, { size }) => {
    const edge = (value: number | undefined, fallback: number): number => Math.min(8192, Math.max(16, Math.round(value ?? fallback)))
    const blank = createBlankImageDataUrl({ width: edge(size?.width, 1920), height: edge(size?.height, 1080), dpi: 72, backgroundColor: UI_WHITE_HEX })
    const document = await createImageDocumentFromSource({ url: blank, blank: true }, container)
    const meta = document.session.documentMeta
    requestImageDocumentInEditor({ id: meta.id, path: meta.path })
    openApplicationSurface('tool.image_edit')
    return meta
  })

  registrar.registerHandler('create_image_edit_preview', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      sourceRef: ApplicationRef
      operations: Record<string, unknown>[]
    }>('create_image_edit_preview', input)
    const preview = await createImageEditPreviewFromRef({
      sourceRef: parsed.sourceRef,
      operations: parsed.operations,
    })
    const previewRef = String(preview.previewRef)
    /*
     * 回执必须带 verification：外部操作账本的 `ok` 只认 `data.verification.verified`，
     * 缺了它，一次**完全成功**的预览会以 `ok:false` / `isError:true` 交给调用方——
     * 标准 MCP 客户端据此判定失败，「生成结果 → 编辑 → 下一次生成」这条链当场断在中间。
     * 这里按稳定引用真的读回来一次再声明，读不回来就是 false，不做橡皮图章。
     */
    const registered = readImageEditPreview(previewRef)
    return {
      previewRef,
      sourceRef: parsed.sourceRef,
      resultRefs: preview.resultRefs,
      operationCount: preview.operationCount,
      hasEffect: preview.hasEffect,
      width: preview.width,
      height: preview.height,
      verification: {
        verified: Boolean(registered),
        condition: '预览已登记，可按该稳定引用继续编辑或作为下一次生成的输入',
        target: { kind: 'image_edit.preview', id: previewRef },
      },
    }
  })

  registrar.registerHandler('commit_image_edit', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      previewRef: string
      displayName?: string
    }>('commit_image_edit', input)
    return await commitImageEdit(parsed.previewRef, parsed.displayName)
  })

  registrar.registerHandler('retry_image_edit_document_save', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const { documentRef, expectedOwnerId } = parseCapabilityInput<{ documentRef: { kind: 'image_edit.document'; id: string }; expectedOwnerId?: string }>(
      'retry_image_edit_document_save', input)
    const saved = await retryImageEditDocumentSaveV3(splitImageEditV3DocumentRef(documentRef).documentId, expectedOwnerId)
    return { ref: documentRef, status: 'persisted', effects: saved.receipt?.effects ?? [],
      resultingRevisions: saved.receipt?.resultingRevisions ?? {} }
  })

}
