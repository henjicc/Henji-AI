import { migrateAudioMergedEffects, migrateAudioEqualizerModes } from '../../audio/effects/mergedEffectsMigration'
import { z } from 'zod'
import { audioEditGainRegionsSchema, audioEditRepairsSchema } from '../../audioEdit/regions'
import { audioEditOutputSchema, migrateAudioEditEffectsToChain } from '../../audioEdit/effects'

import { henjiExtension, henjiLegacyExtensions } from '../../fileExtensions'
import type { DocumentKindDescriptor } from './registry'

/*
 * 口播（`.hjaud`，3.3 口播接入）：可以独立存放（作品目录“口播”文件夹），也可以放进项目。
 *
 * 内容 = 口播剪辑工程去掉外壳字段（ID、名称、创建 / 修改时间、版本由文档外壳表达）后的部分，内存形态、位置都是绝对路径：
 * - source：导入的音频或视频（默认引用原文件，重要记录 006）；新建空文档（如助手 create_document）为 null，
 *   打开时由界面请用户导入；
 * - referenceScript / transcript / suggestions / cuts：参考稿、识别词块、剪辑线索与声音编辑区间；
 * - editBaseline：第一次识别得到的原文（“撤销全部修改”的依据）；
 * - effectChain / chainBypassed / output：效果控件（有顺序的效果链，从上到下处理录音本身）与作用在成品上的输出一节；
 * - batchSettings / xmlFrameRate / viewSettings / selectedAsrModelId：粗剪与显示设置。
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
  cuts: z.array(itemSchema).optional(),
  gainRegions: audioEditGainRegionsSchema.optional(), repairs: audioEditRepairsSchema.optional(),
  effectChain: z.array(z.looseObject({ id: z.string().min(1), kind: z.string().min(1) })).optional(),
  chainBypassed: z.boolean().optional(),
  output: audioEditOutputSchema.optional(),
})

export type AudioEditDocumentContent = z.infer<typeof audioEditContentSchema>

/**
 * 空内容：还没导入素材，或导入后什么都没做（没有识别、没有剪辑区间、没有参考稿、没有声音处理）。
 * 导入只是引用原文件，不花钱也不产生新文件，这样的草稿离开时直接删除，不询问。
 */
function isEmptyAudioEditContent(content: AudioEditDocumentContent): boolean {
  if (!content.source) return true
  if (content.source.ownership === 'managed') return false
  return content.transcript.length === 0
    && !(content.cuts?.length)
    && !(content.gainRegions?.length) && !(content.repairs?.length)
    && content.referenceScript.trim().length === 0
    && !(content.effectChain?.length) && !content.output
}

export const audioEditDocumentKind: DocumentKindDescriptor<AudioEditDocumentContent> = {
  id: 'audio_edit',
  extension: henjiExtension('audio_edit'),
  legacyExtensions: henjiLegacyExtensions('audio_edit'),
  standaloneFolderNames: { zh: '口播', en: 'Voiceovers' },
  untitledNames: { zh: '未命名音频', en: 'Untitled Audio' },
  storage: 'json',
  // 版本 1 = 旧口播工程（audio_edit_projects.document_json）去掉 id / name / createdAt / updatedAt / revision。
  // 版本 2 = 新增可选的音量区域与修复记录；版本 3 = 修复画笔笔画新增可选的纵向半径 radiusY；
  // 版本 4 = 新增可选的效果组（effects / effectsBypassed）、基本声音（essentialSound）与口水音修复（mouthClicks）。都只加可选字段，旧文件原样可读。
  // 版本 5（2026-10-26 效果控件重构）= 效果组、基本声音、口水音修复、VST3 插件链合成一条有序效果链（effectChain），
  // 音量与自动匹配响度移到 output；去掉了旧程序必填的 vstEnabled，所以旧程序不能再读（minReaderVersion 5，用户已确认）。
  // 版本 6 = 去除口水音新增可选的 skipped（用户关掉、不处理的位置），只加可选字段，最低可读版本不变。
  // 版本 8 = source 新增可选的采样指纹 fingerprint（外部素材导入、重新定位时写）；应用写出的拼接结果写整文件 SHA-256 的 identity。
  // 最低可读版本提到 8：版本 7 及以前的程序按严格结构解析 source，遇到 fingerprint 会解析失败而不是忽略。
  // 后果：被版本 8 的程序打开并保存过的 .hjaud，旧版程序打不开（提示“请升级”，不会当成损坏）。发生在 2.0 正式版之前。
  // 同一版本起 source 保留不认识的字段（宽松结构），以后再给 source 加可选字段只升版本、不再提高最低可读版本。
  // 版本 9 = 顶层新增可选的 suggestionHandoff（本地粗剪交给助手二次判断的材料，按线索 ID 存）。
  // 版本 8 的程序把不认识的顶层字段原样带回，所以最低可读版本不变。
  // 版本 10 = 参考稿 referenceScript 去掉 20 万字上限。版本 9 及以前的程序遇到超过 20 万字的参考稿会校验失败，
  // 所以只有这样的文件写最低可读版本 10，其余仍写 8。
  version: 10,
  minReaderVersion: 10,
  minReaderVersionFor: (content) => content.referenceScript.length > 200000 ? 10 : 8,
  contentSchema: audioEditContentSchema,
  migrations: {
    // 6 → 7：音频效果合并、均衡方式拆分并保留声音身份别名；旧程序无法理解新效果，最低可读版本同步提高。
    6: content => migrateAudioEqualizerModes(migrateAudioMergedEffects(content)), 1: (content) => structuredClone(content), 2: (content) => structuredClone(content), 3: (content) => structuredClone(content), 4: (content) => migrateAudioEditEffectsToChain(content as Record<string, unknown>) as AudioEditDocumentContent, 5: (content) => structuredClone(content),
    // 7 → 8：只新增可选的 source.fingerprint；旧素材的 identity 原样保留，派生缓存键照旧计算。
    7: (content) => structuredClone(content),
    // 8 → 9：只新增可选的顶层 suggestionHandoff。
    8: (content) => structuredClone(content),
    // 9 → 10：只放宽参考稿长度，内容不变。
    9: (content) => structuredClone(content) },
  createEmptyContent: () => ({ source: null, referenceScript: '', transcript: [], suggestions: [] }),
  isEmptyContent: isEmptyAudioEditContent,
  summarize: (content) => ({
    mediaType: content.source?.mediaType ?? null,
    // 列表卡片显示时长（秒，保留一位小数）
    durationSeconds: content.source
      ? Math.round(content.source.durationFrames / Math.max(1, content.source.sampleRate) * 10) / 10
      : null,
  }),
}
