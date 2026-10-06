import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { aiReadSavedResult } from '@/commands/aiRuntime'
import { createLogger } from '@/core/logging'
import type React from 'react'
import { useCallback, useEffect } from 'react'
import { databaseService } from '@/services/database/DatabaseService'
import type { HistoryRecord } from '@/services/database/types'
import { getThumbnailsPath } from '@/utils/dataPath'
import { isDesktop } from '@/utils/save'
import type { GenerationTask, GeneratorOptions, TaskStatus } from '../types'
import { isRecord, isStringArray } from '../utils/typeGuards'
import { createHistoryMediaResolver } from '../application/historyMediaResolver'
import { readStoredResultUrls, STORED_RESULT_URLS_KEY } from '@/features/generation/domain/storedResultUrls'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.useTaskHistory')

function normalizeHistoryStatus(status: HistoryRecord['status']): TaskStatus {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'timeout') return 'error'
  if (status === 'cancelled') return 'error'
  return status
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

/** 本地显示地址（结果已在 resultPaths 里时不必另存）。 */
const LOCAL_DISPLAY_URL = /^(?:henji-media:|file:)/i

async function mapHistoryRecordToTask(
  record: HistoryRecord,
  resolveDisplayUrls: ReturnType<typeof createHistoryMediaResolver>,
): Promise<GenerationTask> {
  const createdAt = parseHistoryTimestamp(record.createdAt)
  const rawParams: DynamicValue = record.params
  const safeParams: DynamicValueMap = isRecord(rawParams) ? rawParams : {}
  // 只读取原请求回执；同步完成直接恢复结果，绝不伪造供应商任务号。
  if (!record.taskId && record.resultPaths.length === 0 && readStoredResultUrls(safeParams).length === 0 && ['pending', 'queued', 'generating'].includes(record.status)) {
    const recovered = await aiReadSavedResult(record.id).catch((error: unknown) => {
      logger.warn('原生成结果仍待保存，保留历史状态', { event: 'generation.history.recovery_pending', taskId: record.id, error })
      return null
    })
    if (recovered?.status === 'completed' && recovered.urls?.length && recovered.filePaths?.length) {
      safeParams[STORED_RESULT_URLS_KEY] = recovered.urls
      record = { ...record, status: 'completed', params: safeParams as HistoryRecord['params'],
        resultPaths: recovered.filePaths,
        taskId: recovered.taskId ?? null }
      await databaseService.updateHistory(record.id, { status: record.status, params: record.params, resultPaths: record.resultPaths, taskId: record.taskId })
    } else if (recovered?.taskId) {
      record = { ...record, taskId: recovered.taskId }
      await databaseService.updateHistory(record.id, { taskId: recovered.taskId })
    }
  }
  const resultUrlsFromParams = readStoredResultUrls(safeParams)
  const dimensionsFromParams = typeof safeParams['__dimensions'] === 'string' ? safeParams['__dimensions'] : undefined
  const paramsForTaskOptions: DynamicValueMap = { ...safeParams }
  delete paramsForTaskOptions[STORED_RESULT_URLS_KEY]
  delete paramsForTaskOptions['__dimensions']

  const uploadedFilePathsRaw = safeParams['uploadedFilePaths']
  const uploadedVideoFilePathsRaw = safeParams['uploadedVideoFilePaths']
  const uploadedAudioFilePathsRaw = safeParams['uploadedAudioFilePaths']

  // 记录里的路径已由主进程换回绝对路径（存储底座 2.3），这里只去掉空项。
  const nonEmpty = (value: string[] | undefined): string[] | undefined => {
    const list = value?.filter((item) => item.trim() !== '')
    return list && list.length > 0 ? list : undefined
  }
  const uploadedFilePathsAbs = nonEmpty(isStringArray(uploadedFilePathsRaw) ? uploadedFilePathsRaw : undefined)
  const uploadedVideoFilePathsAbs = nonEmpty(isStringArray(uploadedVideoFilePathsRaw) ? uploadedVideoFilePathsRaw : undefined)
  const uploadedAudioFilePathsAbs = nonEmpty(isStringArray(uploadedAudioFilePathsRaw) ? uploadedAudioFilePathsRaw : undefined)

  const imageResolution = uploadedFilePathsAbs
    ? await resolveDisplayUrls(uploadedFilePathsAbs, 'image')
    : undefined
  const videoResolution = uploadedVideoFilePathsAbs
    ? await resolveDisplayUrls(uploadedVideoFilePathsAbs, 'video')
    : undefined
  const skippedInputCount = (imageResolution?.skippedCount ?? 0) + (videoResolution?.skippedCount ?? 0)
  if (skippedInputCount > 0) {
    logger.warn('历史记录引用的本地媒体不可访问，已跳过预览', {
      event: 'generation_history.media_preview.skipped',
      context: { historyId: record.id, skippedInputCount },
    })
  }

  const images = imageResolution?.urls
  const videos = videoResolution?.urls


  // Dimensions and duration are no longer pre-computed during initial load.
  // Loading media dimensions requires decoding every image, which blocks
  // the main thread when many high-resolution records exist.
  // They can be lazily computed when the user opens the viewer.

  const hasResultFiles = record.resultPaths.length > 0
  const resolvedResultUrls = hasResultFiles
    ? (await resolveDisplayUrls(record.resultPaths, record.type)).urls
    : resultUrlsFromParams

  const result = resolvedResultUrls.length > 0
    ? {
        id: record.id,
        type: record.type,
        urls: resolvedResultUrls,
        filePaths: record.resultPaths,
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
    // 成功记录有结果路径却解析不出可显示的文件：文件被移走或删掉了，卡片要给出提示而不是只剩标题
    ...(normalizedStatus === 'success' && hasResultFiles && resolvedResultUrls.length === 0 ? { resultFileMissing: true } : {}),
    options,
  }
}

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
      const resolveMedia = createHistoryMediaResolver(await getThumbnailsPath())
      const loadedTasks = await Promise.all(historyRecords.map((r) => mapHistoryRecordToTask(r, resolveMedia)))
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

