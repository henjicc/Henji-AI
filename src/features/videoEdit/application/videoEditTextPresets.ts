import { z } from 'zod'
import { videoEditTextPresetSchema } from '@/core/persistence/storedSchemas'
import { type VideoEditTextStyle } from '@/core/videoEdit/text'
import { publishVideoEdit } from './videoEditService'
import { VideoEditLocalLibrary } from './videoEditLocalLibrary'

export { videoEditTextPresetSchema } from '@/core/persistence/storedSchemas'
export type VideoEditTextPreset = z.infer<typeof videoEditTextPresetSchema>
export const VIDEO_EDIT_TEXT_PRESETS_KEY = 'video-edit-text-presets'
const librarySchema = z.array(videoEditTextPresetSchema).superRefine((presets, context) => {
  if (presets.some(preset => preset.id.startsWith('builtin:')) || new Set(presets.map(preset => preset.id)).size !== presets.length) context.addIssue({ code: 'custom', message: '自定义预设标识重复或与内置预设冲突。' })
})
/** One shared persistence boundary for typography, title templates and style kits. */
export class VideoEditTextPresetLibrary extends VideoEditLocalLibrary<VideoEditTextPreset> {
  private revision = 0
  private readonly listeners = new Set<() => void>()
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readonly snapshot = (): number => this.revision
  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage) {
    super(VIDEO_EDIT_TEXT_PRESETS_KEY, librarySchema, storage, () => { this.revision++; for (const listener of this.listeners) listener(); publishVideoEdit(true) })
  }
  list(): VideoEditTextPreset[] { return this.custom() }
  save(name: string, style: VideoEditTextStyle): VideoEditTextPreset {
    const preset = videoEditTextPresetSchema.parse({ id: crypto.randomUUID(), name, style }); this.replace([...this.custom(), preset]); return preset
  }
  update(id: string, patch: Partial<Pick<VideoEditTextPreset, 'name' | 'style'>>): VideoEditTextPreset {
    const presets = this.custom(); const previous = presets.find(preset => preset.id === id)
    if (!previous) throw new Error('只能修改本机自定义预设。')
    const next = videoEditTextPresetSchema.parse({ ...previous, ...patch }); this.replace(presets.map(preset => preset.id === id ? next : preset)); return next
  }
  remove(id: string): void {
    const presets = this.custom()
    if (!presets.some(preset => preset.id === id)) throw new Error('只能删除本机自定义预设。')
    this.replace(presets.filter(preset => preset.id !== id))
  }
}
export const videoEditTextPresetLibrary = new VideoEditTextPresetLibrary()
