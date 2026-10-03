import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { showAlertDialog } from '@/stores/alertDialogStore'
import { PromptEditor, StackedMediaUploader, UiIconButton } from '@/components/ui'
import type {
  PromptEditorHandle,
  PromptReferenceItem,
  StackedMediaUploaderHandle,
} from '@/components/ui'
import type { PromptDocumentV1 } from '@/core/inputs/promptDocument'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { hasTag } from '@/core/tags'
import { PromptOptimizationPreviewText } from './PromptOptimizationPreviewText'
import { useMixedFileOrder } from './InputArea/hooks/useMixedFileOrder'
import { usePromptOptimizationPreviewPlayback } from '../hooks/usePromptOptimizationPreviewPlayback'
import { ArrowUp, LoaderCircle, Plus } from 'lucide-react'
import { readVideoInfo } from '@/commands/video'
import { getPathForFile } from '@/platform/desktopApi'
import { getPlatform } from '@/platform/runtime'
import { useDragDrop } from '@/contexts/DragDropContext'
import { isDesktop } from '@/utils/save'
export interface FileOrderItem {
  type: 'video' | 'image' | 'audio'
  index: number
}
interface InputAreaProps {
  compact?: boolean
  promptDocument: PromptDocumentV1
  onPromptDocumentChange: (document: PromptDocumentV1) => void
  promptReferences: readonly PromptReferenceItem[]
  currentModel: DynamicValue
  selectedModel: string
  modelParams: DynamicValueMap
  uploadedImages: string[]
  isLoading: boolean
  isGenerating?: boolean
  onImageUpload: (files: File[]) => void
  onImageRemove: (index: number) => void
  onImageReplace: (index: number, file: File) => void
  onImageReorder: (from: number, to: number) => void
  onImageClick?: (imageUrl: string, imageList: string[]) => void
  onPaste: (event: ClipboardEvent) => void
  onImageDrop: (files: File[]) => void
  onDragStateChange: (isDragging: boolean) => void
  uploadedVideos?: string[]
  onVideoUpload?: (files: File[]) => void
  onVideoRemove?: (index: number) => void
  onVideoReplace?: (index: number, file: File) => void
  onVideoTrim?: (index: number) => void
  onVideoClick?: (videoUrl: string) => void
  uploadedAudios?: string[]
  onAudioUpload?: (files: File[]) => void
  onAudioRemove?: (index: number) => void
  onAudioReplace?: (index: number, file: File) => void
  onAudioClick?: (audioUrl: string) => void
  fileOrder?: FileOrderItem[]
  onFileOrderChange?: (order: FileOrderItem[]) => void
  promptOptimizationPreview?: {
    active: boolean
    reasoning: string
    content: string
  }
  promptEditorRef?: React.RefObject<PromptEditorHandle>
  onGenerate: () => void
  /** 底栏左侧（“添加素材”之后）：模型与参数条。 */
  footerStart?: React.ReactNode
  /** 底栏右侧（生成按钮之前）：预计费用、预设、优化。 */
  footerEnd?: React.ReactNode
}

/**
 * 拖拽进行中（应用内自定义拖拽或系统文件拖入窗口）时临时显示参考素材行，让它成为可见的放置目标；
 * 平时没有参考素材就不占一行（设计稿 Generation：缩略图在提示词上方，“+”在底栏）。
 */
function useMediaDragInProgress(): boolean {
  const { isDragging: isCustomDragging } = useDragDrop()
  const [isNativeDragging, setIsNativeDragging] = useState(false)
  useEffect(() => {
    if (!isDesktop()) return undefined
    return getPlatform().dragDrop.onDragStateChange(setIsNativeDragging)
  }, [])
  return isCustomDragging || isNativeDragging
}
/**
 * 输入区域组件
 * 包含图片上传和文本输入
 */
