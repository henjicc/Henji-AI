import { createLogger } from '@/core/logging'
import { fontLibrarySnapshot } from '@/platform/fonts'
import { styleKitSchema, type StyleKit } from '@/core/videoEdit/styleKit'
import { availableStyleKitFonts } from '@/core/videoEdit/styleKitPresets'
import { titleTemplateSchema, type TitleTemplate } from '@/core/videoEdit/titleTemplates'
import { VIDEO_EDIT_TRANSITION_PRESETS, type VideoEditTransitionKind } from '@/core/videoEdit/transitions'
import type { VideoEditEffectPreset } from '@/core/videoEdit/effectPresets'
import { VIDEO_EDIT_PRESET_CATEGORIES, VIDEO_EDIT_PRESET_CATEGORY_LABELS, VIDEO_EDIT_PRESET_PACKAGE_VERSION, videoEditPresetPackageSchema, type VideoEditPresetCategory, type VideoEditPresetPackageItem } from '@/core/videoEdit/presetPackage'
import { videoEditStyleKitLibrary } from './videoEditStyleKitLibrary'
import { listTitleTemplates, useTitleTemplateLibrary } from './videoEditTitleTemplateLibrary'
import { listVideoEditSubtitlePresets, STYLE_SUBTITLE_PRESET_ID, type VideoEditSubtitlePreset } from './videoEditSubtitlePresets'
import { videoEditTextPresetLibrary } from './videoEditTextPresets'
import { useVideoEditEffectLibraryStore } from './videoEditEffectPresets'
import { videoEditPresetPreferences } from './videoEditPresetPreferences'

const logger = createLogger('features.videoEdit.presetCatalog')
/** What a preset previews and applies with; one resolver for the panel, the assistant entity and export. */
export type VideoEditPresetSource =
  | { category: 'style'; kit: StyleKit }
  | { category: 'title'; template: TitleTemplate }
  | { category: 'text'; preset: VideoEditSubtitlePreset }
  | { category: 'effect'; preset: VideoEditEffectPreset }
  | { category: 'transition'; kind: VideoEditTransitionKind }
