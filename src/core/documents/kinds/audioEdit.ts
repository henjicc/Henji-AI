import { z } from 'zod'

import type { DocumentKindDescriptor } from './registry'

/*
 * 口播（`.henji-audio`，3.3 口播接入）：可以独立存放（作品目录“口播”文件夹），也可以放进项目。
 *
 * 内容 = 口播剪辑工程去掉外壳字段（ID、名称、创建 / 修改时间、版本由文档外壳表达）后的部分，内存形态、位置都是绝对路径：
 * - source：导入的音频或视频（默认引用原文件，重要记录 006）；新建空文档（如助手 create_document）为 null，
 *   打开时由界面请用户导入；
 * - referenceScript / transcript / suggestions / cuts：参考稿、识别词块、剪辑线索与声音编辑区间；
 * - editBaseline：第一次识别得到的原文（“撤销全部修改”的依据）；
 * - batchSettings / processorChain / vstEnabled / xmlFrameRate / viewSettings / selectedAsrModelId：处理与显示设置。
 *
 * 这里只校验外层结构；逐字段的严格规则由工具读取时用 `audioEditProjectSchema` 检查。外层与嵌套都保留未知字段：
 * 主进程保存时持久化的是 schema 解析结果，剥掉字段就等于丢数据。
 * 缓存（解码 WAV、处理结果）按文档 ID 存在程序目录，文档里没有程序目录路径。
 *
 * 本文件主进程与渲染层共用，只用相对导入。
 */

const sourceSchema = z.looseObject({
  mediaType: z.enum(['audio', 'video']),
  sourcePath: z.string().min(1),
  audioPath: z.string().min(1),
  durationFrames: z.number().int().nonnegative(),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().positive(),
})

const itemSchema = z.looseObject({ id: z.string().min(1) })

export const audioEditContentSchema = z.looseObject({
  source: sourceSchema.nullable(),
  referenceScript: z.string(),
  transcript: z.array(itemSchema),
  suggestions: z.array(itemSchema),
  vstEnabled: z.boolean(),
  cuts: z.array(itemSchema).optional(),
  processorChain: z.array(itemSchema).optional(),
})

export type AudioEditDocumentContent = z.infer<typeof audioEditContentSchema>

/**
 * 空内容：还没导入素材，或导入后什么都没做（没有识别、没有剪辑区间、没有参考稿、没有声音处理）。
 * 导入只是引用原文件，不花钱也不产生新文件，这样的草稿离开时直接删除，不询问。
 */
function isEmptyAudioEditContent(content: AudioEditDocumentContent): boolean {
  if (!content.source) return true
  return content.transcript.length === 0
    && !(content.cuts?.length)
    && content.referenceScript.trim().length === 0
    && !(content.processorChain?.length)
}

export const audioEditDocumentKind: DocumentKindDescriptor<AudioEditDocumentContent> = {
  id: 'audio_edit',
  extension: '.henji-audio',
  standaloneFolderNames: { zh: '口播', en: 'Voiceovers' },
  untitledNames: { zh: '未命名口播', en: 'Untitled Voiceover' },
  storage: 'json',
  // 版本 1 = 旧口播工程（audio_edit_projects.document_json）去掉 id / name / createdAt / updatedAt / revision。
  version: 1,
  contentSchema: audioEditContentSchema,
  migrations: {},
  createEmptyContent: () => ({ source: null, referenceScript: '', transcript: [], suggestions: [], vstEnabled: false }),
  isEmptyContent: isEmptyAudioEditContent,
  summarize: (content) => ({
    mediaType: content.source?.mediaType ?? null,
    // 列表卡片显示时长（秒，保留一位小数）
    durationSeconds: content.source
      ? Math.round(content.source.durationFrames / Math.max(1, content.source.sampleRate) * 10) / 10
      : null,
  }),
}
