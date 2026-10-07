import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { createJSONStorage } from 'zustand/middleware'
import { z } from 'zod'
import { createLogger } from '@/core/logging'
import { VIDEO_EDIT_SUBTITLE_PRESETS, videoEditSubtitleStyleSchema, type VideoEditSubtitleStyle } from '@/core/videoEdit/subtitleStyle'
import { styleVideoEditSubtitles } from './videoEditAutoSubtitles'
import { publishVideoEdit } from './videoEditService'

const logger = createLogger('features.videoEdit.subtitlePresets')
const presetSchema = z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1, '请填写预设名称。').max(200), style: videoEditSubtitleStyleSchema }).strict()
export type VideoEditSubtitlePreset = z.infer<typeof presetSchema>
const librarySchema = z.object({ presets: z.array(presetSchema) }).strict()
interface LibraryData { presets: VideoEditSubtitlePreset[] }
interface LibraryState extends LibraryData {
  revision: number
  loadError: string
  savePreset(name: string, style: VideoEditSubtitleStyle): VideoEditSubtitlePreset
  deletePreset(id: string): void
}
interface SettingsStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export const VIDEO_EDIT_SUBTITLE_LIBRARY_STORAGE_KEY = 'video-edit-subtitle-library'

/** Same local settings envelope and write-before-publication contract as the 4.15 effects library. */
export function createVideoEditSubtitleLibraryStore(storage?: SettingsStorage): UseBoundStore<StoreApi<LibraryState>> {
  const json = createJSONStorage<LibraryData>(() => storage ?? localStorage)
  let initial: LibraryData = { presets: [] }; let loadError = ''
  try {
    const saved = json?.getItem(VIDEO_EDIT_SUBTITLE_LIBRARY_STORAGE_KEY)
    if (saved && !('then' in saved)) {
      if (saved.version !== 1) throw new Error('字幕预设格式无法读取。')
      initial = librarySchema.parse(saved.state)
      if (new Set(initial.presets.map(preset => preset.id)).size !== initial.presets.length || initial.presets.some(preset => preset.id.startsWith('builtin:'))) throw new Error('字幕预设标识重复。')
    }
  } catch (error) { loadError = '字幕预设读取失败，已保留原数据；请重启应用后重试。'; initial = { presets: [] }; logger.error('字幕预设读取失败', { event: 'video_edit.subtitle_presets.load.failed', error }) }
  return create<LibraryState>((set, get) => {
    const publish = (next: LibraryData): void => {
      logger.info('保存字幕预设', { event: 'video_edit.subtitle_presets.save.start' })
      try {
        if (loadError) throw new Error(loadError)
        if (!json) throw new Error('本机预设存储不可用。')
        const result = json.setItem(VIDEO_EDIT_SUBTITLE_LIBRARY_STORAGE_KEY, { state: librarySchema.parse(next), version: 1 })
        if (result && typeof result === 'object' && 'then' in result) throw new Error('字幕预设需要同步的本机设置存储。')
        set({ ...next, revision: get().revision + 1 })
        publishVideoEdit(true)
        logger.info('字幕预设已保存', { event: 'video_edit.subtitle_presets.save.completed' })
      } catch (error) { logger.error('字幕预设保存失败', { event: 'video_edit.subtitle_presets.save.failed', error }); throw error }
    }
    return {
      ...initial, revision: 0, loadError,
      savePreset(name, style) {
        const preset = presetSchema.parse({ id: crypto.randomUUID(), name, style })
        publish({ presets: [...get().presets, preset] }); return structuredClone(preset)
      },
      deletePreset(id) {
        if (!get().presets.some(preset => preset.id === id)) throw new Error('原预设已删除，请重新选择。')
        publish({ presets: get().presets.filter(preset => preset.id !== id) })
      },
    }
  })
}
export const useVideoEditSubtitleLibraryStore = createVideoEditSubtitleLibraryStore()
export function listVideoEditSubtitlePresets(): VideoEditSubtitlePreset[] { return structuredClone([...VIDEO_EDIT_SUBTITLE_PRESETS, ...useVideoEditSubtitleLibraryStore.getState().presets]) }
export function applyVideoEditSubtitlePreset(projectId: string, sequenceId: string, presetId: string, ids?: readonly string[]): void {
  const preset = listVideoEditSubtitlePresets().find(preset => preset.id === presetId)
  if (!preset) throw new Error('原预设已删除，请重新选择。')
  styleVideoEditSubtitles(projectId, sequenceId, preset.style, ids)
}
