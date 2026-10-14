import { z } from 'zod'

import type { DocumentKindDescriptor } from './registry'
import { videoEditInPlaceRecordsSchema } from '../../videoEdit/inPlacePersistence'
import { colorLutAssetSchema } from '../../videoEdit/colorLutAsset'
import { migrateStyleKitV1, styleKitSchema } from '../../videoEdit/styleKit'
import { videoEditDocumentSchema } from '../../videoEdit/document'
import { creativeIntentsSchema } from '../../creativeIntent/persistence'
import { VIDEO_EDIT_CONTENT_VERSION } from '../../persistence/schemaVersions'

/*
 * 剪辑（`.henji-video`，3.1 剪辑接入）：项目的主文档，始终放在项目里（可以在项目之间移动）。
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
  styleKits: z.array(styleKitSchema).optional(),
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
  extension: '.henji-video',
  standaloneFolderNames: null,
  untitledNames: { zh: '未命名剪辑', en: 'Untitled Edit' },
  storage: 'json',
  // 版本 1 = 旧剪辑文件第 2 版的持久字段（去掉 format / version / id / name / revision，由外壳表达）。
  version: VIDEO_EDIT_CONTENT_VERSION,
  contentSchema: videoEditContentSchema,
  // 2 → 3（t187）：字幕新增可选 sourceText，原样保留；导出归档新增必填 presetName / rangeSource。
  // 旧归档没有记下预设名与区间来源，按升级前的展示补齐，不改动其他内容。
  migrations: {
    2: migrateVideoEditContentV2,
    3: migrateVideoEditContentV3,
    // 4 → 5：新增可选录制光标引用和效果，已有内容不需要补值。
    4: content => content,
    // 5 → 6：新增可选 screen_attention 关键帧归属，已有关键帧语义不变。
    5: content => content,
    // 6 → 7：内置效果新增可选缩放区间 regions（自动缩放）与录屏画框效果，已有效果不需要补值。
    6: content => content,
    // 7 → 8（t97）：工程风格包快照的旧 Markdown 规则移入 notes，其余新字段由默认值补齐。
    7: migrateVideoEditContentV7,
  },
  dependencyContent: ({ exportHistory: _exportHistory, ...dependencies }) => dependencies,
  createEmptyContent: createEmptyVideoEditContent,
  isEmptyContent: isEmptyVideoEditContent,
  summarize: summarizeVideoEdit,
}

function migrateVideoEditContentV2(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const record = content as Record<string, unknown>
  if (!Array.isArray(record.exportHistory)) return content
  return { ...record, exportHistory: record.exportHistory.map(entry => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? { presetName: '已完成导出', rangeSource: 'content', ...(entry as Record<string, unknown>) }
    : entry) }
}

/** 3 → 4：字幕原先始终输出且可编辑；显式保留这两个默认行为。 */
function migrateVideoEditContentV3(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const record = content as Record<string, unknown>
  if (!Array.isArray(record.sequences)) return content
  return { ...record, sequences: record.sequences.map(sequence => sequence && typeof sequence === 'object' && !Array.isArray(sequence)
    ? { ...(sequence as Record<string, unknown>), captionTrackEnabled: true, captionTrackLocked: false }
    : sequence) }
}

/** 7 → 8：只迁移工程内嵌风格快照，其他内容原样保留。 */
function migrateVideoEditContentV7(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const record = content as Record<string, unknown>
  return Array.isArray(record.styleKits) ? { ...record, styleKits: record.styleKits.map(migrateStyleKitV1) } : content
}
