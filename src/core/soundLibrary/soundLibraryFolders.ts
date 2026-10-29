import { z } from 'zod'

/** 登记的音效文件夹（主进程设置表 `sound_library.folders`，带版本戳的 JSON 容器）。 */
export const SOUND_LIBRARY_FOLDERS_VERSION = 2
export const SOUND_LIBRARY_FOLDERS_SETTING_KEY = 'sound_library.folders'
export const soundLibraryFolderRecordSchema = z.object({
  id: z.string().uuid(),
  path: z.string().min(1).max(4096),
  addedAt: z.string().datetime(),
}).strict()
export const soundLibraryFoldersSchema = z.array(soundLibraryFolderRecordSchema)
export type SoundLibraryFolderRecord = z.infer<typeof soundLibraryFolderRecordSchema>
