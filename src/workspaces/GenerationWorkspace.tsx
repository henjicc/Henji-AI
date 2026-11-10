import { GenerationAppMenus } from './GenerationWorkspace/components/GenerationAppMenus'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { useGenerationLifecycleContext } from '@/features/generation/application/generationLifecycle'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toDisplaySrc } from '@/platform/desktopApi'
import MediaGenerator from '@/components/MediaGenerator'
import ContextMenu from '@/components/ContextMenu'
import UpdateDialog from '@/components/UpdateDialog'
import TestModeIndicator from '@/components/TestModeIndicator'
import TestModePanel from '@/components/TestModePanel'
import { UiTaskHistoryFilterBar } from '@/components/ui'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useI18n } from '@/hooks/useI18n'
import { useOnboardingState } from '@/features/onboarding/application/useOnboardingState'
import { getModelDisplayName } from '@/utils/modelHelpers'
import { FloatingInputPanel } from './GenerationWorkspace/components/FloatingInputPanel'
import { GenerationHistoryToolbar } from './GenerationWorkspace/components/GenerationHistoryToolbar'
import { UiToast } from '@/components/ui/UiToast'
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
import { useGenerationHistoryFilterStore } from '@/stores/generationHistoryFilterStore'
import { useGenerationAutoScroll } from './GenerationWorkspace/hooks/useGenerationAutoScroll'
import { useGenerationImageViewer } from './GenerationWorkspace/hooks/useGenerationImageViewer'
import { GENERATION_COLUMN_MAX_WIDTH_CLASS, GENERATION_COLUMN_MAX_WIDTH_PX } from './GenerationWorkspace/generationColumn'
import { Clipboard, Copy, PanelBottom, PanelLeft } from 'lucide-react'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import { pasteClipboardImageToPrompt } from '@/contexts/promptClipboardPaste'
import { createLogger } from '@/core/logging'
import {
  GENERATION_SIDE_PANEL_MIN_WIDTH,
  readGenerationSidePanelWidth,
  resolveGenerationSidePanelMaxWidth,
  writeGenerationSidePanelWidth,
  GENERATION_SIDE_PANEL_MIN_WORKSPACE_WIDTH,
  setGenerationInputPanelPlacement,
  useGenerationInputPanelPlacement,
} from './GenerationWorkspace/inputPanelPlacement'
import { ICON_DOWNLOAD } from '@/core/theme/icons'

// 与历史列的外框同宽：输入卡片两侧比记录文字各宽出一档留白（设计稿 Generation）；列宽随窗口变宽，见 generationColumn
const FLOATING_INPUT_PANEL_MAX_WIDTH_PX = GENERATION_COLUMN_MAX_WIDTH_PX
const FLOATING_INPUT_PANEL_GUTTER_PX = 24

// 稳定引用：删除/清空任务时清掉对应的瞬态进度，避免 store 里残留已结束任务的条目
const clearGenerationTaskProgress = (taskId: string): void =>
  useGenerationTaskProgressStore.getState().clearProgress(taskId)

const logger = createLogger('workspaces.GenerationWorkspace')

/** 左侧输入面板与窗口左缘、记录列之间的留白 */
const SIDE_PANEL_GUTTER_PX = 16

/** 右键“粘贴”：图片走提示词的图片导入（同 Ctrl+V），文字插到提示词光标处。 */
async function pasteIntoPrompt(panel: HTMLElement | null): Promise<void> {
  if (await pasteClipboardImageToPrompt()) return
  const text = isDesktopRuntime() ? await getPlatform().clipboard.readText() : await navigator.clipboard.readText()
  const editor = panel?.querySelector<HTMLElement>('[data-onboarding-target="prompt"] [contenteditable="true"]')
  if (!text || !editor) return
  editor.focus()
  document.execCommand('insertText', false, text)
}

