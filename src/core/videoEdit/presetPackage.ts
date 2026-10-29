import { z } from 'zod'
import { styleKitMigrationSchema, titleTemplateMigrationSchema } from './styles/styleTemplateMigration'
import { videoEditEffectPresetSchema } from './effectPresets'
import { videoEditTextPresetSchema } from '../persistence/storedSchemas'
import { henjiExtension } from '../fileExtensions'

/** Preset kinds the preset panel manages; transitions are built-in only, the rest also have personal libraries. */
export const VIDEO_EDIT_PRESET_CATEGORIES = ['style', 'title', 'text', 'effect', 'transition'] as const
export type VideoEditPresetCategory = typeof VIDEO_EDIT_PRESET_CATEGORIES[number]
export const VIDEO_EDIT_PRESET_CATEGORY_LABELS: Record<VideoEditPresetCategory, string> = { style: '风格', title: '标题', text: '文字', effect: '效果', transition: '转场' }
/**
 * 预设面板管理的类别。风格与标题（style/title）2026-10-22 起由风格库与模板接管：类别值仍留在偏好与旧预设文件里
 * （风格默认值继续存在偏好的 style 类别下），面板与 video_edit.preset 不再列出。
 */
export const VIDEO_EDIT_PRESET_PANEL_CATEGORIES = ['text', 'effect', 'transition'] as const satisfies readonly VideoEditPresetCategory[]
export type VideoEditPresetPanelCategory = typeof VIDEO_EDIT_PRESET_PANEL_CATEGORIES[number]
/** Categories whose default changes what new work starts from (effects have no single default). */
export const VIDEO_EDIT_PRESET_DEFAULTABLE: readonly VideoEditPresetCategory[] = ['style', 'title', 'text', 'transition']
export const VIDEO_EDIT_PRESET_MAX_RATING = 5

const category = z.enum(VIDEO_EDIT_PRESET_CATEGORIES)
/** Per-preset user preference: a 0–5 liking (0 = not rated) and whether it is the category default. */
export const videoEditPresetPreferenceSchema = z.object({
  category, id: z.string().min(1).max(200),
  rating: z.number().int().min(0).max(VIDEO_EDIT_PRESET_MAX_RATING).default(0).describe('喜爱程度 0–5，0 表示未评分。'),
  isDefault: z.boolean().default(false),
}).strict()
export type VideoEditPresetPreference = z.infer<typeof videoEditPresetPreferenceSchema>
export const videoEditPresetPreferencesSchema = z.array(videoEditPresetPreferenceSchema).superRefine((values, context) => {
  if (new Set(values.map(value => `${value.category}:${value.id}`)).size !== values.length) context.addIssue({ code: 'custom', message: '预设偏好重复。' })
  for (const name of VIDEO_EDIT_PRESET_CATEGORIES) if (values.filter(value => value.category === name && value.isDefault).length > 1) context.addIssue({ code: 'custom', message: '每类预设只能有一个默认。' })
})

/** One exchange file may carry presets of several kinds; ids are replaced on import. */
export const VIDEO_EDIT_PRESET_PACKAGE_VERSION = 8
export const videoEditPresetPackageItemSchema = z.discriminatedUnion('category', [
  // 风格与标题条目只出现在 2026-10-22 之前导出的文件里，导入时转成新的风格与原生模板；新导出不再写这两类。
  z.object({ category: z.literal('style'), preset: styleKitMigrationSchema }).strict(),
  z.object({ category: z.literal('title'), preset: titleTemplateMigrationSchema }).strict(),
  z.object({ category: z.literal('text'), preset: videoEditTextPresetSchema }).strict(),
  z.object({ category: z.literal('effect'), preset: videoEditEffectPresetSchema }).strict(),
])
export type VideoEditPresetPackageItem = z.infer<typeof videoEditPresetPackageItemSchema>
export const videoEditPresetPackageSchema = z.object({
  format: z.literal('henji-video-presets'), version: z.literal(VIDEO_EDIT_PRESET_PACKAGE_VERSION),
  items: z.array(videoEditPresetPackageItemSchema).min(1),
}).strict()
export type VideoEditPresetPackage = z.infer<typeof videoEditPresetPackageSchema>
export const VIDEO_EDIT_PRESET_PACKAGE_EXTENSION = henjiExtension('preset_package').slice(1)
