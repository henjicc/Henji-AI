import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { showAlertDialog } from '@/stores/alertDialogStore'
import { ReferenceTextarea, StackedMediaUploader, UiIconButton } from '@/components/ui'
import type { ReferenceTextareaHandle } from '@/components/ui/ReferenceTextarea'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { hasTag } from '@/core/tags'
import { PromptOptimizationPreviewText } from './PromptOptimizationPreviewText'
import { useMixedFileOrder } from './InputArea/hooks/useMixedFileOrder'
import { usePromptOptimizationPreviewPlayback } from '../hooks/usePromptOptimizationPreviewPlayback'
export interface FileOrderItem {
  type: 'video' | 'image' | 'audio'
  index: number
}
interface InputAreaProps {
  input: string
  setInput: (value: string) => void
  promptUndoTriggerValue?: string | null
  promptUndoReplacementValue?: string | null
  onUndoPromptReplacement?: () => void
  promptRedoTriggerValue?: string | null
  promptRedoReplacementValue?: string | null
  onRedoPromptReplacement?: () => void
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
  onPaste: (e: React.ClipboardEvent) => void
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
  promptTextareaRef?: React.RefObject<ReferenceTextareaHandle>
  onGenerate: () => void
}
/**
 * 输入区域组件
 * 包含图片上传和文本输入
 */
const InputArea: React.FC<InputAreaProps> = ({
  input,
  setInput,
  promptUndoTriggerValue,
  promptUndoReplacementValue,
  onUndoPromptReplacement,
  promptRedoTriggerValue,
  promptRedoReplacementValue,
  onRedoPromptReplacement,
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
  promptTextareaRef,
  onGenerate
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
  const promptMinHeightClass = 'min-h-[146px]'
  const promptLeftPaddingClass =
    shouldShowUpload
      ? 'pl-[116px]'
      : 'pl-4'
  const promptReferences = uploadedImages.map((imageUrl, index) => ({
    id: `image-ref-${index}`,
    label: `图${index + 1}`,
    thumbnailSrc: imageUrl
  }))

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
    <div className="relative rounded-2xl">
        {shouldShowUpload && (
          <div className="pointer-events-auto absolute left-2 top-2 z-20">
            <StackedMediaUploader
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
              hideUploadButton={shouldHideUploadButton}
              fileTypes={(needsVideoUpload || needsAudioUpload) && currentFileOrder.length > 0
                ? currentFileOrder.map(item => item.type)
                : undefined}
              onDragStateChange={onDragStateChange}
              disabled={isLoading}
              hintText={needsVideoUpload ? uploadHint : undefined}
            />
          </div>
        )}

        {/* 文本输入框 */}
        <div className="relative">
          <ReferenceTextarea
          ref={promptTextareaRef}
          value={input}
          onChange={setInput}
          undoTriggerValue={promptUndoTriggerValue}
          undoReplacementValue={promptUndoReplacementValue}
          onUndoReplacement={onUndoPromptReplacement}
          redoTriggerValue={promptRedoTriggerValue}
          redoReplacementValue={promptRedoReplacementValue}
          onRedoReplacement={onRedoPromptReplacement}
          references={promptReferences}
          onPaste={onPaste}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'))
            if (files.length > 0) {
              onImageDrop(files)
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
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
          className="relative isolate overflow-visible rounded-2xl border border-zinc-700/35 bg-zinc-950/22 transition-colors duration-200 focus-within:border-zinc-500/50"
          highlightLayerClassName="text-sm leading-6 text-white"
          highlightContentClassName={`${promptMinHeightClass} ${promptLeftPaddingClass} py-3 pr-14`}
          textareaClassName={`ui-scrollbar !border-0 !bg-transparent !backdrop-blur-0 !shadow-none !rounded-2xl w-full ${promptLeftPaddingClass} py-3 pr-14 text-sm leading-6 ${promptMinHeightClass} resize-none overflow-y-auto overflow-x-hidden focus:!ring-0 focus:!shadow-none transition-colors duration-200 ease-out text-transparent caret-white placeholder-zinc-500/85 whitespace-pre-wrap break-words`}
          pickerClassName="z-50 w-[150px]"
          pickerListClassName="max-h-[180px]"
          renderPickerItem={({ item }) => (
            <>
              {item.thumbnailSrc ? (
                <img
                  src={item.thumbnailSrc}
                  alt={item.label}
                  className="h-8 w-8 rounded object-cover"
                  draggable={false}
                />
              ) : (
                <span className="inline-flex h-8 w-8 items-center justify-center rounded bg-zinc-700/70 text-xs text-zinc-200">
                  {item.label}
                </span>
              )}
              <span>{item.label}</span>
            </>
          )}
          disabled={isLoading || isPromptOptimizing || renderPromptOptimizationPreview}
        />
        {renderPromptOptimizationPreview ? (
          <div className={`prompt-optimize-preview pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-2xl border border-accent/40 bg-app/72 backdrop-blur-md ${isPromptOptimizationPreviewClosing ? 'is-closing' : ''}`}>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />
            <div
              ref={promptOptimizationScrollRef}
              className="prompt-optimize-preview__stream h-full overflow-y-scroll px-4 py-3 pr-14 text-sm leading-6"
            >
              {displayedPromptOptimizationReasoningGlyphs.length > 0 ? (
                <PromptOptimizationPreviewText
                  className="prompt-optimize-preview__reasoning whitespace-pre-wrap break-words text-text-muted"
                  glyphs={displayedPromptOptimizationReasoningGlyphs}
                />
              ) : null}
              {displayedPromptOptimizationReasoningGlyphs.length > 0 && displayedPromptOptimizationContentGlyphs.length > 0 ? '\n\n' : null}
              {displayedPromptOptimizationContentGlyphs.length > 0 ? (
                <PromptOptimizationPreviewText
                  className="prompt-optimize-preview__content whitespace-pre-wrap break-words text-text-dark"
                  glyphs={displayedPromptOptimizationContentGlyphs}
                />
              ) : null}
              {!hasOptimizationContent ? (
                <span className="prompt-optimize-preview__placeholder text-text-muted">
                  模型正在处理提示词...
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
        {/* 生成按钮 */}
        <UiIconButton
          type="button"
          onClick={onGenerate}
          disabled={generateDisabled || isPromptOptimizing || renderPromptOptimizationPreview}
          title={isGenerating ? t('inputArea.button.queue') : t('inputArea.button.generate')}
          className={`absolute bottom-3 right-3 h-10 w-10 !rounded-full transition-all duration-250 ${generateDisabled
            ? '!border-zinc-700/25 !bg-zinc-800/65 !text-zinc-500'
            : '!border-brand-500/55 !bg-accent !text-white hover:scale-105 hover:brightness-110'
            }`}
        >
            {isLoading ? (
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : isGenerating ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            )}
          </UiIconButton>
        </div>

    </div>
  )
}
export default InputArea

