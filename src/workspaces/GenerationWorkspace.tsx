import { useGenerationLifecycleContext } from '@/features/generation/application/generationLifecycle'
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
import { useOnboardingState } from '@/features/onboarding/application/useOnboardingState'
import { getModelDisplayName } from '@/utils/modelHelpers'
import { FloatingInputPanel } from './GenerationWorkspace/components/FloatingInputPanel'
import { GenerationHistoryToolbar } from './GenerationWorkspace/components/GenerationHistoryToolbar'
import { NotificationToast } from './GenerationWorkspace/components/NotificationToast'
import { ClearHistoryDialog } from './GenerationWorkspace/components/ClearHistoryDialog'
import { ImageViewerModal } from '@/components/mediaViewer/ImageViewerModal'
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal'
import { AudioViewerModal } from '@/components/mediaViewer/AudioViewerModal'
import { TaskList } from './GenerationWorkspace/components/TaskList'
import { useBottomPanel } from './GenerationWorkspace/hooks/useBottomPanel'
import { useMediaFileActions } from './GenerationWorkspace/hooks/useMediaFileActions'
import { useTaskCleanup } from './GenerationWorkspace/hooks/useTaskCleanup'
import { useTaskReplay } from './GenerationWorkspace/hooks/useTaskReplay'
import { useGenerationTaskProgressStore } from '@/stores/generationTaskProgressStore'
import { useTestModeShortcuts } from './GenerationWorkspace/hooks/useTestModeShortcuts'
import { useUpdateCheck } from './GenerationWorkspace/hooks/useUpdateCheck'
import { useGenerationHistoryFiltering } from './GenerationWorkspace/hooks/useGenerationHistoryFiltering'
import { useGenerationAutoScroll } from './GenerationWorkspace/hooks/useGenerationAutoScroll'
import { useGenerationImageViewer } from './GenerationWorkspace/hooks/useGenerationImageViewer'
import { splitMulti } from './GenerationWorkspace/utils/multiFile'
import { Copy, Download } from 'lucide-react'

// 与历史列的外框（max-w-4xl = 896）同宽：输入卡片两侧比记录文字各宽出一档留白（设计稿 Generation）
const FLOATING_INPUT_PANEL_MAX_WIDTH_PX = 896
const FLOATING_INPUT_PANEL_GUTTER_PX = 24

// 稳定引用：删除/清空任务时清掉对应的瞬态进度，避免 store 里残留已结束任务的条目
const clearGenerationTaskProgress = (taskId: string): void =>
  useGenerationTaskProgressStore.getState().clearProgress(taskId)

const GenerationWorkspace: React.FC = () => {
  const { t } = useI18n()
  const { tasks, setTasks, rememberResultImageDimensions, isTasksLoaded, isGenerating,
    handleGenerate, handleContinuePolling, imageEditStatesRef, setUploadedImagesRef,
    setUploadedFilePathsRef, notification, notificationVisible, notify } = useGenerationLifecycleContext()
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
    isCompactLayout,
    isPanelCollapsed,
    isCollapsing,
    expandPanelSmooth,
    handlePanelMouseEnter,
    handlePanelMouseLeave,
    handlePanelMouseMove,
  } = useBottomPanel({ listContainerRef })
  const onboarding = useOnboardingState()
  useEffect(() => {
    if (!onboarding.firstTaskPrepared || onboarding.firstTaskCompleted) return
    expandPanelSmooth()
  }, [expandPanelSmooth, onboarding.firstTaskCompleted, onboarding.firstTaskPrepared])
  const [panelModelId, setPanelModelId] = useState('')
  const [panelPrompt, setPanelPrompt] = useState('')
  const handleUsePrompt = useCallback((prompt: string): void => {
    if (!prompt.trim()) return
    window.dispatchEvent(new CustomEvent('reedit-content', { detail: { prompt } }))
    expandPanelSmooth()
  }, [expandPanelSmooth])
  const {
    isImageViewerOpen,
    currentImage,
    currentImageList,
    currentFilePathList,
    currentImageIndex,
    isEditorMode,
    isFromUploadArea,
    openImageViewer,
    closeImageViewer,
    navigateImage,
    enterImageEditor,
    exitImageEditor,
    handleSaveImageEdit,
    handleImageEditSessionChange,
  } = useGenerationImageViewer({
    imageEditStatesRef,
    setUploadedImagesRef,
    setUploadedFilePathsRef,
  })
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
  // 搜索与筛选条：由命令带的搜索按钮展开；带着生效中的筛选进入页面时默认展开
  const [isSearchOpen, setIsSearchOpen] = useState(hasActiveFilters)
  const searchStripRef = useRef<HTMLDivElement | null>(null)
  const toggleSearch = useCallback((): void => {
    setIsSearchOpen((open) => !open)
  }, [])
  useEffect(() => {
    if (!isSearchOpen) return
    searchStripRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [isSearchOpen])
  const handleCloseSearch = useCallback((): void => {
    resetHistoryFilters()
    setIsSearchOpen(false)
  }, [resetHistoryFilters])
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
    <div className="relative flex h-full flex-1 flex-col overflow-hidden bg-app text-text1">
      <NotificationToast notification={notification} visible={notificationVisible} />
      <main className="relative z-raised flex min-h-0 flex-1 flex-col">
        {/* 命令带：类型分段 + 搜索 + 更多；搜索展开时筛选条作为从属带紧贴其下（不另画底色与边框） */}
        <div className="mx-auto w-full max-w-4xl shrink-0 px-6 pt-3">
          <GenerationHistoryToolbar
            mediaType={filterMediaType}
            mediaOptions={mediaFilterOptions}
            onMediaTypeChange={setFilterMediaType}
            searchOpen={isSearchOpen}
            onToggleSearch={toggleSearch}
            hasActiveFilters={hasActiveFilters}
            matchedCount={matchedCount}
            totalCount={tasks.length}
            onOpenClearHistory={() => setIsClearDialogOpen(true)}
          />
          {isSearchOpen && (
            <div ref={searchStripRef} className="pb-1 pt-1">
              <UiTaskHistoryFilterBar
                mode="always"
                showCloseButton
                showMediaType={false}
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
                onClose={handleCloseSearch}
              />
            </div>
          )}
        </div>
        <UiSharedGlassHost
          ref={listContainerRef}
          minTargets={4}
          className="app-scroll-container min-h-0 flex-1 overflow-y-auto pt-4"
          style={{ paddingBottom: inputPadding }}
        >
          <div ref={contentRef}>
            <TaskList
              scrollContainerRef={listContainerRef}
              tasks={filteredTasks}
              totalCount={tasks.length}
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
          compact={isCompactLayout}
          isCollapsed={isPanelCollapsed}
          isCollapsing={isCollapsing}
          modelLabel={panelModelId ? getModelDisplayName(panelModelId) : ''}
          prompt={panelPrompt}
          maxWidthPx={FLOATING_INPUT_PANEL_MAX_WIDTH_PX}
          viewportGutterPx={FLOATING_INPUT_PANEL_GUTTER_PX}
          onExpand={expandPanelSmooth}
          onMouseEnter={handlePanelMouseEnter}
          onMouseLeave={handlePanelMouseLeave}
          onMouseMove={handlePanelMouseMove}
        >
          <MediaGenerator
            compact={isCompactLayout}
            onGenerate={handleGenerate}
            isLoading={isGenerating}
            isGenerating={isGenerating}
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
        onEnterEditor={enterImageEditor}
        onExitEditor={exitImageEditor}
        onSaveEdit={handleSaveImageEdit}
        onEditSessionChange={handleImageEditSessionChange}
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
