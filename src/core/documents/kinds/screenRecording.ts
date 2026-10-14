import type { DocumentKindDescriptor } from './registry'
import { createRecordingDocument, recordingDocumentSchema, type RecordingDocument } from '../../screenRecording/document'

export const screenRecordingDocumentKind: DocumentKindDescriptor<RecordingDocument> = {
  id: 'screen_recording', extension: '.henji-recording', storage: 'json', version: 9,
  migrations: {
    // 5 → 6：新增可选正式开始/结束时刻；旧会话没有预热段，原样保留。
    5: content => content,
    // 6 → 7：新增可选暂停区间；旧会话按各轨自身的暂停空档处理，原样保留。
    6: content => content,
    // 7 → 8：嵌入的剪辑基线内容随剪辑格式新增可选缩放区间，原样保留。
    7: content => content,
    // 8 → 9：来源新增可选的录制时系统光标大小与样式；旧会话没有，光标效果用原默认值。
    8: content => content,
  },
  standaloneFolderNames: { zh: '录制会话', en: 'Recordings' },
  untitledNames: { zh: '未命名录制', en: 'Untitled Recording' },
  contentSchema: recordingDocumentSchema, createEmptyContent: createRecordingDocument,
  isEmptyContent: content => !content.sessionId && !content.understanding.director,
  summarize: content => ({ durationMs: Math.round(Math.max(0, ...content.media.map(media => media.monoUs + media.durationUs)) / 1000), status: content.status }),
}
