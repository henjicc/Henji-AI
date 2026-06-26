import { createLogger } from '@/core/logging'
import { useCallback } from 'react'
import { remove } from '@/platform/desktopApi'
import { canDeleteFile } from '@/utils/fileRefCount'
import { loadPresets } from '@/utils/preset'
import { deleteEditState } from '@/utils/editStatePersistence'
import { deleteWaveformCacheForAudio, isDesktop } from '@/utils/save'
import type { GenerationTask } from '../types'
import { splitMulti } from '../utils/multiFile'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.useTaskCleanup')

export interface UseTaskCleanupParams {
  tasks: GenerationTask[]
  setTasks: React.Dispatch<React.SetStateAction<GenerationTask[]>>
  clearTaskProgress?: (taskId: string) => void
}

export interface UseTaskCleanupReturn {
  deleteTask: (taskId: string) => Promise<void>
  clearFailedTasks: () => Promise<void>
  clearAllTasks: () => Promise<void>
}

async function deleteThumbnailCacheSafe(fullPath: string): Promise<void> {
  try {
    const mod = await import('@/utils/imageConversion')
    await mod.deleteThumbnailCache(fullPath)
  } catch (e) {
    logger.error('[Workspace] 删除缩略图缓存失败', { data: [fullPath, e] })
  }
}

async function removeFileSafe(fullPath: string): Promise<void> {
  try {
    await remove(fullPath)
  } catch (e) {
    logger.error('[Workspace] 删除文件失败', { data: [fullPath, e] })
  }
}

