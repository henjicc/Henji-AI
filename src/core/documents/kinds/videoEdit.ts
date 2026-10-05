import { defineSkeletonDocumentKind } from './registry'

/**
 * 剪辑（`.henji-video`）：项目的主文档，始终放在项目里，可以在项目之间移动。
 * 内容 schema、空内容判断与列表摘要由 3.1 剪辑接入补全。
 */
export const videoEditDocumentKind = defineSkeletonDocumentKind({
  id: 'video_edit',
  extension: '.henji-video',
  standaloneFolderNames: null,
  untitledNames: { zh: '未命名剪辑', en: 'Untitled Edit' },
  storage: 'json',
})
