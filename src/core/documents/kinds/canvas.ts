import { defineSkeletonDocumentKind } from './registry'

/**
 * 画布（`.henji-canvas`）：可以独立存放（作品目录“画布”文件夹），也可以放进项目。
 * 内容 schema、空内容判断与列表摘要由 3.4 画布接入补全。
 */
export const canvasDocumentKind = defineSkeletonDocumentKind({
  id: 'canvas',
  extension: '.henji-canvas',
  standaloneFolderNames: { zh: '画布', en: 'Canvases' },
  untitledNames: { zh: '未命名画布', en: 'Untitled Canvas' },
  storage: 'json',
})
