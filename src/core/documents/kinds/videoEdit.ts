import { z } from 'zod'
import { migrateEmbeddedVideoColorGradesV1 } from '../../videoEdit/colorGradeMigration'

import { henjiExtension, henjiLegacyExtensions } from '../../fileExtensions'
import type { DocumentKindDescriptor } from './registry'
import { videoEditInPlaceRecordsSchema } from '../../videoEdit/inPlacePersistence'
import { colorLutAssetSchema } from '../../videoEdit/colorLutAsset'
import { migrateVideoEditStyles } from '../../videoEdit/styles/legacyStyles'
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
  standaloneFolderNames: null,
  untitledNames: { zh: '未命名剪辑', en: 'Untitled Edit' },
  storage: 'json',
  // 版本 1 = 旧剪辑文件第 2 版的持久字段（去掉 format / version / id / name / revision，由外壳表达）。
  version: VIDEO_EDIT_CONTENT_VERSION,
  // 25：批注新增箭头、椭圆、文字、编号圆点形状。旧程序的批注目标是封闭联合，读不懂这些分支，
  // 按“改变已有字段（target）可取值”处理，提高到 25，让旧程序明确提示升级而不是报内容损坏。
  minReaderVersion: 25,
  contentSchema: videoEditContentSchema,
  // 2026-10-21 兼容起点：此前的开发期版本不再读取；今后每次升版本在这里登记 N → N+1。
  migrations: {
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
  },
  dependencyContent: ({ exportHistory: _exportHistory, ...dependencies }) => dependencies,
  createEmptyContent: createEmptyVideoEditContent,
  isEmptyContent: isEmptyVideoEditContent,
  summarize: summarizeVideoEdit,
}

