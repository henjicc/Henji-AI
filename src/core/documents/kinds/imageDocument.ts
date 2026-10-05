import { defineSkeletonDocumentKind } from './registry'

/**
 * 图片文档（`.henjiimg`）：沿用单文件包，一个文件就是全部（像 PSD）。
 * 通用服务只做文件级操作，头信息经主进程包适配器读写；适配器、工作副本与写回由 3.5 接入。
 */
export const imageDocumentKind = defineSkeletonDocumentKind({
  id: 'image_document',
  extension: '.henjiimg',
  standaloneFolderNames: { zh: '图片文档', en: 'Image Documents' },
  untitledNames: { zh: '未命名图片', en: 'Untitled Image' },
  storage: 'package',
})
