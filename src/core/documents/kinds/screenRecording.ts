import { henjiExtension, henjiLegacyExtensions } from '../../fileExtensions'
import type { DocumentKindDescriptor } from './registry'
import { migrateEmbeddedVideoEditStyles } from '../../videoEdit/styles/legacyStyles'
import { createRecordingDocument, recordingDocumentSchema, type RecordingDocument } from '../../screenRecording/document'

export const screenRecordingDocumentKind: DocumentKindDescriptor<RecordingDocument> = {
  id: 'screen_recording', extension: henjiExtension('screen_recording'), legacyExtensions: henjiLegacyExtensions('screen_recording'), storage: 'json', version: 29, minReaderVersion: 29,
  // 2026-10-21 兼容起点：此前的开发期版本不再读取；今后每次升版本在这里登记 N → N+1。
  migrations: {
    // 嵌入剪辑快照的片段新增非等比缩放、批注新增线条粗细；旧程序按等比渲染会画面不同，最低可读版本同步提高到 29。
    28: content => content,
    // 嵌入剪辑快照的批注新增箭头、椭圆、文字、编号圆点与可选颜色；旧程序读不懂新形状，最低可读版本同步提高到 28。
    27: content => content,
    // 嵌入剪辑风格新增可选的使用者偏好；旧内容保持原样，最低可读版本不变。
    26: content => content,
    // 嵌入剪辑快照新增源增益；旧程序忽略后重放声音不同，最低可读版本同步提高。
    25: content => content,
    // 浏览器设备 ID 无法映射到原生设备；保留启用状态，由统一录音设置选择输入。
    24: content => { const value = content as RecordingDocument; return { ...value, devices: { ...value.devices, ...(value.devices.microphone ? { microphone: {} } : {}) } } },
    23: content => content,
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
