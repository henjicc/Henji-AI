import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { createJSONStorage } from 'zustand/middleware'
import { z } from 'zod'
import { createLogger } from '@/core/logging'
import { videoEditEffectSchema, VIDEO_EDIT_MAX_EFFECTS, videoEditEffectMedia, type VideoEditEffect } from '@/core/videoEdit/compositing'
import { isSmartRegionMask } from '@/core/videoEdit/effectMasks'
import { resolveVideoEditEffectTemplate } from '@/core/videoEdit/smartRegionPresets'
import { normalizeVideoEditBuiltinParams, requireVideoEditBuiltinEffect, videoEditBuiltinEffectMedia, videoEditBuiltinRefId } from '@/core/videoEdit/builtinEffects'
import { VIDEO_EDIT_EFFECT_CATEGORIES, videoEditEffectsRegistry, type VideoEditEffectsRegistryEntry } from '@/core/videoEdit/effectsRegistry'

const logger = createLogger('features.videoEdit.presets')
const nameSchema = z.string().trim().min(1, '请填写预设名称。').max(200, '预设名称最多 200 字。')
export const videoEditEffectPresetSchema = z.object({
  id: z.string().min(1).max(100), name: nameSchema, media: z.enum(['video', 'audio']),
  effects: z.array(videoEditEffectSchema).min(1).max(VIDEO_EDIT_MAX_EFFECTS),
}).strict().superRefine((preset, context) => {
  if (preset.effects.some(effect => !effect.builtin || videoEditEffectMedia(effect) !== preset.media || effect.mask?.regionId === 'tracker' || effect.mask?.regionId === 'shapes' && effect.mask.shapes.some(shape => shape.follow))) context.addIssue({ code: 'custom', message: '预设只保存同媒介的内置效果，不能保存原片段的跟踪绑定；代码滤镜请保存为代码素材。' })
})
export type VideoEditEffectPreset = z.infer<typeof videoEditEffectPresetSchema>
interface LibraryData { favorites: string[]; presets: VideoEditEffectPreset[] }
interface LibraryState extends LibraryData {
  revision: number
  loadError: string
  savePreset(name: string, effects: readonly VideoEditEffect[], includeShapes?: boolean): VideoEditEffectPreset
  renamePreset(id: string, name: string): void
  deletePreset(id: string): void
  toggleFavorite(id: string): void
}
export const VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY = 'video-edit-effects-library'
const dataSchema = z.object({ favorites: z.array(z.string().max(150)), presets: z.array(videoEditEffectPresetSchema) }).strict()
interface SyncSettingsStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** Shared by UI and assistant discovery. The persistence write precedes publication;
 * a full disk/storage failure leaves the previous library intact. */
export function createVideoEditEffectLibraryStore(storage?: SyncSettingsStorage): UseBoundStore<StoreApi<LibraryState>> {
  const json = createJSONStorage<LibraryData>(() => storage ?? localStorage)
  let initial: LibraryData = { favorites: [], presets: [] }
  let loadError = ''
  try {
    const saved = json?.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)
    if (saved && !('then' in saved)) {
      if (saved.version !== 1) throw new Error('效果库格式无法读取。')
      initial = dataSchema.parse(saved.state)
      if (new Set(initial.presets.map(preset => preset.id)).size !== initial.presets.length) throw new Error('预设标识重复。')
      initial.favorites = [...new Set(initial.favorites)]
    }
  } catch (error) { loadError = '效果收藏与预设读取失败，已保留原数据；请重启应用后重试。'; initial = { favorites: [], presets: [] }; logger.error('effect_library.load.failed', '效果收藏与预设读取失败', { error }) }
  return create<LibraryState>((set, get) => {
    const publish = (operation: string, next: LibraryData): void => {
      logger.info(`effect_library.${operation}.start`, '更新本机效果库')
      try {
        if (!json) throw new Error('本机预设存储不可用。')
        if (loadError) throw new Error(loadError)
        const result = json.setItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY, { state: dataSchema.parse(next), version: 1 })
        if (result && typeof result === 'object' && 'then' in result) throw new Error('效果库需要同步的本机设置存储。')
        set({ ...next, revision: get().revision + 1 })
        logger.info(`effect_library.${operation}.completed`, '本机效果库已保存')
      } catch (error) { logger.error(`effect_library.${operation}.failed`, '本机效果库保存失败', { error }); throw error }
    }
    const requirePreset = (id: string): VideoEditEffectPreset => {
      const preset = get().presets.find(value => value.id === id)
      if (!preset) throw new Error('原预设已删除，请重新选择。')
      return preset
    }
    return {
      ...initial, revision: 0, loadError,
      savePreset(name, effects, includeShapes = false) {
        if (!effects.length || effects.some(effect => !effect.builtin)) throw new Error('请选择内置效果；代码滤镜请保存为代码素材。')
        const copies = effects.map(effect => {
          const copy = videoEditEffectSchema.parse(structuredClone(effect))
          // Tracker IDs are scoped to their original clip. Shapes retain geometry only.
          if (copy.mask?.regionId === 'tracker' || copy.mask?.regionId === 'shapes' && !includeShapes) delete copy.mask
          else if (copy.mask?.regionId === 'shapes') copy.mask.shapes.forEach(shape => { delete shape.follow })
          return copy
        })
        const preset = videoEditEffectPresetSchema.parse({ id: crypto.randomUUID(), name, media: videoEditEffectMedia(copies[0]), effects: copies })
        publish('save', { favorites: get().favorites, presets: [...get().presets, preset] })
        return structuredClone(preset)
      },
      renamePreset(id, name) { requirePreset(id); const nextName = nameSchema.parse(name); publish('rename', { favorites: get().favorites, presets: get().presets.map(preset => preset.id === id ? { ...preset, name: nextName } : preset) }) },
      deletePreset(id) { requirePreset(id); publish('delete', { favorites: get().favorites.filter(ref => ref !== `preset:${id}`), presets: get().presets.filter(preset => preset.id !== id) }) },
      toggleFavorite(id) {
        if (!videoEditEffectsRegistry().some(entry => entry.id === id) && !get().presets.some(preset => `preset:${preset.id}` === id)) throw new Error('这个效果或过渡已不可用。')
        publish('favorite', { presets: get().presets, favorites: get().favorites.includes(id) ? get().favorites.filter(value => value !== id) : [...get().favorites, id] })
      },
    }
  })
}
export const useVideoEditEffectLibraryStore = createVideoEditEffectLibraryStore()

