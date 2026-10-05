import { defineSkeletonDocumentKind } from './registry'

/**
 * 镜头参考（`.henji-stage`）：可以独立存放（作品目录“镜头参考”文件夹），也可以放进项目。
 * 内容 schema、空内容判断与列表摘要由 3.2 镜头参考接入（样板）补全。
 */
export const cameraStageDocumentKind = defineSkeletonDocumentKind({
  id: 'camera_stage',
  extension: '.henji-stage',
  standaloneFolderNames: { zh: '镜头参考', en: 'Camera Stages' },
  untitledNames: { zh: '未命名镜头参考', en: 'Untitled Camera Stage' },
  storage: 'json',
})