const GenerationWorkspace: React.FC = () => {
  const { t } = useI18n()
  const { tasks, setTasks, rememberResultImageDimensions, isTasksLoaded, isGenerating,
    handleGenerate, handleContinuePolling, imageEditStatesRef, setUploadedImagesRef,
    setUploadedFilePathsRef, notification, notificationVisible, notify } = useGenerationLifecycleContext()
  const includeCanvas = useGenerationHistoryFilterStore((state) => state.includeCanvas)
  const listedTasks = useMemo(() => includeCanvas ? tasks : tasks.filter((task) => !task.options?.__canvasGeneration), [includeCanvas, tasks])
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
  } = useGenerationHistoryFiltering(listedTasks)
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

  // 清除只作用于列表里看得到的记录，不悄悄删掉被隐藏的画布生成记录
  const { deleteTask, clearFailedTasks, clearAllTasks } = useTaskCleanup({
    tasks: listedTasks,
    setTasks,
    clearTaskProgress: clearGenerationTaskProgress,
  })
  const { handleRegenerate, handleReedit, handleContinue } = useTaskReplay({
    handleGenerate,
    imageEditStatesRef,
  })
  const { showUpdateDialog, releaseInfo, currentVersion, closeUpdateDialog } = useUpdateCheck()
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const [isTestPanelOpen, setIsTestPanelOpen] = useState(false)
  useTestModeShortcuts({ togglePanel: () => setIsTestPanelOpen((v) => !v) })
  const { menuVisible, menuPosition, menuItems, showMenu, hideMenu } = useContextMenu()
  const { listContainerRef, contentRef } = useGenerationAutoScroll(isTasksLoaded, listedTasks.length)
  const placement = useGenerationInputPanelPlacement()
  const mainRef = useRef<HTMLElement | null>(null)
  // 量外框宽度：停到左侧后 main 会加左内边距，量内容宽会让宽度在门槛两侧来回跳
  const [mainWidth, setMainWidth] = useState(() => window.innerWidth)
  useLayoutEffect(() => {
    const element = mainRef.current
    if (!element) return
    setMainWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setMainWidth(entry.borderBoxSize[0]?.inlineSize ?? element.getBoundingClientRect().width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // 窗口太窄时左侧放不下：临时排回底部，记住的位置不变，变宽后回到左侧
  const sideDocked = placement === 'left' && mainWidth >= GENERATION_SIDE_PANEL_MIN_WORKSPACE_WIDTH
  const [storedSideWidth, setStoredSideWidth] = useState(readGenerationSidePanelWidth)
  const sideMaxWidth = resolveGenerationSidePanelMaxWidth(mainWidth, SIDE_PANEL_GUTTER_PX, GENERATION_COLUMN_MAX_WIDTH_PX)
  // 窗口变窄时只按当前上限显示，记住的宽度不改，变宽后回到原宽度
  const sideWidth = Math.min(storedSideWidth, sideMaxWidth)
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
  } = useBottomPanel({ listContainerRef, sideDocked })
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
          <Copy className={`${UI_ICON_SIZE_CLASS.md}`} />
        ),
        onClick: async () => copyImageToClipboard(filePath),
        disabled: !filePath,
      },
      {
        id: 'download-image',
        label: t('common:actions.download'),
        icon: (
          <ICON_DOWNLOAD className={`${UI_ICON_SIZE_CLASS.md}`} />
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
    const normalizedFilePath = filePath || undefined
    const normalizedUrl = normalizedFilePath
      ? toDisplaySrc(normalizedFilePath.replace(/\\/g, '/'))
      : rawUrl
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
  const togglePlacement = useCallback((): void => {
    setGenerationInputPanelPlacement(placement === 'left' ? 'bottom' : 'left')
  }, [placement])
  const handleInputPanelContextMenu = (event: React.MouseEvent): void => {
    const panel = event.currentTarget as HTMLElement
    // 面板里打开的浮层经 portal 渲染，右键事件仍会冒泡到这里；只接管面板本身上的右键
    if (!(event.target instanceof Node) || !panel.contains(event.target)) return
    showMenu(event, [
      {
        id: 'paste',
        label: t('common:actions.paste'),
        icon: <Clipboard className={UI_ICON_SIZE_CLASS.md} />,
        onClick: () => { void pasteIntoPrompt(panel).catch((error: unknown) => logger.warn('输入面板粘贴失败', { event: 'generation.input_panel.paste_failed', error })) },
      },
      {
        id: 'toggle-placement',
        label: t(placement === 'left' ? 'ui:workspace.inputPanel.moveToBottom' : 'ui:workspace.inputPanel.moveToLeft'),
        icon: placement === 'left' ? <PanelBottom className={UI_ICON_SIZE_CLASS.md} /> : <PanelLeft className={UI_ICON_SIZE_CLASS.md} />,
        onClick: togglePlacement,
      },
    ])
  }
  const handleDownloadFromViewer = async (filePath: string) => {
    await download(filePath, true)
  }
  return (
    <div className="relative flex h-full flex-1 flex-col overflow-hidden bg-window text-text1">
      <GenerationAppMenus onSearch={toggleSearch} onClear={() => setIsClearDialogOpen(true)} hasTasks={listedTasks.length > 0}
        inputPanelPlacement={placement} onToggleInputPanelPlacement={togglePlacement} />
      {notification && <UiToast message={notification.message} tone={notification.type} visible={notificationVisible} />}
      <main
        ref={mainRef}
        className="relative z-raised flex min-h-0 flex-1 flex-col"
        style={sideDocked ? { paddingLeft: sideWidth + SIDE_PANEL_GUTTER_PX } : undefined}
      >
        {/* 命令带：类型分段 + 搜索 + 更多；搜索展开时筛选条作为从属带紧贴其下（不另画底色与边框） */}
        <div className={`mx-auto w-full ${GENERATION_COLUMN_MAX_WIDTH_CLASS} shrink-0 px-6 pt-3`}>
          <GenerationHistoryToolbar
            mediaType={filterMediaType}
            mediaOptions={mediaFilterOptions}
            onMediaTypeChange={setFilterMediaType}
            searchOpen={isSearchOpen}
            onToggleSearch={toggleSearch}
            hasActiveFilters={hasActiveFilters}
            matchedCount={matchedCount}
            totalCount={listedTasks.length}
            onOpenClearHistory={() => setIsClearDialogOpen(true)}
            includeCanvas={includeCanvas}
            onIncludeCanvasChange={useGenerationHistoryFilterStore.getState().setIncludeCanvas}
            trailingStatus={<TestModeIndicator onOpenPanel={() => setIsTestPanelOpen(true)} />}
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
        <div
          ref={listContainerRef}
          // 滚动条与其他主滚动区同一套（全局细滚动条，任务 5.8）；关闭滚动锚定，虚拟列表测高后不跳动
          data-generation-history-scroll
          className="relative isolate min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-auto [overflow-anchor:none] [scrollbar-gutter:stable] pt-4"
          style={{ paddingBottom: inputPadding }}
        >
          <div ref={contentRef}>
            <TaskList
              scrollContainerRef={listContainerRef}
              tasks={filteredTasks}
              totalCount={listedTasks.length}
              hasActiveFilters={hasActiveFilters}
              showMenu={showMenu}
              onDownload={download}
              onCopyImage={copyImageToClipboard}
              onRegenerate={handleRegenerate}
              onRetryPolling={handleContinuePolling}
              onReedit={handleReedit}
              onContinue={handleContinue}
              onDelete={deleteTask}
              onUsePrompt={handleUsePrompt}
              onRememberResultImageDimensions={rememberResultImageDimensions}
              onOpenImageViewer={(url, list, filePaths) => openImageViewer(url, list, filePaths, false)}
              onOpenVideoViewer={openVideoViewer}
              onOpenAudioViewer={openAudioViewer}
              notify={notify}
            />
          </div>
        </div>
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
          placement={sideDocked ? 'side' : 'bottom'}
          sideWidth={{ value: sideWidth, min: GENERATION_SIDE_PANEL_MIN_WIDTH, max: sideMaxWidth, onChange: setStoredSideWidth, onCommit: writeGenerationSidePanelWidth }}
          onContextMenu={handleInputPanelContextMenu}
        >
          <MediaGenerator
            arrangement={sideDocked ? 'side' : 'bar'}
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
      <TestModePanel isOpen={isTestPanelOpen} onClose={() => setIsTestPanelOpen(false)} />
    </div>
  )
}

export default GenerationWorkspace
