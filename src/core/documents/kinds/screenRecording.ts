import type { DocumentKindDescriptor } from './registry'
import { migrateEmbeddedVideoEditStyles } from '../../videoEdit/styles/legacyStyles'
import { createRecordingDocument, recordingDocumentSchema, type RecordingDocument } from '../../screenRecording/document'

export const screenRecordingDocumentKind: DocumentKindDescriptor<RecordingDocument> = {
  id: 'screen_recording', extension: '.henji-recording', storage: 'json', version: 23, minReaderVersion: 23,
  // 2026-10-21 兼容起点：此前的开发期版本不再读取；今后每次升版本在这里登记 N → N+1。
  migrations: {
    // 19 → 20：嵌入的剪辑片段新增可选的速度曲线、补帧与变调字段；旧内容原样有效。
    19: content => content,
    // 20 → 21：嵌入的剪辑片段新增可选字段（跟随 motion、跟踪器 recording、防抖 stabilization），原内容不变。
    20: content => content,
    // 21 → 22：嵌入的剪辑片段新增可选的音频重构记录 remix，原内容不变。
    21: content => content,
    // 22 → 23：嵌入的剪辑快照把工程风格包换成风格副本（styleKits → styles，序列 styleKitId → styleId），
    // 片段新增可选的原生模板标记；旧程序不认识新的风格字段，最低可读版本提高到 23。
    22: content => migrateEmbeddedVideoEditStyles(content) as typeof content,
  },

  standaloneFolderNames: { zh: '录制会话', en: 'Recordings' },
  untitledNames: { zh: '未命名录制', en: 'Untitled Recording' },
  contentSchema: recordingDocumentSchema, createEmptyContent: createRecordingDocument,
  isEmptyContent: content => !content.sessionId && !content.understanding.director,
  summarize: content => ({ durationMs: Math.round(Math.max(0, ...content.media.map(media => media.monoUs + media.durationUs)) / 1000), status: content.status }),
}
