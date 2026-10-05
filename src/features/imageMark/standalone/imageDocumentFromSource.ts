import {
  createImageEditorV3RequestId,
  ImageEditorV3CommandRepository,
  ingestImageEditorV3Source,
} from '@/commands/imageEditorV3'
import { createEmptyImageEditDocument, type ImageEditDocument } from '@/core/imageEdit'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import { migrateImageEditDocumentV2ToV3 } from '@/core/imageEdit/v3/legacyMigration'
import { createLogger } from '@/core/logging'
import { createImageDocument, type OpenImageDocument } from '@/features/imageEdit/documents/imageDocumentRuntime'
import type { DocumentContainerRef } from '@/core/documents/types'

import { createImageMarkV3ColorMode, resolveImageMarkV3SourceLocator } from './imageMarkV3Source'

/*
 * 从一张图片新建图片文档（3.5）：打开图片 / 新建空白图片 / 粘贴 / 拖入 / 从其他工具传来。
 * 图片先导入程序目录的内容寻址资源库，按它建一份工作副本（V3 文档 ID 就是新文档的 ID），
 * 再写出草稿 `.henjiimg`。空白图片记下创建时的版本：之后没有任何编辑就算空草稿，离开时直接删除。
 */

const logger = createLogger('features.imageMark.document_source')

export interface ImageDocumentSource {
  /** 本地路径、http(s) 或 data: 地址。 */
  url: string
  /** 从其他工具传来时带着的标注（旧版标注文档会迁移成图层）。 */
  document?: ImageEditDocument
  /** 新建空白图片。 */
  blank?: boolean
}

function newDocumentId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export async function createImageDocumentFromSource(
  source: ImageDocumentSource,
  container: DocumentContainerRef = { kind: 'user' },
): Promise<OpenImageDocument> {
  const documentId = newDocumentId()
  const managed = await ingestImageEditorV3Source({
    requestId: createImageEditorV3RequestId('image-document-source'),
    source: resolveImageMarkV3SourceLocator(source.url),
  })
  let generatedLayerIndex = 0
  const migrated = migrateImageEditDocumentV2ToV3(source.document ?? createEmptyImageEditDocument(), {
    width: managed.metadata.width,
    height: managed.metadata.height,
    sourceResourceId: managed.resource.resourceRef,
    documentId,
    idFactory: (prefix) => `${prefix}-${documentId}-${generatedLayerIndex += 1}`,
  })
  const document = { ...migrated, color: createImageMarkV3ColorMode(managed.metadata) }
  const history = new ImageEditCommandHistoryV3()
  history.clear(document)
  const reference = await new ImageEditorV3CommandRepository().save(document, {
    expectedRevision: 0,
    previewRef: null,
    history: history.createSnapshot(),
  })
  logger.info('图片文档工作副本已建好', {
    event: 'image_document.source.prepared',
    context: { documentId, revision: reference.revision, blank: source.blank === true },
  })
  return await createImageDocument({
    documentId,
    emptyUntilRevision: source.blank ? reference.revision : null,
  }, container)
}
