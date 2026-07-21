import { createLogger } from '@/core/logging'
import type React from 'react'
import { useCallback, useEffect } from 'react'
import { exists, toDisplaySrc } from '@/platform/desktopApi'
import { databaseService } from '@/services/database/DatabaseService'
import type { HistoryRecord } from '@/services/database/types'
import { getDataRoot, convertPathArray, convertPathString } from '@/utils/dataPath'
import { isDesktop } from '@/utils/save'
import type { GenerationTask, GeneratorOptions, TaskStatus } from '../types'
import { joinMulti, splitMulti } from '../utils/multiFile'
import { isRecord, isStringArray } from '../utils/typeGuards'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.useTaskHistory')

function normalizeHistoryStatus(status: HistoryRecord['status']): TaskStatus {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'timeout') return 'error'
  return status
}

async function toDisplayUrl(fullPath: string, kind: 'image' | 'audio' | 'video'): Promise<string> {
  // For images, try to use cached thumbnail first
  if (kind === 'image') {
    try {
      const { getHistoryThumbnailCachePath } = await import('@/utils/historyThumbnail')
      const cachePath = await getHistoryThumbnailCachePath(fullPath)
      if (await exists(cachePath)) {
        return toDisplaySrc(cachePath.replace(/\\/g, '/'))
      }
    } catch {
      // Fall through to full URL
    }
  }
  // For non-image or when thumbnail is unavailable, use the original file
  return toDisplaySrc(fullPath.replace(/\\/g, '/'))
}

async function toDisplayUrlString(
  absoluteFilePath: string,
  kind: 'image' | 'audio' | 'video'
): Promise<string> {
  const paths = splitMulti(absoluteFilePath)
  const urls = await Promise.all(paths.map((p) => toDisplayUrl(p, kind)))
  return joinMulti(urls)
}

