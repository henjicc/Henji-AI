import React from "react"
import { toDisplaySrc } from '@/platform/desktopApi'
import { useI18n } from "@/hooks/useI18n"
import type { MenuItem } from "@/hooks/useContextMenu"
import { ProgressBar } from "@/components/ui/ProgressBar"
import { getProgressTransitionDurationMs } from "@/core/progress/progressTracker"
import { useGenerationTaskProgressStore } from "@/stores/generationTaskProgressStore"
import {
  UiButton,
  UiEmpty,
  UiError,
  UiIconButton,
  UiLoading,
  UI_INSET_SURFACE_CLASS,
  UI_META_BADGE_ACCENT_CLASS,
  UI_META_BADGE_CLASS,
} from "@/components/ui"
import AudioPlayer from "@/components/AudioPlayer"
import { getModelDisplayName } from "@/utils/modelHelpers"
import type { GenerationTask } from "../types"
import { splitMulti } from "../utils/multiFile"
import { TaskInputPreview } from "./TaskInputPreview"
import { TaskPrompt } from "./TaskPrompt"
import { CopyIcon, DownloadIcon, UsePromptIcon } from "./TaskActionIcons"
import { useHistoryDrag } from "../hooks/useHistoryDrag"
import { FolderCheck, FolderPlus, MessageCircleQuestion } from 'lucide-react'
import { useAddToAssetLibrary } from '@/features/assets/hooks/useAddToAssetLibrary'
import { checkAssetPaths } from '@/commands/assetLibrary'
import { openAssistantForDiagnosis } from '@/features/assistant/diagnostics/openAssistantDiagnosis'

export interface TaskCardProps {
  task: GenerationTask
  onDownload: (filePath: string, fromButton?: boolean) => Promise<void>
  onCopyImage: (filePath?: string) => Promise<void>
  onRegenerate: (task: GenerationTask) => Promise<void>
  onRetryPolling: (task: GenerationTask) => Promise<void>
  onReedit: (task: GenerationTask) => void
  onDelete: (taskId: string) => Promise<void>
  onUsePrompt: (prompt: string) => void
  onOpenImageViewer: (url: string, list: string[], filePaths?: string[]) => void
  onOpenVideoViewer: (url: string, filePath?: string, trimRange?: { start: number; end: number }) => void
  showMenu: (e: React.MouseEvent, items: MenuItem[]) => void
  notify: (message: string, type?: 'success' | 'error') => void
}

/**
 * 结果区插槽：固定高度 + 内嵌表面。
 * 生成中/排队/失败都占同样高度，避免状态切换时列表跳动；
 * 用 inset（比页面底色更暗）读作"凹进去的待填充槽位"，而不是浮起来的卡片。
 */
const RESULT_SLOT_CLASS = `h-64 rounded-lg ${UI_INSET_SURFACE_CLASS}`

