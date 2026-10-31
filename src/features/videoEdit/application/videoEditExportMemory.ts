import { videoEditExportMemorySchema, videoEditExportMemoryEntrySchema, type VideoEditExportMemoryEntry } from '@/core/videoEdit/exportMemory'
import { localLibraryContract, readLocalPersistenceJson, serializeVersionedPersistenceJson } from '@/core/persistence/versionedJson'
import { createLogger } from '@/core/logging'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'

const logger = createLogger('features.videoEdit.exportMemory')
export const VIDEO_EDIT_EXPORT_MEMORY_KEY = 'video-edit-export-memory'
export class VideoEditExportMemory {
  private entries: VideoEditExportMemoryEntry[] = []
  private error: unknown
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage) {
    try {
      const saved = storage?.getItem(VIDEO_EDIT_EXPORT_MEMORY_KEY)
      if (saved != null && storage) this.entries = videoEditExportMemorySchema.parse(readLocalPersistenceJson(saved, VIDEO_EDIT_EXPORT_MEMORY_KEY, localLibraryContract(VIDEO_EDIT_EXPORT_MEMORY_KEY, videoEditExportMemorySchema), storage))
    } catch (error) { this.error = error; logger.error('读取上次导出设置失败，保留原记录', { event: 'video_edit.export_memory.load.failed', error }) }
  }
  read(projectId: string, sequenceId: string): VideoEditExportMemoryEntry | undefined {
    if (this.error) throw this.error
    return structuredClone(this.entries.find(value => value.projectId === projectId && value.sequenceId === sequenceId))
  }
  remember(input: VideoEditExportMemoryEntry): void {
    assertApplicationWritesAllowed()
    logger.info('保存上次导出设置', { event: 'video_edit.export_memory.save.start', context: { projectId: input.projectId, sequenceId: input.sequenceId } })
    try {
      if (this.error) throw this.error
      if (!this.storage) throw new Error('本机导出记忆存储不可用。')
      const entry = videoEditExportMemoryEntrySchema.parse(input)
      const entries = [entry, ...this.entries.filter(value => value.projectId !== entry.projectId || value.sequenceId !== entry.sequenceId)]
      this.storage.setItem(VIDEO_EDIT_EXPORT_MEMORY_KEY, serializeVersionedPersistenceJson(localLibraryContract(VIDEO_EDIT_EXPORT_MEMORY_KEY, videoEditExportMemorySchema), entries))
      this.entries = entries
      logger.info('上次导出设置已保存', { event: 'video_edit.export_memory.save.completed', context: { projectId: entry.projectId, sequenceId: entry.sequenceId } })
    } catch (error) { logger.error('保存上次导出设置失败', { event: 'video_edit.export_memory.save.failed', error }); throw error }
  }
}
export const videoEditExportMemory = new VideoEditExportMemory()