function parseHistoryTimestamp(value?: string | null): Date {
  if (!value) return new Date()
  if (/[zZ]$/.test(value) || /[+-]\d{2}:?\d{2}$/.test(value)) {
    return new Date(value)
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`)
  }
  return new Date(value)
}

async function mapHistoryRecordToTask(record: HistoryRecord, dataRoot: string): Promise<GenerationTask> {
  const createdAt = parseHistoryTimestamp(record.createdAt)
  const rawParams: DynamicValue = record.params
  const safeParams: DynamicValueMap = isRecord(rawParams) ? rawParams : {}
  const resultUrlFromParams = typeof safeParams['__resultUrl'] === 'string' ? safeParams['__resultUrl'] : undefined
  const dimensionsFromParams = typeof safeParams['__dimensions'] === 'string' ? safeParams['__dimensions'] : undefined
  const paramsForTaskOptions: DynamicValueMap = { ...safeParams }
  delete paramsForTaskOptions['__resultUrl']
  delete paramsForTaskOptions['__dimensions']

  const uploadedFilePathsRaw = safeParams['uploadedFilePaths']
  const uploadedVideoFilePathsRaw = safeParams['uploadedVideoFilePaths']
  const uploadedAudioFilePathsRaw = safeParams['uploadedAudioFilePaths']

  const uploadedFilePathsRel = isStringArray(uploadedFilePathsRaw) ? uploadedFilePathsRaw : undefined
  const uploadedVideoFilePathsRel = isStringArray(uploadedVideoFilePathsRaw) ? uploadedVideoFilePathsRaw : undefined
  const uploadedAudioFilePathsRel = isStringArray(uploadedAudioFilePathsRaw) ? uploadedAudioFilePathsRaw : undefined

  const uploadedFilePathsAbs = uploadedFilePathsRel
    ? await convertPathArray(uploadedFilePathsRel, dataRoot, false)
    : undefined

  const uploadedVideoFilePathsAbs = uploadedVideoFilePathsRel
    ? await convertPathArray(uploadedVideoFilePathsRel, dataRoot, false)
    : undefined

  const uploadedAudioFilePathsAbs = uploadedAudioFilePathsRel
    ? await convertPathArray(uploadedAudioFilePathsRel, dataRoot, false)
    : undefined

  const images = uploadedFilePathsAbs
    ? await Promise.all(uploadedFilePathsAbs.map((p) => toDisplayUrl(p, 'image')))
    : undefined

  const videos = uploadedVideoFilePathsAbs
    ? await Promise.all(uploadedVideoFilePathsAbs.map((p) => toDisplayUrl(p, 'video')))
    : undefined

  const absoluteResultFilePath = record.filePath
    ? await convertPathString(record.filePath, dataRoot, false)
    : null

  // Dimensions and duration are no longer pre-computed during initial load.
  // Loading media dimensions requires decoding every image, which blocks
  // the main thread when many high-resolution records exist.
  // They can be lazily computed when the user opens the viewer.

  const resolvedResultUrl = absoluteResultFilePath
    ? await toDisplayUrlString(absoluteResultFilePath, record.type)
    : resultUrlFromParams

  const result = resolvedResultUrl
    ? {
        id: record.id,
        type: record.type,
        url: resolvedResultUrl,
        filePath: absoluteResultFilePath ?? undefined,
        prompt: record.prompt ?? '',
        createdAt,
      }
    : undefined

  const options: GeneratorOptions = {
    ...paramsForTaskOptions,
    ...(uploadedFilePathsAbs ? { uploadedFilePaths: uploadedFilePathsAbs } : {}),
    ...(uploadedVideoFilePathsAbs ? { uploadedVideoFilePaths: uploadedVideoFilePathsAbs } : {}),
    ...(uploadedAudioFilePathsAbs ? { uploadedAudioFilePaths: uploadedAudioFilePathsAbs } : {}),
  }

  const normalizedStatus = normalizeHistoryStatus(record.status)

  return {
    id: record.id,
    createdAt,
    type: record.type,
    prompt: record.prompt ?? '',
    model: record.modelId,
    provider: record.providerId,
    status: normalizedStatus,
    result,
    error: record.errorMessage ?? undefined,
    dimensions: dimensionsFromParams ?? undefined,
    duration: undefined,
    images,
    videos,
    uploadedFilePaths: uploadedFilePathsAbs,
    uploadedVideoFilePaths: uploadedVideoFilePathsAbs,
    uploadedAudioFilePaths: uploadedAudioFilePathsAbs,
    serverTaskId: record.taskId ?? undefined,
    options,
  }
}

async function loadHistoryWithRetries(): Promise<HistoryRecord[]> {
  const maxRetries = 10
  for (let retries = 0; retries < maxRetries; retries++) {

    try {
      return await databaseService.getHistory()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('Database not initialized')) {
        if (retries === maxRetries - 1) throw error
        await new Promise((r) => setTimeout(r, 100))
        continue
      }
      throw error
    }
  }
  return []
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
      const dataRoot = await getDataRoot()
      const loadedTasks = await Promise.all(historyRecords.map((r) => mapHistoryRecordToTask(r, dataRoot)))
      setTasks(loadedTasks.reverse())
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

  useEffect(() => {
    void load()

    const handlePathChange = () => {
      logger.info('[Workspace] 检测到数据路径变更，重新加载历史记录', {})
      void load()
    }

    window.addEventListener('dataPathChanged', handlePathChange)
    return () => window.removeEventListener('dataPathChanged', handlePathChange)
  }, [load])
}

export interface UseSaveTaskHistoryParams {
  tasks: GenerationTask[]
  isTasksLoaded: boolean
  isInitialLoadRef: React.MutableRefObject<boolean>
}

function deleteKeys(target: DynamicValueMap, keys: string[]): void {
  for (const k of keys) delete target[k]
}

export function useSaveTaskHistory({ tasks, isTasksLoaded, isInitialLoadRef }: UseSaveTaskHistoryParams): void {
  useEffect(() => {
    if (!isTasksLoaded) return
    if (!isDesktop()) return
    if (isInitialLoadRef.current) return

    const saveHistory = async (): Promise<void> => {
      try {
        const dataRoot = await getDataRoot()

        const tasksToSave = tasks.filter((t) =>
          ['success', 'error', 'pending', 'queued', 'generating'].includes(t.status)
        )

        const allRecords = await databaseService.getHistory()
        const taskIdSet = new Set(tasksToSave.map((t) => t.id))
        const recordMap = new Map(allRecords.map((r) => [r.id, r]))

        for (const record of allRecords) {
          if (!taskIdSet.has(record.id)) {
            await databaseService.deleteHistory(record.id)
          }
        }

        for (const task of tasksToSave) {
          const optionsCopy: DynamicValueMap = { ...(task.options ?? {}) }
          deleteKeys(optionsCopy, [
            'images',
            'image_url',
            'uploadedImages',
            'videos',
            'video_url',
            'uploadedVideos',
            'video',
          ])

          const relativeFilePath = task.result?.filePath
            ? (await convertPathString(task.result.filePath, dataRoot, true)) ?? null
            : null

          if (task.uploadedFilePaths?.length) {
            optionsCopy['uploadedFilePaths'] = await convertPathArray(task.uploadedFilePaths, dataRoot, true)
          }
          if (task.uploadedVideoFilePaths?.length) {
            optionsCopy['uploadedVideoFilePaths'] = await convertPathArray(task.uploadedVideoFilePaths, dataRoot, true)
          }
          if (task.uploadedAudioFilePaths?.length) {
            optionsCopy['uploadedAudioFilePaths'] = await convertPathArray(task.uploadedAudioFilePaths, dataRoot, true)
          }
          if (task.result?.url) {
            optionsCopy['__resultUrl'] = task.result.url
          }

          const historyRecord: Omit<HistoryRecord, 'createdAt' | 'updatedAt'> = {
            id: task.id,
            providerId: task.provider ?? '',
            modelId: task.model,
            type: task.type,
            prompt: task.prompt,
            params: optionsCopy as DynamicValue as HistoryRecord['params'],
            filePath: relativeFilePath,
            taskId: task.serverTaskId ?? null,
            status: task.status,
            errorMessage: task.error ?? null,
            cost: null,
            duration: null,
          }

          if (recordMap.has(task.id)) {
            await databaseService.updateHistory(task.id, historyRecord)
          } else {
            await databaseService.insertHistory(historyRecord)
          }
        }

        logger.info('[Workspace] 历史记录保存完成', { count: tasksToSave.length })

        // Generate thumbnails for image results in background
        ;(async () => {
          try {
            const { getOrCreateHistoryThumbnail } = await import('@/utils/historyThumbnail')
            for (const task of tasksToSave) {
              if (task.type === 'image' && task.result?.filePath) {
                // Split multi-file paths and generate thumbnail for each file
                const { splitMulti } = await import('../utils/multiFile')
                const filePaths = splitMulti(task.result.filePath)
                for (const fp of filePaths) {
                  getOrCreateHistoryThumbnail(fp).catch(() => {/* silent */})
                }
              }
            }
          } catch {
            // silent
          }
        })()
      } catch (error) {
        logger.error('[Workspace] 保存历史记录失败:', error)
      }
    }

    const timer = setTimeout(() => {
      void saveHistory()
    }, 1000)

    return () => clearTimeout(timer)
  }, [isInitialLoadRef, isTasksLoaded, tasks])
}
