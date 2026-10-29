import { z } from 'zod'
import { SOUND_LIBRARY_IPC_CHANNELS } from '../../../src/platform/contracts/soundLibrary'
import { getSoundLibraryService } from '../services/sound-library/runtime'
import { parseVoid, registerIpcHandler } from './registry'

/*
 * 音效库 IPC：渲染层经 preload `henjiNative.soundLibrary` → PAL `SoundLibraryPlatform`
 * → `src/commands/soundLibrary.ts` 调用。登记文件夹可直接给路径，不给时由主进程弹出系统选择框；
 * 之后按文件夹 / 音效 ID 引用。状态变化经 `soundLibrary:changed` 推给所有窗口。
 */

const id = z.string().min(1).max(200)
const searchSchema = z.object({
  keywords: z.array(z.string().min(1).max(80)),
  description: z.string().min(1).max(300).optional(),
  folderIds: z.array(id).optional(),
  minDurationSeconds: z.number().nonnegative().optional(),
  maxDurationSeconds: z.number().positive().optional(),
  maxHitSeconds: z.number().nonnegative().optional(),
  brightness: z.enum(['dark', 'neutral', 'bright']).optional(),
  limit: z.number().int().min(1),
}).strict()

export function registerSoundLibraryIpc(): void {
  const c = SOUND_LIBRARY_IPC_CHANNELS
  registerIpcHandler(c.getState, parseVoid, () => getSoundLibraryService().getState())
  registerIpcHandler(c.addFolder, value => value === undefined ? undefined : z.object({ path: z.string().min(1).max(4096).optional() }).strict().parse(value).path, folderPath => getSoundLibraryService().addFolder(folderPath))
  registerIpcHandler(c.removeFolder, value => z.object({ id }).strict().parse(value).id, folderId => getSoundLibraryService().removeFolder(folderId))
  registerIpcHandler(c.refresh, value => z.object({ folderIds: z.array(id).optional() }).strict().parse(value).folderIds, folderIds => getSoundLibraryService().refresh(folderIds))
  registerIpcHandler(c.search, value => searchSchema.parse(value), request => getSoundLibraryService().search(request))
  registerIpcHandler(c.listSounds, value => z.object({ offset: z.number().int().nonnegative(), limit: z.number().int().min(1) }).strict().parse(value), ({ offset, limit }) => getSoundLibraryService().listSounds(offset, limit))
  registerIpcHandler(c.locate, value => z.object({ id }).strict().parse(value).id, soundId => getSoundLibraryService().locate(soundId))
}
