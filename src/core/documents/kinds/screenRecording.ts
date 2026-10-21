import type { DocumentKindDescriptor } from './registry'
import { createRecordingDocument, recordingDocumentSchema, type RecordingDocument } from '../../screenRecording/document'

export const screenRecordingDocumentKind: DocumentKindDescriptor<RecordingDocument> = {
  id: 'screen_recording', extension: '.henji-recording', storage: 'json', version: 19,
  // 2026-10-21 兼容起点：此前的开发期版本不再读取；今后每次升版本在这里登记 N → N+1。
  migrations: {},

  standaloneFolderNames: { zh: '录制会话', en: 'Recordings' },
  untitledNames: { zh: '未命名录制', en: 'Untitled Recording' },
  contentSchema: recordingDocumentSchema, createEmptyContent: createRecordingDocument,
  isEmptyContent: content => !content.sessionId && !content.understanding.director,
  summarize: content => ({ durationMs: Math.round(Math.max(0, ...content.media.map(media => media.monoUs + media.durationUs)) / 1000), status: content.status }),
}
