import React, { useEffect } from 'react'
import { getAvailableProviders, getModelInfo } from '@/utils/modelHelpers'
import PriceEstimate from '@/components/ui/PriceEstimate'
import PresetPanel from '@/components/PresetPanel'

// 导入新的模块化组件
import { logInfo, logError } from '@/utils/errorLogger'
import { useUIState } from './state/useUIState'
import { useModelState } from './state/useModelState'
import { useModelVisibility } from './hooks/useModelVisibility'
import { useGenerationHandler } from './hooks/useGenerationHandler'
import { useImageUpload } from './hooks/useImageUpload'
import { useVideoUpload } from './hooks/useVideoUpload'
import { PresetManager } from './preset/PresetManager'
import ModelSelectorPanel from './components/ModelSelectorPanel'
import ParameterPanel from './components/ParameterPanel'
import InputArea from './components/InputArea'
import AlertDialog from '../ui/AlertDialog'
import PanelTrigger from '../ui/PanelTrigger'
import { getMaxImageCount } from './utils/constants'

interface MediaGeneratorProps {
  onGenerate: (input: string, model: string, type: 'image' | 'video' | 'audio', options?: any) => void
  isLoading: boolean
  onOpenSettings: () => void
  onOpenClearHistory: () => void
  onImageClick?: (imageUrl: string, imageList: string[]) => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  isGenerating?: boolean
  onSetUploadedImagesRef?: (setter: React.Dispatch<React.SetStateAction<string[]>>) => void
  onSetUploadedFilePathsRef?: (setter: React.Dispatch<React.SetStateAction<string[]>>) => void
}

interface ReEditEventDetail {
  prompt?: string
  images?: string[]
  uploadedFilePaths?: string[]
  videos?: string[]
  uploadedVideoFilePaths?: string[]
  model?: string
  provider?: string
  options?: any
}

/**
 * MediaGenerator 主组件 - 重构版
 * 从 2069 行简化到 < 250 行
 * 使用模块化架构和配置驱动设计
 */
