import { z } from 'zod'
import { PersistenceError } from '@/core/persistence/migrations'
import { createLogger } from '@/core/logging'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { VIDEO_EDIT_EXPORT_PRESETS, videoEditExportPresetSchema, type VideoEditExportPreset, type VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import { publishVideoEdit } from './videoEditService'
import { localLibraryContract, readLocalPersistenceJson, serializeVersionedPersistenceJson } from '@/core/persistence/versionedJson'

const logger = createLogger('features.videoEdit.exportPresets')
export const VIDEO_EDIT_EXPORT_PRESETS_KEY = 'video-edit-export-presets'
const librarySchema = z.array(videoEditExportPresetSchema)
export class VideoEditExportPresetLibrary {
  private presets: VideoEditExportPreset[] = []
  private error = ''
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage) {
    try {
      const saved = storage?.getItem(VIDEO_EDIT_EXPORT_PRESETS_KEY)
      if (saved !== null && saved !== undefined && storage) {
        this.presets = librarySchema.parse(readLocalPersistenceJson(saved, VIDEO_EDIT_EXPORT_PRESETS_KEY, localLibraryContract(VIDEO_EDIT_EXPORT_PRESETS_KEY, librarySchema), storage))
        if (new Set(this.presets.map(value => value.id)).size !== this.presets.length || this.presets.some(value => value.id.startsWith('builtin:'))) throw new Error('预设标识重复。')
      }
    } catch (error) { this.presets = []; this.error = error instanceof PersistenceError ? error.message : '本机导出预设读取失败，原数据已保留；请重启后重试。'; logger.error('读取导出预设失败', { event: 'video_edit.export_presets.load.failed', error }) }
  }
  list(): VideoEditExportPreset[] { return structuredClone([...VIDEO_EDIT_EXPORT_PRESETS, ...this.presets]) }
  custom(): VideoEditExportPreset[] { return structuredClone(this.presets) }
  replace(values: readonly VideoEditExportPreset[]): void {
    assertApplicationWritesAllowed()
    logger.info('保存导出预设', { event: 'video_edit.export_presets.save.start' })
    try {
      if (this.error) throw new Error(this.error)
      if (!this.storage) throw new Error('本机预设存储不可用。')
      const parsed = librarySchema.parse(values)
      if (parsed.some(value => value.id.startsWith('builtin:')) || new Set(parsed.map(value => value.id)).size !== parsed.length) throw new Error('内置预设不可覆盖，或预设标识重复。')
      this.storage.setItem(VIDEO_EDIT_EXPORT_PRESETS_KEY, serializeVersionedPersistenceJson(localLibraryContract(VIDEO_EDIT_EXPORT_PRESETS_KEY, librarySchema), parsed))
      this.presets = parsed; publishVideoEdit(true)
      logger.info('导出预设已保存', { event: 'video_edit.export_presets.save.completed', context: { count: parsed.length } })
    } catch (error) { logger.error('保存导出预设失败', { event: 'video_edit.export_presets.save.failed', error }); throw error }
  }
  save(name: string, settings: VideoEditExportSettings): VideoEditExportPreset {
    const value = videoEditExportPresetSchema.parse({ id: crypto.randomUUID(), name, settings })
    this.replace([...this.presets, value]); return value
  }
  update(id: string, patch: Partial<Pick<VideoEditExportPreset, 'name' | 'settings'>>): VideoEditExportPreset {
    const previous = this.presets.find(value => value.id === id)
    if (!previous) throw new Error('只能修改本机自定义预设，内置预设不可修改。')
    const next = videoEditExportPresetSchema.parse({ ...previous, ...patch })
    this.replace(this.presets.map(value => value.id === id ? next : value)); return next
  }
  remove(id: string): void {
    if (!this.presets.some(value => value.id === id)) throw new Error('只能删除本机自定义预设，内置预设不可删除。')
    this.replace(this.presets.filter(value => value.id !== id))
  }
}
export const videoEditExportPresetLibrary = new VideoEditExportPresetLibrary()
