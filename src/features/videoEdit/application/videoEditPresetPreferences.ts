import { useSettingsStore } from '@/stores/settingsStore'
import { VIDEO_EDIT_DEFAULT_TRANSITIONS, type VideoEditTransitionKind } from '@/core/videoEdit/transitions'
import { VIDEO_EDIT_PRESET_MAX_RATING, VIDEO_EDIT_PRESET_DEFAULTABLE, videoEditPresetPreferencesSchema, type VideoEditPresetCategory, type VideoEditPresetPreference } from '@/core/videoEdit/presetPackage'
import { VideoEditLocalLibrary } from './videoEditLocalLibrary'
import { publishVideoEdit } from './videoEditService'

export const PRESET_PREFERENCES_STORAGE_KEY = 'video-edit-preset-preferences'
/**
 * Ratings and defaults for every preset kind live in one place. The video-transition default is the existing
 * “default transition” setting, so the preset panel and the effects panel can never disagree.
 */
export class VideoEditPresetPreferences extends VideoEditLocalLibrary<VideoEditPresetPreference> {
  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage, publish: () => void = () => publishVideoEdit(true)) {
    super(PRESET_PREFERENCES_STORAGE_KEY, videoEditPresetPreferencesSchema, storage, publish)
  }
  rating(category: VideoEditPresetCategory, id: string): number { return this.custom().find(value => value.category === category && value.id === id)?.rating ?? 0 }
  defaultId(category: VideoEditPresetCategory): string | undefined {
    if (category === 'transition') return useSettingsStore.getState().videoEditDefaultTransitions.video ?? VIDEO_EDIT_DEFAULT_TRANSITIONS.video
    return this.custom().find(value => value.category === category && value.isDefault)?.id
  }
  setRating(category: VideoEditPresetCategory, id: string, rating: number): void {
    if (!Number.isInteger(rating) || rating < 0 || rating > VIDEO_EDIT_PRESET_MAX_RATING) throw new Error(`评分须为 0–${VIDEO_EDIT_PRESET_MAX_RATING} 的整数。`)
    this.write(category, id, value => ({ ...value, rating }))
  }
  /** `null` clears the category default; transitions fall back to the built-in default transition. */
  setDefault(category: VideoEditPresetCategory, id: string | null): void {
    if (!VIDEO_EDIT_PRESET_DEFAULTABLE.includes(category)) throw new Error('这类预设没有默认项。')
    if (category === 'transition') { useSettingsStore.getState().setVideoEditDefaultTransition('video', (id ?? null) as VideoEditTransitionKind | null); publishVideoEdit(true); return }
    const values = this.custom().map(value => value.category === category ? { ...value, isDefault: false } : value)
    if (id) { const index = values.findIndex(value => value.category === category && value.id === id); if (index < 0) values.push({ category, id, rating: 0, isDefault: true }); else values[index] = { ...values[index], isDefault: true } }
    this.replace(values.filter(keep))
  }
  /** A deleted preset leaves no rating or default behind. */
  forget(category: VideoEditPresetCategory, id: string): void { const values = this.custom(); if (values.some(value => value.category === category && value.id === id)) this.replace(values.filter(value => !(value.category === category && value.id === id))) }
  private write(category: VideoEditPresetCategory, id: string, update: (value: VideoEditPresetPreference) => VideoEditPresetPreference): void {
    const values = this.custom(); const index = values.findIndex(value => value.category === category && value.id === id)
    const next = update(index < 0 ? { category, id, rating: 0, isDefault: false } : values[index])
    if (index < 0) values.push(next); else values[index] = next
    this.replace(values.filter(keep))
  }
}
const keep = (value: VideoEditPresetPreference): boolean => value.rating > 0 || value.isDefault
export const videoEditPresetPreferences = new VideoEditPresetPreferences()
