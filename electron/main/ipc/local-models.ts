import {
  isLocalModelId,
  LOCAL_MODEL_DOWNLOAD_SOURCES,
  LOCAL_MODELS_IPC_CHANNELS,
  type LocalModelDownloadSource,
  type LocalModelId,
} from '../../../src/platform/contracts/localModels'
import { getLocalModelService } from '../services/local-models/runtime'
import { parseRecord, parseVoid, registerIpcHandler } from './registry'

/*
 * 本地模型 IPC（任务 4.11）：渲染层经 preload `henjiNative.localModels` → PAL `LocalModelsPlatform`
 * → `src/commands/localModels.ts` 调用。下载进度经 `localModels:progress` 推给所有窗口。
 */

export function parseLocalModelIdPayload(input: unknown): LocalModelId {
  const record = parseRecord(input)
  if (!isLocalModelId(record.id) || Object.keys(record).length !== 1) throw new Error('Expected { id: LocalModelId }')
  return record.id
}

export function parseOptionalLocalModelIdPayload(input: unknown): LocalModelId | null {
  const record = parseRecord(input)
  if (record.id === null && Object.keys(record).length === 1) return null
  return parseLocalModelIdPayload(input)
}

export function parseDownloadSourcePayload(input: unknown): LocalModelDownloadSource {
  const record = parseRecord(input)
  const source = record.source
  if (typeof source !== 'string' || !(LOCAL_MODEL_DOWNLOAD_SOURCES as readonly string[]).includes(source) || Object.keys(record).length !== 1) {
    throw new Error('Expected { source: "auto" | "domestic" | "global" }')
  }
  return source as LocalModelDownloadSource
}

export function registerLocalModelsIpc(): void {
  const c = LOCAL_MODELS_IPC_CHANNELS
  registerIpcHandler(c.getState, parseVoid, () => getLocalModelService().getState())
  registerIpcHandler(c.ensure, parseLocalModelIdPayload, (id) => getLocalModelService().ensure(id))
  registerIpcHandler(c.cancel, parseLocalModelIdPayload, (id) => getLocalModelService().cancel(id))
  registerIpcHandler(c.remove, parseLocalModelIdPayload, (id) => getLocalModelService().remove(id))
  registerIpcHandler(c.openFolder, parseOptionalLocalModelIdPayload, (id) => getLocalModelService().openFolder(id))
  registerIpcHandler(c.getDownloadSource, parseVoid, () => getLocalModelService().getDownloadSource())
  registerIpcHandler(c.setDownloadSource, parseDownloadSourcePayload, (source) => getLocalModelService().setDownloadSource(source))
}
