import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
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
  UiCheckbox,
  UiError,
  UiMediaCheck,
  UiSkeleton,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
} from "@/components/ui"
import AudioPlayer from "@/components/AudioPlayer"
import { getModelDisplayName } from "@/utils/modelHelpers"
import type { GenerationTask, ResultImageDimensions } from "../types"
import { resolveResultAspectRatio, resolveResultImageDimensions } from "../utils/resultImageDimensions"
import { formatMediaDuration, formatTaskCreatedAt, joinTaskMeta } from "../utils/taskMeta"
import { taskErrorMessage } from '../utils/taskErrorMessage'
import { TaskInputPreview } from "./TaskInputPreview"
import { TaskPrompt } from "./TaskPrompt"
import { TaskCardToolbar } from './TaskCardToolbar'
import { useHistoryDrag } from "../hooks/useHistoryDrag"
import { Copy, FolderCheck, FolderPlus, Play } from 'lucide-react'
import { useAddToAssetLibrary } from '@/features/assets/hooks/useAddToAssetLibrary'
import { checkAssetPaths } from '@/commands/assetLibrary'
import { openAssistantForDiagnosis } from '@/features/assistant/diagnostics/openAssistantDiagnosis'
import { TaskListRetentionContext } from '../hooks/useTaskListRetention'
import { videoEditSendMenuItems } from '@/features/videoEdit/panels/videoEditSendActions'
import { ICON_DOWNLOAD, ICON_WORKSPACE_VIDEO_EDIT } from '@/core/theme/icons'
import { VideoEditSendDialog } from '@/features/videoEdit/panels/VideoEditSendMenu'
import { listGenerationContinuations } from '@/core/services/generationContinuations'
import { listSelectableResults, resultSelectionKey, useResultSelectionStore, useTaskSelectionSignature } from '../hooks/resultSelection'

/** 结果与生成中占位共用的行高：宽度随画面比例，竖图不会撑成整屏大图。 */
const RESULT_ROW_HEIGHT_CLASS = 'h-64'

export interface TaskCardProps {
  task: GenerationTask
  onDownload: (filePath: string, fromButton?: boolean) => Promise<void>
  onCopyImage: (filePath?: string) => Promise<void>
  onRegenerate: (task: GenerationTask) => Promise<void>
  onRetryPolling: (task: GenerationTask) => Promise<void>
  onReedit: (task: GenerationTask) => void
  onContinue: (task: GenerationTask, continuationId: string) => void
  onDelete: (taskId: string) => Promise<void>
  onUsePrompt: (prompt: string) => void
  onRememberResultImageDimensions: (
    taskId: string,
    imageIndex: number,
    dimensions: ResultImageDimensions
  ) => void
  onOpenImageViewer: (url: string, list: string[], filePaths?: string[]) => void
  onOpenVideoViewer: (url: string, filePath?: string, trimRange?: { start: number; end: number }) => void
  onOpenAudioViewer: (url: string, filePath?: string) => void
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
  onContinue,
  onDelete,
  onUsePrompt,
  onRememberResultImageDimensions,
  onOpenImageViewer,
  onOpenVideoViewer,
  onOpenAudioViewer,
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
  const [videoEditSend, setVideoEditSend] = React.useState<{ mediaKind: 'image' | 'video' | 'audio'; outputIndex: number } | null>(null)
  // 多选：选中状态在工作区的选择 store 里；这张卡只订阅自己那几项，别的卡勾选时不重渲染
  const selectionActive = useResultSelectionStore((state) => state.active)
  const toggleSelection = useResultSelectionStore((state) => state.toggle)
  const setManySelection = useResultSelectionStore((state) => state.setMany)
  const selectionSignature = useTaskSelectionSignature(task.id)
  const selectedIndices = React.useMemo(() => new Set(selectionSignature ? selectionSignature.split(',').map(Number) : []), [selectionSignature])
  const selectableKeys = React.useMemo(() => listSelectableResults([task]).map(result => result.key), [task])
  const isSelectable = (outputIndex: number): boolean => selectableKeys.includes(resultSelectionKey(task.id, outputIndex))
  /** 多选中、或按住 Ctrl / Shift 点结果时切换选中；否则照常打开查看。 */
  const handleResultClick = (event: React.MouseEvent, outputIndex: number, open: () => void): void => {
    if (shouldIgnoreClick()) return
    if (selectionActive || event.ctrlKey || event.metaKey || event.shiftKey) {
      if (isSelectable(outputIndex)) toggleSelection(resultSelectionKey(task.id, outputIndex), event.shiftKey)
      return
    }
    open()
  }
  const renderResultSelection = (outputIndex: number): React.ReactNode => {
    if (!isSelectable(outputIndex)) return null
    const selected = selectedIndices.has(outputIndex)
    return (
      <>
        {selected && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-inset ring-accent" />}
        <UiMediaCheck
          checked={selected}
          aria-label={t('ui:generationSelection.selectResult')}
          className={`absolute left-1 top-1 ${selectionActive || selected ? '' : 'opacity-0 focus-visible:opacity-100 group-hover/result:opacity-100'}`}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => toggleSelection(resultSelectionKey(task.id, outputIndex))}
        />
      </>
    )
  }
  const videoEditItems = (mediaKind: 'image' | 'video' | 'audio', outputIndex: number, filePath: string | undefined): MenuItem[] => filePath
    ? videoEditSendMenuItems(mediaKind, () => ({ type: 'generation', recordId: task.id, outputIndex }), notify, <ICON_WORKSPACE_VIDEO_EDIT className={`${UI_ICON_SIZE_CLASS.md}`} />, () => setVideoEditSend({ mediaKind, outputIndex }))
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
  const [videoAspectRatio, setVideoAspectRatio] = React.useState<string | null>(null)

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
        : task.status === "cancelled" ? t("ui:workspace.status.cancelled") : null
  const metaLine = joinTaskMeta([
    typeLabel,
    modelName,
    createdAtLabel,
  ])

