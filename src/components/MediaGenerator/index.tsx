import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getAvailableProviders, getModelInfo } from '@/utils/modelHelpers'
import PriceEstimate from '@/components/ui/PriceEstimate'
import PresetPanel from '@/components/PresetPanel'
import { VideoTrimModal } from '@/components/videoTrim/VideoTrimModal'
import { saveUploadVideo } from '@/utils/save'
import { getPathForFile, toDisplaySrc } from '@/platform/desktopApi'

import { useUIState } from './state/useUIState'
import { useModelState } from './state/useModelState'
import { useModelVisibility } from './hooks/useModelVisibility'
import { useGenerationHandler } from './hooks/useGenerationHandler'
import { useImageUpload } from './hooks/useImageUpload'
import { useVideoUpload } from './hooks/useVideoUpload'
import { useAudioUpload } from './hooks/useAudioUpload'
import { useGlobalPasteImage } from './hooks/useGlobalPasteImage'
import { usePriceEstimateParams } from './hooks/usePriceEstimateParams'
import { useReeditContent } from './hooks/useReeditContent'
import { PresetManager } from './preset/PresetManager'
import InputArea from './components/InputArea'
import { GeneratorConfigurationBar } from './components/GeneratorConfigurationBar'
import type { ParameterPanelController } from './components/ParameterPanel'
import { PromptOptimizeButton } from './components/PromptOptimizeButton'
import { UiFieldLayoutContext, type PromptEditorHandle } from '@/components/ui'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { validateGenerationRequirements } from '@/core/validation/modelRequirements'
import { parseLegacyPromptString } from '@/core/inputs/promptDocument'
import type { Preset } from '@/types/preset'

interface MediaGeneratorProps {
  compact?: boolean
  onGenerate: (input: string, model: string, type: 'image' | 'video' | 'audio', options?: DynamicValue) => void | Promise<void>
  isLoading: boolean
  onImageClick?: (imageUrl: string, imageList: string[]) => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  isGenerating?: boolean
  onSetUploadedImagesRef?: (setter: React.Dispatch<React.SetStateAction<string[]>>) => void
  onSetUploadedFilePathsRef?: (setter: React.Dispatch<React.SetStateAction<string[]>>) => void
  onStateChange?: (state: { modelId: string; prompt: string }) => void
}

/**
 * MediaGenerator 主组件 - 重构版
 * 从 2069 行简化到 < 250 行
 * 使用模块化架构和配置驱动设计
 */
