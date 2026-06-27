import React from "react"
import { toDisplaySrc } from '@/platform/desktopApi'
import { useI18n } from "@/hooks/useI18n"
import type { MenuItem } from "@/hooks/useContextMenu"
import { ProgressBar } from "@/components/ui/ProgressBar"
import { UiButton, UiIconButton } from "@/components/ui"
import AudioPlayer from "@/components/AudioPlayer"
import { getModelDisplayName } from "@/utils/modelHelpers"
import type { GenerationTask } from "../types"
import { splitMulti } from "../utils/multiFile"
import { TaskInputPreview } from "./TaskInputPreview"
import { TaskPrompt } from "./TaskPrompt"
import { CopyIcon, DownloadIcon, UsePromptIcon } from "./TaskActionIcons"
import { useHistoryDrag } from "../hooks/useHistoryDrag"

export interface TaskCardProps {
  task: GenerationTask
  progress: number | undefined
  onDownload: (filePath: string, fromButton?: boolean) => Promise<void>
  onCopyImage: (filePath?: string) => Promise<void>
  onRegenerate: (task: GenerationTask) => Promise<void>
  onRetryPolling: (task: GenerationTask) => Promise<void>
  onReedit: (task: GenerationTask) => void
  onDelete: (taskId: string) => Promise<void>
  onUsePrompt: (prompt: string) => void
  onOpenImageViewer: (url: string, list: string[], filePaths?: string[]) => void
  onOpenVideoViewer: (url: string, filePath?: string) => void
  showMenu: (e: React.MouseEvent, items: MenuItem[]) => void
}

const TaskCard = React.memo(function TaskCard({
  task,
  progress: progressValue,
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
}: TaskCardProps): JSX.Element {
  const { t, i18n } = useI18n()
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
    if (task.status === "queued") {
      return (
        <div className="flex items-center justify-center h-64 bg-layer rounded-lg border-2 border-blue-500/30">
          <div className="text-center">
            <p className="text-blue-400 font-medium">{t("ui:workspace.status.queued")}</p>
            <p className="text-zinc-400 text-sm mt-2">{t("ui:workspace.status.waiting")}</p>
          </div>
        </div>
      )
    }

    if (task.status === "pending") {
      return (
        <div className="flex items-center justify-center h-64 bg-layer rounded-lg">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent mb-2" />
            <p className="text-zinc-400">{t("ui:workspace.status.preparing")}</p>
          </div>
        </div>
      )
    }

    if (task.status === "generating") {
      return (
        <div className="flex items-center justify-center h-64 bg-layer rounded-lg">
          <div className="text-center w-full px-6">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent mb-3" />
            <p className="text-zinc-400 mb-3">{t("ui:workspace.status.generating")}</p>
            {progressValue !== undefined && (
              <ProgressBar progress={progressValue} className="mt-3" duration={progressValue >= 99 ? 450 : 2800} />
            )}
          </div>
        </div>
      )
    }

    if (task.status === "error") {
      return (
        <div className="flex items-center justify-center h-64 bg-app rounded-lg border-2 border-red-500/20">
          <div className="text-center w-full px-6">
            <p className="text-red-300 font-medium mb-2">{t("common:error")}</p>
            <p className="text-zinc-300 text-sm break-words">{task.error || t("common:status.failed")}</p>
            <div className="mt-5 flex justify-center">
              <UiButton variant="primary" size="sm" className="h-9 px-4" onClick={() => onRetryPolling(task)}>
                {t("ui:retry")}
              </UiButton>
            </div>
          </div>
        </div>
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
                className="relative w-64 bg-layer rounded-lg overflow-hidden border border-zinc-700/50"
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
          className="relative w-64 bg-layer rounded-lg overflow-hidden border border-zinc-700/50 cursor-pointer"
          onClick={() => handleVideoClick(videoUrl, filePath)}
          onContextMenu={(e) =>
            showMenu(e, [
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
    <div className="rounded-xl p-3">
      <div className="flex items-start gap-3">
        <TaskInputPreview
          taskId={task.id}
          inputImages={inputImages}
          inputVideos={inputVideos}
          uploadedFilePaths={task.uploadedFilePaths}
          uploadedVideoFilePaths={task.uploadedVideoFilePaths}
          onOpenImage={handleImageClick}
          onOpenVideo={handleVideoClick}
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
                <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded">
                  {typeLabel}
                </span>
                <span className="bg-accent/10 border border-accent/40 text-brand-300 px-2 py-0.5 rounded">
                  {modelName}
                </span>
                {task.dimensions && (
                  <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded">
                    {task.dimensions}
                  </span>
                )}
                {task.type === "video" && task.duration && (
                  <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded">{task.duration}</span>
                )}
                {task.type === "audio" && task.duration && (
                  <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded">{task.duration}</span>
                )}
                {createdAtLabel && (
                  <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded text-zinc-400">
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
  // Only re-render when task or progress actually changed
  return prev.task === next.task && prev.progress === next.progress
})

export default TaskCard
