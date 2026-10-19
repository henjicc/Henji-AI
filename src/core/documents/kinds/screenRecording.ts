import type { DocumentKindDescriptor } from './registry'
import { createRecordingDocument, recordingDocumentSchema, type RecordingDocument } from '../../screenRecording/document'
import { dropVideoEditStyleKits } from './videoEdit'
import { emptyRecordingPrivacy } from '../../screenRecording/privacy'

export const screenRecordingDocumentKind: DocumentKindDescriptor<RecordingDocument> = {
  id: 'screen_recording', extension: '.henji-recording', storage: 'json', version: 17,
  migrations: {
    // 2 → 3：旧会话尚未检测隐私区域，补空待审列表，不改变原有理解结果。
    2: migrateRecordingContentV2,
    // 3 → 4：旧会话尚未采集操作快照/脚本，补空集合。
    3: migrateRecordingContentV3,
    // 4 → 5：导演与配音回执均可选，不伪造执行结果。
    4: content => content,
    // 5 → 6：新增可选正式开始/结束时刻；旧会话没有预热段，原样保留。
    5: content => content,
    // 6 → 7：新增可选暂停区间；旧会话按各轨自身的暂停空档处理，原样保留。
    6: content => content,
    // 7 → 8：嵌入的剪辑基线内容随剪辑格式新增可选缩放区间，原样保留。
    7: content => content,
    // 8 → 9：来源新增可选的录制时系统光标大小与样式；旧会话没有，光标效果用原默认值。
    8: content => content,
    // 9 → 10 → 11（t97）：脚本基线里嵌入的剪辑内容丢弃旧风格快照与绑定。
    9: migrateRecordingContentV9,
    10: migrateRecordingContentV9,
    // 11 → 12（t102）：内嵌剪辑的代码参数类型拓宽，基线内容及其文档版本原样保留。
    11: content => content,
  },
  standaloneFolderNames: { zh: '录制会话', en: 'Recordings' },
  untitledNames: { zh: '未命名录制', en: 'Untitled Recording' },
  contentSchema: recordingDocumentSchema, createEmptyContent: createRecordingDocument,
  isEmptyContent: content => !content.sessionId && !content.understanding.director,
  summarize: content => ({ durationMs: Math.round(Math.max(0, ...content.media.map(media => media.monoUs + media.durationUs)) / 1000), status: content.status }),
}

function migrateRecordingContentV2(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const record = content as Record<string, unknown>
  if (!record.understanding || typeof record.understanding !== 'object' || Array.isArray(record.understanding)) return content
  return { ...record, understanding: { privacy: emptyRecordingPrivacy(), ...record.understanding } }
}

function migrateRecordingContentV3(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const record = content as Record<string, unknown>
  if (!record.understanding || typeof record.understanding !== 'object' || Array.isArray(record.understanding)) return content
  return { ...record, scriptCapture: record.scriptCapture === undefined ? { baselines: [], calls: [] } : record.scriptCapture,
    understanding: { operationScript: { steps: [] }, ...record.understanding } }
}

function migrateRecordingContentV9(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const record = content as Record<string, unknown>; const capture = record.scriptCapture as Record<string, unknown> | undefined
  if (!capture || !Array.isArray(capture.baselines)) return content
  return { ...record, scriptCapture: { ...capture, baselines: capture.baselines.map(baseline => {
    const value = baseline as { content?: Record<string, unknown> }
    return value?.content ? { ...value, content: dropVideoEditStyleKits(value.content) } : baseline
  }) } }
}
