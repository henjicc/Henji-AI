import { app, shell } from 'electron'

import { hasActiveGenerationWork } from '../ai-runtime/runtime'
import { getUserDataLayout, USER_ROOT_FOLDER_NAMES } from '../appPaths'
import { writeCustomDataRoot } from '../dataRoot'
import { getDocumentService } from '../documents/runtime'
import { createMainLogger } from '../logging/main-logger'
import { findWorkRootBusyReason, registerWorkRootBusyProbe } from './busy-probes'
import { createWorkRootService, type WorkRootService } from './service'

/*
 * 作品目录更换的正式运行环境：作品目录来自 appPaths，设置写入 settings 表，
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
        rootFolderName: USER_ROOT_FOLDER_NAMES[layout.locale],
        rootFolderNames: Object.values(USER_ROOT_FOLDER_NAMES),
      }
    },
    writeCustomRoot: writeCustomDataRoot,
    ensureFolders: () => { getUserDataLayout() },
    refreshIndex: () => getDocumentService().refreshIndex(),
    busyReason: findWorkRootBusyReason,
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
