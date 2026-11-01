import { migrateRecordingAuthor } from '../../videoEdit/styles/authorVersionMigration'
import { migrateAudioMergedEffects, migrateAudioEqualizerModes } from '../../audio/effects/mergedEffectsMigration'
import { migrateRecordingTransitions } from '../../videoEdit/transitionMigration'
import { migrateRecordingCaptionOwnership } from '../../videoEdit/captionOwnershipMigration'
import { henjiExtension, henjiLegacyExtensions } from '../../fileExtensions'
import type { DocumentKindDescriptor } from './registry'
import { migrateEmbeddedVideoEditStyles } from '../../videoEdit/styles/styleTemplateMigration'
import { migrateEmbeddedVideoEditMotionBlurMaster } from '../../videoEdit/motionBlurMigration'
import { migrateVideoEditMergedEffects } from '../../videoEdit/mergedEffectsMigration'
import { createRecordingDocument, recordingDocumentSchema, type RecordingDocument } from '../../screenRecording/document'

export const screenRecordingDocumentKind: DocumentKindDescriptor<RecordingDocument> = {
  id: 'screen_recording', extension: henjiExtension('screen_recording'), legacyExtensions: henjiLegacyExtensions('screen_recording'), storage: 'json', version: 59, minReaderVersion: 59,
  // 2026-10-21 兼容起点：此前的开发期版本不再读取；今后每次升版本在这里登记 N → N+1。
  migrations: {
    // 57 → 58：嵌入剪辑新增可选元素效果覆盖、修改记录与作者接口 11（效果 key），已有内容原样保留；旧程序读不懂接口 11、会忽略效果覆盖（与剪辑 54 → 55 同理），最低可读版本提高到 58。
    57: content => structuredClone(content),
    // 58 → 59：嵌入剪辑的代码可携带作者接口 12 的网页文本声明，已有内容原样保留；最低可读版本提高到 59。
    58: content => structuredClone(content),
    // 56 → 57：接受作者接口 10，样片补固定历史版本。
    56: migrateRecordingAuthor,
    // 55 → 56：嵌入剪辑的风格件可带代码滤镜快照，历史基线原样保留。
    55: content => structuredClone(content),
    // 54 → 55：嵌入剪辑接受作者接口 v9 的调整层，旧源码与接口保持原样。
    54: content => structuredClone(content),
    // 53 → 54：嵌入剪辑允许作者接口 v8 的 all 显隐条件，保留旧源码和接口。
    53: content => structuredClone(content),
    // 52 → 53：录制基线按剪辑 49 → 50 精确迁移过渡；旧程序不认识新 ID，最低可读版本提高到 53。
    52: migrateRecordingTransitions,
    // 51 → 52：音频效果合并、均衡方式拆分并保留声音身份别名；旧程序无法理解新效果，最低可读版本同步提高。
    51: content => migrateAudioEqualizerModes(migrateAudioMergedEffects(content)),
    // 50 → 51：嵌入剪辑的工程风格新增可选风格件，最低可读版本保持 50。
    50: content => structuredClone(content),
    // 49 → 50：嵌入剪辑里的旧模糊并成“模糊”、旧暗角负数量换成白色（与剪辑 46 → 47 同一换算）；旧程序不认识新效果，最低可读版本提高到 50。
    49: migrateVideoEditMergedEffects,
    // 48 → 49：剪辑基线新增可选高级导出编码，旧快照保持原样，最低可读版本保持 48。
    48: content => structuredClone(content),
    // 47 → 48：允许作者接口 7 的图层效果，旧源码与库锁定保持原样。
    47: content => structuredClone(content),
    // 46 → 47：嵌入剪辑的导出设置新增可选 renderAtOutputResolution，缺省为开，最低可读版本保持 45。
    46: content => structuredClone(content),
    // 45 → 46：嵌入剪辑导出记录的设置新增可选 usePreviews，缺省不使用预览，最低可读版本保持 45。
    45: content => structuredClone(content),
    // 44 → 45：嵌入剪辑删除旧程序依赖的 linkedCaptionId；防止旧程序追加字幕及写回退役字段，最低可读版本提高到 45。
    44: migrateRecordingCaptionOwnership,
    // 43 → 44：嵌入剪辑的代码图片参数新增网页画面引用 {kind:'web'}，旧内容原样有效。
    43: content => structuredClone(content),
    // 42 → 43：嵌入剪辑的作者源码与固定组件依赖取消容量和深度上限。
    42: content => structuredClone(content),
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