const InputArea: React.FC<InputAreaProps> = ({
  compact = false,
  promptDocument,
  onPromptDocumentChange,
  promptReferences,
  currentModel,
  selectedModel,
  modelParams,
  uploadedImages,
  isLoading,
  isGenerating,
  onImageUpload,
  onImageRemove,
  onImageReplace,
  onImageReorder,
  onImageClick,
  onPaste,
  onImageDrop,
  onDragStateChange,
  uploadedVideos = [],
  onVideoUpload,
  onVideoRemove,
  onVideoReplace,
  onVideoTrim,
  onVideoClick,
  uploadedAudios = [],
  onAudioUpload,
  onAudioRemove,
  onAudioReplace,
  onAudioClick,
  fileOrder,
  onFileOrderChange,
  promptOptimizationPreview,
  promptEditorRef,
  onGenerate,
  footerStart,
  footerEnd,
}) => {
  const { t } = useTranslation('ui')
  // 弹窗渲染统一收在 App 根部的 GlobalAlertDialog，这里只负责发起
  const showAlert = (title: string, message: string, type: 'info' | 'warning' | 'error' = 'warning') => {
    showAlertDialog({ title, message, type })
  }
  const inputLimits = resolveInputLimits(
    selectedModel,
    modelParams,
    { imagesCount: uploadedImages.length, videosCount: uploadedVideos.length }
  )
  const maxImageCount = inputLimits.images.max
  const minImageCount = inputLimits.images.min
  const maxVideoCount = inputLimits.videos.max
  const minVideoCount = inputLimits.videos.min
  const maxAudioCount = inputLimits.audios.max
  const videoConstraints = inputLimits.videoConstraints
  const needsVideoUpload = maxVideoCount > 0
  const needsVideoOnly = needsVideoUpload && maxImageCount === 0
  const isMultiple = maxImageCount > 1
  const needsAudioUpload = maxAudioCount > 0 && Boolean(onAudioUpload)
  const shouldShowUpload = currentModel?.type !== 'audio' && (maxImageCount > 0 || needsVideoUpload || needsAudioUpload)
  const isEnglishPromptOnly = hasTag(selectedModel, 'english-prompt-only')
  const formatLimitText = (min: number, max: number, unit: string) => {
    if (max <= 0) return ''
    if (min === max) return t('inputArea.limit.exact', { count: max, unit })
    if (min > 0) return t('inputArea.limit.range', { min, max, unit })
    return t('inputArea.limit.max', { max, unit })
  }
  const uploadHint = (() => {
    if (!needsVideoUpload) {
      return t('inputArea.upload.images', {
        range: formatLimitText(minImageCount, maxImageCount, t('inputArea.unit.images'))
      })
    }
    if (needsVideoOnly) {
      return t('inputArea.upload.videos', {
        range: formatLimitText(minVideoCount, maxVideoCount, t('inputArea.unit.videos'))
      })
    }
    const videoText = formatLimitText(minVideoCount, maxVideoCount, t('inputArea.unit.videos'))
    const imageText = formatLimitText(minImageCount, maxImageCount, t('inputArea.unit.images'))
    const fixedCounts = minVideoCount === maxVideoCount && minImageCount === maxImageCount
    return fixedCounts
      ? t('inputArea.upload.mixedFixed', { videoRange: videoText, imageRange: imageText })
      : t('inputArea.upload.mixed', { videoRange: videoText, imageRange: imageText })
  })()
  const {
    currentFileOrder,
    mixedFiles,
    mixedMaxCount,
    shouldHideUploadButton,
    handleMixedFileRemove,
    handleMixedFileReplace,
    handleMixedFileTrim,
    handleMixedFileReorder,
    handleMixedFileClick
  } = useMixedFileOrder({
    needsVideoUpload,
    needsVideoOnly,
    uploadedImages,
    uploadedVideos,
    uploadedAudios,
    maxImageCount,
    maxVideoCount,
    maxAudioCount,
    fileOrder,
    onFileOrderChange,
    onImageRemove,
    onImageReplace,
    onImageReorder,
    onImageClick,
    onVideoRemove,
    onVideoReplace,
    onVideoTrim,
    onVideoClick,
    onAudioRemove,
    onAudioReplace,
    onAudioClick
  })
  const isGenerateDisabled = () => {
    if (isLoading) return true
    return false
  }
  const generateDisabled = isGenerateDisabled()
  const isPromptOptimizing = promptOptimizationPreview?.active ?? false
  const promptOptimizationScrollRef = useRef<HTMLDivElement>(null)
  const promptOptimizationScrollFrameRef = useRef<number | null>(null)
  const promptOptimizationScrollTargetRef = useRef(0)
  const {
    closing: isPromptOptimizationPreviewClosing,
    contentGlyphs: displayedPromptOptimizationContentGlyphs,
    hasContent: hasOptimizationContent,
    reasoningGlyphs: displayedPromptOptimizationReasoningGlyphs,
    visible: renderPromptOptimizationPreview,
  } = usePromptOptimizationPreviewPlayback(promptOptimizationPreview)
  const getVideoDuration = (file: File): Promise<number> => {
    const fullPath = getPathForFile(file).trim()
    if (fullPath) {
      return readVideoInfo(fullPath).then((info) => info.durationSeconds)
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url)
        resolve(video.duration)
      }
      video.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('无法读取视频元数据'))
      }
      video.src = url
    })
  }
  const handleMixedFileUpload = async (files: File[]) => {
    const videoFiles = files.filter(f => f.type.startsWith('video/'))
    const imageFiles = files.filter(f => f.type.startsWith('image/'))
    const audioFiles = files.filter(f => f.type.startsWith('audio/'))
    const currentVideoCount = uploadedVideos.length
    const currentImageCount = uploadedImages.length
    if (videoFiles.length > 0 && onVideoUpload && currentVideoCount < maxVideoCount) {
      const file = videoFiles[0]
      if (videoConstraints) {
        // 文件体积超限不在上传时拦截：本地有 ffmpeg 后改为生成提交时按需压缩（见 GenerationService），
        // 让上传体验保持即时，压缩耗时由任务进度条覆盖。
        if (videoConstraints.minDurationSec || videoConstraints.maxDurationSec) {
          try {
            const duration = await getVideoDuration(file)
            if (videoConstraints.minDurationSec && duration < videoConstraints.minDurationSec) {
              showAlert(
                t('inputArea.alerts.videoDuration.title'),
                t('inputArea.alerts.videoDuration.min', {
                  minDuration: videoConstraints.minDurationSec,
                  duration: duration.toFixed(1)
                }),
                'warning'
              )
              return
            }
            if (videoConstraints.maxDurationSec && duration > videoConstraints.maxDurationSec) {
              showAlert(
                t('inputArea.alerts.videoDuration.title'),
                t('inputArea.alerts.videoDuration.max', {
                  maxDuration: videoConstraints.maxDurationSec,
                  duration: duration.toFixed(1)
                }),
                'warning'
              )
              return
            }
          } catch (e) {
            showAlert(
              t('inputArea.alerts.videoMetadataFailed.title'),
              t('inputArea.alerts.videoMetadataFailed.message'),
              'error'
            )
            return
          }
        }
      }
      onVideoUpload([file])
    } else if (videoFiles.length > 0 && currentVideoCount >= maxVideoCount) {
      showAlert(
        t('inputArea.alerts.videoCount.title'),
        t('inputArea.alerts.videoCount.message', { max: maxVideoCount }),
        'warning'
      )
    }
    if (imageFiles.length > 0 && !needsVideoOnly) {
      const availableImageSlots = maxImageCount - currentImageCount
      if (availableImageSlots > 0) {
        onImageUpload(imageFiles)
      } else {
        showAlert(
          t('inputArea.alerts.imageCount.title'),
          t('inputArea.alerts.imageCount.message', { max: maxImageCount }),
          'warning'
        )
      }
    }
    if (audioFiles.length > 0 && onAudioUpload && uploadedAudios.length < maxAudioCount) {
      onAudioUpload([audioFiles[0]])
    }
  }
  // 紧凑模式由生成工作区的真实可用尺寸决定，CSS 像素已包含系统缩放与应用缩放。
  // 长提示词在编辑区内部滚动。
  const promptHeightClass = compact
    ? 'min-h-[48px] max-h-[176px]'
    : 'min-h-[72px] max-h-[260px]'
  const uploaderRef = useRef<StackedMediaUploaderHandle>(null)
  const dragInProgress = useMediaDragInProgress()
  const showReferenceRow = mixedFiles.length > 0 || dragInProgress
  const canAddReference = !shouldHideUploadButton && !isLoading && (!mixedMaxCount || mixedFiles.length < mixedMaxCount)
  useEffect(() => {
    if (!renderPromptOptimizationPreview) {
      if (promptOptimizationScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(promptOptimizationScrollFrameRef.current)
        promptOptimizationScrollFrameRef.current = null
      }
      return
    }

    const container = promptOptimizationScrollRef.current
    if (!container) return

    promptOptimizationScrollTargetRef.current = Math.max(0, container.scrollHeight - container.clientHeight)

    const smoothScroll = (): void => {
      const currentTop = container.scrollTop
      const targetTop = promptOptimizationScrollTargetRef.current
      const delta = targetTop - currentTop

      if (Math.abs(delta) < 0.5) {
        container.scrollTop = targetTop
        promptOptimizationScrollFrameRef.current = null
        return
      }

      container.scrollTop = currentTop + delta * 0.18
      promptOptimizationScrollFrameRef.current = window.requestAnimationFrame(smoothScroll)
    }

    if (promptOptimizationScrollFrameRef.current === null) {
      promptOptimizationScrollFrameRef.current = window.requestAnimationFrame(smoothScroll)
    }

    return () => {
      if (promptOptimizationScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(promptOptimizationScrollFrameRef.current)
        promptOptimizationScrollFrameRef.current = null
      }
    }
  }, [
    renderPromptOptimizationPreview,
    displayedPromptOptimizationContentGlyphs.length,
    displayedPromptOptimizationReasoningGlyphs.length
  ])

  return (
    <div className="relative flex flex-col gap-1.5">
        {/* 参考素材行：始终挂载（系统拖入、替换与裁剪都走它），没有素材且不在拖拽中时不占位 */}
        {shouldShowUpload && (
          <div className={showReferenceRow ? 'pointer-events-auto px-1 pt-0.5' : 'hidden'}>
            <StackedMediaUploader
              ref={uploaderRef}
              files={mixedFiles}
              onUpload={(needsVideoUpload || needsAudioUpload) ? handleMixedFileUpload : onImageUpload}
              onRemove={(needsVideoUpload || needsAudioUpload) ? handleMixedFileRemove : onImageRemove}
              onReplace={(needsVideoUpload || needsAudioUpload) ? handleMixedFileReplace : onImageReplace}
              onTrim={needsVideoUpload && videoConstraints?.trim ? handleMixedFileTrim : undefined}
              onReorder={(needsVideoUpload || needsAudioUpload) ? handleMixedFileReorder : onImageReorder}
              onFileClick={(needsVideoUpload || needsAudioUpload) ? handleMixedFileClick : onImageClick}
              accept={needsVideoOnly
                ? (needsAudioUpload ? "video/*,audio/*" : "video/*")
                : (needsVideoUpload
                  ? (needsAudioUpload ? "video/*,image/*,audio/*" : "video/*,image/*")
                  : (needsAudioUpload ? "image/*,audio/*" : "image/*"))}
              multiple={needsVideoOnly ? needsAudioUpload : ((needsVideoUpload || needsAudioUpload) ? true : isMultiple)}
              maxCount={mixedMaxCount}
              hideUploadButton
              fileTypes={(needsVideoUpload || needsAudioUpload) && currentFileOrder.length > 0
                ? currentFileOrder.map(item => item.type)
                : undefined}
              onDragStateChange={onDragStateChange}
              disabled={isLoading}
              hintText={needsVideoUpload ? uploadHint : undefined}
            />
          </div>
        )}

        {/* 文本输入框：外层输入卡片已经画了表面，编辑器本身无框 */}
        <div data-onboarding-target="prompt" className="relative">
          <PromptEditor
            ref={promptEditorRef}
            value={promptDocument}
            onChange={onPromptDocumentChange}
            preset="media-references"
            layout="fill-scroll"
            frame="none"
            ariaLabel={t('inputArea.placeholder.default')}
            references={promptReferences}
            onPaste={onPaste}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const files = Array.from(event.dataTransfer?.files ?? [])
                .filter(file => file.type.startsWith('image/'))
              if (files.length > 0) onImageDrop(files)
            }}
            submitShortcut="enter"
            onSubmit={onGenerate}
            placeholder={
              currentModel?.type === 'audio'
                ? t('inputArea.placeholder.audio')
                : isEnglishPromptOnly
                  ? t('inputArea.placeholder.englishOnly')
                  : t('inputArea.placeholder.default')
            }
            className="relative isolate"
            // 内容基础类已有 px-3 py-2.5 text-sm：这里用 pl/pr/pt/pb 与 text-14（产物中排在其后）收紧，不与之抢同一属性的同名档
            editorClassName={`ui-scrollbar w-full pl-2 pr-2 pt-1 pb-1 text-14 ${promptHeightClass}`}
            disabled={isLoading || isPromptOptimizing || renderPromptOptimizationPreview}
          />
          {renderPromptOptimizationPreview ? (
          <div className={`prompt-optimize-preview pointer-events-none absolute inset-0 z-dropdown overflow-hidden rounded-lg bg-panel ${isPromptOptimizationPreviewClosing ? 'is-closing' : ''}`}>
            <div
              ref={promptOptimizationScrollRef}
              className="prompt-optimize-preview__stream h-full overflow-y-scroll px-2 py-1 text-14 leading-6 text-text1"
            >
              {displayedPromptOptimizationReasoningGlyphs.length > 0 ? (
                <PromptOptimizationPreviewText
                  className="prompt-optimize-preview__reasoning whitespace-pre-wrap break-words text-text3"
                  glyphs={displayedPromptOptimizationReasoningGlyphs}
                />
              ) : null}
              {displayedPromptOptimizationReasoningGlyphs.length > 0 && displayedPromptOptimizationContentGlyphs.length > 0 ? '\n\n' : null}
              {displayedPromptOptimizationContentGlyphs.length > 0 ? (
                <PromptOptimizationPreviewText
                  className="prompt-optimize-preview__content whitespace-pre-wrap break-words text-text1"
                  glyphs={displayedPromptOptimizationContentGlyphs}
                />
              ) : null}
              {!hasOptimizationContent ? (
                <span className="prompt-optimize-preview__placeholder text-text3">
                  模型正在处理提示词...
                </span>
              ) : null}
            </div>
          </div>
          ) : null}
        </div>

        {/* 底栏：添加素材 · 模型 · 参数 ｜ 预计费用 · 预设 · 优化 · 生成（设计稿 Generation） */}
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-x-3 gap-y-1.5">
            {shouldShowUpload && (
              <UiIconButton size="lg"
                type="button"
                disabled={!canAddReference}
                onClick={() => uploaderRef.current?.openFilePicker()}
                title={needsVideoUpload ? uploadHint : t('inputArea.button.addReference')}
                aria-label={t('inputArea.button.addReference')}
              >
                <Plus className="h-[18px] w-[18px]" />
              </UiIconButton>
            )}
            {footerStart}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {footerEnd}
            {/* 生成按钮：这块输入卡片唯一的主动作 */}
            <UiIconButton tone="accent" size="lg"
              type="button"
              data-onboarding-target="generate"
              onClick={onGenerate}
              disabled={generateDisabled || isPromptOptimizing || renderPromptOptimizationPreview}
              title={isGenerating ? t('inputArea.button.queue') : t('inputArea.button.generate')}
            >
              {isLoading ? (
                <LoaderCircle className="h-[18px] w-[18px] animate-spin" />
              ) : isGenerating ? (
                <Plus className="h-[18px] w-[18px]" />
              ) : (
                <ArrowUp className="h-[18px] w-[18px]" />
              )}
            </UiIconButton>
          </div>
        </div>
    </div>
  )
}
export default InputArea
