import type { DocumentKindDescriptor } from './registry'
import { createRecordingDocument, recordingDocumentSchema, type RecordingDocument } from '../../screenRecording/document'
import { migrateStyleKitV1 } from '../../videoEdit/styleKit'

export const screenRecordingDocumentKind: DocumentKindDescriptor<RecordingDocument> = {
  id: 'screen_recording', extension: '.henji-recording', storage: 'json', version: 10,
  migrations: {
    // 5 → 6：新增可选正式开始/结束时刻；旧会话没有预热段，原样保留。
    5: content => content,
    // 6 → 7：新增可选暂停区间；旧会话按各轨自身的暂停空档处理，原样保留。
    6: content => content,
    // 7 → 8：嵌入的剪辑基线内容随剪辑格式新增可选缩放区间，原样保留。
    7: content => content,
    // 8 → 9：来源新增可选的录制时系统光标大小与样式；旧会话没有，光标效果用原默认值。
    8: content => content,
    // 9 → 10（t97）：脚本基线里嵌入的剪辑风格快照，旧 Markdown 规则移入 notes，其余由默认值补齐。
    9: migrateRecordingContentV9,
  },
  standaloneFolderNames: { zh: '录制会话', en: 'Recordings' },
  untitledNames: { zh: '未命名录制', en: 'Untitled Recording' },
  contentSchema: recordingDocumentSchema, createEmptyContent: createRecordingDocument,
  isEmptyContent: content => !content.sessionId && !content.understanding.director,
  summarize: content => ({ durationMs: Math.round(Math.max(0, ...content.media.map(media => media.monoUs + media.durationUs)) / 1000), status: content.status }),
}

function migrateRecordingContentV9(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const record = content as Record<string, unknown>; const capture = record.scriptCapture as Record<string, unknown> | undefined
  if (!capture || !Array.isArray(capture.baselines)) return content
  return { ...record, scriptCapture: { ...capture, baselines: capture.baselines.map(baseline => {
    const value = baseline as { content?: Record<string, unknown> }
    return value?.content && Array.isArray(value.content.styleKits) ? { ...value, content: { ...value.content, styleKits: value.content.styleKits.map(migrateStyleKitV1) } } : baseline
  }) } }
}
