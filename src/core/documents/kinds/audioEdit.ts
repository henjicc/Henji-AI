import { defineSkeletonDocumentKind } from './registry'

/**
 * 口播（`.henji-audio`）：可以独立存放（作品目录“口播”文件夹），也可以放进项目。
 * 内容 schema、空内容判断与列表摘要由 3.3 口播接入补全。
 */
export const audioEditDocumentKind = defineSkeletonDocumentKind({
  id: 'audio_edit',
  extension: '.henji-audio',
  standaloneFolderNames: { zh: '口播', en: 'Voiceovers' },
  untitledNames: { zh: '未命名口播', en: 'Untitled Voiceover' },
  storage: 'json',
})
