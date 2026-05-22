import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getAvailableProviders, getModelInfo } from '@/utils/modelHelpers'
import PriceEstimate from '@/components/ui/PriceEstimate'
import PresetPanel from '@/components/PresetPanel'

import { useUIState } from './state/useUIState'
import { useModelState } from './state/useModelState'
import { useModelVisibility } from './hooks/useModelVisibility'
import { useGenerationHandler } from './hooks/useGenerationHandler'
import { useImageUpload } from './hooks/useImageUpload'
import { useVideoUpload } from './hooks/useVideoUpload'
import { useGlobalPasteImage } from './hooks/useGlobalPasteImage'
import { useReeditContent } from './hooks/useReeditContent'
import { PresetManager } from './preset/PresetManager'
import ModelSelectorPanel from './components/ModelSelectorPanel'
import ParameterPanel from './components/ParameterPanel'
import InputArea from './components/InputArea'
import AlertDialog from '../ui/AlertDialog'
import PanelTrigger from '../ui/PanelTrigger'
import { UiButton } from '@/components/ui'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { validateGenerationRequirements } from '@/core/validation/modelRequirements'

interface MediaGeneratorProps {
  onGenerate: (input: string, model: string, type: 'image' | 'video' | 'audio', options?: unknown) => void | Promise<void>
  isLoading: boolean
  onOpenClearHistory: () => void
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
  onGenerate,
  isLoading,
  onOpenClearHistory,
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

  // 2. 模型参数管理（使用新系统）
  const modelState = useModelState(uiState.selectedModel, uiState)

  const inputLimits = resolveInputLimits(
    uiState.selectedModel,
    modelState.params,
    { imagesCount: uiState.uploadedImages.length, videosCount: uiState.uploadedVideos.length }
  )
  const maxImageCount = inputLimits.images.max
  const videoValidationOptions = inputLimits.videoConstraints
    ? {
      minDuration: inputLimits.videoConstraints.minDurationSec,
      maxDuration: inputLimits.videoConstraints.maxDurationSec,
      maxSizeMB: inputLimits.videoConstraints.maxSizeMB
    }
    : undefined

  // 3. 模型可见性管理
  useModelVisibility(
    uiState.selectedProvider,
    uiState.selectedModel,
    uiState.setSelectedProvider,
    uiState.setSelectedModel,
    modelState.resetParams
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
    uiState.setUploadedVideoDuration
  )

  // 5. 生成请求处理
  const { handleGenerate: handleGenerateRequest } = useGenerationHandler(
    uiState.selectedModel,
    uiState.input,
    modelState,
    uiState.uploadedImages,
    uiState.uploadedVideos,
    uiState.uploadedVideoFiles,
    uiState.uploadedFilePaths,
    uiState.uploadedVideoFilePaths,
    onGenerate
  )

  // 获取当前选择的供应商和模型
  const providers = getAvailableProviders()
  const currentProvider = providers.find(p => p.id === uiState.selectedProvider)
  const currentModel = getModelInfo(uiState.selectedModel)
  const priceEstimateParams = useMemo(
    () => ({
      ...modelState.params,
      prompt: uiState.input,
      text: uiState.input,
    }),
    [modelState.params, uiState.input]
  )

  useEffect(() => {
    if (maxImageCount === 0 && uiState.uploadedImages.length > 0) {
      uiState.setUploadedImages([])
      uiState.setUploadedFilePaths([])
      return
    }

    if (uiState.uploadedImages.length > maxImageCount) {
      uiState.setUploadedImages(prev => prev.slice(0, maxImageCount))
      uiState.setUploadedFilePaths(prev => prev.slice(0, maxImageCount))
    }
  }, [maxImageCount, uiState.uploadedImages.length, uiState.setUploadedImages, uiState.setUploadedFilePaths])

  useEffect(() => {
    const maxVideoCount = inputLimits.videos.max
    if (maxVideoCount === 0 && uiState.uploadedVideos.length > 0) {
      uiState.setUploadedVideos([])
      uiState.setUploadedVideoFiles([])
      uiState.setUploadedVideoFilePaths([])
      uiState.setUploadedVideoDuration(0)
      return
    }

    if (uiState.uploadedVideos.length > maxVideoCount) {
      uiState.setUploadedVideos(prev => prev.slice(0, maxVideoCount))
      uiState.setUploadedVideoFiles(prev => prev.slice(0, maxVideoCount))
      uiState.setUploadedVideoFilePaths(prev => prev.slice(0, maxVideoCount))
      if (maxVideoCount === 0) {
        uiState.setUploadedVideoDuration(0)
      }
    }
  }, [
    inputLimits.videos.max,
    uiState.uploadedVideos.length,
    uiState.setUploadedVideos,
    uiState.setUploadedVideoFiles,
    uiState.setUploadedVideoFilePaths,
    uiState.setUploadedVideoDuration
  ])

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
      uiState.uploadedVideos.length > 0

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
  const handleLoadPreset = (presetData: any) => {
    const params = PresetManager.loadPreset(presetData, uiState.selectedModel)
    Object.entries(params).forEach(([key, value]) => {
      modelState.setParam(key, value)
    })
  }



