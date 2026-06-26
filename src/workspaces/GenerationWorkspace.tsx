import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toDisplaySrc as convertFileSrc } from '@/platform/desktopApi'
import MediaGenerator from '@/components/MediaGenerator'
import ContextMenu from '@/components/ContextMenu'
import UpdateDialog from '@/components/UpdateDialog'
import TestModeIndicator from '@/components/TestModeIndicator'
import TestModePanel from '@/components/TestModePanel'
import { UiTaskHistoryFilterBar } from '@/components/ui'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useI18n } from '@/hooks/useI18n'
import { getModelDisplayName, getModelInfo, getProviderDisplayName } from '@/utils/modelHelpers'
import {
  useGenerationHistoryFilterStore,
  type GenerationHistoryMediaType,
} from '@/stores/generationHistoryFilterStore.ts'
import type { ImageEditState } from '@/components/ImageEditor'
import { FloatingInputPanel } from './GenerationWorkspace/components/FloatingInputPanel'
import { NotificationToast } from './GenerationWorkspace/components/NotificationToast'
import { ClearHistoryDialog } from './GenerationWorkspace/components/ClearHistoryDialog'
import { ImageViewerModal } from '@/components/mediaViewer/ImageViewerModal'
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal'
import { AudioViewerModal } from '@/components/mediaViewer/AudioViewerModal'
import { TaskList } from './GenerationWorkspace/components/TaskList'
import { useBottomPanel } from './GenerationWorkspace/hooks/useBottomPanel'
import { useDataDirectoryInit } from './GenerationWorkspace/hooks/useDataDirectoryInit'
import { useLoadTaskHistory, useSaveTaskHistory } from './GenerationWorkspace/hooks/useTaskHistory'
import { useMediaFileActions } from './GenerationWorkspace/hooks/useMediaFileActions'
import { useTaskCleanup } from './GenerationWorkspace/hooks/useTaskCleanup'
import { useTaskGeneration } from './GenerationWorkspace/hooks/useTaskGeneration'
import { useTaskReplay } from './GenerationWorkspace/hooks/useTaskReplay'
import { useTaskState } from './GenerationWorkspace/hooks/useTaskState'
import { useAutoResumePolling } from './GenerationWorkspace/hooks/useAutoResumePolling'
import { useTestModeShortcuts } from './GenerationWorkspace/hooks/useTestModeShortcuts'
import { useToast } from './GenerationWorkspace/hooks/useToast'
import { useUpdateCheck } from './GenerationWorkspace/hooks/useUpdateCheck'
import { useAutoScrollOnResize } from './GenerationWorkspace/hooks/useAutoScrollOnResize'
import { useTaskFilters } from './GenerationWorkspace/hooks/useTaskFilters'
import { splitMulti } from './GenerationWorkspace/utils/multiFile'

const FLOATING_INPUT_PANEL_MAX_WIDTH_PX = 1100

