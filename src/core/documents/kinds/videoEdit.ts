import { z } from 'zod'
import { migrateVideoEditCaptionOwnership } from '../../videoEdit/captionOwnershipMigration'
import { migrateEmbeddedVideoColorGradesV1 } from '../../videoEdit/colorGradeMigration'

import { henjiExtension, henjiLegacyExtensions } from '../../fileExtensions'
import type { DocumentKindDescriptor } from './registry'
import { videoEditInPlaceRecordsSchema } from '../../videoEdit/inPlacePersistence'
import { colorLutAssetSchema } from '../../videoEdit/colorLutAsset'
import { migrateVideoEditStyles } from '../../videoEdit/styles/styleTemplateMigration'
import { migrateVideoEditMotionBlurMaster } from '../../videoEdit/motionBlurMigration'
import { videoEditDocumentSchema } from '../../videoEdit/document'
import { creativeIntentsSchema } from '../../creativeIntent/persistence'
import { VIDEO_EDIT_CONTENT_VERSION } from '../../persistence/schemaVersions'

/*
 * 剪辑（`.hjvid`，3.1 剪辑接入）：项目的主文档，始终放在项目里（可以在项目之间移动）。
 *
 * 内容 = 剪辑的持久部分（内存形态，素材位置都是绝对路径）：
 * - media：引用的源文件；bins / items：素材箱与素材项；sequences：序列（轨道、片段、标注、标记、字幕、转场）；
 * - codeMaterials：可编辑代码素材的固定源码版本（可选）。
 * 稳定 ID、名称与版本由文档外壳表达（剪辑名就是文件名），不进内容。
 *
 * 这里只校验外层结构，细节由剪辑工具打开时按完整 schema（`videoEditDocumentSchema`）逐项校验。
 * 嵌套对象一律保留未知字段：主进程保存时持久化的是 schema 解析结果，剥掉字段就等于丢数据。
 * 本文件主进程与渲染层共用，只能相对导入纯模块。
 */

const identified = z.looseObject({ id: z.string().min(1) })
const ratioSchema = z.looseObject({ numerator: z.number(), denominator: z.number() })

const clipSchema = z.looseObject({
  id: z.string().min(1),
  start: z.number(),
  duration: z.number(),
})

const sequenceSchema = z.looseObject({
  id: z.string().min(1),
  frameRate: ratioSchema,
  tracks: z.array(identified),
  clips: z.array(clipSchema),
  annotations: z.array(identified),
})

export const videoEditContentSchema = z.object({
  foreign: videoEditDocumentSchema.shape.foreign,
  exportHistory: videoEditDocumentSchema.shape.exportHistory,
  creativeIntents: creativeIntentsSchema.optional(),
  styles: videoEditDocumentSchema.shape.styles,
  templates: videoEditDocumentSchema.shape.templates,
  colorLuts: z.array(colorLutAssetSchema).optional(),
  media: z.array(z.looseObject({ id: z.string().min(1), path: z.string().min(1) })),
  bins: z.array(identified),
  items: z.array(identified),
  sequences: z.array(sequenceSchema),
  codeMaterials: z.array(identified).optional(),
  posterFrame: z.looseObject({ sequenceId: z.string().min(1), frame: z.number() }).optional(),
  inPlaceGenerations: videoEditInPlaceRecordsSchema.optional(),
  creativePlacements: videoEditDocumentSchema.shape.creativePlacements,
  scenes: z.array(identified).optional(),
})

export type VideoEditDocumentContent = z.infer<typeof videoEditContentSchema>

/** 一条序列里内容的结束帧（片段、字幕、标记取最大）。 */
function sequenceEndFrame(sequence: VideoEditDocumentContent['sequences'][number]): number {
  const captions = Array.isArray(sequence.captions) ? sequence.captions as Array<{ start?: unknown; duration?: unknown }> : []
  const ends = [
    ...sequence.clips.map((clip) => clip.start + clip.duration),
    ...captions.map((caption) => (typeof caption.start === 'number' && typeof caption.duration === 'number' ? caption.start + caption.duration : 0)),
  ]
  return ends.length ? Math.max(0, ...ends) : 0
}

function sequenceHasContent(sequence: VideoEditDocumentContent['sequences'][number]): boolean {
  const optional = ['markers', 'captions', 'transitions'] as const
  return sequence.clips.length > 0
    || sequence.annotations.length > 0
    || optional.some((key) => Array.isArray(sequence[key]) && (sequence[key] as unknown[]).length > 0)
}

