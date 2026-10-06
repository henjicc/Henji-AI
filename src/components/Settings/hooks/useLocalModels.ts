import { useCallback, useEffect, useRef, useState } from 'react'

import {
  cancelLocalModelDownload,
  ensureLocalModel,
  getLocalModelsState,
  openLocalModelFolder,
  removeLocalModel,
  setLocalModelDownloadSource,
  subscribeLocalModelProgress,
} from '@/commands/localModels'
import { createLogger } from '@/core/logging'
import type { LocalModelDownloadSource, LocalModelId, LocalModelInfo } from '@/platform/contracts/localModels'

const logger = createLogger('components.settings.local_models')

export interface LocalModelsView {
  models: LocalModelInfo[]
  downloadSource: LocalModelDownloadSource
  loaded: boolean
  loadFailed: boolean
  download: (id: LocalModelId) => void
  cancel: (id: LocalModelId) => void
  remove: (id: LocalModelId) => void
  openFolder: (id: LocalModelId) => void
  changeDownloadSource: (source: LocalModelDownloadSource) => void
  reload: () => void
}

/**
 * 设置“本地模型”分区的状态：从主进程取一次全量状态，之后靠进度推送就地更新；
 * 下载结束、失败或删除时重新取一次，拿到最终校验结果。助手或其他窗口发起的下载同样会推送过来。
 */
export function useLocalModels(): LocalModelsView {
  const [models, setModels] = useState<LocalModelInfo[]>([])
  const [downloadSource, setDownloadSource] = useState<LocalModelDownloadSource>('auto')
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const mounted = useRef(true)

  const reload = useCallback(() => {
    getLocalModelsState()
      .then((state) => {
        if (!mounted.current) return
        setModels(state.models)
        setDownloadSource(state.downloadSource)
        setLoaded(true)
        setLoadFailed(false)
      })
      .catch((error: unknown) => {
        logger.error('读取本地模型状态失败', { event: 'local_models.state.failed', error })
        if (mounted.current) { setLoaded(true); setLoadFailed(true) }
      })
  }, [])

  useEffect(() => {
    mounted.current = true
    reload()
    const unsubscribe = subscribeLocalModelProgress((event) => {
      setModels((current) => current.map((model) => (model.id === event.id
        ? { ...model, status: event.status, progress: event.progress, lastFailure: event.lastFailure }
        : model)))
      if (event.status !== 'downloading') reload()
    })
    return () => { mounted.current = false; unsubscribe() }
  }, [reload])

  const download = useCallback((id: LocalModelId) => {
    // 失败原因由下载服务记录并随状态推送回来，这里只记日志。
    ensureLocalModel(id).catch((error: unknown) => {
      logger.warn('本地模型下载未完成', { event: 'local_models.ui_download.failed', modelId: id, error })
    })
  }, [])

  const cancel = useCallback((id: LocalModelId) => {
    void cancelLocalModelDownload(id)
  }, [])

  const remove = useCallback((id: LocalModelId) => {
    removeLocalModel(id).catch((error: unknown) => {
      logger.error('删除本地模型失败', { event: 'local_models.ui_remove.failed', modelId: id, error })
      reload()
    })
  }, [reload])

  const openFolder = useCallback((id: LocalModelId) => {
    openLocalModelFolder(id).catch((error: unknown) => {
      logger.warn('打开本地模型文件夹失败', { event: 'local_models.ui_open_folder.failed', modelId: id, error })
    })
  }, [])

  const changeDownloadSource = useCallback((source: LocalModelDownloadSource) => {
    setDownloadSource(source)
    setLocalModelDownloadSource(source).catch((error: unknown) => {
      logger.error('保存模型下载源失败', { event: 'local_models.ui_source.failed', error })
      reload()
    })
  }, [reload])

  return { models, downloadSource, loaded, loadFailed, download, cancel, remove, openFolder, changeDownloadSource, reload }
}

/** 下载大小：1 MB 以下按 KB，其余按 MB 保留一位小数。 */
export function formatLocalModelSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