const GenerationWorkspace: React.FC = () => {
  const { t } = useI18n()
  useDataDirectoryInit()
  const { tasks, setTasks, updateTask, updateProgress } = useTaskState()
  const [isTasksLoaded, setIsTasksLoaded] = useState(false)
  const isInitialLoadRef = useRef(true)
  useLoadTaskHistory({ setTasks, setIsTasksLoaded, isInitialLoadRef })
  useSaveTaskHistory({ tasks, isTasksLoaded, isInitialLoadRef })
  const {
    keyword: filterKeyword,
    providerId: filterProviderId,
    modelId: filterModelId,
    mediaType: filterMediaType,
    timePreset: filterTimePreset,
    startDate: filterStartDate,
    endDate: filterEndDate,
    setKeyword: setFilterKeyword,
    setProviderId: setFilterProviderId,
    setModelId: setFilterModelId,
    setMediaType: setFilterMediaType,
    setTimePreset: setFilterTimePreset,
    setStartDate: setFilterStartDate,
    setEndDate: setFilterEndDate,
    resetFilters: resetHistoryFilters,
  } = useGenerationHistoryFilterStore()
  const { filteredTasks, matchedCount, hasActiveFilters } = useTaskFilters(tasks, {
    keyword: filterKeyword,
    providerId: filterProviderId,
    modelId: filterModelId,
    mediaType: filterMediaType,
    timePreset: filterTimePreset,
    startDate: filterStartDate,
    endDate: filterEndDate,
  })
  const historyProviderOptions = useMemo(() => {
    const providers = new Map<string, string>()
    tasks.forEach((task) => {
      if (!task.provider || providers.has(task.provider)) return
      providers.set(task.provider, getProviderDisplayName(task.provider))
    })
    return Array.from(providers.entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base', numeric: true }))
      .map(([value, label]) => ({ value, label }))
  }, [tasks])
  const historyModelOptions = useMemo(() => {
    const models = new Map<string, { label: string; providerId: string }>()
    tasks.forEach((task) => {
      if (!task.provider || models.has(task.model)) return
      models.set(task.model, {
        label: getModelInfo(task.model)?.name ?? task.model,
        providerId: task.provider,
      })
    })
    return Array.from(models.entries())
      .sort((a, b) => a[1].label.localeCompare(b[1].label, undefined, { sensitivity: 'base', numeric: true }))
      .map(([value, payload]) => ({
        value,
        label: payload.label,
        providerId: payload.providerId,
      }))
  }, [tasks])
  const historyMediaTypeOptions = useMemo<GenerationHistoryMediaType[]>(() => {
    const order: GenerationHistoryMediaType[] = ['image', 'video', 'audio']
    const available = new Set<GenerationHistoryMediaType>()
    tasks.forEach((task) => {
      if (task.type === 'image' || task.type === 'video' || task.type === 'audio') {
        available.add(task.type)
      }
    })
    return order.filter((type) => available.has(type))
  }, [tasks])
  const mediaFilterOptions = useMemo<Array<{ label: string; value: GenerationHistoryMediaType }>>(() => {
    const labelByType: Record<Exclude<GenerationHistoryMediaType, 'all'>, string> = {
      image: t('ui:workspaceToolbar.filter.image'),
      video: t('ui:workspaceToolbar.filter.video'),
      audio: t('ui:workspaceToolbar.filter.audio'),
    }
    return [
      { value: 'all', label: t('ui:workspaceToolbar.filter.all') },
      ...historyMediaTypeOptions.map((value) => ({
      value,
      label: labelByType[value as Exclude<GenerationHistoryMediaType, 'all'>],
      })),
    ]
  }, [historyMediaTypeOptions, t])
  const providerFilterOptions = useMemo(() => [
    { value: 'all', label: t('ui:workspaceFilters.provider.all') },
    ...historyProviderOptions,
  ], [historyProviderOptions, t])
  const modelFilterOptions = useMemo(() => (
    [
      { value: 'all', label: t('ui:workspaceFilters.model.all') },
      ...(filterProviderId === 'all'
      ? historyModelOptions.map((option) => ({ value: option.value, label: option.label }))
      : historyModelOptions
        .filter((option) => option.providerId === filterProviderId)
        .map((option) => ({ value: option.value, label: option.label }))),
    ]
  ), [filterProviderId, historyModelOptions, t])
  const handleProviderFilterChange = useCallback((providerId: string): void => {
    setFilterProviderId(providerId)
    if (filterModelId === 'all') return
    if (providerId === 'all') return
    const modelVisible = historyModelOptions.some((option) => option.value === filterModelId && option.providerId === providerId)
    if (!modelVisible) {
      setFilterModelId('all')
    }
  }, [filterModelId, historyModelOptions, setFilterModelId, setFilterProviderId])
  useEffect(() => {
    if (filterProviderId !== 'all' && !historyProviderOptions.some((option) => option.value === filterProviderId)) {
      setFilterProviderId('all')
    }
  }, [filterProviderId, historyProviderOptions, setFilterProviderId])
  useEffect(() => {
    if (filterModelId === 'all') return
    const modelVisible = historyModelOptions.some((option) => (
      option.value === filterModelId &&
      (filterProviderId === 'all' || option.providerId === filterProviderId)
    ))
    if (!modelVisible) {
      setFilterModelId('all')
    }
  }, [filterModelId, filterProviderId, historyModelOptions, setFilterModelId])
  useEffect(() => {
    if (filterMediaType !== 'all' && !historyMediaTypeOptions.includes(filterMediaType)) {
      setFilterMediaType('all')
    }
  }, [filterMediaType, historyMediaTypeOptions, setFilterMediaType])
  const { notification, visible: notificationVisible, show: notify } = useToast()
  const mediaActionMessages = useMemo(() => {
    return {
      downloadSuccess: t('ui:workspace.toast.downloadSuccess'),
      downloadInvalidPath: t('ui:workspace.toast.invalidFilePath'),
      downloadFailed: (reason: string) => t('ui:workspace.toast.downloadFailed', { reason }),
      copySuccess: t('ui:workspace.toast.copySuccess'),
      copyMissingPath: t('ui:workspace.toast.copyMissingPath'),
      copyFailed: (reason: string) => t('ui:workspace.toast.copyFailed', { reason }),
    }
  }, [t])
  const { download, copyImageToClipboard } = useMediaFileActions({
    notify,
    messages: mediaActionMessages,
  })

  const { deleteTask, clearFailedTasks, clearAllTasks } = useTaskCleanup({
    tasks,
    setTasks,
  })
  const imageEditStatesRef = useRef<Map<string, ImageEditState>>(new Map())
  const setUploadedImagesRef = useRef<React.Dispatch<React.SetStateAction<string[]>> | null>(null)
  const setUploadedFilePathsRef = useRef<React.Dispatch<React.SetStateAction<string[]>> | null>(null)
  const generationMessages = useMemo(() => {
    return {
      testModeIntercepted: t('ui:workspace.toast.testModeIntercepted'),
      missingInput: t('ui:alerts.missingInput.message'),
      genericGenerateFailed: t('ui:workspace.toast.generateFailed'),
    }
  }, [t])
  const { isGenerating, handleGenerate, handleContinuePolling } = useTaskGeneration({
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
  const { handleRegenerate, handleReedit } = useTaskReplay({
    handleGenerate,
    imageEditStatesRef,
  })
  const { showUpdateDialog, releaseInfo, currentVersion, closeUpdateDialog } = useUpdateCheck()
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const [isTestPanelOpen, setIsTestPanelOpen] = useState(false)
  useTestModeShortcuts({ togglePanel: () => setIsTestPanelOpen((v) => !v) })
  const { menuVisible, menuPosition, menuItems, showMenu, hideMenu } = useContextMenu()
  const listContainerRef = useRef<HTMLDivElement>(null)
  const [isUserAtBottom, setIsUserAtBottom] = useState(true)
  const {
    inputContainerRef,
    inputPadding,
    isPanelCollapsed,
    isCollapsing,
    expandPanelSmooth,
    handlePanelMouseEnter,
    handlePanelMouseLeave,
    handlePanelMouseMove,
  } = useBottomPanel({ listContainerRef })
  const [panelModelId, setPanelModelId] = useState('')
  const [panelPrompt, setPanelPrompt] = useState('')
  const scrollToBottom = useCallback((): void => {
    const el = listContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])
  const handleUsePrompt = useCallback((prompt: string): void => {
    if (!prompt.trim()) return
    window.dispatchEvent(new CustomEvent('reedit-content', { detail: { prompt } }))
    expandPanelSmooth()
  }, [expandPanelSmooth])
  const contentRef = useAutoScrollOnResize(isUserAtBottom, scrollToBottom)
  useEffect(() => {
    const el = listContainerRef.current
    if (!el) return
    const update = () => {
      const threshold = 8
      const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= threshold
      setIsUserAtBottom(atBottom)
    }
    update()
    el.addEventListener('scroll', update)
    return () => el.removeEventListener('scroll', update)
  }, [])
  useEffect(() => {
    if (!isTasksLoaded) return
    scrollToBottom()
  }, [isTasksLoaded, scrollToBottom])
  useEffect(() => {
    if (!isTasksLoaded) return
    if (!isUserAtBottom) return
    scrollToBottom()
  }, [isTasksLoaded, isUserAtBottom, scrollToBottom, tasks.length])
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false)
  const [currentImage, setCurrentImage] = useState('')
  const [currentImageList, setCurrentImageList] = useState<string[]>([])
  const [currentFilePathList, setCurrentFilePathList] = useState<string[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isEditorMode, setIsEditorMode] = useState(false)
  const [isFromUploadArea, setIsFromUploadArea] = useState(false)
  const openImageViewer = (url: string, list: string[], filePaths?: string[], fromUpload: boolean = false) => {
    setCurrentImage(url)
    setCurrentImageList(list)
    setCurrentImageIndex(Math.max(0, list.indexOf(url)))
    setCurrentFilePathList(filePaths ?? [])
    setIsFromUploadArea(fromUpload)
    setIsEditorMode(false)
    setIsImageViewerOpen(true)
  }
  const closeImageViewer = () => {
    setIsImageViewerOpen(false)
    setIsEditorMode(false)
  }
  const navigateImage = (direction: 'prev' | 'next') => {
    if (currentImageList.length === 0) return
    const nextIndex =
      direction === 'prev'
        ? (currentImageIndex > 0 ? currentImageIndex - 1 : currentImageList.length - 1)
        : (currentImageIndex < currentImageList.length - 1 ? currentImageIndex + 1 : 0)
    setCurrentImageIndex(nextIndex)
    setCurrentImage(currentImageList[nextIndex])
    setIsEditorMode(false)
  }
  const handleSaveImageEdit = (dataUrl: string, editState: ImageEditState) => {
    const nextState: ImageEditState = {
      ...editState,
      imageId: dataUrl,
      originalSrc: editState.originalSrc,
    }
    imageEditStatesRef.current.set(dataUrl, nextState)
    setCurrentImageList((prev) => {
      const next = [...prev]
      next[currentImageIndex] = dataUrl
      return next
    })
    setCurrentFilePathList((prev) => {
      if (!prev.length) return prev
      const next = [...prev]
      next[currentImageIndex] = ''
      return next
    })
    setCurrentImage(dataUrl)
    if (isFromUploadArea) {
      setUploadedImagesRef.current?.((prev) => {
        const next = [...prev]
        if (currentImageIndex < next.length) next[currentImageIndex] = dataUrl
        return next
      })
      setUploadedFilePathsRef.current?.((prev) => {
        const next = [...prev]
        while (next.length <= currentImageIndex) next.push('')
        next[currentImageIndex] = ''
        return next
      })
    }
  }
  const handleImageViewerContextMenu = (e: React.MouseEvent, filePath?: string) => {
    showMenu(e, [
      {
        id: 'copy-image',
        label: t('common:actions.copy'),
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        ),
        onClick: async () => copyImageToClipboard(filePath),
        disabled: !filePath,
      },
      {
        id: 'download-image',
        label: t('common:actions.download'),
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        ),
        onClick: async () => {
          if (filePath) await download(filePath, false)
        },
        disabled: !filePath,
      },
    ])
  }
  const [isVideoViewerOpen, setIsVideoViewerOpen] = useState(false)
  const [currentVideoUrl, setCurrentVideoUrl] = useState('')
  const [currentVideoPath, setCurrentVideoPath] = useState<string | undefined>(undefined)
  const [isAudioViewerOpen, setIsAudioViewerOpen] = useState(false)
  const [currentAudioUrl, setCurrentAudioUrl] = useState('')
  const [currentAudioPath, setCurrentAudioPath] = useState<string | undefined>(undefined)
  const [isTopFilterVisible, setIsTopFilterVisible] = useState(false)
  const [isTopFilterHovered, setIsTopFilterHovered] = useState(false)
  const filterHideTimerRef = useRef<number | null>(null)
  const hasActiveFiltersRef = useRef(hasActiveFilters)
  const isTopFilterHoveredRef = useRef(isTopFilterHovered)

  const clearFilterHideTimer = useCallback((): void => {
    if (filterHideTimerRef.current === null) return
    window.clearTimeout(filterHideTimerRef.current)
    filterHideTimerRef.current = null
  }, [])

  const showTopFilterBar = useCallback((): void => {
    clearFilterHideTimer()
    setIsTopFilterVisible(true)
  }, [clearFilterHideTimer])

  const requestHideTopFilterBar = useCallback((): void => {
    clearFilterHideTimer()
    filterHideTimerRef.current = window.setTimeout(() => {
      if (hasActiveFiltersRef.current || isTopFilterHoveredRef.current) {
        filterHideTimerRef.current = null
        return
      }
      setIsTopFilterVisible(false)
      filterHideTimerRef.current = null
    }, 220)
  }, [clearFilterHideTimer])

  const hideTopFilterBarWithDelay = useCallback((): void => {
    setIsTopFilterHovered(false)
    requestHideTopFilterBar()
  }, [requestHideTopFilterBar])

  useEffect(() => {
    if (!hasActiveFilters) return
    clearFilterHideTimer()
    setIsTopFilterVisible(true)
  }, [clearFilterHideTimer, hasActiveFilters])

  useEffect(() => {
    hasActiveFiltersRef.current = hasActiveFilters
  }, [hasActiveFilters])

  useEffect(() => {
    isTopFilterHoveredRef.current = isTopFilterHovered
  }, [isTopFilterHovered])

  useEffect(() => {
    if (hasActiveFilters) return
    if (isTopFilterHovered) return
    requestHideTopFilterBar()
  }, [hasActiveFilters, isTopFilterHovered, requestHideTopFilterBar])

  const handleCloseTopFilterBar = useCallback((): void => {
    clearFilterHideTimer()
    resetHistoryFilters()
    setIsTopFilterVisible(false)
  }, [clearFilterHideTimer, resetHistoryFilters])

  useEffect(() => {
    return () => clearFilterHideTimer()
  }, [clearFilterHideTimer])
  const openVideoViewer = (url?: string, filePath?: string) => {
    const rawUrl = typeof url === 'string' ? url : ''
    const normalizedFilePath = filePath ? splitMulti(filePath)[0] : undefined
    const normalizedUrl = normalizedFilePath
      ? convertFileSrc(normalizedFilePath.replace(/\\/g, '/'))
      : (rawUrl ? (splitMulti(rawUrl)[0] ?? '') : '')
    setCurrentVideoUrl(normalizedUrl)
    setCurrentVideoPath(normalizedFilePath)
    setIsVideoViewerOpen(true)
  }
  const closeVideoViewer = () => {
    setIsVideoViewerOpen(false)
    setCurrentVideoPath(undefined)
  }
  const openAudioViewer = (url?: string, filePath?: string) => {
    setCurrentAudioUrl(url || (filePath ? convertFileSrc(filePath.replace(/\\/g, '/')) : ''))
    setCurrentAudioPath(filePath)
    setIsAudioViewerOpen(true)
  }
  const closeAudioViewer = () => {
    setIsAudioViewerOpen(false)
    setCurrentAudioPath(undefined)
  }
  useEffect(() => {
    const handleOpenVideoViewer = (event: Event) => {
      const e = event as CustomEvent<{ url?: string; videoUrl?: string; filePath?: string }>
      const url = typeof e.detail.url === 'string' ? e.detail.url : e.detail.videoUrl
      openVideoViewer(url, e.detail.filePath)
    }
    window.addEventListener('open-video-viewer', handleOpenVideoViewer as EventListener)
    return () => window.removeEventListener('open-video-viewer', handleOpenVideoViewer as EventListener)
  }, [])
  useEffect(() => {
    const handleOpenAudioViewer = (event: Event) => {
      const e = event as CustomEvent<{ url?: string; audioUrl?: string; filePath?: string }>
      const url = typeof e.detail.url === 'string' ? e.detail.url : e.detail.audioUrl
      openAudioViewer(url, e.detail.filePath)
    }
    window.addEventListener('open-audio-viewer', handleOpenAudioViewer as EventListener)
    return () => window.removeEventListener('open-audio-viewer', handleOpenAudioViewer as EventListener)
  }, [])
  const handleDownloadFromViewer = async (filePath: string) => {
    await download(filePath, true)
  }
  return (
    <div className="h-full flex-1 bg-app text-white flex flex-col relative overflow-hidden">
      <NotificationToast notification={notification} visible={notificationVisible} />
      <main className="flex-1 flex flex-col relative z-10 pt-10">
        <div className="pointer-events-none absolute left-1/2 top-1 z-30 -translate-x-1/2">
          <div
            className="relative flex flex-col items-center pointer-events-auto"
            onPointerEnter={() => {
              setIsTopFilterHovered(true)
              showTopFilterBar()
            }}
            onPointerLeave={hideTopFilterBarWithDelay}
            onFocusCapture={() => {
              showTopFilterBar()
            }}
            onBlurCapture={(event) => {
              const nextFocusTarget = event.relatedTarget
              if (nextFocusTarget instanceof Node && event.currentTarget.contains(nextFocusTarget)) return
              if (hasActiveFilters) return
              requestHideTopFilterBar()
            }}
          >
            <div className="pointer-events-auto absolute -top-6 h-16 w-[980px] max-w-[98vw]" />
            <div className={`pointer-events-none transition-[opacity,transform] duration-220 ease-out ${
              (isTopFilterVisible || hasActiveFilters)
                ? 'pointer-events-auto translate-y-0 opacity-100'
                : '-translate-y-2 opacity-0'
            }`}>
              <UiTaskHistoryFilterBar
                mode="always"
                showCloseButton
                keyword={filterKeyword}
                providerId={filterProviderId}
                modelId={filterModelId}
                mediaType={filterMediaType}
                timePreset={filterTimePreset}
                startDate={filterStartDate}
                endDate={filterEndDate}
                providerOptions={providerFilterOptions}
                modelOptions={modelFilterOptions}
                mediaOptions={mediaFilterOptions}
                onKeywordChange={setFilterKeyword}
                onProviderChange={handleProviderFilterChange}
                onModelChange={setFilterModelId}
                onMediaTypeChange={setFilterMediaType}
                onTimePresetChange={setFilterTimePreset}
                onStartDateChange={setFilterStartDate}
                onEndDateChange={setFilterEndDate}
                onClose={handleCloseTopFilterBar}
              />
            </div>
          </div>
        </div>
        <div
          ref={listContainerRef}
          className="flex-1 overflow-y-auto p-4 app-scroll-container"
          style={{ paddingBottom: inputPadding }}
        >
          <div ref={contentRef}>
            <TaskList
              tasks={filteredTasks}
              totalCount={tasks.length}
              matchedCount={matchedCount}
              hasActiveFilters={hasActiveFilters}
              showMenu={showMenu}
              onDownload={download}
              onCopyImage={copyImageToClipboard}
              onRegenerate={handleRegenerate}
              onRetryPolling={handleContinuePolling}
              onReedit={handleReedit}
              onDelete={deleteTask}
              onUsePrompt={handleUsePrompt}
              onOpenImageViewer={(url, list, filePaths) => openImageViewer(url, list, filePaths, false)}
              onOpenVideoViewer={openVideoViewer}
            />
          </div>
        </div>
        <FloatingInputPanel
          containerRef={inputContainerRef}
          isCollapsed={isPanelCollapsed}
          isCollapsing={isCollapsing}
          modelLabel={panelModelId ? getModelDisplayName(panelModelId) : ''}
          prompt={panelPrompt}
          maxWidthPx={FLOATING_INPUT_PANEL_MAX_WIDTH_PX}
          onExpand={expandPanelSmooth}
          onMouseEnter={handlePanelMouseEnter}
          onMouseLeave={handlePanelMouseLeave}
          onMouseMove={handlePanelMouseMove}
        >
          <MediaGenerator
            onGenerate={handleGenerate}
            isLoading={isGenerating}
            isGenerating={isGenerating}
            onOpenClearHistory={() => setIsClearDialogOpen(true)}
            onImageClick={(url: string, list: string[]) => openImageViewer(url, list, undefined, true)}
            onSetUploadedImagesRef={(setter) => {
              setUploadedImagesRef.current = setter
            }}
            onSetUploadedFilePathsRef={(setter) => {
              setUploadedFilePathsRef.current = setter
            }}
            onStateChange={(state) => {
              setPanelModelId(state.modelId)
              setPanelPrompt(state.prompt)
            }}
          />
        </FloatingInputPanel>
      </main>
      <ClearHistoryDialog
        open={isClearDialogOpen}
        onClose={() => setIsClearDialogOpen(false)}
        onClearFailed={clearFailedTasks}
        onClearAll={clearAllTasks}
      />
      <ImageViewerModal
        open={isImageViewerOpen}
        imageUrl={currentImage}
        imageList={currentImageList}
        filePaths={currentFilePathList}
        currentIndex={currentImageIndex}
        fromUpload={isFromUploadArea}
        isEditorMode={isEditorMode}
        initialEditState={imageEditStatesRef.current.get(currentImage)}
        onClose={closeImageViewer}
        onNavigate={navigateImage}
        onEnterEditor={() => setIsEditorMode(true)}
        onExitEditor={() => setIsEditorMode(false)}
        onSaveEdit={handleSaveImageEdit}
        onContextMenu={handleImageViewerContextMenu}
      />
      <VideoViewerModal
        open={isVideoViewerOpen}
        videoUrl={currentVideoUrl}
        filePath={currentVideoPath}
        onClose={closeVideoViewer}
        onDownload={(filePath) => void handleDownloadFromViewer(filePath)}
      />
      <AudioViewerModal
        open={isAudioViewerOpen}
        audioUrl={currentAudioUrl}
        filePath={currentAudioPath}
        onClose={closeAudioViewer}
      />
      <ContextMenu items={menuItems} position={menuPosition} onClose={hideMenu} visible={menuVisible} />
      {showUpdateDialog && releaseInfo && (
        <UpdateDialog
          releaseInfo={releaseInfo}
          currentVersion={currentVersion}
          onClose={closeUpdateDialog}
        />
      )}
      <TestModeIndicator onOpenPanel={() => setIsTestPanelOpen(true)} />
      <TestModePanel isOpen={isTestPanelOpen} onClose={() => setIsTestPanelOpen(false)} />
    </div>
  )
}

export default GenerationWorkspace
