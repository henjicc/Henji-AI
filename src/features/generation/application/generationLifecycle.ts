import React, { createContext, useContext, useMemo, useRef, useState } from 'react'
import type { ImageEditSessionData } from '@/core/imageEdit'
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
  useAutoResumePolling({
    tasks,
    isTasksLoaded,
    handleContinuePolling,
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
