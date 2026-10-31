import { getPlatform } from '@/platform/runtime'
import { subscribeRestored } from '@/services/recycle'
import { storedVideoEditEffectLibrary, storedVideoEditEffectLibrarySchema } from '@/core/videoEdit/effectLibrary'
import { localLibraryContract } from '@/core/persistence/versionedJson'
import { persistenceMinReaderVersion, upgradePersistenceContent } from '@/core/persistence/migrations'
import { readEffectLibrarySources, desktopEffectLibrarySources } from './videoEditEffectLibrarySources'
import type { LibraryData } from './videoEditEffectPresets'
import { createLogger } from '@/core/logging'

const directory = 'video-edit-effect-recovery'
const contract = localLibraryContract('video-edit-effects-library', storedVideoEditEffectLibrarySchema)
const logger = createLogger('features.videoEdit.presets')

/**
 * 回收副本使用已登记的效果库格式，源码仍引用不可变内容存储。
 * 不走 serialize/parseVersionedPersistenceJson：它们按格式记住本机库的前向字段，读写副本会串改正式库的保存。
 * 副本先进回收区再发布删除：中途失败或退出最多多一条可恢复的条目（恢复按内容幂等合并），不会丢风格件。
 */
export async function recycleVideoEditStylePieces(value: LibraryData): Promise<void> {
  logger.info('effect_library.recycle.start', '将风格件移入回收区')
  try {
    const { system, settings } = getPlatform()
    const root = await system.paths.join(await system.paths.appLocalDataDir(), directory)
    const file = await system.paths.join(root, `${crypto.randomUUID()}.json`)
    await system.fs.mkdir(root, { recursive: true })
    await system.fs.writeTextFile(file, JSON.stringify({ version: contract.version, minReaderVersion: persistenceMinReaderVersion(contract), content: storedVideoEditEffectLibrarySchema.parse(storedVideoEditEffectLibrary(value)) }))
    await settings.trashFile(file, value.presets.map(preset => preset.name).join('、'))
    logger.info('effect_library.recycle.completed', '风格件已移入回收区')
  } catch (error) { logger.error('effect_library.recycle.failed', '风格件未能移入回收区', { error }); throw error }
}

export function registerVideoEditStylePieceRestore(restore: (value: LibraryData) => Promise<void>): void {
  subscribeRestored(async item => {
    if (!item.path?.replaceAll('\\', '/').includes(`/${directory}/`)) return
    logger.info('effect_library.restore_recycled.start', '从回收区恢复风格件')
    try {
      const raw: unknown = JSON.parse(await getPlatform().system.fs.readTextFile(item.path))
      if (!raw || typeof raw !== 'object' || !('version' in raw) || typeof raw.version !== 'number' || !('content' in raw)) throw new Error('回收的风格件文件无法读取。')
      const minReader = 'minReaderVersion' in raw && typeof raw.minReaderVersion === 'number' ? raw.minReaderVersion : undefined
      const saved = storedVideoEditEffectLibrarySchema.parse(upgradePersistenceContent(contract, raw.content, raw.version, item.path, minReader))
      await restore(await readEffectLibrarySources(saved, desktopEffectLibrarySources))
      logger.info('effect_library.restore_recycled.completed', '风格件已从回收区恢复')
    } catch (error) {
      logger.error('effect_library.restore_recycled.failed', '风格件未能从回收区恢复，副本已放回回收区', { error })
      // 宿主已经还原文件；领域保存失败时把同一副本送回回收区，保留正式重试入口。
      await getPlatform().settings.trashFile(item.path, item.name)
      throw error
    }
    // 成员已并回效果库，回收副本只是中转文件。
    try { await getPlatform().system.fs.remove(item.path) } catch (error) { logger.warn('effect_library.recycle.cleanup_failed', '已恢复风格件的回收副本未能清理', { error }) }
  })
}