function deleteKeys(target: DynamicValueMap, keys: string[]): void {
  for (const k of keys) delete target[k]
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

/** 原历史映射的唯一保存入口，调用者可等待真正落盘。 */
let historySaveTail: Promise<void> = Promise.resolve()
const taskSaves = new Map<string, Promise<void>>()

/** 等待状态入口已经合并的最新任务保存，不能用执行开始时的快照覆盖并发编辑。 */
export function awaitGenerationTaskPersistence(id: string): Promise<void> {
  return taskSaves.get(id) ?? Promise.resolve()
}
const deletedTaskIds = new Set<string>()

export function persistGenerationTask(task: GenerationTask): Promise<void> {
  const save = historySaveTail.then(() => deletedTaskIds.has(task.id) ? undefined : writeGenerationTask(task))
  taskSaves.set(task.id, save)
  historySaveTail = save.catch(() => undefined)
  return save
}

export function createPersistedGenerationTask(task: GenerationTask): Promise<void> {
  const save = historySaveTail.then(() => writeGenerationTask(task, true))
  taskSaves.set(task.id, save)
  historySaveTail = save.catch(() => undefined)
  return save
}

async function writeGenerationTask(task: GenerationTask, createOnly = false): Promise<void> {
  if (!isDesktop()) return
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

  // 路径一律传绝对路径；写入数据库时由主进程换成位置写法（存储底座 2.3）。
  const resultPaths = task.result?.filePaths.filter((item) => item.trim() !== '') ?? []

  if (task.uploadedFilePaths?.length) {
    optionsCopy['uploadedFilePaths'] = task.uploadedFilePaths.filter((item) => item.trim() !== '')
  }
  if (task.uploadedVideoFilePaths?.length) {
    optionsCopy['uploadedVideoFilePaths'] = task.uploadedVideoFilePaths.filter((item) => item.trim() !== '')
  }
  if (task.uploadedAudioFilePaths?.length) {
    optionsCopy['uploadedAudioFilePaths'] = task.uploadedAudioFilePaths.filter((item) => item.trim() !== '')
  }
  // 本地显示地址可由结果文件重新得出，不重复保存；远程结果地址保留，供本地副本缺失时回退。
  const resultUrls = task.result?.urls ?? []
  if (resultUrls.length > 0 && !(resultPaths.length > 0 && resultUrls.every((url) => LOCAL_DISPLAY_URL.test(url)))) {
    optionsCopy[STORED_RESULT_URLS_KEY] = resultUrls
  }
  if (task.dimensions) {
    optionsCopy['__dimensions'] = task.dimensions
  }

  const historyRecord: Omit<HistoryRecord, 'createdAt' | 'updatedAt'> = {
    id: task.id,
    providerId: task.provider ?? '',
    modelId: task.model,
    type: task.type,
    prompt: task.prompt,
    params: optionsCopy as DynamicValue as HistoryRecord['params'],
    resultPaths,
    taskId: task.serverTaskId ?? null,
    status: task.status,
    errorMessage: task.error ?? null,
    cost: null,
    duration: null,
  }

  if (await databaseService.getHistoryById(task.id)) {
    if (createOnly) throw new ApplicationPreflightFailure('GENERATION_ID_COLLISION:原任务标识已存在，本次未创建或修改历史记录')
    await databaseService.updateHistory(task.id, historyRecord)
  } else {
    await databaseService.insertHistory(historyRecord)
  }
}

export function deletePersistedGenerationTask(id: string): Promise<void> {
  deletedTaskIds.add(id)
  const save = historySaveTail.then(async () => { if (isDesktop()) await databaseService.deleteHistory(id) })
  taskSaves.set(id, save)
  historySaveTail = save.catch(() => undefined)
  return save
}
