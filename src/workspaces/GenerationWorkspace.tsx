import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toDisplaySrc } from '@/platform/desktopApi'
import MediaGenerator from '@/components/MediaGenerator'
import ContextMenu from '@/components/ContextMenu'
import UpdateDialog from '@/components/UpdateDialog'
import TestModeIndicator from '@/components/TestModeIndicator'
import TestModePanel from '@/components/TestModePanel'
import { UiSharedGlassHost, UiTaskHistoryFilterBar } from '@/components/ui'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useI18n } from '@/hooks/useI18n'
import { getModelDisplayName } from '@/utils/modelHelpers'
import type { ImageEditSession } from '@/core/imageEdit'
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
import { useGenerationTaskProgressStore } from '@/stores/generationTaskProgressStore'
import { useAutoResumePolling } from './GenerationWorkspace/hooks/useAutoResumePolling'
import { useTestModeShortcuts } from './GenerationWorkspace/hooks/useTestModeShortcuts'
import { useToast } from './GenerationWorkspace/hooks/useToast'
import { useUpdateCheck } from './GenerationWorkspace/hooks/useUpdateCheck'
import { useGenerationHistoryFiltering } from './GenerationWorkspace/hooks/useGenerationHistoryFiltering'
import { useGenerationAutoScroll } from './GenerationWorkspace/hooks/useGenerationAutoScroll'
import { splitMulti } from './GenerationWorkspace/utils/multiFile'
import { Copy, Download } from 'lucide-react'

const FLOATING_INPUT_PANEL_MAX_WIDTH_PX = 1100

// 稳定引用：删除/清空任务时清掉对应的瞬态进度，避免 store 里残留已结束任务的条目
const clearGenerationTaskProgress = (taskId: string): void =>
  useGenerationTaskProgressStore.getState().clearProgress(taskId)

const GenerationWorkspace: React.FC = () => {
  const { t } = useI18n()
  useDataDirectoryInit()
  const {
    tasks,
    setTasks,
    updateTask,
    updateProgress,
    rememberResultImageDimensions,
  } = useTaskState()
  const [isTasksLoaded, setIsTasksLoaded] = useState(false)
  const isInitialLoadRef = useRef(true)
  useLoadTaskHistory({ setTasks, setIsTasksLoaded, isInitialLoadRef })
  useSaveTaskHistory({ tasks, isTasksLoaded, isInitialLoadRef })
  const {
    filterKeyword,
    filterProviderId,
    filterModelId,
    filterMediaType,
    filterTimePreset,
    filterStartDate,
    filterEndDate,
    setFilterKeyword,
    setFilterModelId,
    setFilterMediaType,
    setFilterTimePreset,
    setFilterStartDate,
    setFilterEndDate,
    resetHistoryFilters,
    filteredTasks,
    matchedCount,
    hasActiveFilters,
    providerFilterOptions,
    modelFilterOptions,
    mediaFilterOptions,
    handleProviderFilterChange,
  } = useGenerationHistoryFiltering(tasks)
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
    clearTaskProgress: clearGenerationTaskProgress,
  })
  const imageEditStatesRef = useRef<Map<string, ImageEditSession>>(new Map())
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
  const { handleRegenerate, handleReedit } = useTaskReplay({
    handleGenerate,
    imageEditStatesRef,
  })
  const { showUpdateDialog, releaseInfo, currentVersion, closeUpdateDialog } = useUpdateCheck()
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const [isTestPanelOpen, setIsTestPanelOpen] = useState(false)
  useTestModeShortcuts({ togglePanel: () => setIsTestPanelOpen((v) => !v) })
  const { menuVisible, menuPosition, menuItems, showMenu, hideMenu } = useContextMenu()
  const { listContainerRef, contentRef } = useGenerationAutoScroll(isTasksLoaded, tasks.length)
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
  const handleUsePrompt = useCallback((prompt: string): void => {
    if (!prompt.trim()) return
    window.dispatchEvent(new CustomEvent('reedit-content', { detail: { prompt } }))
    expandPanelSmooth()
  }, [expandPanelSmooth])
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
  const handleSaveImageEdit = (dataUrl: string, session: ImageEditSession) => {
    imageEditStatesRef.current.set(dataUrl, session)
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
          <Copy className="w-4 h-4" />
        ),
        onClick: async () => copyImageToClipboard(filePath),
        disabled: !filePath,
      },
      {
        id: 'download-image',
        label: t('common:actions.download'),
        icon: (
          <Download className="w-4 h-4" />
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
  const [currentVideoTrimRange, setCurrentVideoTrimRange] = useState<{ start: number; end: number } | undefined>(undefined)
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
  const openVideoViewer = (url?: string, filePath?: string, trimRange?: { start: number; end: number }) => {
    const rawUrl = typeof url === 'string' ? url : ''
    const normalizedFilePath = filePath ? splitMulti(filePath)[0] : undefined
    const normalizedUrl = normalizedFilePath
      ? toDisplaySrc(normalizedFilePath.replace(/\\/g, '/'))
      : (rawUrl ? (splitMulti(rawUrl)[0] ?? '') : '')
    setCurrentVideoUrl(normalizedUrl)
    setCurrentVideoPath(normalizedFilePath)
    setCurrentVideoTrimRange(trimRange)
    setIsVideoViewerOpen(true)
  }
  const closeVideoViewer = () => {
    setIsVideoViewerOpen(false)
    setCurrentVideoPath(undefined)
  }
  const openAudioViewer = (url?: string, filePath?: string) => {
    setCurrentAudioUrl(url || (filePath ? toDisplaySrc(filePath.replace(/\\/g, '/')) : ''))
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
      <main className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-1 z-30 flex justify-center px-2">
          <div
            className="pointer-events-auto relative flex w-full max-w-[980px] flex-col items-center"
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
            <div className="pointer-events-auto absolute inset-x-0 -top-6 h-16" />
            <div className={`pointer-events-none transition-[opacity,transform] duration-200 ${
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
        <UiSharedGlassHost
          ref={listContainerRef}
          minTargets={4}
          className="app-scroll-container min-h-0 flex-1 overflow-y-auto p-6"
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
              onRememberResultImageDimensions={rememberResultImageDimensions}
              onOpenImageViewer={(url, list, filePaths) => openImageViewer(url, list, filePaths, false)}
              onOpenVideoViewer={openVideoViewer}
              notify={notify}
            />
          </div>
        </UiSharedGlassHost>
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
        initialEditSession={imageEditStatesRef.current.get(currentImage)}
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
        trimRange={currentVideoTrimRange}
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
