import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { mapWithConcurrency } from '@/utils/mapWithConcurrency'
import { rewriteAuthorModule, type AuthorModuleUrls } from '../engine/videoEditAuthorModules'

const logger = createLogger('features.videoEdit.nativeModules')

/** 只为循环图提供预先确定的地址。复用 PAL 临时文件和现有协议，不改项目或原始源码。 */
export async function prepareVideoEditNativeModules(files: CodeMaterialFiles): Promise<AuthorModuleUrls> {
  const { system } = getPlatform()
  const directory = await system.paths.join(await system.paths.tempDir(), 'henji-code-modules', crypto.randomUUID())
  await system.fs.mkdir(directory, { recursive: true })
  const remove = async (): Promise<void> => {
    try { await system.fs.remove(directory, { recursive: true }) }
    catch (error) { logger.debug('临时模块目录释放失败', { event: 'video_edit.code.modules.cleanup_failed', error }) }
  }
  try {
    const entries = await Promise.all(Object.keys(files.files).map(async (path, index) => {
      const location = await system.paths.join(directory, `${index}.mjs`)
      return { path, location, url: toFetchableMediaUrl(location) }
    }))
    const urls = new Map(entries.map(entry => [entry.path, entry.url]))
    const modules = entries.map(entry => ({ ...entry, source: rewriteAuthorModule(files, entry.path, path => urls.get(path)!) }))
    // 等待已发出的写入结束再补偿，不能让迟到写入重建已删除的目录。
    const outcomes = await mapWithConcurrency(modules, 8, async entry => (await Promise.allSettled([system.fs.writeTextFile(entry.location, entry.source)]))[0])
    const failure = outcomes.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
    let disposed = false
    logger.debug('循环模块已准备', { event: 'video_edit.code.modules.ready', context: { files: entries.length } })
    return { url: urls.get(files.entry)!, dispose: () => { if (!disposed) { disposed = true; void remove() } } }
  } catch (error) { await remove(); throw error }
}