/**
 * 空内容：没有引用任何素材、没有素材项与素材箱、没有代码素材，序列里也没有任何片段、标注、标记、字幕或转场。
 * 新建后只是改了序列规格或多建了一条空序列的草稿项目离开时直接丢弃，不询问。
 */
function isEmptyVideoEditContent(content: VideoEditDocumentContent): boolean {
  return (content.exportHistory?.length ?? 0) === 0
    && content.media.length === 0
    && (content.creativeIntents?.drafts.length ?? 0) === 0
    && (content.creativeIntents?.sessions.length ?? 0) === 0
    && (content.colorLuts?.length ?? 0) === 0
    && content.items.length === 0
    && content.bins.length === 0
    && (content.codeMaterials?.length ?? 0) === 0
    && (content.inPlaceGenerations?.length ?? 0) === 0
    && (content.scenes?.length ?? 0) === 0
    && !content.sequences.some(sequenceHasContent)
}

/** 列表摘要：片段数与时长（秒，取最长的序列）。 */
function summarizeVideoEdit(content: VideoEditDocumentContent): { clips: number; durationSeconds: number } {
  let durationSeconds = 0
  for (const sequence of content.sequences) {
    const fps = sequence.frameRate.denominator > 0 ? sequence.frameRate.numerator / sequence.frameRate.denominator : 0
    if (fps > 0) durationSeconds = Math.max(durationSeconds, sequenceEndFrame(sequence) / fps)
  }
  return {
    clips: content.sequences.reduce((total, sequence) => total + sequence.clips.length, 0),
    durationSeconds: Math.round(durationSeconds * 100) / 100,
  }
}

/** 新剪辑只有素材集合，时间线由用户新建或首次拖入素材时建立。 */
function createEmptyVideoEditContent(): VideoEditDocumentContent {
  return { media: [], bins: [], items: [], sequences: [] }
}