const MediaGenerator: React.FC<MediaGeneratorProps> = ({
  onGenerate,
  isLoading,
  onOpenSettings,
  onOpenClearHistory,
  onImageClick,
  isGenerating,
  onSetUploadedImagesRef,
  onSetUploadedFilePathsRef
}) => {
  // 1. UI 状态管理
  const uiState = useUIState()

  // 2. 模型参数管理（使用新系统）
  const modelState = useModelState(uiState.selectedModel, uiState)

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
    undefined,
    undefined,
    uiState.setUploadedVideoDuration
  )

  // 5. 生成请求处理
  const { handleGenerate: handleGenerateRequest } = useGenerationHandler(
    uiState.selectedModel,
    uiState.input,
    modelState,
    uiState.uploadedImages,
    uiState.uploadedVideos,
    onGenerate
  )

  // 获取当前选择的供应商和模型
  const providers = getAvailableProviders()
  const currentProvider = providers.find(p => p.id === uiState.selectedProvider)
  const currentModel = getModelInfo(uiState.selectedModel)

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

  // 7. 监听全局右键菜单的图片粘贴事件
  useEffect(() => {
    const dataUrlToFile = (dataUrl: string, fileName: string): File | null => {
      try {
        const arr = dataUrl.split(',')
        const mimeMatch = arr[0].match(/:(.*?);/)
        if (!mimeMatch) return null
        const mime = mimeMatch[1]
        const bstr = atob(arr[1])
        let n = bstr.length
        const u8arr = new Uint8Array(n)
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n)
        }
        return new File([u8arr], fileName, { type: mime })
      } catch {
        return null
      }
    }

    const getMaxCount = () => getMaxImageCount(
      uiState.selectedModel,
      modelState.params.mode || modelState.params.version
    )

    const handleGlobalPasteImage = async (e: Event) => {
      const customEvent = e as CustomEvent<{
        files?: File[]
        clipboardFiles?: Array<{ data: string; mimeType: string; name: string }>
        imageBlob?: Blob
        imageType?: string
      }>
      const detail = customEvent.detail

      if (detail?.clipboardFiles && detail.clipboardFiles.length > 0) {
        const files: File[] = []
        for (const clipFile of detail.clipboardFiles) {
          const file = dataUrlToFile(clipFile.data, clipFile.name)
          if (file) files.push(file)
        }
        if (files.length > 0) {
          await imageUpload.handleImageFileUpload(files, getMaxCount())
        }
      } else if (detail?.files && detail.files.length > 0) {
        await imageUpload.handleImageFileUpload(detail.files, getMaxCount())
      } else if (detail?.imageBlob) {
        const file = new File([detail.imageBlob], 'pasted-image.png', {
          type: detail.imageType || 'image/png'
        })
        await imageUpload.handleImageFileUpload([file], getMaxCount())
      }
    }

    window.addEventListener('globalPasteImage', handleGlobalPasteImage)
    return () => window.removeEventListener('globalPasteImage', handleGlobalPasteImage)
  }, [uiState.selectedModel, modelState.params, imageUpload])

  // 8. 监听重新编辑事件
  useEffect(() => {
    const handleReedit = async (e: Event) => {
      const customEvent = e as CustomEvent<ReEditEventDetail>
      const { prompt, images, uploadedFilePaths, videos, uploadedVideoFilePaths, model, provider, options } = customEvent.detail

      logInfo('[MediaGenerator] Handle re-edit:', { model, provider })

      // 1. 设置 UI 状态
      if (prompt !== undefined) uiState.setInput(prompt)
      if (provider) uiState.setSelectedProvider(provider)
      if (model) uiState.setSelectedModel(model)

      // 恢复图片
      if (images) uiState.setUploadedImages(images)
      if (uploadedFilePaths) uiState.setUploadedFilePaths(uploadedFilePaths)

      // 恢复视频 (包含缩略图重新生成逻辑)
      if (uploadedVideoFilePaths && Array.isArray(uploadedVideoFilePaths) && uploadedVideoFilePaths.length > 0) {
        logInfo('[MediaGenerator] Restoring videos from paths:', uploadedVideoFilePaths)

        try {
          // 异步处理：读取本地视频文件，生成缩略图和 File 对象
          const { readFile } = await import('@tauri-apps/plugin-fs')
          const { generateVideoThumbnail } = await import('@/utils/videoProcessing')

          const restorePromises = uploadedVideoFilePaths.map(async (filePath: string, index: number) => {
            try {
              // 读取文件内容
              const bytes = await readFile(filePath)
              const blob = new Blob([bytes], { type: 'video/mp4' })
              const file = new File([blob], `video-restored-${index}.mp4`, { type: 'video/mp4' })

              // 生成缩略图 (传入 timeOffset = 1.0 明确参数)
              const thumbnail = await generateVideoThumbnail(file, 1.0)

              logInfo('[MediaGenerator] 视频恢复成功:', { path: filePath, thumbnailLength: thumbnail.length })
              return { file, thumbnail, path: filePath }
            } catch (e) {
              logError('[MediaGenerator] 视频恢复失败:', { path: filePath, error: e })
              return null
            }
          })

          const results = await Promise.all(restorePromises)
          const validResults = results.filter(r => r !== null) as { file: File, thumbnail: string, path: string }[]

          if (validResults.length > 0) {
            // 一次性设置所有状态，避免 UI 闪烁
            uiState.setUploadedVideos(validResults.map(r => r.thumbnail))
            uiState.setUploadedVideoFiles(validResults.map(r => r.file))
            uiState.setUploadedVideoFilePaths(validResults.map(r => r.path))
          }
        } catch (err) {
          logError('[MediaGenerator] 批量恢复视频失败:', err)
        }
      } else if (videos && Array.isArray(videos) && videos.length > 0) {
        // 旧逻辑回退：如果没有 uploadedVideoFilePaths，尝试使用 videos (可能是 base64 缩略图或者 URL)
        logInfo('[MediaGenerator] Restoring videos from legacy videos array')
        uiState.setUploadedVideos(videos)
        // 清空其他相关状态以保持一致性
        uiState.setUploadedVideoFilePaths([])
        uiState.setUploadedVideoFiles([])
      }

      // 2. 恢复参数 (延迟执行以等待模型切换的副作用完成)
      setTimeout(() => {
        if (options) {
          // 清理不需要的字段 (防止污染参数)
          const paramsToSet = { ...options }
          delete paramsToSet.images
          delete paramsToSet.uploadedFilePaths
          delete paramsToSet.videos
          delete paramsToSet.uploadedVideoFilePaths
          delete paramsToSet.uploadedImages
          delete paramsToSet.uploadedVideos
          delete paramsToSet.editStateFile // 内部字段不作为参数显示
          delete paramsToSet.imageEditStates // 内部字段

          logInfo('[MediaGenerator] Restore params:', paramsToSet)
          modelState.setParams(paramsToSet)
        }
      }, 100)
    }

    window.addEventListener('reedit-content', handleReedit)
    return () => window.removeEventListener('reedit-content', handleReedit)
  }, [uiState, modelState]) // 依赖项包含 state setter，确保闭包中拿到的是最新的 setter

  // 9. 生成按钮处理（带验证）
  const handleGenerate = async () => {
    if ((!uiState.input.trim() && uiState.uploadedImages.length === 0) || isLoading) return

    // === 模型特定验证 ===

    // 1. Seedance v1 Pro 快速模式限制
    if ((uiState.selectedModel === 'fal-ai-bytedance-seedance-v1' ||
      uiState.selectedModel === 'bytedance-seedance-v1') &&
      modelState.params.falSeedanceV1Version === 'pro' &&
      modelState.params.falSeedanceV1FastMode &&
      modelState.params.falSeedanceV1Mode === 'image-to-video' &&
      uiState.uploadedImages.length >= 2) {
      uiState.showAlert(
        '不支持的参数组合',
        'Pro模型的快速模式不支持结束帧（首尾帧）',
        'warning'
      )
      return
    }

    // 2. KIE Hailuo 2.3 必需条件
    if (uiState.selectedModel === 'kie-hailuo-2-3' ||
      uiState.selectedModel === 'hailuo-2-3-kie') {
      if (uiState.uploadedImages.length === 0) {
        uiState.showAlert(
          '图片必需',
          'KIE 海螺 2.3 是图生视频模型，必须上传图片才能生成',
          'warning'
        )
        return
      }
      if (!uiState.input.trim()) {
        uiState.showAlert(
          '提示词必需',
          '请输入提示词描述期望的视频效果',
          'warning'
        )
        return
      }
    }

    // 3. Kling O1 多模式验证
    if (uiState.selectedModel === 'kling-o1') {
      const mode = modelState.params.ppioKlingO1Mode || 'text-image-to-video'

      if (mode === 'start-end-frame' && uiState.uploadedImages.length !== 2) {
        uiState.showAlert(
          '图片必需',
          '首尾帧模式需要上传2张图片',
          'warning'
        )
        return
      }
      if (mode === 'reference-to-video' && uiState.uploadedVideoFiles.length === 0) {
        uiState.showAlert(
          '视频必需',
          '参考生视频模式需要上传视频才能生成',
          'warning'
        )
        return
      }
      if (mode === 'video-edit' && uiState.uploadedVideoFiles.length === 0) {
        uiState.showAlert(
          '视频必需',
          '视频编辑模式需要上传视频才能生成',
          'warning'
        )
        return
      }
    }

    // 4. 动作控制模式验证 (PPIO/Fal/KIE Kling 2.6)
    const isKling26PPIO = uiState.selectedModel === 'kling-2.6-pro' && modelState.params.ppioKling26Mode === 'motion-control'
    const isKling26Fal = (uiState.selectedModel === 'fal-ai-kling-video-v2.6-pro' || uiState.selectedModel === 'kling-video-v2.6-pro') &&
      modelState.params.falKlingV26ProMode === 'motion-control'
    const isKling26KIE = (uiState.selectedModel === 'kie-kling-v2-6' || uiState.selectedModel === 'kling-v2-6-kie') &&
      modelState.params.kieKlingV26Mode === 'motion-control'

    if (isKling26PPIO || isKling26Fal || isKling26KIE) {
      if (uiState.uploadedImages.length !== 1) {
        uiState.showAlert(
          '图片必需',
          '动作控制模式需要上传1张图片（不能多也不能少）',
          'warning'
        )
        return
      }
      if (uiState.uploadedVideoFiles.length !== 1) {
        uiState.showAlert(
          '视频必需',
          '动作控制模式需要上传1个视频（不能多也不能少）',
          'warning'
        )
        return
      }
    }

    // 验证通过，执行生成
    handleGenerateRequest()
  }

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
    <div className="w-full max-w-5xl mx-auto">
      {/* 顶部参数行：模型选择器 + 参数面板 */}
      <div className="flex flex-wrap items-end gap-4 mb-4">
        {/* 模型选择器 */}
        <PanelTrigger
          label="模型"
          display={`${currentProvider?.name}：${currentModel?.name || '选择'}`}
          className="w-auto min-w-[180px] flex-shrink-0"
          panelWidth={1100}
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
          getMaxImageCount(uiState.selectedModel, modelState.params.mode || modelState.params.version)
        )}
        onVideoUpload={videoUpload.handleVideoUpload}
        onImageRemove={imageUpload.removeImage}
        onVideoRemove={videoUpload.handleVideoRemove}
        onImageReplace={imageUpload.handleImageReplace}
        onImageReorder={imageUpload.handleImageReorder}
        onImageClick={onImageClick}
        onPaste={(e) => imageUpload.handlePaste(
          e,
          getMaxImageCount(uiState.selectedModel, modelState.params.mode || modelState.params.version)
        )}
        onImageDrop={(files) => imageUpload.handleImageFileDrop(
          files,
          getMaxImageCount(uiState.selectedModel, modelState.params.mode || modelState.params.version)
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
        isLoading={isLoading}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
      />

      {/* 底部工具栏：按钮 + 价格估算 */}
      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-2">
          {/* 清除历史按钮 */}
          <button
            onClick={onOpenClearHistory}
            className="h-9 px-4 inline-flex items-center justify-center rounded-lg bg-red-600/70 hover:bg-red-600 text-white text-sm transition-colors"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            清除历史
          </button>

          {/* 设置按钮 */}
          <button
            onClick={onOpenSettings}
            className="h-9 px-4 inline-flex items-center justify-center rounded-lg bg-zinc-700/60 hover:bg-zinc-600/60 text-white text-sm transition-colors"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </button>

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
          params={modelState.params}
        />
      </div>

      {/* 全局 Alert Dialog */}
      <AlertDialog
        isOpen={uiState.alertDialog.isOpen}
        title={uiState.alertDialog.title}
        message={uiState.alertDialog.message}
        type={uiState.alertDialog.type}
        onClose={() => uiState.setAlertDialog({ ...uiState.alertDialog, isOpen: false })}
      />
    </div>
  )
}

export default MediaGenerator
