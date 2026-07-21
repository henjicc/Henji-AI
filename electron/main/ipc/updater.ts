import {
  checkForElectronUpdates,
  downloadElectronUpdate,
  getUpdaterStatus,
  quitAndInstallElectronUpdate,
  type UpdaterCheckResultDto,
} from '../services/updater'
import { parseVoid, registerIpcHandler } from './registry'

export function registerUpdaterIpc(): void {
  registerIpcHandler<void, UpdaterCheckResultDto>('updater:getStatus', parseVoid, () => getUpdaterStatus())
  registerIpcHandler<void, UpdaterCheckResultDto>('updater:checkForUpdates', parseVoid, () => checkForElectronUpdates())
  registerIpcHandler<void, UpdaterCheckResultDto>('updater:downloadUpdate', parseVoid, () => downloadElectronUpdate())
  registerIpcHandler<void, void>('updater:quitAndInstall', parseVoid, () => quitAndInstallElectronUpdate())
}