export interface VideoEditPresetEntry {
  category: VideoEditPresetCategory; id: string; name: string; meta: string
  builtin: boolean; rating: number; isDefault: boolean
  /** The best-liked preset the user has not made default; at most one per category. */
  recommended: boolean
}
interface Raw { id: string; name: string; meta: string; builtin: boolean }
function raw(category: VideoEditPresetCategory): Raw[] {
  switch (category) {
    case 'style': return videoEditStyleKitLibrary.list().map(kit => ({ id: kit.id, name: kit.name, meta: kit.profile.scenarios.join('、') || kit.profile.summary, builtin: kit.id.startsWith('builtin:') }))
    case 'title': return listTitleTemplates().map(template => ({ id: template.id, name: template.name, meta: template.content ? '自建组合' : '内置', builtin: template.id.startsWith('title:') }))
    case 'text': return [{ id: STYLE_SUBTITLE_PRESET_ID, name: '跟随风格', meta: '按序列风格的字体与配色', builtin: true }, ...listVideoEditSubtitlePresets().map(preset => ({ id: preset.id, name: preset.name, meta: preset.id.startsWith('builtin:') ? '字幕' : '个人文字样式', builtin: preset.id.startsWith('builtin:') }))]
    case 'effect': return useVideoEditEffectLibraryStore.getState().presets.map(preset => ({ id: preset.id, name: preset.name, meta: `${preset.media === 'video' ? '画面' : '声音'} · ${preset.effects.length} 个效果`, builtin: false }))
    case 'transition': return VIDEO_EDIT_TRANSITION_PRESETS.filter(preset => preset.medium === 'video').map(preset => ({ id: preset.kind, name: preset.name, meta: preset.tooltip, builtin: true }))
  }
}
/** Default first, then by liking; ties keep the library order so built-ins stay predictable. */
export function listVideoEditPresets(category: VideoEditPresetCategory): VideoEditPresetEntry[] {
  const defaultId = videoEditPresetPreferences.defaultId(category)
  const entries = raw(category).map((value, order) => ({ ...value, category, rating: videoEditPresetPreferences.rating(category, value.id), isDefault: value.id === defaultId, recommended: false, order }))
  entries.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.rating - a.rating || a.order - b.order)
  const best = entries.find(entry => !entry.isDefault && entry.rating > 0 && entry.rating === Math.max(...entries.filter(value => !value.isDefault).map(value => value.rating)))
  if (best) best.recommended = true
  return entries.map(({ order: _order, ...entry }) => entry)
}
export function listAllVideoEditPresets(): VideoEditPresetEntry[] { return VIDEO_EDIT_PRESET_CATEGORIES.flatMap(listVideoEditPresets) }
/** The preset new work should start from: the default, otherwise the best-liked one; undefined when nothing is set or rated. */
export function preferredVideoEditPreset(category: VideoEditPresetCategory): VideoEditPresetEntry | undefined {
  const entries = listVideoEditPresets(category)
  return entries.find(entry => entry.isDefault) ?? entries.find(entry => entry.recommended)
}
export function requireVideoEditPreset(category: VideoEditPresetCategory, id: string): VideoEditPresetEntry {
  const entry = listVideoEditPresets(category).find(value => value.id === id)
  if (!entry) throw new Error(`NOT_FOUND：这个${VIDEO_EDIT_PRESET_CATEGORY_LABELS[category]}预设已删除，请重新选择。`)
  return entry
}
export function videoEditPresetSource(category: VideoEditPresetCategory, id: string): VideoEditPresetSource {
  requireVideoEditPreset(category, id)
  switch (category) {
    case 'style': { const kit = videoEditStyleKitLibrary.list().find(value => value.id === id)!; return { category, kit: kit.id.startsWith('builtin:') ? availableStyleKitFonts(kit, fontLibrarySnapshot().faces) : kit } }
    case 'title': return { category, template: listTitleTemplates().find(value => value.id === id)! }
    case 'text': return { category, preset: id === STYLE_SUBTITLE_PRESET_ID ? { id, name: '跟随风格', style: listVideoEditSubtitlePresets()[0].style } : listVideoEditSubtitlePresets().find(value => value.id === id)! }
    case 'effect': return { category, preset: useVideoEditEffectLibraryStore.getState().presets.find(value => value.id === id)! }
    case 'transition': return { category, kind: id as VideoEditTransitionKind }
  }
}
export function setVideoEditPresetRating(category: VideoEditPresetCategory, id: string, rating: number): void { requireVideoEditPreset(category, id); videoEditPresetPreferences.setRating(category, id, rating) }
export function setVideoEditPresetDefault(category: VideoEditPresetCategory, id: string | null): void { if (id) requireVideoEditPreset(category, id); videoEditPresetPreferences.setDefault(category, id) }
/** Only personal presets can be deleted; projects keep their own snapshots of anything already applied. */
export function deleteVideoEditPreset(category: VideoEditPresetCategory, id: string): void {
  const entry = requireVideoEditPreset(category, id)
  if (entry.builtin) throw new Error('内置预设不能删除。')
  logger.info('preset.delete.start', '删除个人预设', { context: { category } })
  if (category === 'style') videoEditStyleKitLibrary.remove(id)
  else if (category === 'title') useTitleTemplateLibrary.getState().replace(useTitleTemplateLibrary.getState().templates.filter(template => template.id !== id))
  else if (category === 'text') videoEditTextPresetLibrary.remove(id)
  else if (category === 'effect') useVideoEditEffectLibraryStore.getState().deletePreset(id)
  videoEditPresetPreferences.forget(category, id)
  logger.info('preset.delete.completed', '个人预设已删除', { context: { category } })
}
function packageItem(category: VideoEditPresetCategory, id: string): VideoEditPresetPackageItem {
  const source = videoEditPresetSource(category, id)
  switch (source.category) {
    case 'style': return { category: 'style', preset: source.kit }
    case 'title': return { category: 'title', preset: source.template }
    case 'text': if (source.preset.id === STYLE_SUBTITLE_PRESET_ID) throw new Error('“跟随风格”随序列风格变化，不能导出；请导出风格本身。'); { const { bottomMargin: _margin, ...style } = source.preset.style; return { category: 'text', preset: { id: source.preset.id, name: source.preset.name, style } } }
    case 'effect': return { category: 'effect', preset: source.preset }
    case 'transition': throw new Error('内置转场不需要导出。')
  }
}
export function videoEditPresetExportable(category: VideoEditPresetCategory, id: string): boolean { return category !== 'transition' && id !== STYLE_SUBTITLE_PRESET_ID }
/** Serialized exchange file (pretty JSON) for one or more presets. */
export function exportVideoEditPresetPackage(refs: ReadonlyArray<{ category: VideoEditPresetCategory; id: string }>): string {
  const value = videoEditPresetPackageSchema.parse({ format: 'henji-video-presets', version: VIDEO_EDIT_PRESET_PACKAGE_VERSION, items: refs.map(ref => packageItem(ref.category, ref.id)) })
  return `${JSON.stringify(value, null, 2)}\n`
}
const unique = (name: string, taken: readonly string[]): string => { if (!taken.includes(name)) return name; let index = 2; while (taken.includes(`${name} ${index}`)) index++; return `${name} ${index}` }
/** Adds every item as a new personal preset (fresh ids, “名称 2” on a clash); ratings and defaults are not carried over. */
export function importVideoEditPresetPackage(text: string): Array<{ category: VideoEditPresetCategory; id: string; name: string }> {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('这个文件不是可读取的预设文件。') }
  const result = videoEditPresetPackageSchema.safeParse(parsed)
  if (!result.success) throw new Error('这个文件不是痕迹AI剪辑预设，或来自更新的版本。')
  logger.info('preset.import.start', '导入剪辑预设', { context: { count: result.data.items.length } })
  const added: Array<{ category: VideoEditPresetCategory; id: string; name: string }> = []
  for (const item of result.data.items) {
    const taken = raw(item.category).map(value => value.name)
    if (item.category === 'style') { const kit = videoEditStyleKitLibrary.save(styleKitSchema.parse({ ...item.preset, name: unique(item.preset.name, taken) })); added.push({ category: 'style', id: kit.id, name: kit.name }) }
    else if (item.category === 'title') { const template = titleTemplateSchema.parse({ ...item.preset, id: crypto.randomUUID(), name: unique(item.preset.name, taken) }); useTitleTemplateLibrary.getState().replace([...useTitleTemplateLibrary.getState().templates, template]); added.push({ category: 'title', id: template.id, name: template.name }) }
    else if (item.category === 'text') { const preset = videoEditTextPresetLibrary.save(unique(item.preset.name, taken), item.preset.style); added.push({ category: 'text', id: preset.id, name: preset.name }) }
    else { const [preset] = useVideoEditEffectLibraryStore.getState().importPresets([{ ...item.preset, name: unique(item.preset.name, taken) }]); added.push({ category: 'effect', id: preset.id, name: preset.name }) }
  }
  logger.info('preset.import.completed', '剪辑预设已导入', { context: { count: added.length } })
  return added
}
/** Bounded assistant hint: per category the default and the best-liked preset, so “加个标题” uses what the user likes. */
export function videoEditPresetHostSummary(): string {
  const parts = VIDEO_EDIT_PRESET_CATEGORIES.flatMap(category => {
    const entries = listVideoEditPresets(category); const preferred = entries.find(entry => entry.isDefault); const liked = entries.find(entry => entry.recommended)
    if (!preferred && !liked) return []
    return [`${VIDEO_EDIT_PRESET_CATEGORY_LABELS[category]}：${[preferred && `默认“${preferred.name}”`, liked && `最喜欢“${liked.name}”（${liked.rating} 星）`].filter(Boolean).join('，')}`]
  })
  return parts.length ? `${parts.join('；')}。用户没有指定时优先用默认，没有默认就推荐最喜欢的并说明；评分与默认在 video_edit.preset 读写。` : '用户还没有设默认或给预设评分；可列出 video_edit.preset 了解可用预设。'
}
