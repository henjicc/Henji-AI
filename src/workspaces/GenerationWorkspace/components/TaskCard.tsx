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
  UiLoading,
  UI_INSET_SURFACE_CLASS,
  UI_TEXT_META_CLASS,
  UI_META_BADGE_ACCENT_CLASS,
  UI_META_BADGE_CLASS,
} from "@/components/ui"
import AudioPlayer from "@/components/AudioPlayer"
import { getModelDisplayName } from "@/utils/modelHelpers"
import type { GenerationTask, ResultImageDimensions } from "../types"
import { splitMulti } from "../utils/multiFile"
import {
  getResultImageSlotHeight,
  resolveResultImageDimensions,
} from "../utils/resultImageDimensions"
import { TaskInputPreview } from "./TaskInputPreview"
import { TaskPrompt } from "./TaskPrompt"
import { CopyIcon, DownloadIcon } from "./TaskActionIcons"
import { TaskCardToolbar } from './TaskCardToolbar'
import { useHistoryDrag } from "../hooks/useHistoryDrag"
import { FolderCheck, FolderPlus, MessageCircleQuestion, Play } from 'lucide-react'
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
  onRememberResultImageDimensions: (
    taskId: string,
    imageIndex: number,
    dimensions: ResultImageDimensions
  ) => void
  onOpenImageViewer: (url: string, list: string[], filePaths?: string[]) => void
  onOpenVideoViewer: (url: string, filePath?: string, trimRange?: { start: number; end: number }) => void
  showMenu: (e: React.MouseEvent, items: MenuItem[]) => void
  notify: (message: string, type?: 'success' | 'error') => void
}
/**
 * 结果区插槽：内嵌表面 + 可预知高度。
 * 已知图片比例时提前匹配结果高度；缺少比例的旧任务回退到固定高度，
 * 避免生成状态切换或图片解码时让历史列表二次跳动。
 * 用 inset（比页面底色更暗）读作"凹进去的待填充槽位"，而不是浮起来的卡片。
 */
interface TaskStatusSlotProps {
  dimensions: ResultImageDimensions | null
  children: React.ReactNode
}

function TaskStatusSlot({ dimensions, children }: TaskStatusSlotProps): JSX.Element {
  const height = getResultImageSlotHeight(dimensions)
  return (
    <div
      className={`${height ? '' : 'h-64'} rounded-lg ${UI_INSET_SURFACE_CLASS}`}
      style={height ? { height } : undefined}
    >
      {children}
    </div>
  )
}
const TaskCard = React.memo(function TaskCard({
  task,
  onDownload,
  onCopyImage,
  onRegenerate,
  onRetryPolling,
  onReedit,
  onDelete,
  onUsePrompt,
  onRememberResultImageDimensions,
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
    // 查看器用 `imageList.indexOf(currentImage)` 反推初始索引，所以这里必须把
    // **被点的那一张**换算成对应的全分辨率 URL；此前固定传 fullUrls[0]，
    // 于是一组多图时点第几张都只会打开第一张。
    const clickedIndex = list.indexOf(url)
    const initialUrl = clickedIndex >= 0 && clickedIndex < fullUrls.length
      ? fullUrls[clickedIndex]
      : fullUrls[0]
    onOpenImageViewer(initialUrl, fullUrls, filePaths)
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
  const primaryResultImageDimensions = task.type === 'image'
    ? resolveResultImageDimensions(task, 0)
    : null
  const renderStatusSlot = (content: React.ReactNode): JSX.Element => (
    <TaskStatusSlot dimensions={primaryResultImageDimensions}>{content}</TaskStatusSlot>
  )

  const renderResult = () => {
    // 四种非成功状态统一走状态组件；已知图片比例时提前使用结果高度，
    // 未知比例时保留 h-64 作为老任务的稳定降级。
    if (task.status === "queued") {
      return renderStatusSlot(
        <UiEmpty
          size="sm"
          className="h-full"
          title={t("ui:workspace.status.queued")}
          description={t("ui:workspace.status.waiting")}
        />
      )
    }

    if (task.status === "pending") {
      return renderStatusSlot(
        <UiLoading size="sm" className="h-full" message={t("ui:workspace.status.preparing")} />
      )
    }

    if (task.status === "generating") {
      return renderStatusSlot(
        <UiLoading size="sm" className="h-full" message={t("ui:workspace.status.generating")}>
          {progressValue !== undefined && (
            <ProgressBar progress={progressValue} duration={getProgressTransitionDurationMs(progressValue)} />
          )}
        </UiLoading>
      )
    }

    if (task.status === "error") {
      return renderStatusSlot(
        <UiError
          size="sm"
          className="h-full"
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
            const imageDimensions = resolveResultImageDimensions(task, index)
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
                  width={imageDimensions?.width}
                  height={imageDimensions?.height}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-auto block cursor-grab active:cursor-grabbing select-none"
                  draggable={false}
                  onLoad={(event) => {
                    const { naturalWidth, naturalHeight } = event.currentTarget
                    if (naturalWidth <= 0 || naturalHeight <= 0) return
                    if (imageDimensions?.width === naturalWidth && imageDimensions.height === naturalHeight) return
                    onRememberResultImageDimensions(task.id, index, {
                      width: naturalWidth,
                      height: naturalHeight,
                    })
                  }}
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
            <div className="ui-glass h-10 w-10 rounded-full flex items-center justify-center text-white">
              <Play className="h-6 w-6" />
            </div>
          </div>
        </div>
      )
    }

    if (task.result.type === "audio") {
      const filePath = task.result.filePath
      return (
        <AudioPlayer
          surface="plain"
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
    // ⚠️ 这里曾经加过 `content-visibility:auto` + `contain-intrinsic-size:auto 420px`
    // 来跳过视口外卡片的布局，但任务卡高度差异极大（排队态约 120px，多图结果可到 800px），
    // 单一 420px 估算值在两个方向上都严重偏离：往回滚时占位高度被换成真实高度，
    // 视口上方的内容尺寸突变，滚动锚定晚一帧补偿，表现就是"闪一下又跳回来"。
    // content-visibility 只适合**行高基本一致**的长列表（如助手历史/记忆的等高行）。
    <div
      className="rounded-xl p-3"
      data-generation-task-id={task.id}
      tabIndex={-1}
    >
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
            <div className={`mt-2 flex items-center gap-3 ${UI_TEXT_META_CLASS}`}>
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
                  <span className={`${UI_META_BADGE_CLASS} text-text-muted`}>
                    {createdAtLabel}
                  </span>
                )}
              </div>
            </div>
          </div>

          <TaskCardToolbar
            task={task}
            collecting={collecting}
            allResultsCollected={
              resultFilePaths.length > 0 &&
              resultFilePaths.every((filePath) => collectedPaths.has(filePath))
            }
            onUsePrompt={() => onUsePrompt(task.prompt)}
            onCollectAll={async () => {
              for (const filePath of resultFilePaths) await collectResult(filePath, task.type)
            }}
            onDownloadAll={async () => {
              for (const filePath of resultFilePaths) await onDownload(filePath, true)
            }}
            onRegenerate={() => onRegenerate(task)}
            onReedit={() => onReedit(task)}
            onDelete={() => onDelete(task.id)}
          />
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
