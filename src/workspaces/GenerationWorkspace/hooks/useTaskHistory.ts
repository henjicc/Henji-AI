import type React from 'react'
import { useCallback, useEffect } from 'react'
import { createLogger } from '@/core/logging'
import { databaseService } from '@/services/database/DatabaseService'
import type { HistoryRecord } from '@/services/database/types'
import { getThumbnailsPath } from '@/utils/dataPath'
import { isDesktop } from '@/utils/save'
import type { GenerationTask } from '../types'
import { createHistoryMediaResolver } from '../application/historyMediaResolver'
import { readGenerationTasks } from '../application/generationTaskProjection'
import { mapHistoryRecordToTask } from '../application/generationTaskHistory'
export { awaitGenerationTaskPersistence, persistGenerationTask, createPersistedGenerationTask, deletePersistedGenerationTask } from '../application/generationTaskHistory'
const logger = createLogger('workspaces.GenerationWorkspace.hooks.useTaskHistory')

async function loadHistoryWithRetries(): Promise<HistoryRecord[]> {
  return await databaseService.getHistory()
}

export interface UseLoadTaskHistoryParams {
  setTasks: React.Dispatch<React.SetStateAction<GenerationTask[]>>
  setIsTasksLoaded: React.Dispatch<React.SetStateAction<boolean>>
  isInitialLoadRef: React.MutableRefObject<boolean>
}

export function useLoadTaskHistory({
  setTasks,
  setIsTasksLoaded,
  isInitialLoadRef,
}: UseLoadTaskHistoryParams): void {
  const load = useCallback(async (): Promise<void> => {
    if (!isDesktop()) {
      setIsTasksLoaded(true)
      isInitialLoadRef.current = false
      return
    }

    try {
      const historyRecords = await loadHistoryWithRetries()
      // 画布结果归原文档；首次历史/实体读取先由正式任务服务对账，再读取同一持久记录。
      for (const record of historyRecords) {
        if (!record.params.__canvasGeneration) continue
        const { getCanvasGenerationTask } = await import('@/features/canvas/application/canvasGenerationTaskService')
        await getCanvasGenerationTask(record.id)
        const reconciled = await databaseService.getHistoryById(record.id)
        if (reconciled) Object.assign(record, reconciled)
      }
      const resolveMedia = createHistoryMediaResolver(await getThumbnailsPath())
      const loadedTasks = await Promise.all(historyRecords.map((r) => mapHistoryRecordToTask(r, resolveMedia)))
      // 加载期间可能有画布/工作区新状态发布；在途事实优先于启动时读取的旧快照。
      const live = new Map(readGenerationTasks().map(task => [task.id, task]))
      const merged = loadedTasks.reverse().map(task => live.get(task.id) ?? task)
      const loadedIds = new Set(merged.map(task => task.id))
      merged.push(...[...live.values()].filter(task => !loadedIds.has(task.id)))
      setTasks(merged)
      logger.info('[Workspace] 历史记录加载完成', { count: loadedTasks.length })
    } catch (error) {
      logger.error('[Workspace] 加载历史记录失败:', error)
    } finally {
      setIsTasksLoaded(true)
      setTimeout(() => {
        isInitialLoadRef.current = false
      }, 500)
    }
  }, [isInitialLoadRef, setIsTasksLoaded, setTasks])

  // 更换作品目录后应用会重新启动（任务 4.2），不需要在运行中重新载入。
  useEffect(() => {
    void load()
  }, [load])
}

export interface UseSaveTaskHistoryParams {
  tasks: GenerationTask[]
  isTasksLoaded: boolean
  isInitialLoadRef: React.MutableRefObject<boolean>
}

export function useSaveTaskHistory({ tasks, isTasksLoaded, isInitialLoadRef }: UseSaveTaskHistoryParams): void {
  useEffect(() => {
    if (!isTasksLoaded) return
    if (!isDesktop()) return
    if (isInitialLoadRef.current) return

    let cancelled = false
    const timer = setTimeout(() => {
      const paths = new Set<string>()
      for (const task of tasks) {
        if (task.type === 'image' && task.result) {
          for (const path of task.result.filePaths) paths.add(path)
        }
      }
      if (paths.size === 0) return
      void import('@/utils/historyThumbnail')
        .then(({ prepareHistoryThumbnails }) => prepareHistoryThumbnails(paths, () => cancelled))
        .catch((error: unknown) => logger.error('历史缩略图更新失败', {
          event: 'generation.history.thumbnails_failed', error,
        }))
    }, 1000)

    return () => { cancelled = true; clearTimeout(timer) }

  }, [isInitialLoadRef, isTasksLoaded, tasks])
}