  const renderResult = () => {
    // 进行中先按成品比例占住结果的位置：光带扫过表示在出图，状态与进度写在占位里，出图后原地换成结果。
    if (isInProgress) {
      return (
        <div className="flex">
          <div
            role="status"
            className={`relative flex max-w-full shrink-0 items-center justify-center overflow-hidden rounded-lg ${task.type === 'audio' ? 'h-14 w-96' : RESULT_ROW_HEIGHT_CLASS}`}
            style={task.type === 'audio' ? undefined : { aspectRatio: resolveResultAspectRatio(task, 0) }}
          >
            <UiSkeleton shape="fill" motion="sweep" />
            <span className="relative text-xs tabular-nums text-text3">{statusLabel}</span>
            <ProgressBar
              appearance="hairline"
              className="absolute inset-x-0 bottom-0 rounded-none"
              progress={progressValue ?? 0}
              duration={progressValue !== undefined ? getProgressTransitionDurationMs(progressValue) : undefined}
            />
          </div>
        </div>
      )
    }

    if (task.status === "error") {
      return (
        <UiError
          appearance="banner"
          title={t('history:failure.title')}
          message={taskErrorMessage(task.error, task.provider, t)}
          detail={task.error || undefined}
          // 拿得到供应商任务号时重试是续上原任务取结果（超时的任务可能已在供应商侧完成，不重复付费）；
          // 拿不到（如提交即被拒）才按原参数重新生成
          onRetry={() => void (resolveResumableServerTaskId(task) ? onRetryPolling(task) : onRegenerate(task))}
          actions={
            <>
              <UiButton
                variant="quiet"
                size="sm"
                onClick={() => openAssistantForDiagnosis({
                  title: t('history:failure.title'),
                  message: task.error || t('history:failure.title'),
                  taskId: task.id,
                  errorCode: 'GENERATION_FAILED',
                  domain: 'core.services.GenerationService',
                  occurredAt: task.createdAt.toISOString(),
                })}
              >
                {t('history:askAssistant')}
              </UiButton>
            </>
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

      // 结果按同一行高平铺、宽度随各自比例（未知比例先按方形），放不下换行；不加卡片背景。
      return (
        <div className="flex flex-wrap items-start gap-1.5">
          {urls.map((url, index) => {
            const filePath = filePaths[index]
            const imageDimensions = resolveResultImageDimensions(task, index)
            return (
              <div
                key={`${task.id}-img-${index}`}
                data-generation-result={task.id}
                className={`group/result relative max-w-full shrink-0 overflow-hidden rounded-lg bg-media ${RESULT_ROW_HEIGHT_CLASS}`}
                style={{ aspectRatio: resolveResultAspectRatio(task, index) }}
                onClick={(event) => handleResultClick(event, index, () => handleImageClick(url, urls, filePaths))}
                onContextMenu={(e) =>
                  showMenu(e, [
                    {
                      id: "copy-image",
                      label: t("common:actions.copy"),
                      icon: <Copy className={`${UI_ICON_SIZE_CLASS.md}`} />,
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
                      icon: <ICON_DOWNLOAD className={`${UI_ICON_SIZE_CLASS.md}`} />,
                      onClick: async () => { if (filePath) await onDownload(filePath, false) },
                      disabled: !filePath,
                    },
                    ...videoEditItems('image', index, filePath),
                  ])
                }
                onMouseDown={(e) => {
                  if (e.button !== 0 || selectionActive) return
                  if (!filePath) return
                  e.stopPropagation()
                  startImageDrag(e, url, filePath)
                }}
                draggable={isNativeFileDragEnabled && Boolean(filePath) && !selectionActive}
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
                  className="absolute inset-0 block h-full w-full cursor-grab select-none object-cover active:cursor-grabbing"
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
                {renderResultSelection(index)}
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
          className={`group/result relative max-w-full shrink-0 cursor-pointer overflow-hidden rounded-lg bg-media ${RESULT_ROW_HEIGHT_CLASS}`}
          style={{ aspectRatio: videoAspectRatio ?? resolveResultAspectRatio(task, 0) }}
          onClick={(event) => handleResultClick(event, 0, () => handleVideoClick(videoUrl, filePath))}
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
                icon: <ICON_DOWNLOAD className={`${UI_ICON_SIZE_CLASS.md}`} />,
                onClick: async () => { if (filePath) await onDownload(filePath, false) },
                disabled: !filePath,
              },
              ...videoEditItems('video', 0, filePath),
            ])
          }
          onMouseDown={(e) => {
            if (e.button !== 0 || selectionActive) return
            if (!filePath) return
            e.stopPropagation()
            startVideoDrag(e, videoUrl, filePath)
          }}
          draggable={isNativeFileDragEnabled && Boolean(filePath) && !selectionActive}
          onDragStart={(e) => startVideoNativeDrag(e, videoUrl, filePath)}
          onDragEnd={endNativeDrag}
          onContextMenuCapture={() => markContextMenu()}
        >
          <video
            src={videoUrl}
            className="absolute inset-0 block h-full w-full object-contain"
            draggable={false}
            muted
            preload="metadata"
            onLoadedMetadata={(event) => {
              const { duration, videoWidth, videoHeight } = event.currentTarget
              if (Number.isFinite(duration)) setVideoDurationSeconds(duration)
              if (videoWidth > 0 && videoHeight > 0) setVideoAspectRatio(`${videoWidth} / ${videoHeight}`)
            }}
          />
          {/* 画面中央的播放提示与右下角时长：媒体叠层固定令牌，不随主题 */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-media-control text-on-media">
              <Play className={`${UI_ICON_SIZE_CLASS.md}`} />
            </span>
          </div>
          {durationBadge && (
            <span className="pointer-events-none absolute bottom-2 right-2 rounded-control bg-media-scrim px-1.5 py-0.5 text-2xs tabular-nums text-on-media">
              {durationBadge}
            </span>
          )}
          {renderResultSelection(0)}
        </div>
      )
    }

    if (task.result.type === "audio") {
      const filePath = task.result.filePaths[0]
      const audioUrl = task.result.urls[0] ?? ''
      const audioSelectable = selectionActive && isSelectable(0)
      return (
        <div className="flex items-center gap-2">
        {audioSelectable && (
          <UiCheckbox
            checked={selectedIndices.has(0)}
            aria-label={t('ui:generationSelection.selectResult')}
            onCheckedChange={() => toggleSelection(resultSelectionKey(task.id, 0))}
          />
        )}
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
                icon: <ICON_DOWNLOAD className={`${UI_ICON_SIZE_CLASS.md}`} />,
                onClick: async () => { if (filePath) await onDownload(filePath, false) },
                disabled: !filePath,
              },
              ...videoEditItems('audio', 0, filePath),
            ])
          }
       />
        </div>
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
    // 生成记录不加卡片背景：提示词标题 + 元信息 + 结果，分隔线和留白由列表项绘制；
    // 操作按钮悬停或键盘聚焦到这条记录时才出现。
    // 参考素材、提示词与信息是同一份输入，排成一条放在上面，结果另起一段。
    <article
      className="group/task flex flex-col gap-4 outline-none"
      data-generation-task-id={task.id}
      tabIndex={-1}
    >
      {/* 左侧是参考素材堆，右侧是提示词与信息；素材点开后在本行铺开，盖住右侧 */}
      <div className="relative flex items-start gap-3">
        {/* 放在列左侧的留白里：参考素材堆是绝对定位的，放进行内会被它盖住；进多选时这一行也不跳动 */}
        {selectionActive && selectableKeys.length > 0 && (
          <UiCheckbox
            className="absolute -left-8 top-0.5"
            checked={selectedIndices.size === 0 ? false : selectedIndices.size >= selectableKeys.length ? true : 'mixed'}
            aria-label={t('ui:generationSelection.selectRecord')}
            onCheckedChange={(checked) => setManySelection(selectableKeys, checked)}
          />
        )}
        <TaskInputPreview
          taskId={task.id}
          inputImages={inputImages}
          inputVideos={inputVideos}
          uploadedFilePaths={task.uploadedFilePaths}
          uploadedVideoFilePaths={task.uploadedVideoFilePaths}
          uploadedAudioFilePaths={task.uploadedAudioFilePaths}
          onOpenImage={handleImageClick}
          onOpenVideo={handleInputVideoClick}
          onOpenAudio={onOpenAudioViewer}
          onStartImageDrag={startImageDrag}
          onStartVideoDrag={startVideoDrag}
          onStartImageNativeDrag={startImageNativeDrag}
          onStartVideoNativeDrag={startVideoNativeDrag}
          onNativeDragEnd={endNativeDrag}
          nativeFileDragEnabled={isNativeFileDragEnabled}
          shouldIgnoreClick={shouldIgnoreClick}
        />
        {/* 提示词与信息从参考素材顶边起紧挨着排；行框比字形高，上移一点让字形贴齐卡片顶边 */}
        <div className="-mt-0.5 flex min-w-0 flex-1 flex-col gap-1">
          <TaskPrompt prompt={task.prompt} />
          <div className="truncate text-xs leading-tight text-text3" title={metaLine}>{metaLine}</div>
        </div>
        {/* 按钮中线对齐提示词首行；多选时单条记录的工具让位给选择带上的批量动作 */}
        <div className={`-mt-2 ${selectionActive ? 'hidden' : ''}`}>
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
            continuations={task.status === 'success' ? listGenerationContinuations(task.model, task.options) : []}
            onContinue={(continuationId) => onContinue(task, continuationId)}
            onDelete={() => onDelete(task.id)}
          />
        </div>
      </div>
      {statusLabel && !isInProgress && <span className="text-xs text-text3">{statusLabel}</span>}
      {result}
      {videoEditSend && <VideoEditSendDialog mediaKind={videoEditSend.mediaKind} resolveSource={() => ({ type: 'generation', recordId: task.id, outputIndex: videoEditSend.outputIndex })} notify={notify} onClose={() => setVideoEditSend(null)} />}
    </article>
  )
}, (prev, next) => {
  // 进度已改为组件内自订阅 store，这里只需比较 task 引用；
  // 进度变化通过 zustand selector 精准触发本卡重渲染
  return prev.task === next.task
})

export default TaskCard
