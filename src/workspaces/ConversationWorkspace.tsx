import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MediaGenerator from '@/components/MediaGenerator'
import SettingsModal from '@/components/Settings'
import ContextMenu from '@/components/ContextMenu'
import UpdateDialog from '@/components/UpdateDialog'
import TestModeIndicator from '@/components/TestModeIndicator'
import TestModePanel from '@/components/TestModePanel'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useI18n } from '@/hooks/useI18n'
import { getModelDisplayName } from '@/utils/modelHelpers'
import type { ImageEditState } from '@/components/ImageEditor'
import { FloatingInputPanel } from './ConversationWorkspace/components/FloatingInputPanel'
import { NotificationToast } from './ConversationWorkspace/components/NotificationToast'
import { ClearHistoryDialog } from './ConversationWorkspace/components/ClearHistoryDialog'
import { ImageViewerModal } from './ConversationWorkspace/components/ImageViewerModal'
import { VideoViewerModal } from './ConversationWorkspace/components/VideoViewerModal'
import { TaskList } from './ConversationWorkspace/components/TaskList'
import { useBottomPanel } from './ConversationWorkspace/hooks/useBottomPanel'
import { useDataDirectoryInit } from './ConversationWorkspace/hooks/useDataDirectoryInit'
import { useLoadTaskHistory, useSaveTaskHistory } from './ConversationWorkspace/hooks/useTaskHistory'
import { useMediaFileActions } from './ConversationWorkspace/hooks/useMediaFileActions'
import { useTaskCleanup } from './ConversationWorkspace/hooks/useTaskCleanup'
import { useTaskGeneration } from './ConversationWorkspace/hooks/useTaskGeneration'
import { useTaskReplay } from './ConversationWorkspace/hooks/useTaskReplay'
import { useTaskState } from './ConversationWorkspace/hooks/useTaskState'
import { useTestModeShortcuts } from './ConversationWorkspace/hooks/useTestModeShortcuts'
import { useToast } from './ConversationWorkspace/hooks/useToast'
import { useUpdateCheck } from './ConversationWorkspace/hooks/useUpdateCheck'
import { useAutoScrollOnResize } from './ConversationWorkspace/hooks/useAutoScrollOnResize'

const ConversationWorkspace: React.FC = () => {
  const { t } = useI18n()
  useDataDirectoryInit()
  const { tasks, setTasks, taskProgress, setTaskProgress, updateTask, updateProgress } = useTaskState()
  const [isTasksLoaded, setIsTasksLoaded] = useState(false)
  const isInitialLoadRef = useRef(true)
  useLoadTaskHistory({ setTasks, setIsTasksLoaded, isInitialLoadRef })
  useSaveTaskHistory({ tasks, isTasksLoaded, isInitialLoadRef })
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
  const clearTaskProgress = useCallback((taskId: string): void => {
    setTaskProgress((prev) => {
      if (!(taskId in prev)) return prev
      const next = { ...prev }
      delete next[taskId]
      return next
    })
  }, [setTaskProgress])
  const { deleteTask, clearFailedTasks, clearAllTasks } = useTaskCleanup({
    tasks,
    setTasks,
    clearTaskProgress,
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
  const { isGenerating, handleGenerate } = useTaskGeneration({
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
  const { handleRegenerate, handleReedit } = useTaskReplay({
    handleGenerate,
    imageEditStatesRef,
  })
  const { showUpdateDialog, releaseInfo, currentVersion, closeUpdateDialog } = useUpdateCheck()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
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
    imageEditStatesRef.current.set(dataUrl, editState)
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
  const openVideoViewer = (url: string, filePath?: string) => {
    setCurrentVideoUrl(url)
    setCurrentVideoPath(filePath)
    setIsVideoViewerOpen(true)
  }
  const closeVideoViewer = () => {
    setIsVideoViewerOpen(false)
    setCurrentVideoPath(undefined)
  }
  useEffect(() => {
    const handleOpenVideoViewer = (event: Event) => {
      const e = event as CustomEvent<{ url: string; filePath?: string }>
      openVideoViewer(e.detail.url, e.detail.filePath)
    }
    window.addEventListener('open-video-viewer', handleOpenVideoViewer as EventListener)
    return () => window.removeEventListener('open-video-viewer', handleOpenVideoViewer as EventListener)
  }, [])
  const handleDownloadFromViewer = async (filePath: string) => {
    await download(filePath, true)
  }
  return (
    <div className="h-full flex-1 bg-[#0a0b0d] text-white flex flex-col relative overflow-hidden">
      <NotificationToast notification={notification} visible={notificationVisible} />
      <main className="flex-1 flex flex-col relative z-10 pt-10">
        <div
          ref={listContainerRef}
          className="flex-1 overflow-y-auto p-4 app-scroll-container"
          style={{ paddingBottom: inputPadding }}
        >
          <div ref={contentRef}>
            <TaskList
              tasks={tasks}
              taskProgress={taskProgress}
              showMenu={showMenu}
              onDownload={download}
              onCopyImage={copyImageToClipboard}
              onRegenerate={handleRegenerate}
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
          onExpand={expandPanelSmooth}
          onMouseEnter={handlePanelMouseEnter}
          onMouseLeave={handlePanelMouseLeave}
          onMouseMove={handlePanelMouseMove}
        >
          <MediaGenerator
            onGenerate={handleGenerate}
            isLoading={isGenerating}
            isGenerating={isGenerating}
            onOpenSettings={() => setIsSettingsOpen(true)}
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
      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
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
        onDownload={(filePath) => void handleDownloadFromViewer(filePath)}
        onContextMenu={handleImageViewerContextMenu}
      />
      <VideoViewerModal
        open={isVideoViewerOpen}
        videoUrl={currentVideoUrl}
        filePath={currentVideoPath}
        onClose={closeVideoViewer}
        onDownload={(filePath) => void handleDownloadFromViewer(filePath)}
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

export default ConversationWorkspace