  // 11. 收藏模型切换
  const handleToggleFavorite = (e: React.MouseEvent, providerId: string, modelId: string) => {
    e.stopPropagation()
    const key = `${providerId}-${modelId}`
    uiState.setFavoriteModels(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <div className="relative w-full rounded-[inherit]">
      {/* 顶部参数行：模型选择器 + 参数面板 */}
      <div className="flex flex-wrap items-end gap-3 mb-2.5 px-1">
        {/* 模型选择器 */}
        <PanelTrigger
          label={t('models:title')}
          display={`${currentProvider?.name}：${currentModel?.name || t('models:selectModel')}`}
          className="w-auto min-w-[180px] flex-shrink-0"
          panelWidth={1100}
          panelClassName="border-zinc-500/70 bg-zinc-900/98 shadow-[0_24px_70px_rgba(0,0,0,0.55)]"
          alignment="aboveCenter"
          stableHeight={true}
          closeOnPanelClick={(t) => {
            if ((t as HTMLElement).closest('[data-prevent-close]')) return false
            return !!(t as HTMLElement).closest('[data-close-on-select]')
          }}
          renderPanel={() => (
            <ModelSelectorPanel
              selectedProvider={uiState.selectedProvider}
              selectedModel={uiState.selectedModel}
              modelFilterProvider={uiState.modelFilterProvider}
              modelFilterType={uiState.modelFilterType}
              modelFilterFunction={uiState.modelFilterFunction}
              favoriteModels={uiState.favoriteModels}
              onModelSelect={(pid, mid) => {
                uiState.setSelectedProvider(pid)
                uiState.setSelectedModel(mid)
                modelState.resetParams()
              }}
              onFilterProviderChange={uiState.setModelFilterProvider}
              onFilterTypeChange={uiState.setModelFilterType}
              onFilterFunctionChange={uiState.setModelFilterFunction}
              onToggleFavorite={handleToggleFavorite}
            />
          )}
        />

        {/* 参数配置面板 */}
        <ParameterPanel
          currentModel={currentModel}
          selectedModel={uiState.selectedModel}
          uploadedImages={uiState.uploadedImages}
          uploadedVideos={uiState.uploadedVideos}
          values={modelState.params}
          onChange={modelState.setParam}
        />
      </div>

      {/* 输入区域 */}
      <InputArea
        input={uiState.input}
        setInput={uiState.setInput}
        uploadedImages={uiState.uploadedImages}
        uploadedVideos={uiState.uploadedVideos}
        fileOrder={uiState.fileOrder}
        onFileOrderChange={uiState.setFileOrder}
        onImageUpload={(files) => imageUpload.handleImageFileUpload(
          files,
          maxImageCount
        )}
        onVideoUpload={videoUpload.handleVideoUpload}
        onImageRemove={imageUpload.removeImage}
        onVideoRemove={videoUpload.handleVideoRemove}
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
        onVideoClick={(videoUrl: string) => {
          const index = uiState.uploadedVideos.indexOf(videoUrl)
          const videoFile = index >= 0 ? uiState.uploadedVideoFiles[index] : undefined
          if (videoFile) {
            const videoObjectUrl = URL.createObjectURL(videoFile)
            window.dispatchEvent(new CustomEvent('open-video-viewer', {
              detail: { videoUrl: videoObjectUrl }
            }))
          }
        }}
        selectedModel={uiState.selectedModel}
        currentModel={currentModel}
        modelParams={modelState.params}
        isLoading={inputBusy}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
      />

      {/* 底部工具栏：按钮 + 价格估算 */}
      <div className="mt-2.5 flex items-center justify-between border-t border-zinc-800/70 px-1 pt-2.5">
        <div className="flex items-center gap-2">
          {/* 清除历史按钮 */}
          <UiButton
            type="button"
            variant="primary"
            onClick={onOpenClearHistory}
            className="h-9 bg-red-600/75 hover:bg-red-600"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {t('ui:actions.clearHistory')}
          </UiButton>

          {/* 预设面板 */}
          <PresetPanel
            getCurrentState={() => ({
              ...modelState.params,
              input: uiState.input
            })}
            onLoadPreset={handleLoadPreset}
          />
        </div>

        {/* 价格估算 */}
        <PriceEstimate
          providerId={uiState.selectedProvider}
          modelId={uiState.selectedModel}
          params={priceEstimateParams}
        />
      </div>

      {/* 全局 Alert Dialog */}
      <AlertDialog
        isOpen={uiState.alertDialog.isOpen}
        title={uiState.alertDialog.title}
        message={uiState.alertDialog.message}
        type={uiState.alertDialog.type}
        scope="container"
        onClose={() => uiState.setAlertDialog({ ...uiState.alertDialog, isOpen: false })}
      />
    </div>
  )
}

export default MediaGenerator
