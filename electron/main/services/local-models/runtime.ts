import { BrowserWindow, shell } from 'electron'

import {
  LOCAL_MODEL_DOWNLOAD_SOURCES,
  LOCAL_MODELS_IPC_CHANNELS,
  type LocalModelDownloadSource,
  type LocalModelEnsureResult,
  type LocalModelId,
  type LocalModelProgressEvent,
} from '../../../../src/platform/contracts/localModels'
import { getUserModelsLocation } from '../appPaths'
import { createDownloadSourceSelector } from '../download/sourceSelector'
import { createMainLogger } from '../logging'
import { getSettingsStore } from '../settings/store'
import { registerWorkRootBusyProbe } from '../work-root/busy-probes'
import { LOCAL_MODEL_MANIFEST, LOCAL_MODEL_SOURCE_PROBES } from './manifest'
import { LocalModelService } from './service'

/*
 * 本地模型服务的进程内单例：注入真实网络、设置表、作品目录与窗口广播。
 * 后续功能（智能区域、跟踪）在主进程直接调用 ensureLocalModel，渲染层经 IPC 调用同一个服务。
 */

const DOWNLOAD_SOURCE_SETTING_KEY = 'local_models.download_source'
const logger = createMainLogger('main.local_models')

function readPreference(): LocalModelDownloadSource {
  const value = getSettingsStore().get(DOWNLOAD_SOURCE_SETTING_KEY)
  return (LOCAL_MODEL_DOWNLOAD_SOURCES as readonly string[]).includes(value ?? '') ? value as LocalModelDownloadSource : 'auto'
}

function broadcast(event: LocalModelProgressEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(LOCAL_MODELS_IPC_CHANNELS.progress, event)
  }
}

let service: LocalModelService | null = null

export function getLocalModelService(): LocalModelService {
  if (service) return service
  const selector = createDownloadSourceSelector({
    probes: LOCAL_MODEL_SOURCE_PROBES,
    fetch: (url, init) => fetch(url, init),
    onProbe: ({ winner, durationMs }) => logger.info('本地模型下载源探测完成', {
      event: 'local_models.source.probed', context: { winner, durationMs },
    }),
  })
  const created = new LocalModelService({
    manifest: LOCAL_MODEL_MANIFEST,
    modelsLocation: getUserModelsLocation,
    selector,
    fetch: (url, init) => fetch(url, init),
    readPreference,
    writePreference: (source) => getSettingsStore().set(DOWNLOAD_SOURCE_SETTING_KEY, source, 'string'),
    emit: broadcast,
    openPath: (dir) => shell.openPath(dir),
    logger,
  })
  // 下载写在作品目录里，下载期间不允许更换作品目录。
  registerWorkRootBusyProbe('local_model_download', { reason: '还有本地模型正在下载', isBusy: () => created.hasActiveDownloads() })
  service = created
  return created
}

/** 给后续功能用：模型就绪时直接返回位置，否则下载并校验（进度会推送给所有窗口）。 */
export function ensureLocalModel(id: LocalModelId): Promise<LocalModelEnsureResult> {
  return getLocalModelService().ensure(id)
}

export function disposeLocalModels(): void {
  service?.dispose()
}
