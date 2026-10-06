import React from "react"
import { toDisplaySrc } from '@/platform/desktopApi'
import { useI18n } from "@/hooks/useI18n"
import type { MenuItem } from "@/hooks/useContextMenu"
import { ProgressBar } from "@/components/ui/ProgressBar"
import { resolveResumableServerTaskId } from "@/features/generation/application/taskServerId"
import { getProgressTransitionDurationMs } from "@/core/progress/progressTracker"
import { useGenerationTaskProgressStore } from "@/stores/generationTaskProgressStore"
import {
  UiButton,
  UiError,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
} from "@/components/ui"
import AudioPlayer from "@/components/AudioPlayer"
import { getModelDisplayName } from "@/utils/modelHelpers"
import type { GenerationTask, ResultImageDimensions } from "../types"
import { resolveResultImageDimensions } from "../utils/resultImageDimensions"
import { formatMediaDuration, formatTaskCreatedAt, joinTaskMeta } from "../utils/taskMeta"
import { TaskInputPreview } from "./TaskInputPreview"
import { TaskPrompt } from "./TaskPrompt"
import { CopyIcon, DownloadIcon } from "./TaskActionIcons"
import { TaskCardToolbar } from './TaskCardToolbar'
import { useHistoryDrag } from "../hooks/useHistoryDrag"
import { FolderCheck, FolderPlus, MessageCircleQuestion, Play } from 'lucide-react'
import { useAddToAssetLibrary } from '@/features/assets/hooks/useAddToAssetLibrary'
import { checkAssetPaths } from '@/commands/assetLibrary'
import { openAssistantForDiagnosis } from '@/features/assistant/diagnostics/openAssistantDiagnosis'
import { TaskListRetentionContext } from '../hooks/useTaskListRetention'
import { videoEditSendMenuItems } from '@/features/videoEdit/panels/videoEditSendActions'
import { ICON_WORKSPACE_VIDEO_EDIT } from '@/core/theme/icons'
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
  const retention = React.useContext(TaskListRetentionContext)
  const onAudioActivityChange = React.useCallback((active: boolean) => {
    retention?.setActive(task.id, 'audio', active)
  }, [retention, task.id])
  // 进度自订阅：只有本任务进度变化时才重渲染这一张卡，不牵动整个工作区
  const progressValue = useGenerationTaskProgressStore((state) => state.progress[task.id])
  const { addMedia, collecting } = useAddToAssetLibrary()
  const resultFilePaths = React.useMemo(() => task.result?.filePaths ?? [], [task.result?.filePaths])
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
    ? <FolderCheck className={`${className} text-success-text`} />
    : <FolderPlus className={className} />
  const collectResult = async (filePath: string | undefined, mediaType: 'image' | 'video' | 'audio'): Promise<void> => {
    if (!filePath) return
    retention?.setActive(task.id, 'collect', true)
    try {
      const asset = await addMedia({ filePath, mediaType, source: 'generated' })
      setCollectedPaths((current) => new Set(current).add(filePath))
      notify(t(asset.wasExisting ? 'ui:assetLibrary.alreadyCollected' : 'ui:assetLibrary.collectSuccess'))
    } catch {
      notify(t('ui:assetLibrary.collectFailed'), 'error')
    } finally {
      retention?.setActive(task.id, 'collect', false)
    }
  }
  // Only saved local outputs can enter an edit; each output keeps its own index.
  const videoEditItems = (mediaKind: 'image' | 'video' | 'audio', outputIndex: number, filePath: string | undefined): MenuItem[] => filePath
    ? videoEditSendMenuItems(mediaKind, () => ({ kind: 'generation.result', id: task.id, outputIndex }), notify, <ICON_WORKSPACE_VIDEO_EDIT className="w-4 h-4" />)
    : []
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

  // 视频结果的真实时长（读自已加载的元数据），用于画面右下角的时长读数
  const [videoDurationSeconds, setVideoDurationSeconds] = React.useState<number | null>(null)

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
  const createdAtLabel = formatTaskCreatedAt(task.createdAt, i18n.language || "zh-CN")
  const inputImages = task.images ?? []
  const inputVideos = task.videos ?? []
  const isInProgress = task.status === "queued" || task.status === "pending" || task.status === "generating"
  const statusLabel = task.status === "queued"
    ? t("ui:workspace.status.queued")
    : task.status === "pending"
      ? t("ui:workspace.status.preparing")
      : task.status === "generating"
        ? `${t("ui:workspace.status.generating")}${progressValue !== undefined ? ` ${Math.floor(progressValue)}%` : ''}`
        : null
  const metaLine = joinTaskMeta([
    typeLabel,
    modelName,
    task.dimensions,
    (task.type === "video" || task.type === "audio") ? task.duration : undefined,
    statusLabel ?? createdAtLabel,
  ])

  const renderResult = () => {
    // 进行中只显示一条进度细线（设计稿 Generation），状态文字已在辅助信息行里
    if (isInProgress) {
      return (
        <ProgressBar
          appearance="hairline"
          progress={progressValue ?? 0}
          duration={progressValue !== undefined ? getProgressTransitionDurationMs(progressValue) : undefined}
        />
      )
    }

    if (task.status === "error") {
      return (
        <UiError
          size="xs"
          align="start"
          title={t("common:error")}
          message={task.error || t("common:status.failed")}
          // 只有拿得到供应商任务号时“继续获取结果”才有意义；没有任务号的失败（如提交即被拒）用工具条的“重新生成”
          onRetry={resolveResumableServerTaskId(task) ? () => void onRetryPolling(task) : undefined}
          retryLabel={t("ui:retry")}
          actions={
            <UiButton
              className="gap-1.5"
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

    if (task.status === 'success' && typeof task.options?.__completionMessage === 'string') {
      return (
        <div className="flex flex-col gap-0.5">
          <span className={UI_TEXT_BODY_CLASS}>音色已保存</span>
          <span className={UI_TEXT_META_CLASS}>{task.options.__completionMessage}</span>
        </div>
      )
    }
    if (task.status === 'success' && task.resultFileMissing) {
      // 结果文件被移动或删除（5.7-24）：说明后果与可做的事，不让记录只剩标题和元信息
      return (
        <UiError
          size="xs"
          align="start"
          title={t("ui:workspace.resultMissing.title")}
          message={t("ui:workspace.resultMissing.message")}
        />
      )
    }
    if (task.status !== "success" || !task.result) return null

    if (task.result.type === "image") {
      const { urls, filePaths } = task.result

      // 图片网格平铺：每格按结果比例占位（未知比例先按方形），不加卡片背景。
      // 网格宽度封顶 896（原记录列宽）：记录列随窗口加宽后，四宫格不跟着放大成整屏大图（任务 5.3）
      return (
        <div className="grid max-w-4xl grid-cols-4 items-start gap-1.5">
          {urls.map((url, index) => {
            const filePath = filePaths[index]
            const imageDimensions = resolveResultImageDimensions(task, index)
            return (
              <div
                key={`${task.id}-img-${index}`}
                data-generation-result={task.id}
                className="relative overflow-hidden rounded-lg bg-media"
                style={{ aspectRatio: imageDimensions ? `${imageDimensions.width} / ${imageDimensions.height}` : '1 / 1' }}
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
                    ...videoEditItems('image', index, filePath),
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
                  className="block h-full w-full cursor-grab select-none object-cover active:cursor-grabbing"
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
      const { urls, filePaths } = task.result
      const filePath = filePaths[0]
      const videoUrl = filePath ? toDisplaySrc(filePath.replace(/\\/g, "/")) : (urls[0] ?? "")
      const durationBadge = videoDurationSeconds !== null ? formatMediaDuration(videoDurationSeconds) : ''
      return (
        <div
          className="relative w-96 max-w-full cursor-pointer overflow-hidden rounded-lg bg-media"
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
              ...videoEditItems('video', 0, filePath),
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
          <video
            src={videoUrl}
            className="block h-auto w-full"
            draggable={false}
            muted
            preload="metadata"
            onLoadedMetadata={(event) => {
              const seconds = event.currentTarget.duration
              if (Number.isFinite(seconds)) setVideoDurationSeconds(seconds)
            }}
          />
          {/* 画面中央的播放提示与右下角时长：媒体叠层固定令牌，不随主题 */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-media-control text-on-media">
              <Play className="h-4 w-4" />
            </span>
          </div>
          {durationBadge && (
            <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-media-scrim px-1.5 py-0.5 font-mono text-2xs tabular-nums text-on-media">
              {durationBadge}
            </span>
          )}
        </div>
      )
    }

    if (task.result.type === "audio") {
      const filePath = task.result.filePaths[0]
      const audioUrl = task.result.urls[0] ?? ''
      return (
        <AudioPlayer
          layout="inline"
          surface="plain"
          src={audioUrl}
          initialPlaybackState={retention?.getAudio(task.id, audioUrl)}
          onActivityChange={onAudioActivityChange}
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
              ...videoEditItems('audio', 0, filePath),
            ])
          }
       />
      )
    }

    return null
  }

  const result = renderResult()

  return (
    // ⚠️ 这里曾经加过 `content-visibility:auto` + `contain-intrinsic-size:auto 420px`
    // 来跳过视口外卡片的布局，但任务卡高度差异极大（排队态约 120px，多图结果可到 800px），
    // 单一 420px 估算值在两个方向上都严重偏离：往回滚时占位高度被换成真实高度，
    // 视口上方的内容尺寸突变，滚动锚定晚一帧补偿，表现就是"闪一下又跳回来"。
    // content-visibility 只适合**行高基本一致**的长列表（如助手历史/记忆的等高行）。
    //
    // 生成记录不加卡片背景（重要记录 001）：提示词一行 + 辅助信息一行，靠列表间距分组；
    // 操作按钮悬停或键盘聚焦到这条记录时才出现。
    <article
      className="group/task flex flex-col gap-2.5 outline-none"
      data-generation-task-id={task.id}
      tabIndex={-1}
    >
      <div className="flex items-start gap-4">
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
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <TaskPrompt prompt={task.prompt} />
          <div className="truncate text-xs text-text3" title={createdAtLabel}>
            {metaLine}
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
      {result}
    </article>
  )
}, (prev, next) => {
  // 进度已改为组件内自订阅 store，这里只需比较 task 引用；
  // 进度变化通过 zustand selector 精准触发本卡重渲染
  return prev.task === next.task
})

export default TaskCard
