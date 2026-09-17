import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ImageEditSessionData } from '@/core/imageEdit'
import type { GenerationTask } from '@/workspaces/GenerationWorkspace/types'
import { useI18n } from '@/hooks/useI18n'
import { useDataDirectoryInit } from '@/workspaces/GenerationWorkspace/hooks/useDataDirectoryInit'
import { useLoadTaskHistory, useSaveTaskHistory } from '@/workspaces/GenerationWorkspace/hooks/useTaskHistory'
import { useTaskState } from '@/workspaces/GenerationWorkspace/hooks/useTaskState'
import { useTaskGeneration } from '@/workspaces/GenerationWorkspace/hooks/useTaskGeneration'
import { useAutoResumePolling } from '@/workspaces/GenerationWorkspace/hooks/useAutoResumePolling'
import { useToast } from '@/workspaces/GenerationWorkspace/hooks/useToast'

export function useGenerationLifecycle() {
  const { t } = useI18n()
  const { notification, visible: notificationVisible, show: notify } = useToast()
  useDataDirectoryInit()
  const {
    tasks,
    setTasks,
    hydrateTasks,
    updateTask,
    updateProgress,
    rememberResultImageDimensions,
  } = useTaskState()
  const [isTasksLoaded, setIsTasksLoaded] = useState(false)
  const isInitialLoadRef = useRef(true)
  useLoadTaskHistory({ setTasks: hydrateTasks, setIsTasksLoaded, isInitialLoadRef })
  useSaveTaskHistory({ tasks, isTasksLoaded, isInitialLoadRef })
  const imageEditStatesRef = useRef<Map<string, ImageEditSessionData>>(new Map())
  const setUploadedImagesRef = useRef<React.Dispatch<React.SetStateAction<string[]>> | null>(null)
  const setUploadedFilePathsRef = useRef<React.Dispatch<React.SetStateAction<string[]>> | null>(null)
  const generationMessages = useMemo(() => {
    return {
      testModeIntercepted: t('ui:workspace.toast.testModeIntercepted'),
      missingInput: t('ui:alerts.missingInput.message'),
      genericGenerateFailed: t('ui:workspace.toast.generateFailed'),
      providerKeyRequiredTitle: t('common:providerKeyRequired.title'),
      providerKeyRequiredMessage: t('common:providerKeyRequired.message'),
    }
  }, [t])
  const { isGenerating, handleGenerate, handleContinuePolling } = useTaskGeneration({
    ready: isTasksLoaded,
    tasks,
    setTasks,
    updateTask,
    updateProgress,
    notify,
    messages: generationMessages,
    imageEditStatesRef,
    setUploadedImagesRef,
    setUploadedFilePathsRef,
  })
  /*
   * 一个供应商任务号都找不到的运行态任务永远轮询不回来，必须就地收敛成失败：
   * 否则它会停在"生成中"，跨重启也不变，用户看到一个既没有结果也没有错误的任务。
   * 这里只改状态和原因，不删记录，也不宣称供应商那边没有发生过计费。
   */
  const settleUnresumableTask = useCallback((task: GenerationTask) => {
    updateTask(task.id, { status: 'error', error: t('errors:messages.generationInterrupted') })
  }, [t, updateTask])
  useAutoResumePolling({
    tasks,
    isTasksLoaded,
    handleContinuePolling,
    settleUnresumableTask,
  })
  return { tasks, setTasks, updateTask, updateProgress, rememberResultImageDimensions,
    isTasksLoaded, isGenerating, handleGenerate, handleContinuePolling, imageEditStatesRef,
    setUploadedImagesRef, setUploadedFilePathsRef, notification, notificationVisible, notify }
}

export type GenerationLifecycleValue = ReturnType<typeof useGenerationLifecycle>

export const GenerationLifecycleContext = createContext<GenerationLifecycleValue | null>(null)

export function useGenerationLifecycleContext(): GenerationLifecycleValue {
  const value = useContext(GenerationLifecycleContext)
  if (!value) throw new Error('生成任务宿主尚未就绪')
  return value
}
