import { henjiExtension, henjiLegacyExtensions } from '../../fileExtensions'
import type { DocumentKindDescriptor } from './registry'
import { migrateEmbeddedVideoEditStyles } from '../../videoEdit/styles/styleTemplateMigration'
import { migrateEmbeddedVideoEditMotionBlurMaster } from '../../videoEdit/motionBlurMigration'
import { createRecordingDocument, recordingDocumentSchema, type RecordingDocument } from '../../screenRecording/document'

export const screenRecordingDocumentKind: DocumentKindDescriptor<RecordingDocument> = {
  id: 'screen_recording', extension: henjiExtension('screen_recording'), legacyExtensions: henjiLegacyExtensions('screen_recording'), storage: 'json', version: 42, minReaderVersion: 41,
  // 2026-10-21 兼容起点：此前的开发期版本不再读取；今后每次升版本在这里登记 N → N+1。
  migrations: {
    // 嵌入剪辑只新增可选外来代码标记，历史录制保持本机身份。
    41: content => structuredClone(content),
    // 40 → 41：嵌入剪辑支持作者接口 v6；保留旧源码、接口与库版本，旧程序须升级后读取。
    40: content => structuredClone(content),
    // 嵌入剪辑快照按剪辑内容 36 → 37：片段新增 enabled:false、新增片子数据 scenes 与片子数据参数、代码版本可写作者接口 v5 与内置库；
    // 旧内容原样有效。旧程序会照常重放停用的片段、读不懂 v5 代码，最低可读版本同步提高到 40。
    39: content => structuredClone(content),
    // 嵌入剪辑快照的代码视频参数新增可选取帧时间表 spans；旧内容原样有效，最低可读版本不变。
    38: content => structuredClone(content),
    // 可选工程入口元数据不改变原闭包语义。
    37: content => structuredClone(content),
    // 嵌入剪辑快照支持 Git 源码引用，保留旧路径。
    36: content => structuredClone(content),
    // 嵌入剪辑快照的过渡种类加入 gl.* 转场；旧内容原样有效，最低可读版本不变。
    35: content => content,
    // 嵌入剪辑快照的风格副本样片时长放宽到 30 秒、锚点 10 张；旧内容原样有效，最低可读版本不变。
    34: content => content,
    // 嵌入剪辑快照的序列运动模糊改为总开关（同时管代码图层），片段新增 motionBlur:false；按剪辑内容 30 → 31 的同一规则迁移，
    // 旧程序会把关掉的总开关当成代码图层照常模糊，最低可读版本同步提高到 34。
    33: content => migrateEmbeddedVideoEditMotionBlurMaster(content),
    // 嵌入剪辑快照的字幕新增可选 linkedCaptionId、素材新增可选 linkedTimeline（音频编辑动态链接）；旧程序忽略也不会误解其余内容，最低可读版本不变。
    // 嵌入剪辑快照的风格副本样片画布放宽到 3840×2160、60 帧；旧内容原样有效，最低可读版本不变。
    32: content => content,
    31: content => content,
    // 嵌入剪辑快照的轨道新增音量、声像与轨道效果，序列新增主轨，片段新增基本声音；旧程序忽略后混出的声音不同，最低可读版本同步提高到 31。
    30: content => content,
    // 嵌入剪辑快照的序列新增运动模糊与帧混合开关；旧程序忽略后画面不同，最低可读版本同步提高到 30。
    29: content => content,
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