export const videoEditDocumentKind: DocumentKindDescriptor<VideoEditDocumentContent> = {
  id: 'video_edit',
  extension: henjiExtension('video_edit'),
  legacyExtensions: henjiLegacyExtensions('video_edit'),
  standaloneFolderNames: { zh: '剪辑', en: 'Video Edits' },
  untitledNames: { zh: '未命名剪辑', en: 'Untitled Edit' },
  storage: 'json',
  // 版本 1 = 旧剪辑文件第 2 版的持久字段（去掉 format / version / id / name / revision，由外壳表达）。
  version: VIDEO_EDIT_CONTENT_VERSION,
  // 25：批注新增箭头、椭圆、文字、编号圆点形状。旧程序的批注目标是封闭联合，读不懂这些分支，
  // 按“改变已有字段（target）可取值”处理，提高到 25，让旧程序明确提示升级而不是报内容损坏。
  // 26：片段新增非等比缩放 scaleAspect，旧程序忽略它会按等比渲染与导出（画面变形不同），提高到 26。
  // 27：序列新增运动模糊与帧混合开关，旧程序忽略它们会渲染出不同的画面，提高到 27。
  // 28：音轨混音（轨道音量、声像、轨道效果）、主轨与片段基本声音，旧程序忽略它们会混出不同的声音，提高到 28。
  // 31：序列 motionBlur 改为总开关（同时管代码图层的位姿模糊），片段新增 motionBlur:false；旧程序会把关掉的总开关当成代码图层照常模糊，提高到 31。
  // 37：片段新增 enabled:false（停用），旧程序忽略它会照常播放与导出停用的片段；新增片子数据 scenes 与代码参数值 {kind:'scene'}，
  // 代码版本可写作者接口 v5 与内置库 libraries，旧程序读不懂这些（作者接口最高只认 v4），提高到 37，让旧程序明确提示升级。
  // 38：作者接口 v6 可使用排版库；旧程序无法执行，最低可读版本同步提高。
  minReaderVersion: 42,
  contentSchema: videoEditContentSchema,
  // 2026-10-21 兼容起点：此前的开发期版本不再读取；今后每次升版本在这里登记 N → N+1。
  migrations: {
    // 41 → 42：删除旧程序依赖的 linkedCaptionId；旧程序会追加链接字幕并写回退役字段，最低可读版本提高到 42。
    41: migrateVideoEditCaptionOwnership,
    // 40 → 41：代码图片参数新增网页画面引用 {kind:'web'}（本机网页的路径、视口、取景、倍率、取帧时刻与要读矩形的选择器）；
    // 旧内容原样有效，最低可读版本不变。
    40: content => structuredClone(content),
    // 39 → 40：作者源码与固定组件依赖不设容量或深度上限，内容原样保留。
    39: content => structuredClone(content),
    38: content => structuredClone(content),
    // 37 → 38：只接受新作者接口；旧源码、apiVersion 与固定库版本原样保留。
    37: content => structuredClone(content),
    // 36 → 37：片段新增可选 enabled:false，文档新增可选片子数据 scenes，代码参数可引用片子数据，代码版本新增可选内置库 libraries 并接受作者接口 v5；
    // 旧内容不含这些，原样有效。
    36: content => structuredClone(content),
    // 35 → 36：代码视频参数新增可选取帧时间表 spans；旧内容原样有效，旧程序忽略它只会改按片段时间取帧，最低可读版本不变。
    35: content => structuredClone(content),
    // 34 → 35：可选 project 固定工程提交与入口，原闭包 files 仍可独立读取。
    34: content => structuredClone(content),
    // 33 → 34：location 新增 Git 对象引用；普通打开保留旧路径，显式迁移才做 I/O。
    33: content => structuredClone(content),
    // 17 → 18：全能调色参数格式 v2（开尔文白平衡、创意分离色调并入色轮），含关键帧。
    17: content => migrateEmbeddedVideoColorGradesV1(content),
    // 18 → 19：片段新增可选的速度曲线 timeRemap、补帧 frameInterpolation 与变调 pitchSemitones；旧内容原样有效。
    18: content => content,
    // 19 → 20：只新增可选字段（跟随 motion 变换跟随、跟踪器 recording 录屏事件来源、片段 stabilization 防抖），原内容不变。
    19: content => content,
    // 20 → 21：片段新增可选的音频重构记录 remix，旧内容原样保留。
    20: content => content,
    // 21 → 22：风格说明书换成 Frameflow 的风格包机制。工程风格包转成风格副本（旧栏目并入新栏目、参考示例记进“样片与代码”），
    // 序列绑定 styleKitId 改名 styleId；新增工程模板 templates 与原生模板实例标记 clip.templateId。
    21: content => migrateVideoEditStyles(content),
    // 22 → 23：新增可选 gainDb，缺省按 0 dB 读取，旧音量与关键帧原样保留。
    22: content => content,
    // 23 → 24：工程风格副本新增可选使用者偏好。
    23: content => content,
    // 24 → 25：批注新增箭头/椭圆/文字/编号圆点目标与可选 style.color；旧批注原样有效。
    24: content => content,
    // 25 → 26：片段新增可选 scaleAspect（非等比缩放），批注样式新增可选 weight（线条粗细）；旧内容原样有效。
    25: content => content,
    // 26 → 27：序列新增可选 motionBlur（运动模糊）与 frameBlend（帧混合默认补帧）；旧内容原样有效。
    26: content => content,
    // 27 → 28：轨道新增可选 volumeDb / pan / effects，序列新增可选 master，片段新增可选 essentialSound；旧内容原样有效。
    27: content => content,
    // 28 → 29：字幕新增可选 linkedCaptionId（音频编辑动态链接的字幕段），素材新增可选 linkedTimeline（成品对应的源录音区间）；旧内容原样有效。
    28: content => content,
    // 29 → 30：工程风格副本的样片画布放宽到 3840×2160、60 帧；旧内容原样有效，旧程序只在副本确实超出旧上限时拒绝打开。
    29: content => content,
    // 30 → 31：序列运动模糊改为总开关。此前关着的序列里代码图层照常模糊、片段变换不模糊：
    // 改为打开总开关，并给有变换动画的片段写 motionBlur:false，画面与旧版一致。
    30: content => migrateVideoEditMotionBlurMaster(content),
    // 31 → 32：工程风格副本的样片时长放宽到 30 秒、锚点 10 张；旧内容原样有效，旧程序只在副本确实超出旧上限时拒绝打开。
    31: content => content,
    // 32 → 33：过渡种类加入 74 个 gl-transitions 转场（gl.*）；旧内容原样有效，旧程序只在确实用了 gl.* 时拒绝打开。
    32: content => content,
  },
  dependencyContent: ({ exportHistory: _exportHistory, ...dependencies }) => dependencies,
  createEmptyContent: createEmptyVideoEditContent,
  isEmptyContent: isEmptyVideoEditContent,
  summarize: summarizeVideoEdit,
}

