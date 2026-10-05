import { z } from 'zod'

import type { DocumentKindDescriptor } from './registry'

/*
 * 剪辑（`.henji-video`，3.1 剪辑接入）：项目的主文档，始终放在项目里（可以在项目之间移动）。
 *
 * 内容 = 剪辑工程的持久部分（内存形态，素材位置都是绝对路径）：
 * - media：引用的源文件；bins / items：素材箱与项目项；sequences：序列（轨道、片段、标注、标记、字幕、转场）；
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
  media: z.array(z.looseObject({ id: z.string().min(1), path: z.string().min(1) })),
  bins: z.array(identified),
  items: z.array(identified),
  sequences: z.array(sequenceSchema).min(1),
  codeMaterials: z.array(identified).optional(),
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
 * 空内容：没有引用任何素材、没有项目项与素材箱、没有代码素材，序列里也没有任何片段、标注、标记、字幕或转场。
 * 新建后只是改了序列规格或多建了一条空序列的草稿项目离开时直接丢弃，不询问。
 */
function isEmptyVideoEditContent(content: VideoEditDocumentContent): boolean {
  return content.media.length === 0
    && content.items.length === 0
    && content.bins.length === 0
    && (content.codeMaterials?.length ?? 0) === 0
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

/** 新剪辑的空内容：一条 1920×1080、30 fps 的空序列（一条音频轨、七条视频轨），与剪辑工具新建时相同。 */
function createEmptyVideoEditContent(): VideoEditDocumentContent {
  const track = (index: number) => ({
    id: crypto.randomUUID(),
    name: index === 0 ? '音频 1' : `视频 ${index}`,
    index,
    kind: index === 0 ? 'audio' : 'video',
    locked: false,
    enabled: true,
    muted: false,
    solo: false,
  })
  return {
    media: [],
    bins: [],
    items: [],
    sequences: [{
      id: crypto.randomUUID(),
      name: '序列 1',
      width: 1920,
      height: 1080,
      frameRate: { numerator: 30, denominator: 1 },
      pixelAspectRatio: { numerator: 1, denominator: 1 },
      sampleRate: 48000,
      channels: 2,
      tracks: Array.from({ length: 8 }, (_, index) => track(index)),
      clips: [],
      annotations: [],
    }],
  }
}

export const videoEditDocumentKind: DocumentKindDescriptor<VideoEditDocumentContent> = {
  id: 'video_edit',
  extension: '.henji-video',
  standaloneFolderNames: null,
  untitledNames: { zh: '未命名剪辑', en: 'Untitled Edit' },
  storage: 'json',
  // 版本 1 = 旧剪辑工程文件第 2 版的持久字段（去掉 format / version / id / name / revision，由外壳表达）。
  version: 1,
  contentSchema: videoEditContentSchema,
  upgradeContent: (content) => content,
  createEmptyContent: createEmptyVideoEditContent,
  isEmptyContent: isEmptyVideoEditContent,
  summarize: summarizeVideoEdit,
}