export function useTaskCleanup({ tasks, setTasks, clearTaskProgress }: UseTaskCleanupParams): UseTaskCleanupReturn {
  const deleteTask = useCallback(async (taskId: string): Promise<void> => {
    const target = tasks.find((t) => t.id === taskId)

    if (!target) {
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
      clearTaskProgress?.(taskId)
      return
    }

    // 非桌面端：只清理状态
    if (!isDesktop()) {
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
      clearTaskProgress?.(taskId)
      return
    }

    // 1) 删除结果文件及其缓存
    if (target.result?.filePath) {
      const paths = splitMulti(target.result.filePath)
      for (const p of paths) {
        await removeFileSafe(p)
        if (target.result.type === 'image' || target.result.type === 'video') {
          await deleteThumbnailCacheSafe(p)
        }
        if (target.result.type === 'audio') {
          try {
            await deleteWaveformCacheForAudio(p)
          } catch (e) {
            logger.error('[Workspace] 删除波形缓存失败', { data: [p, e] })
          }
        }
      }
    }

    // 2) 删除编辑状态文件
    const editStateFile = typeof target.options?.editStateFile === 'string' ? target.options.editStateFile : undefined
    if (editStateFile) {
      await deleteEditState(editStateFile)
    }

    // 3) 删除上传的图片（需要引用计数：历史 + 预设）
    if (target.uploadedFilePaths?.length) {
      const presets = await loadPresets()
      for (const filePath of target.uploadedFilePaths) {
        const ok = canDeleteFile(filePath, tasks, presets, taskId)
        if (!ok) continue
        await removeFileSafe(filePath)
        await deleteThumbnailCacheSafe(filePath)
      }
    }

    // 4) 删除上传的视频（仅检查其他任务是否引用）
    if (target.uploadedVideoFilePaths?.length) {
      for (const filePath of target.uploadedVideoFilePaths) {
        const usedByOthers = tasks.some((t) => t.id !== taskId && t.uploadedVideoFilePaths?.includes(filePath))
        if (usedByOthers) continue
        await removeFileSafe(filePath)
        await deleteThumbnailCacheSafe(filePath)
      }
    }

    if (target.uploadedAudioFilePaths?.length) {
      for (const filePath of target.uploadedAudioFilePaths) {
        const usedByOthers = tasks.some((t) => t.id !== taskId && t.uploadedAudioFilePaths?.includes(filePath))
        if (usedByOthers) continue
        await removeFileSafe(filePath)
        await deleteWaveformCacheForAudio(filePath)
        await deleteThumbnailCacheSafe(filePath)
      }
    }

    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    clearTaskProgress?.(taskId)
  }, [clearTaskProgress, setTasks, tasks])

  const clearFailedTasks = useCallback(async (): Promise<void> => {
    const failedTasks = tasks.filter((t) => t.status === 'error')
    if (failedTasks.length === 0) return

    if (!isDesktop()) {
      setTasks((prev) => prev.filter((t) => t.status !== 'error'))
      failedTasks.forEach((t) => clearTaskProgress?.(t.id))
      return
    }

    const presets = await loadPresets()
    const failedIds = new Set(failedTasks.map((t) => t.id))
    const remainingTasks = tasks.filter((t) => !failedIds.has(t.id))

    const editStateFiles = new Set<string>()
    const resultFiles = new Set<string>()
    const resultAudioPaths = new Set<string>()
    const audioPaths: string[] = []
    const uploadedImages = new Set<string>()
    const uploadedVideos = new Set<string>()

    for (const t of failedTasks) {
      const editStateFile = typeof t.options?.editStateFile === 'string' ? t.options.editStateFile : undefined
      if (editStateFile) editStateFiles.add(editStateFile)

      if (t.result?.filePath) {
        const paths = splitMulti(t.result.filePath)
        for (const p of paths) {
          resultFiles.add(p)
          if (t.result.type === 'audio') resultAudioPaths.add(p)
        }
      }

      t.uploadedFilePaths?.forEach((p) => uploadedImages.add(p))
      t.uploadedVideoFilePaths?.forEach((p) => uploadedVideos.add(p))
      t.uploadedAudioFilePaths?.forEach((p) => audioPaths.push(p))
    }

    for (const f of editStateFiles) {
      await deleteEditState(f)
    }

    for (const f of resultFiles) {
      await removeFileSafe(f)
      await deleteThumbnailCacheSafe(f)
    }

    for (const p of resultAudioPaths) {
      try {
        await deleteWaveformCacheForAudio(p)
      } catch (e) {
        logger.error('[Workspace] 删除波形缓存失败', { data: [p, e] })
      }
    }

    for (const filePath of uploadedImages) {
      const ok = canDeleteFile(filePath, remainingTasks, presets)
      if (!ok) continue
      await removeFileSafe(filePath)
      await deleteThumbnailCacheSafe(filePath)
    }

    for (const filePath of uploadedVideos) {
      const usedByRemaining = remainingTasks.some((t) => t.uploadedVideoFilePaths?.includes(filePath))
      if (usedByRemaining) continue
      await removeFileSafe(filePath)
      await deleteThumbnailCacheSafe(filePath)
    }

    for (const filePath of audioPaths) {
      const usedByRemaining = remainingTasks.some((t) => t.uploadedAudioFilePaths?.includes(filePath))
      if (usedByRemaining) continue
      await removeFileSafe(filePath)
      await deleteWaveformCacheForAudio(filePath)
      await deleteThumbnailCacheSafe(filePath)
    }

    logger.info('[Workspace] 已清理失败任务', { count: failedTasks.length })
    setTasks(remainingTasks)
    failedTasks.forEach((t) => clearTaskProgress?.(t.id))
  }, [clearTaskProgress, setTasks, tasks])

  const clearAllTasks = useCallback(async (): Promise<void> => {
    if (tasks.length === 0) return

    if (!isDesktop()) {
      tasks.forEach((t) => clearTaskProgress?.(t.id))
      setTasks([])
      return
    }

    const presets = await loadPresets()
    const editStateFiles = new Set<string>()
    const resultFiles = new Set<string>()
    const resultAudioPaths = new Set<string>()
    const audioPaths: string[] = []
    const uploadedImages = new Set<string>()
    const uploadedVideos = new Set<string>()

    for (const t of tasks) {
      const editStateFile = typeof t.options?.editStateFile === 'string' ? t.options.editStateFile : undefined
      if (editStateFile) editStateFiles.add(editStateFile)

      if (t.result?.filePath) {
        const paths = splitMulti(t.result.filePath)
        for (const p of paths) {
          resultFiles.add(p)
          if (t.result.type === 'audio') resultAudioPaths.add(p)
        }
      }

      t.uploadedFilePaths?.forEach((p) => uploadedImages.add(p))
      t.uploadedVideoFilePaths?.forEach((p) => uploadedVideos.add(p))
      t.uploadedAudioFilePaths?.forEach((p) => audioPaths.push(p))
    }

    for (const f of editStateFiles) {
      await deleteEditState(f)
    }

    for (const f of resultFiles) {
      await removeFileSafe(f)
      await deleteThumbnailCacheSafe(f)
    }

    for (const p of resultAudioPaths) {
      try {
        await deleteWaveformCacheForAudio(p)
      } catch (e) {
        logger.error('[Workspace] 删除波形缓存失败', { data: [p, e] })
      }
    }

    // 由于 remainingTasks 为空，canDeleteFile 仅会检查预设引用
    const remainingTasks: GenerationTask[] = []
    for (const filePath of uploadedImages) {
      const ok = canDeleteFile(filePath, remainingTasks, presets)
      if (!ok) continue
      await removeFileSafe(filePath)
      await deleteThumbnailCacheSafe(filePath)
    }

    for (const filePath of uploadedVideos) {
      await removeFileSafe(filePath)
      await deleteThumbnailCacheSafe(filePath)
    }

    for (const filePath of audioPaths) {
      await removeFileSafe(filePath)
      await deleteWaveformCacheForAudio(filePath)
      await deleteThumbnailCacheSafe(filePath)
    }

    logger.info('[Workspace] 已清空全部任务', { count: tasks.length })
    tasks.forEach((t) => clearTaskProgress?.(t.id))
    setTasks([])
  }, [clearTaskProgress, setTasks, tasks])

  return { deleteTask, clearFailedTasks, clearAllTasks }
}

