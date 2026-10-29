import {
  checkForElectronUpdates,
  downloadElectronUpdate,
  getUpdaterStatus,
  quitAndInstallElectronUpdate,
  type UpdaterCheckResultDto,
} from '../services/updater'
import { parseVoid, registerIpcHandler } from './registry'
import { releaseMcpForUpdate, restoreMcpAfterUpdate } from './mcp'

export function registerUpdaterIpc(): void {
  registerIpcHandler<void, UpdaterCheckResultDto>('updater:getStatus', parseVoid, () => getUpdaterStatus())
  registerIpcHandler<void, UpdaterCheckResultDto>('updater:checkForUpdates', parseVoid, () => checkForElectronUpdates())
  registerIpcHandler<void, UpdaterCheckResultDto>('updater:downloadUpdate', parseVoid, () => downloadElectronUpdate())
  registerIpcHandler<void, void>('updater:quitAndInstall', parseVoid, async () => {
    // 关闭失败不能挡住安装：安装程序最终也会结束接线员。
    await releaseMcpForUpdate()
    try { quitAndInstallElectronUpdate() } catch (error) { void restoreMcpAfterUpdate(); throw error }
    // 正常情况下应用随即退出，这个计时器不会触发；没退出就恢复外部连接。
    setTimeout(() => { void restoreMcpAfterUpdate() }, 15_000).unref()
  })
}
