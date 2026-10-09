import {
  createImageEditorV3RequestId,
  ImageEditorV3CommandRepository,
  ingestImageEditorV3Source,
} from '@/commands/imageEditorV3'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { createLogger } from '@/core/logging'
import { createImageDocument, type OpenImageDocument } from '@/features/imageEdit/documents/imageDocumentRuntime'
import type { DocumentContainerRef } from '@/core/documents/types'

import { createImageMarkV3ColorMode, prepareImageEditSourceLocatorV3 } from './imageMarkV3Source'

/*
 * 从一张图片新建图片文档（3.5）：打开图片 / 新建空白图片 / 粘贴 / 拖入 / 从其他工具传来。
 * 图片先导入程序目录的内容寻址资源库，按它建一份工作副本（V3 文档 ID 就是新文档的 ID），
 * 再写出草稿 `.henjiimg`。空白图片记下创建时的版本：之后没有任何编辑就算空草稿，离开时直接删除。
 */

const logger = createLogger('features.imageMark.document_source')

export interface ImageDocumentSource {
  /** 本地路径、http(s) 或 data: 地址。 */
  url: string
  /** 从其他工具传来时带着的标注（V3 图层文档）。 */
  document?: ImageEditDocumentV3
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
  let document: ImageEditDocumentV3
  if (source.document) {
    document = { ...structuredClone(source.document), id: documentId, revision: 0 }
  } else {
    const managed = await ingestImageEditorV3Source({
      requestId: createImageEditorV3RequestId('image-document-source'),
      source: await prepareImageEditSourceLocatorV3(source.url),
    })
    document = createImageEditDocumentV3({
        width: managed.metadata.width,
        height: managed.metadata.height,
        sourceResourceId: managed.resource.resourceRef,
        documentId,
        color: createImageMarkV3ColorMode(managed.metadata),
      })
  }
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
