import { app, session, shell } from 'electron'
import path from 'node:path'

import { hasActiveGenerationWork } from '../ai-runtime/runtime'
import { getProgramDataDir, getUserDataLayout, USER_ROOT_FOLDER_NAMES } from '../appPaths'
import { readDataLocation, SYSTEM_FOLDER, writeDataLocation } from '../appBasePaths'
import { getDocumentService } from '../documents/runtime'
import { createMainLogger } from '../logging/main-logger'
import { MEDIA_CACHE_FOLDER_NAMES } from '../media/media-cache'
import { findWorkRootBusyReason, registerWorkRootBusyProbe } from './busy-probes'
import { createWorkRootService, type WorkRootService } from './service'

/*
 * 数据目录更换的正式运行环境：数据目录来自 appPaths，新位置写入用户主目录的位置文件，
 * 完成后刷新作品索引；生成结果还在保存、导出等长任务进行中时拒绝开始（各任务在 busy-probes 登记）。
 */

const logger = createMainLogger('main.work_root')
let service: WorkRootService | null = null

registerWorkRootBusyProbe('generation', { reason: '还有生成结果正在保存', isBusy: hasActiveGenerationWork })

export function getWorkRootService(): WorkRootService {
  service ??= createWorkRootService({
    layout: () => {
      const layout = getUserDataLayout()
      return {
        root: layout.root,
        defaultRoot: layout.defaultRoot,
        isCustom: layout.isCustom,
        rootFolderName: USER_ROOT_FOLDER_NAMES[0],
        rootFolderNames: USER_ROOT_FOLDER_NAMES,
      }
    },
    // 数据库、日志等程序资料正被本进程占用：位置先切到新目录，程序资料记下原处，重启时再搬（completePendingSystemMove）
    writeRoot: (root) => {
      const systemDir = getProgramDataDir()
      const location = readDataLocation()
      writeDataLocation({ root, ...(location.locale ? { locale: location.locale } : {}), ...(path.relative(systemDir, path.join(root, SYSTEM_FOLDER)) === '' ? {} : { systemDir }) })
    },
    ensureFolders: () => { getUserDataLayout() },
    refreshIndex: () => getDocumentService().refreshIndex(),
    busyReason: findWorkRootBusyReason,
    // 可重建的缓存不跨盘复制，随旧目录删除，新位置重新生成。
    moveOptions: { skipTopLevel: Object.values(MEDIA_CACHE_FOLDER_NAMES), keepTopLevel: [SYSTEM_FOLDER] },
    logger,
  })
  return service
}

export async function openWorkRoot(): Promise<void> {
  const root = getUserDataLayout().root
  const message = await shell.openPath(root)
  if (message) {
    logger.warn('无法在文件管理器中打开作品目录', { event: 'work_root.open.failed', context: { message } })
    throw new Error(`无法打开作品目录：${message}`)
  }
  logger.info('已在文件管理器中打开作品目录', { event: 'work_root.open.completed' })
}

/**
 * 更换完成后重新启动：渲染层已在应用关闭屏障里保存完全部内容，这里直接批准窗口关闭并重启，
 * 让所有界面与主进程服务按新位置重新载入。
 */
export function relaunchAfterWorkRootChange(approveWindowsClose: () => void): void {
  if (getWorkRootService().isRunning()) throw new Error('作品目录正在移动，请等待完成')
  logger.info('作品目录已更换，重新启动应用', { event: 'work_root.relaunch.requested' })
  // 先把渲染层本地存储（首次引导的步骤进度等）写到磁盘：重启后引导回到原来那一步，而不是从头开始
  try { session.defaultSession.flushStorageData() } catch (error) {
    logger.warn('重启前写入本地存储失败', { event: 'work_root.relaunch.flush_failed', error })
  }
  approveWindowsClose()
  app.relaunch()
  app.quit()
}

/** 应用退出清理：移动进行中时取消并等待回滚完成（原目录保持完整）。 */
export async function disposeWorkRootChange(): Promise<void> {
  if (!service?.isRunning()) return
  logger.warn('应用退出时作品目录仍在移动，正在取消并恢复原状', { event: 'work_root.shutdown.cancel' })
  await service.dispose()
}