/** Creation templates share the same effect application path for builtins, smart presets and saved combinations. */
export function resolveVideoEditLibraryEffects(ref: string): { media: 'video' | 'audio'; effects: Omit<VideoEditEffect, 'id'>[]; needsSource: boolean } | undefined {
  if (ref.startsWith('preset:')) {
    const preset = useVideoEditEffectLibraryStore.getState().presets.find(value => `preset:${value.id}` === ref)
    return preset && { media: preset.media, effects: structuredClone(preset.effects), needsSource: preset.effects.some(effect => isSmartRegionMask(effect.mask)) }
  }
  const template = resolveVideoEditEffectTemplate(ref)
  if (!template) return undefined
  return { media: videoEditBuiltinEffectMedia(template.builtinId), effects: [{ name: template.name ?? requireVideoEditBuiltinEffect(template.builtinId).name, enabled: true, amount: 1, builtin: { id: template.builtinId, params: normalizeVideoEditBuiltinParams(template.builtinId, template.params) }, ...(template.mask ? { mask: template.mask } : {}) }], needsSource: Boolean(template.mask) }
}
export type VideoEditLibraryEntry = Omit<VideoEditEffectsRegistryEntry, 'category'> & { category: VideoEditEffectsRegistryEntry['category'] | 'presets'; aliases?: readonly string[] }
export function videoEditUserPresetEntries(presets: readonly VideoEditEffectPreset[]): VideoEditLibraryEntry[] {
  return presets.map(preset => ({ id: `preset:${preset.id}`, templateRef: `preset:${preset.id}`, name: preset.name, category: 'presets', kind: 'effect', media: preset.media, tooltip: preset.media === 'audio' ? '将已保存的效果组合加到声音片段' : '将已保存的效果组合加到画面片段', description: preset.effects.map(effect => `${effect.name} ${effect.builtin?.id}`).join(' '), aliases: preset.effects.map(effect => effect.builtin?.id.replaceAll('_', ' ') ?? '') }))
}
/** Whitespace-separated keywords must all match; accents/case and English IDs are normalized. */
export function filterVideoEditLibraryEntries(entries: readonly VideoEditLibraryEntry[], query: string, folderName = ''): VideoEditLibraryEntry[] {
  const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase()
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  return entries.filter(entry => {
    const category = VIDEO_EDIT_EFFECT_CATEGORIES.find(category => category.id === entry.category)?.name ?? '预设'
    const text = normalize([entry.name, entry.description, category, folderName, entry.category === 'presets' ? `${entry.media === 'audio' ? '音频' : '视频'}预设` : '', entry.group, entry.builtinId?.replaceAll('_', ' '), entry.transitionKind?.replaceAll('_', ' '), ...(entry.aliases ?? [])].join(' '))
    return words.every(word => text.includes(word))
  })
}
export function videoEditPresetCreationProperties(preset: VideoEditEffectPreset): Array<Record<string, unknown>> {
  return preset.effects.map(effect => ({ 'video_edit.effect.definition_id': videoEditBuiltinRefId(effect.builtin!.id), 'video_edit.effect.parameters': structuredClone(effect.builtin!.params), 'video_edit.effect.name': effect.name, 'video_edit.effect.enabled': effect.enabled, 'video_edit.effect.amount': effect.amount, ...(effect.mask ? { 'video_edit.effect.mask': structuredClone(effect.mask) } : {}) }))
}