const TaskCard = React.memo(function TaskCard({
  task,
  onDownload,
  onCopyImage,
  onRegenerate,
  onRetryPolling,
  onReedit,
  onDelete,
  onUsePrompt,
  onOpenImageViewer,
  onOpenVideoViewer,
  showMenu,
  notify,
}: TaskCardProps): JSX.Element {
  const { t, i18n } = useI18n()
  // 进度自订阅：只有本任务进度变化时才重渲染这一张卡，不牵动整个工作区
  const progressValue = useGenerationTaskProgressStore((state) => state.progress[task.id])
  const { addMedia, collecting } = useAddToAssetLibrary()
  const resultFilePaths = React.useMemo(() => task.result?.filePath ? splitMulti(task.result.filePath) : [], [task.result?.filePath])
  const [collectedPaths, setCollectedPaths] = React.useState<Set<string>>(() => new Set())
  React.useEffect(() => {
    let cancelled = false
    if (resultFilePaths.length === 0) { setCollectedPaths(new Set()); return }
    void checkAssetPaths(resultFilePaths).then((statuses) => {
      if (!cancelled) setCollectedPaths(new Set(resultFilePaths.filter((_, index) => statuses[index])))
    }).catch(() => { if (!cancelled) setCollectedPaths(new Set()) })
    return () => { cancelled = true }
  }, [resultFilePaths])
  const collectionIcon = (filePath: string | undefined, className: string): React.ReactNode => filePath && collectedPaths.has(filePath)
    ? <FolderCheck className={`${className} text-emerald-400`} />
    : <FolderPlus className={className} />
  const collectResult = async (filePath: string | undefined, mediaType: 'image' | 'video' | 'audio'): Promise<void> => {
    if (!filePath) return
    try {
      const asset = await addMedia({ filePath, mediaType, source: 'generated' })
      setCollectedPaths((current) => new Set(current).add(filePath))
      notify(t(asset.wasExisting ? 'ui:assetLibrary.alreadyCollected' : 'ui:assetLibrary.collectSuccess'))
    } catch {
      notify(t('ui:assetLibrary.collectFailed'), 'error')
    }
  }
  const {
    startImageDrag,
    startVideoDrag,
    startImageNativeDrag,
    startVideoNativeDrag,
    endNativeDrag,
    isNativeFileDragEnabled,
    shouldIgnoreClick,
    markContextMenu
  } = useHistoryDrag()

  const formatDate = (value?: Date): string => {
    if (!value) return ""
    const locale = i18n.language || "zh-CN"
    return value.toLocaleString(locale, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  }

  const handleImageClick = (url: string, list: string[], filePaths: string[]) => {
    if (shouldIgnoreClick()) return
    // Use full-resolution URLs for the viewer (thumbnail URLs are for display only)
    const fullUrls = filePaths.length > 0
      ? filePaths.map(fp => toDisplaySrc(fp.replace(/\\\\/g, '/')))
      : list
    onOpenImageViewer(fullUrls[0], fullUrls, filePaths)
  }

  const handleVideoClick = (url: string, filePath?: string) => {
    if (shouldIgnoreClick()) return
    onOpenVideoViewer(url, filePath)
  }

  // 点击历史记录里"输入视频"的缩略图：如果这个任务有保存过的裁剪选区，
  // 把它带进播放器，让播放器只在选区内播放——结果视频不受影响，用 handleVideoClick。
  const handleInputVideoClick = (url: string, filePath?: string) => {
    if (shouldIgnoreClick()) return
    const trimStart = task.options?.uploadedVideoTrimStart
    const trimEnd = task.options?.uploadedVideoTrimEnd
    const trimRange = typeof trimStart === 'number' && typeof trimEnd === 'number'
      ? { start: trimStart, end: trimEnd }
      : undefined
    onOpenVideoViewer(url, filePath, trimRange)
  }

  const modelName = getModelDisplayName(task.model)
  const typeLabel = task.type === "image"
    ? t("ui:workspaceToolbar.filter.image")
    : task.type === "video"
      ? t("ui:workspaceToolbar.filter.video")
      : t("ui:workspaceToolbar.filter.audio")
  const createdAtLabel = formatDate(task.createdAt)
  const inputImages = task.images ?? []
  const inputVideos = task.videos ?? []

  const renderResult = () => {
    // 四种非成功状态统一走状态组件。h-64 必须保留：结果区高度固定，
    // 生成过程中状态切换才不会让整条历史列表跳动。
    if (task.status === "queued") {
      return (
        <UiEmpty
          size="sm"
          className={RESULT_SLOT_CLASS}
          title={t("ui:workspace.status.queued")}
          description={t("ui:workspace.status.waiting")}
        />
      )
    }

    if (task.status === "pending") {
      return (
        <UiLoading size="sm" className={RESULT_SLOT_CLASS} message={t("ui:workspace.status.preparing")} />
      )
    }

    if (task.status === "generating") {
      return (
        <UiLoading size="sm" className={RESULT_SLOT_CLASS} message={t("ui:workspace.status.generating")}>
          {progressValue !== undefined && (
            <ProgressBar progress={progressValue} duration={getProgressTransitionDurationMs(progressValue)} />
          )}
        </UiLoading>
      )
    }

    if (task.status === "error") {
      return (
        <UiError
          size="sm"
          className={RESULT_SLOT_CLASS}
          title={t("common:error")}
          message={task.error || t("common:status.failed")}
          onRetry={() => void onRetryPolling(task)}
          retryLabel={t("ui:retry")}
          actions={
            <UiButton
              variant="muted"
              size="sm"
              className="h-9 gap-1.5 px-4"
              onClick={() => openAssistantForDiagnosis({
                title: '生成任务失败',
                message: task.error || '生成任务失败',
                taskId: task.id,
                errorCode: 'GENERATION_FAILED',
                domain: 'core.services.GenerationService',
                occurredAt: task.createdAt.toISOString(),
              })}
            >
              <MessageCircleQuestion className="h-3.5 w-3.5" />问助手
            </UiButton>
          }
        />
      )
    }

    if (task.status !== "success" || !task.result) return null

    if (task.result.type === "image") {
      const urls = splitMulti(task.result.url)
      const filePaths = task.result.filePath ? splitMulti(task.result.filePath) : []

      return (
        <div className="flex flex-wrap gap-3">
          {urls.map((url, index) => {
            const filePath = filePaths[index]
            return (
              <div
                key={`${task.id}-img-${index}`}
                className={`relative w-64 overflow-hidden rounded-lg ${UI_INSET_SURFACE_CLASS}`}
                onClick={() => handleImageClick(url, urls, filePaths)}
                onContextMenu={(e) =>
                  showMenu(e, [
                    {
                      id: "copy-image",
                      label: t("common:actions.copy"),
                      icon: <CopyIcon className="w-4 h-4" />,
                      onClick: async () => onCopyImage(filePath),
                      disabled: !filePath,
                    },
                    {
                      id: "add-image-to-assets",
                      label: t("ui:assetLibrary.collect"),
                      icon: collectionIcon(filePath, 'w-4 h-4'),
                      onClick: () => void collectResult(filePath, 'image'),
                      disabled: !filePath || collecting,
                    },
                    {
                      id: "download-image",
                      label: t("common:actions.download"),
                      icon: <DownloadIcon className="w-4 h-4" />,
                      onClick: async () => { if (filePath) await onDownload(filePath, false) },
                      disabled: !filePath,
                    },
                  ])
                }
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  if (!filePath) return
                  e.stopPropagation()
                  startImageDrag(e, url, filePath)
                }}
                draggable={isNativeFileDragEnabled && Boolean(filePath)}
                onDragStart={(e) => startImageNativeDrag(e, url, filePath)}
                onDragEnd={endNativeDrag}
                onContextMenuCapture={() => markContextMenu()}
              >
                <img
                  src={url}
                  alt={t("ui:viewer.imageAlt")}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-auto block cursor-grab active:cursor-grabbing select-none"
                  draggable={false}
                  
               />
              </div>
            )
          })}
        </div>
      )
    }

    if (task.result.type === "video") {
      const urls = splitMulti(task.result.url)
      const filePaths = task.result.filePath ? splitMulti(task.result.filePath) : []
      const filePath = filePaths[0]
      const videoUrl = filePath ? toDisplaySrc(filePath.replace(/\\/g, "/")) : (urls[0] ?? "")
      return (
        <div
          className={`relative w-64 cursor-pointer overflow-hidden rounded-lg ${UI_INSET_SURFACE_CLASS}`}
          onClick={() => handleVideoClick(videoUrl, filePath)}
          onContextMenu={(e) =>
            showMenu(e, [
              {
                id: "add-video-to-assets",
                label: t("ui:assetLibrary.collect"),
                icon: collectionIcon(filePath, 'w-4 h-4'),
                onClick: () => void collectResult(filePath, 'video'),
                disabled: !filePath || collecting,
              },
              {
                id: "download-video",
                label: t("common:actions.download"),
                icon: <DownloadIcon className="w-4 h-4" />,
                onClick: async () => { if (filePath) await onDownload(filePath, false) },
                disabled: !filePath,
              },
            ])
          }
          onMouseDown={(e) => {
            if (e.button !== 0) return
            if (!filePath) return
            e.stopPropagation()
            startVideoDrag(e, videoUrl, filePath)
          }}
          draggable={isNativeFileDragEnabled && Boolean(filePath)}
          onDragStart={(e) => startVideoNativeDrag(e, videoUrl, filePath)}
          onDragEnd={endNativeDrag}
          onContextMenuCapture={() => markContextMenu()}
        >
          <video src={videoUrl} className="w-full h-auto block" draggable={false} muted preload="metadata" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="h-10 w-10 rounded-full bg-zinc-900/60 backdrop-blur-sm flex items-center justify-center text-white">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>
      )
    }

    if (task.result.type === "audio") {
      const filePath = task.result.filePath
      return (
        <AudioPlayer
          src={task.result.url}
          filePath={filePath}
          onContextMenu={(e) =>
            showMenu(e, [
              {
                id: "add-audio-to-assets",
                label: t("ui:assetLibrary.collect"),
                icon: collectionIcon(filePath, 'w-4 h-4'),
                onClick: () => void collectResult(filePath, 'audio'),
                disabled: !filePath || collecting,
              },
              {
                id: "download-audio",
                label: t("common:actions.download"),
                icon: <DownloadIcon className="w-4 h-4" />,
                onClick: async () => { if (filePath) await onDownload(filePath, false) },
                disabled: !filePath,
              },
            ])
          }
       />
      )
    }

    return null
  }

  return (
    <div className="rounded-xl p-3" data-generation-task-id={task.id} tabIndex={-1}>
      <div className="flex items-start gap-3">
        <TaskInputPreview
          taskId={task.id}
          inputImages={inputImages}
          inputVideos={inputVideos}
          uploadedFilePaths={task.uploadedFilePaths}
          uploadedVideoFilePaths={task.uploadedVideoFilePaths}
          onOpenImage={handleImageClick}
          onOpenVideo={handleInputVideoClick}
          onStartImageDrag={startImageDrag}
          onStartVideoDrag={startVideoDrag}
          onStartImageNativeDrag={startImageNativeDrag}
          onStartVideoNativeDrag={startVideoNativeDrag}
          onNativeDragEnd={endNativeDrag}
          nativeFileDragEnabled={isNativeFileDragEnabled}
          shouldIgnoreClick={shouldIgnoreClick}
       />
        <div className="min-w-0 flex-1 relative">
          <div className="pr-48">
            <TaskPrompt prompt={task.prompt} />
            <div className="flex items-center gap-3 mt-2 text-xs text-zinc-400">
              <div className="flex flex-wrap gap-2">
                <span className={UI_META_BADGE_CLASS}>
                  {typeLabel}
                </span>
                <span className={UI_META_BADGE_ACCENT_CLASS}>
                  {modelName}
                </span>
                {task.dimensions && (
                  <span className={UI_META_BADGE_CLASS}>
                    {task.dimensions}
                  </span>
                )}
                {task.type === "video" && task.duration && (
                  <span className={UI_META_BADGE_CLASS}>{task.duration}</span>
                )}
                {task.type === "audio" && task.duration && (
                  <span className={UI_META_BADGE_CLASS}>{task.duration}</span>
                )}
                {createdAtLabel && (
                  <span className={`${UI_META_BADGE_CLASS} text-zinc-400`}>
                    {createdAtLabel}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="absolute top-0 right-0 flex gap-2">
            <UiIconButton
              onClick={() => onUsePrompt(task.prompt)}
              className="!h-8 !w-8 bg-zinc-700/40 hover:bg-zinc-600/50"
              title={t("ui:workspace.actions.usePrompt")}
            >
              <UsePromptIcon className="h-4 w-4" />
            </UiIconButton>
            {task.result?.filePath && (
              <UiIconButton
                onClick={async () => {
                  for (const fp of splitMulti(task.result!.filePath!)) await collectResult(fp, task.type)
                }}
                disabled={collecting}
                className={`!h-8 !w-8 bg-zinc-700/40 hover:bg-zinc-600/50 ${resultFilePaths.length > 0 && resultFilePaths.every((filePath) => collectedPaths.has(filePath)) ? '!text-emerald-400' : ''}`}
                title={t("ui:assetLibrary.collect")}
              >
                {resultFilePaths.length > 0 && resultFilePaths.every((filePath) => collectedPaths.has(filePath)) ? <FolderCheck className="h-4 w-4" /> : <FolderPlus className="h-4 w-4" />}
              </UiIconButton>
            )}
            {task.result?.filePath && (
              <UiIconButton
                onClick={async () => {
                  for (const fp of splitMulti(task.result!.filePath!)) {
                    await onDownload(fp, true)
                  }
                }}
                className="!h-8 !w-8 bg-zinc-700/40 hover:bg-zinc-600/50"
                title={t("common:actions.download")}
              >
                <DownloadIcon className="h-4 w-4" />
              </UiIconButton>
            )}
            <UiIconButton
              onClick={() => onRegenerate(task)}
              className="!h-8 !w-8 bg-zinc-700/40 hover:bg-zinc-600/50"
              title={t("ui:workspace.actions.regenerate")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </UiIconButton>
            <UiIconButton
              onClick={() => onReedit(task)}
              className="!h-8 !w-8 bg-zinc-700/40 hover:bg-zinc-600/50"
              title={t("ui:workspace.actions.reedit")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </UiIconButton>
            <UiIconButton
              onClick={() => onDelete(task.id)}
              hoverVariant="danger"
              className="!h-8 !w-8 bg-zinc-700/40"
              title={t("common:delete")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </UiIconButton>
          </div>
        </div>
      </div>
      <div className="pt-3">{renderResult()}</div>
    </div>
  )
}, (prev, next) => {
  // 进度已改为组件内自订阅 store，这里只需比较 task 引用；
  // 进度变化通过 zustand selector 精准触发本卡重渲染
  return prev.task === next.task
})

export default TaskCard
