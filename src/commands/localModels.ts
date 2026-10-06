import { getPlatform } from '@/platform'
import type {
  LocalModelDownloadSource,
  LocalModelEnsureResult,
  LocalModelId,
  LocalModelsState,
  LocalModelProgressEvent,
} from '@/platform/contracts/localModels'

/*
 * 本地模型（任务 4.11）。下载、校验、落盘全部在主进程完成；渲染层只取状态、发起操作、订阅进度。
 * 后续功能（智能区域、跟踪）用 ensureLocalModel 拿到本地文件位置，交给 Worker 前先过 toFetchableMediaUrl()。
 */

export function getLocalModelsState(): Promise<LocalModelsState> {
  return getPlatform().localModels.getState()
}

/** 模型就绪时直接返回位置；否则下载并校验，进度经 onProgress 回调（只在本次调用期间有效）。 */
export async function ensureLocalModel(
  id: LocalModelId,
  onProgress?: (event: LocalModelProgressEvent) => void,
): Promise<LocalModelEnsureResult> {
  const platform = getPlatform().localModels
  const unsubscribe = onProgress
    ? platform.onProgress((event) => { if (event.id === id) onProgress(event) })
    : () => undefined
  try {
    return await platform.ensure(id)
  } finally {
    unsubscribe()
  }
}

export function cancelLocalModelDownload(id: LocalModelId): Promise<boolean> {
  return getPlatform().localModels.cancel(id)
}

export function removeLocalModel(id: LocalModelId): Promise<void> {
  return getPlatform().localModels.remove(id)
}

export function openLocalModelFolder(id: LocalModelId | null): Promise<void> {
  return getPlatform().localModels.openFolder(id)
}

export function getLocalModelDownloadSource(): Promise<LocalModelDownloadSource> {
  return getPlatform().localModels.getDownloadSource()
}

export function setLocalModelDownloadSource(source: LocalModelDownloadSource): Promise<void> {
  return getPlatform().localModels.setDownloadSource(source)
}

/** 订阅所有本地模型的状态变化（任一窗口或助手触发的下载都会推送）。 */
export function subscribeLocalModelProgress(handler: (event: LocalModelProgressEvent) => void): () => void {
  return getPlatform().localModels.onProgress(handler)
}