const MediaGenerator: React.FC<MediaGeneratorProps> = ({
  compact = false,
  onGenerate,
  isLoading,
  onImageClick,
  isGenerating,
  onSetUploadedImagesRef,
  onSetUploadedFilePathsRef,
  onStateChange
}) => {
  // 1. UI 状态管理
  const uiState = useUIState()
  const { t } = useTranslation(['models', 'ui'])
  const [isSubmittingGenerate, setIsSubmittingGenerate] = useState(false)
  const [promptOptimizationPreview, setPromptOptimizationPreview] = useState({
    active: false,
    reasoning: '',
    content: '',
  })
  const promptEditorRef = useRef<PromptEditorHandle>(null)
  const parameterPanelRef = useRef<ParameterPanelController>(null)

  // 2. 模型参数管理（使用新系统）
  const modelState = useModelState(uiState.selectedModel, uiState)

  const inputLimits = resolveInputLimits(
    uiState.selectedModel,
    modelState.params,
    { imagesCount: uiState.uploadedImages.length, videosCount: uiState.uploadedVideos.length }
  )
  const maxImageCount = inputLimits.images.max
  const maxVideoCount = inputLimits.videos.max
  const maxAudioCount = inputLimits.audios.max
  const videoValidationOptions = inputLimits.videoConstraints
    ? {
      minDuration: inputLimits.videoConstraints.minDurationSec,
      maxDuration: inputLimits.videoConstraints.maxDurationSec,
      maxSizeMB: inputLimits.videoConstraints.maxSizeMB
    }
    : undefined
  const videoTrimMaxClipSeconds = inputLimits.videoConstraints?.trim?.maxClipSeconds
  const videoTrimMaxSizeMB = inputLimits.videoConstraints?.maxSizeMB
  const [videoTrimState, setVideoTrimState] = useState<{ index: number; file: File; previewUrl: string } | null>(null)

  // 3. 模型可见性管理
  useModelVisibility(
    uiState.selectedProvider,
    uiState.selectedModel,
    uiState.setSelectedProvider,
    uiState.setSelectedModel
  )

  // 4. 文件上传管理
  const imageUpload = useImageUpload(
    uiState.uploadedImages,
    uiState.setUploadedImages,
    uiState.uploadedFilePaths,
    uiState.setUploadedFilePaths
  )

  const videoUpload = useVideoUpload(
    uiState.uploadedVideos,
    uiState.setUploadedVideos,
    uiState.uploadedVideoFiles,
    uiState.setUploadedVideoFiles,
    uiState.setUploadedVideoFilePaths,
    uiState.showAlert,
    videoValidationOptions,
    uiState.setUploadedVideoDuration,
    uiState.setUploadedVideoTrimStart,
    uiState.setUploadedVideoTrimEnd
  )

  const handleVideoTrim = (index: number): void => {
    const videoFile = uiState.uploadedVideoFiles[index]
    if (!videoFile) return
    // 打开窗口不落盘：用 object URL 直接预览。完整视频本身不会因为裁剪而被替换，
    // 确认裁剪只保存 [start, end] 选区，真正切片推迟到生成提交时才做。
    // file 保留在 state 里是为了确认时按需压缩（需要真实文件路径，通过 resolveSource 懒获取）。
    const fullPath = uiState.uploadedVideoFilePaths[index] || getPathForFile(videoFile)
    if (!fullPath) return
    setVideoTrimState({ index, file: videoFile, previewUrl: toDisplaySrc(fullPath) })
  }

  const handleVideoTrimConfirm = (range: { start: number; end: number }): void => {
    uiState.setUploadedVideoTrimStart(range.start)
    uiState.setUploadedVideoTrimEnd(range.end)
  }

  const audioUpload = useAudioUpload(
    uiState.setUploadedAudios,
    uiState.setUploadedAudioFilePaths,
    uiState.showAlert
  )

  // 5. 生成请求处理
  const { handleGenerate: handleGenerateRequest } = useGenerationHandler(
    uiState.selectedModel,
    uiState.promptDocument,
    uiState.promptReferences,
    modelState,
    uiState.uploadedImages,
    uiState.uploadedVideos,
    uiState.uploadedAudios,
    uiState.uploadedVideoFiles,
    uiState.uploadedFilePaths,
    uiState.uploadedVideoFilePaths,
    uiState.uploadedAudioFilePaths,
    onGenerate,
    uiState.uploadedVideoTrimStart,
    uiState.uploadedVideoTrimEnd
  )

  // 获取当前选择的供应商和模型
  const providers = getAvailableProviders()
  const currentProvider = providers.find(p => p.id === uiState.selectedProvider)
  const currentModel = getModelInfo(uiState.selectedModel)
  const priceEstimateParams = usePriceEstimateParams({
    modelParams: modelState.params,
    prompt: uiState.input,
    uploadedImages: uiState.uploadedImages,
    uploadedFilePaths: uiState.uploadedFilePaths,
    uploadedVideos: uiState.uploadedVideos,
    uploadedVideoFilePaths: uiState.uploadedVideoFilePaths,
    uploadedAudios: uiState.uploadedAudios,
    uploadedAudioFilePaths: uiState.uploadedAudioFilePaths,
    uploadedVideoDuration: uiState.uploadedVideoDuration,
    uploadedVideoTrimStart: uiState.uploadedVideoTrimStart,
    uploadedVideoTrimEnd: uiState.uploadedVideoTrimEnd,
  })

  useEffect(() => {
    if (maxImageCount === 0 && uiState.uploadedImages.length > 0) {
      uiState.setUploadedImages([])
      uiState.setUploadedFilePaths([])
      uiState.setFileOrder(prev => prev.filter(item => item.type !== 'image'))
      return
    }

    if (uiState.uploadedImages.length > maxImageCount) {
      uiState.setUploadedImages(prev => prev.slice(0, maxImageCount))
      uiState.setUploadedFilePaths(prev => prev.slice(0, maxImageCount))
      uiState.setFileOrder(prev => prev.filter(item => item.type !== 'image' || item.index < maxImageCount))
    }
  }, [maxImageCount, uiState.uploadedImages.length, uiState.setFileOrder, uiState.setUploadedFilePaths, uiState.setUploadedImages, uiState])

  useEffect(() => {
    if (maxVideoCount === 0 && uiState.uploadedVideos.length > 0) {
      uiState.setUploadedVideos([])
      uiState.setUploadedVideoFiles([])
      uiState.setUploadedVideoFilePaths([])
      uiState.setUploadedVideoDuration(0)
      uiState.setFileOrder(prev => prev.filter(item => item.type !== 'video'))
      return
    }

    if (uiState.uploadedVideos.length > maxVideoCount) {
      uiState.setUploadedVideos(prev => prev.slice(0, maxVideoCount))
      uiState.setUploadedVideoFiles(prev => prev.slice(0, maxVideoCount))
      uiState.setUploadedVideoFilePaths(prev => prev.slice(0, maxVideoCount))
      uiState.setFileOrder(prev => prev.filter(item => item.type !== 'video' || item.index < maxVideoCount))
      if (maxVideoCount === 0) {
        uiState.setUploadedVideoDuration(0)
      }
    }
  }, [maxVideoCount, uiState.uploadedVideos.length, uiState.setFileOrder, uiState.setUploadedVideos, uiState.setUploadedVideoFiles, uiState.setUploadedVideoFilePaths, uiState.setUploadedVideoDuration, uiState])

  useEffect(() => {
    if (maxAudioCount === 0 && uiState.uploadedAudios.length > 0) {
      uiState.setUploadedAudios([])
      uiState.setUploadedAudioFilePaths([])
      uiState.setFileOrder(prev => prev.filter(item => item.type !== 'audio'))
      return
    }

    if (uiState.uploadedAudios.length > maxAudioCount) {
      uiState.setUploadedAudios(prev => prev.slice(0, maxAudioCount))
      uiState.setUploadedAudioFilePaths(prev => prev.slice(0, maxAudioCount))
      uiState.setFileOrder(prev => prev.filter(item => item.type !== 'audio' || item.index < maxAudioCount))
    }
  }, [maxAudioCount, uiState.uploadedAudios.length, uiState.setFileOrder, uiState.setUploadedAudioFilePaths, uiState.setUploadedAudios, uiState])

  // 6. 暴露 setter 给父组件
  useEffect(() => {
    if (onSetUploadedImagesRef) {
      onSetUploadedImagesRef(uiState.setUploadedImages)
    }
  }, [onSetUploadedImagesRef, uiState.setUploadedImages])

  useEffect(() => {
    if (onSetUploadedFilePathsRef) {
      onSetUploadedFilePathsRef(uiState.setUploadedFilePaths)
    }
  }, [onSetUploadedFilePathsRef, uiState.setUploadedFilePaths])

  useEffect(() => {
    if (!onStateChange) return
    onStateChange({ modelId: uiState.selectedModel, prompt: uiState.input })
  }, [onStateChange, uiState.selectedModel, uiState.input])

  useGlobalPasteImage({
    selectedModel: uiState.selectedModel,
    modelParams: modelState.params,
    uploadedImagesCount: uiState.uploadedImages.length,
    uploadedVideosCount: uiState.uploadedVideos.length,
    handleImageFileUpload: imageUpload.handleImageFileUpload
  })

  useReeditContent(uiState, modelState)

  // 9. 生成按钮处理（带验证）
  const handleGenerate = async () => {
    const isInputBusy = isSubmittingGenerate || (isLoading && !isGenerating)
    if (isInputBusy) return

    // 必填参数未填：直接打开其所在的“更多参数”浮层（或行内控件）并聚焦，不提交（任务 4.3）
    if (parameterPanelRef.current?.revealFirstMissingRequired()) return

    const requirementCheck = validateGenerationRequirements(
      uiState.selectedModel,
      modelState.params,
      {
        prompt: uiState.input,
        imagesCount: uiState.uploadedImages.length,
        videosCount: uiState.uploadedVideos.length
      }
    )

    if (!requirementCheck.ok && requirementCheck.message) {
      uiState.showAlert(
        requirementCheck.message.title,
        requirementCheck.message.message,
        requirementCheck.message.type || 'warning'
      )
      return
    }

    const hasAnyInput = uiState.input.trim().length > 0 ||
      uiState.uploadedImages.length > 0 ||
      uiState.uploadedVideos.length > 0 ||
      uiState.uploadedAudios.length > 0

    if (!hasAnyInput) {
      uiState.showAlert(
        t('ui:alerts.missingInput.title'),
        t('ui:alerts.missingInput.message'),
        'warning'
      )
      return
    }

    setIsSubmittingGenerate(true)
    try {
      await handleGenerateRequest()
    } finally {
      setIsSubmittingGenerate(false)
    }
  }
  const inputBusy = isSubmittingGenerate || (isLoading && !isGenerating)

  // 9. 预设加载处理
  const handleLoadPreset = (preset: Preset): void => {
    uiState.loadPromptCarrier({
      document: preset.promptDocument,
      legacyText: preset.prompt,
      bindings: preset.promptMediaBindings,
      legacyImages: preset.images?.dataUrls,
    })
    const params = PresetManager.loadPreset(preset.params ?? {}, uiState.selectedModel)
    Object.entries(params).forEach(([key, value]) => {
      modelState.setParam(key, value)
    })
  }



  return (
    <div className="relative w-full">
      {/* 输入区域：参考素材 · 提示词 · 底栏（模型与参数 ｜ 费用、预设、优化、生成） */}
      <InputArea
        compact={compact}
        promptDocument={uiState.promptDocument}
        onPromptDocumentChange={uiState.setPromptDocument}
        promptReferences={uiState.promptReferences}
        uploadedImages={uiState.uploadedImages}
        uploadedVideos={uiState.uploadedVideos}
        uploadedAudios={uiState.uploadedAudios}
        fileOrder={uiState.fileOrder}
        onFileOrderChange={uiState.setFileOrder}
        onImageUpload={(files) => imageUpload.handleImageFileUpload(
          files,
          maxImageCount
        )}
        onVideoUpload={videoUpload.handleVideoUpload}
        onAudioUpload={audioUpload.handleAudioUpload}
        onImageRemove={imageUpload.removeImage}
        onVideoRemove={videoUpload.handleVideoRemove}
        onAudioRemove={audioUpload.handleAudioRemove}
        onImageReplace={imageUpload.handleImageReplace}
        onImageReorder={imageUpload.handleImageReorder}
        onImageClick={onImageClick}
        onPaste={(e) => imageUpload.handlePaste(
          e,
          maxImageCount
        )}
        onImageDrop={(files) => imageUpload.handleImageFileDrop(
          files,
          maxImageCount
        )}
        onDragStateChange={imageUpload.setIsDraggingImage}
        onVideoReplace={videoUpload.handleVideoReplace}
        onVideoTrim={videoTrimMaxClipSeconds ? (index) => void handleVideoTrim(index) : undefined}
        onAudioReplace={audioUpload.handleAudioReplace}
        onVideoClick={(videoUrl: string) => {
          const index = uiState.uploadedVideos.indexOf(videoUrl)
          const videoFile = index >= 0 ? uiState.uploadedVideoFiles[index] : undefined
          if (videoFile) {
            const fullPath = uiState.uploadedVideoFilePaths[index] || getPathForFile(videoFile)
            if (!fullPath) return
            window.dispatchEvent(new CustomEvent('open-video-viewer', {
              detail: { videoUrl: toDisplaySrc(fullPath) }
            }))
          }
        }}
        onAudioClick={(audioUrl: string) => {
          const index = uiState.uploadedAudios.indexOf(audioUrl)
          const audioPath = index >= 0 ? uiState.uploadedAudioFilePaths[index] : undefined
          window.dispatchEvent(new CustomEvent('open-audio-viewer', {
            detail: { filePath: audioPath }
          }))
        }}
        selectedModel={uiState.selectedModel}
        currentModel={currentModel}
        modelParams={modelState.params}
        isLoading={inputBusy}
        isGenerating={isGenerating}
        promptOptimizationPreview={promptOptimizationPreview}
        promptEditorRef={promptEditorRef}
        onGenerate={handleGenerate}
        footerStart={<GeneratorConfigurationBar uiState={uiState} modelState={modelState} parameterPanelRef={parameterPanelRef} />}
        footerEnd={(
          <UiFieldLayoutContext.Provider value="toolbar">
            <PriceEstimate
              providerId={uiState.selectedProvider}
              modelId={uiState.selectedModel}
              params={priceEstimateParams}
            />
            <PresetPanel
              getCurrentState={() => ({
                input: uiState.input,
                promptDocument: uiState.promptDocument,
                promptMediaBindings: uiState.promptMediaBindings,
                uploadedImages: uiState.uploadedImages,
                uploadedFilePaths: uiState.uploadedFilePaths,
                params: modelState.params,
              })}
              onLoadPreset={handleLoadPreset}
            />
            <PromptOptimizeButton
              prompt={uiState.input}
              uploadedImages={uiState.uploadedImages}
              uploadedFilePaths={uiState.uploadedFilePaths}
              uploadedVideos={uiState.uploadedVideos}
              uploadedVideoFiles={uiState.uploadedVideoFiles}
              uploadedVideoFilePaths={uiState.uploadedVideoFilePaths}
              targetModel={{
                providerId: uiState.selectedProvider,
                providerName: currentProvider?.name,
                modelId: uiState.selectedModel,
                modelName: currentModel?.name,
                modelType: currentModel?.type,
                modelFunctions: currentModel?.functions,
                modelDescription: currentModel?.description,
              }}
              disabled={inputBusy}
              onOptimized={(value) => {
                const document = parseLegacyPromptString(value, {
                  references: uiState.promptReferences,
                })
                if (promptEditorRef.current) {
                  promptEditorRef.current.replaceDocument(document, { addToHistory: true })
                  return
                }
                uiState.setPromptDocument(document)
              }}
              onStreamPreviewChange={setPromptOptimizationPreview}
              onAlert={uiState.showAlert}
            />
          </UiFieldLayoutContext.Provider>
        )}
      />

      {videoTrimState && videoTrimMaxClipSeconds && (
        <VideoTrimModal
          open
          previewUrl={videoTrimState.previewUrl}
          maxClipSeconds={videoTrimMaxClipSeconds}
          maxSizeMB={videoTrimMaxSizeMB}
          resolveSource={async () => {
            const existingPath = uiState.uploadedVideoFilePaths[videoTrimState.index]
            if (existingPath) return existingPath
            const saved = await saveUploadVideo(videoTrimState.file, 'persist')
            return saved.fullPath
          }}
          initialRange={
            uiState.uploadedVideoTrimStart !== null && uiState.uploadedVideoTrimEnd !== null
              ? { start: uiState.uploadedVideoTrimStart, end: uiState.uploadedVideoTrimEnd }
              : null
          }
          onConfirm={handleVideoTrimConfirm}
          onVideoCompressed={(newPath) => {
            // 完整视频已被压缩成新文件：更新引用，让后续生成提交直接用这个压缩版本
            uiState.setUploadedVideoFilePaths([newPath])
          }}
          onClose={() => {
            setVideoTrimState(null)
          }}
        />
      )}

    </div>
  )
}

export default MediaGenerator
