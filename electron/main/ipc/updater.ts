import {
  checkForElectronUpdates,
  downloadElectronUpdate,
  getUpdaterStatus,
  quitAndInstallElectronUpdate,
  type UpdaterCheckResultDto,
} from '../services/updater'
import { parseVoid, registerIpcHandler } from './registry'
import { releaseMcpForUpdate } from './mcp'

export function registerUpdaterIpc(): void {
  registerIpcHandler<void, UpdaterCheckResultDto>('updater:getStatus', parseVoid, () => getUpdaterStatus())
  registerIpcHandler<void, UpdaterCheckResultDto>('updater:checkForUpdates', parseVoid, () => checkForElectronUpdates())
  registerIpcHandler<void, UpdaterCheckResultDto>('updater:downloadUpdate', parseVoid, () => downloadElectronUpdate())
  registerIpcHandler<void, void>('updater:quitAndInstall', parseVoid, async () => {
    // 关闭失败不能挡住安装：安装程序最终也会结束接线员。
    await releaseMcpForUpdate().catch(() => undefined)
    quitAndInstallElectronUpdate()
  })
}
