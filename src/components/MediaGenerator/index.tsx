import React, { useEffect, useMemo, useRef } from 'react'
import { providers } from '@/config/providers'
import ParamRow from '@/components/ui/ParamRow'
import PanelTrigger from '@/components/ui/PanelTrigger'
import PriceEstimate from '@/components/ui/PriceEstimate'
import PresetPanel from '@/components/PresetPanel'
import { createPresetSetterMap } from '@/config/presetStateMapping'
import { getModelDefaultValues, getAutoSwitchValues } from '@/models'

// 导入提取的模块
import { useMediaGeneratorState } from './hooks/useMediaGeneratorState'
import { useImageUpload } from './hooks/useImageUpload'
import { buildGenerateOptions } from './builders/optionsBuilder'
import { calculateSmartResolution, calculateSeedreamSmartResolution, calculatePPIOSeedreamSmartResolution, getActualResolution } from './utils/resolutionUtils'
import { getMaxImageCount } from './utils/constants'
import ModelSelectorPanel from './components/ModelSelectorPanel'
import ParameterPanel from './components/ParameterPanel'
import InputArea from './components/InputArea'

interface MediaGeneratorProps {
  onGenerate: (input: string, model: string, type: 'image' | 'video' | 'audio', options?: any) => void
  isLoading: boolean
  onOpenSettings: () => void
  onOpenClearHistory: () => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  isGenerating?: boolean
}

/**
 * MediaGenerator 主组件 - 简化版
 * 从 2345 行简化到约 300 行
 */
const MediaGenerator: React.FC<MediaGeneratorProps> = ({
  onGenerate,
  isLoading,
  onOpenSettings,
  onOpenClearHistory,
  isGenerating
}) => {
  // 使用统一的状态管理 hook
  const state = useMediaGeneratorState()

  // 使用图片上传 hook
  const imageUpload = useImageUpload(
    state.uploadedImages,
    state.setUploadedImages,
    state.uploadedFilePaths,
    state.setUploadedFilePaths
  )

  // 获取当前选择的供应商和模型
  const currentProvider = providers.find(p => p.id === state.selectedProvider)
  const currentModel = currentProvider?.models.find(m => m.id === state.selectedModel)

  // 预设参数映射（用于预设功能和重新编辑功能）
  const setterMap = useMemo(() => createPresetSetterMap({
    setInput: state.setInput,
    setSelectedProvider: state.setSelectedProvider,
    setSelectedModel: state.setSelectedModel,
    setUploadedImages: state.setUploadedImages,
    setSelectedResolution: state.setSelectedResolution,
    setResolutionQuality: state.setResolutionQuality,
    setCustomWidth: state.setCustomWidth,
    setCustomHeight: state.setCustomHeight,
    setMaxImages: state.setMaxImages,
    setNumImages: state.setNumImages,
    setAspectRatio: state.setAspectRatio,
    setResolution: state.setResolution,
    setImageSize: state.setImageSize,
    setVeoMode: state.setVeoMode,
    setVeoAspectRatio: state.setVeoAspectRatio,
    setVeoResolution: state.setVeoResolution,
    setVeoEnhancePrompt: state.setVeoEnhancePrompt,
    setVeoGenerateAudio: state.setVeoGenerateAudio,
    setVeoAutoFix: state.setVeoAutoFix,
    setVeoFastMode: state.setVeoFastMode,
    setVideoDuration: state.setVideoDuration,
    setVideoResolution: state.setVideoResolution,
    setVideoAspectRatio: state.setVideoAspectRatio,
    setVideoNegativePrompt: state.setVideoNegativePrompt,
    setVideoSeed: state.setVideoSeed,
    setViduMode: state.setViduMode,
    setViduAspectRatio: state.setViduAspectRatio,
    setViduStyle: state.setViduStyle,
    setViduMovementAmplitude: state.setViduMovementAmplitude,
    setViduBgm: state.setViduBgm,
    setKlingCfgScale: state.setKlingCfgScale,
    setHailuoFastMode: state.setHailuoFastMode,
    setMinimaxEnablePromptExpansion: state.setMinimaxEnablePromptExpansion,
    setPixFastMode: state.setPixFastMode,
    setPixStyle: state.setPixStyle,
    setSeedanceVariant: state.setSeedanceVariant,
    setSeedanceResolution: state.setSeedanceResolution,
    setSeedanceAspectRatio: state.setSeedanceAspectRatio,
    setSeedanceCameraFixed: state.setSeedanceCameraFixed,
    setWanSize: state.setWanSize,
    setWanResolution: state.setWanResolution,
    setWanPromptExtend: state.setWanPromptExtend,
    setWanAudio: state.setWanAudio,
    setVoiceId: state.setVoiceId,
    setAudioSpec: state.setAudioSpec,
    setAudioEmotion: state.setAudioEmotion,
    setLanguageBoost: state.setLanguageBoost,
    setAudioVol: state.setAudioVol,
    setAudioPitch: state.setAudioPitch,
    setAudioSpeed: state.setAudioSpeed,
    setAudioSampleRate: state.setAudioSampleRate,
    setAudioBitrate: state.setAudioBitrate,
    setAudioFormat: state.setAudioFormat,
    setAudioChannel: state.setAudioChannel,
    setLatexRead: state.setLatexRead,
    setTextNormalization: state.setTextNormalization
  }), [])

  // 收藏模型管理
  const saveFavorites = (favorites: Set<string>) => {
    localStorage.setItem('favorite_models', JSON.stringify([...favorites]))
  }

  const toggleFavorite = (e: React.MouseEvent, providerId: string, modelId: string) => {
    e.stopPropagation()
    const key = `${providerId}-${modelId}`
    state.setFavoriteModels(prev => {
      const newSet = new Set(prev)
      if (newSet.has(key)) {
        newSet.delete(key)
      } else {
        newSet.add(key)
      }
      saveFavorites(newSet)
      return newSet
    })
  }

  // 从 localStorage 加载收藏的模型
  useEffect(() => {
    const saved = localStorage.getItem('favorite_models')
    if (saved) {
      try {
        const favArray = JSON.parse(saved)
        state.setFavoriteModels(new Set(favArray))
      } catch {
        state.setFavoriteModels(new Set())
      }
    }
  }, [])

  // 向 App 发送拖动状态变化事件
  useEffect(() => {
    const event = new CustomEvent('imageDragStateChanged', {
      detail: { isDragging: imageUpload.isDraggingImage }
    })
    window.dispatchEvent(event)
  }, [imageUpload.isDraggingImage])

  // 向父组件暴露当前状态
  useEffect(() => {
    const event = new CustomEvent('generatorStateChanged', {
      detail: {
        modelName: currentModel?.name || state.selectedModel,
        prompt: state.input
      }
    })
    window.dispatchEvent(event)
  }, [state.selectedModel, state.input, currentModel])

  // 监听分辨率选项变化
  useEffect(() => {
    if (state.selectedResolution === 'smart' || state.isManualInput) return
    const resolution = getActualResolution(state.selectedResolution, state.resolutionQuality)
    if (resolution && resolution.includes('x')) {
      const [w, h] = resolution.split('x')
      state.setCustomWidth(w)
      state.setCustomHeight(h)
    }
  }, [state.selectedResolution, state.resolutionQuality])

  // 监听重新编辑事件
  const isRestoringRef = useRef(false)
  useEffect(() => {
    const handleReedit = (event: CustomEvent) => {
      const { prompt, images, uploadedFilePaths, model, provider, options } = event.detail as any

      // 标记正在恢复状态，防止 useEffect 重置参数
      isRestoringRef.current = true

      state.setInput(prompt || '')

      // 恢复模型选择
      if (model) {
        let targetProvider = provider
        if (!targetProvider) {
          // 如果 provider 缺失（旧历史记录），尝试从 model 推断
          const p = providers.find(p => p.models.some(m => m.id === model))
          if (p) targetProvider = p.id
        }

        if (targetProvider) {
          handleModelSelect(targetProvider, model)
        }
      }

      // 恢复图片
      if (images && Array.isArray(images)) {
        state.setUploadedImages(images)
      }
      if (uploadedFilePaths && Array.isArray(uploadedFilePaths)) {
        state.setUploadedFilePaths(uploadedFilePaths)
      } else {
        state.setUploadedFilePaths([])
      }

      // 恢复参数 - 使用 setterMap 自动映射
      if (options) {
        for (const [key, value] of Object.entries(options)) {
          const setter = setterMap[key]
          if (setter && value !== undefined && value !== null) {
            setter(value)
          }
        }
      }

      // 恢复完成后重置标记
      setTimeout(() => {
        isRestoringRef.current = false
      }, 100)
    }

    window.addEventListener('reedit-content', handleReedit as EventListener)
    return () => {
      window.removeEventListener('reedit-content', handleReedit as EventListener)
    }
  }, [setterMap])

  // 自动应用模型 Schema 中定义的默认值
  useEffect(() => {
    if (isRestoringRef.current) return // 重新编辑时不重置

    const defaults = getModelDefaultValues(state.selectedModel)

    // 应用所有默认值
    for (const [key, value] of Object.entries(defaults)) {
      const setter = setterMap[key]
      if (setter) {
        setter(value)
      }
    }
  }, [state.selectedModel, setterMap])

  // 自动应用模型 Schema 中定义的自动切换规则
  useEffect(() => {
    if (isRestoringRef.current) return // 重新编辑时不切换

    const switches = getAutoSwitchValues(state.selectedModel, state)

    // 应用所有自动切换
    for (const [key, value] of Object.entries(switches)) {
      const setter = setterMap[key]
      if (setter) {
        setter(value)
      }
    }
  }, [state.selectedModel, state.uploadedImages.length, setterMap])

  // 注意：智能匹配已移除，现在只在生成时（optionsBuilder.ts）执行
  // 当用户上传图片时，autoSwitch 会自动将参数设置为 'smart'
  // 生成时，optionsBuilder.ts 会将 'smart' 转换为实际匹配的比例值


  // 模型选择处理
  const handleModelSelect = (providerId: string, modelId: string) => {
    state.setSelectedProvider(providerId)
    state.setSelectedModel(modelId)

    // 根据模型截断图片
    const max = getMaxImageCount(modelId, modelId === 'vidu-q1' ? state.viduMode : modelId === 'veo3.1' ? state.veoMode : undefined)
    if (state.uploadedImages.length > max) {
      state.setUploadedImages(prev => prev.slice(0, max))
      state.setUploadedFilePaths(prev => prev.slice(0, max))
    }
  }

  // 参数变更处理
  const handleSchemaChange = (id: string, value: any) => {
    const setterMap: Record<string, (v: any) => void> = {
      // 视频参数
      videoDuration: state.setVideoDuration,
      videoAspectRatio: state.setVideoAspectRatio,
      videoResolution: state.setVideoResolution,
      videoNegativePrompt: state.setVideoNegativePrompt,
      videoSeed: state.setVideoSeed,
      // Vidu
      viduMode: state.setViduMode,
      viduAspectRatio: state.setViduAspectRatio,
      viduStyle: state.setViduStyle,
      viduMovementAmplitude: state.setViduMovementAmplitude,
      viduBgm: state.setViduBgm,
      // Kling
      klingCfgScale: state.setKlingCfgScale,
      // Hailuo
      hailuoFastMode: state.setHailuoFastMode,
      minimaxEnablePromptExpansion: state.setMinimaxEnablePromptExpansion,
      // PixVerse
      pixFastMode: state.setPixFastMode,
      pixStyle: state.setPixStyle,
      // Wan
      wanSize: state.setWanSize,
      wanResolution: state.setWanResolution,
      wanPromptExtend: state.setWanPromptExtend,
      wanAudio: state.setWanAudio,
      // Seedance
      seedanceVariant: state.setSeedanceVariant,
      seedanceResolution: state.setSeedanceResolution,
      seedanceAspectRatio: state.setSeedanceAspectRatio,
      seedanceCameraFixed: state.setSeedanceCameraFixed,
      // Veo
      veoMode: state.setVeoMode,
      veoAspectRatio: state.setVeoAspectRatio,
      veoResolution: state.setVeoResolution,
      veoEnhancePrompt: state.setVeoEnhancePrompt,
      veoGenerateAudio: state.setVeoGenerateAudio,
      veoAutoFix: state.setVeoAutoFix,
      veoFastMode: state.setVeoFastMode,
      // Seedream
      maxImages: state.setMaxImages,
      selectedResolution: state.setSelectedResolution,
      resolutionQuality: state.setResolutionQuality,
      // Nano Banana
      num_images: state.setNumImages,
      aspect_ratio: state.setAspectRatio,
      resolution: state.setResolution,
      // 音频
      audioSpec: state.setAudioSpec,
      audioEmotion: state.setAudioEmotion,
      languageBoost: state.setLanguageBoost,
      audioVol: state.setAudioVol,
      audioPitch: state.setAudioPitch,
      audioSpeed: state.setAudioSpeed,
      audioSampleRate: state.setAudioSampleRate,
      audioBitrate: state.setAudioBitrate,
      audioFormat: state.setAudioFormat,
      audioChannel: state.setAudioChannel,
      latexRead: state.setLatexRead,
      textNormalization: state.setTextNormalization
    }

    // 直接设置值，保持界面显示为 'smart'
    const setter = setterMap[id]
    if (setter) setter(value)
  }

  // 生成处理
  const handleGenerate = async () => {
    if ((!state.input.trim() && state.uploadedImages.length === 0) || isLoading) return

    try {
      const options = await buildGenerateOptions({
        currentModel,
        selectedModel: state.selectedModel,
        uploadedImages: state.uploadedImages,
        uploadedFilePaths: state.uploadedFilePaths,
        setUploadedFilePaths: state.setUploadedFilePaths,
        selectedResolution: state.selectedResolution,
        resolutionQuality: state.resolutionQuality,
        customWidth: state.customWidth,
        customHeight: state.customHeight,
        isManualInput: state.isManualInput,
        maxImages: state.maxImages,
        numImages: state.numImages,
        aspectRatio: state.aspectRatio,
        resolution: state.resolution,
        videoDuration: state.videoDuration,
        videoAspectRatio: state.videoAspectRatio,
        videoResolution: state.videoResolution,
        videoNegativePrompt: state.videoNegativePrompt,
        videoSeed: state.videoSeed,
        viduMode: state.viduMode,
        viduStyle: state.viduStyle,
        viduMovementAmplitude: state.viduMovementAmplitude,
        viduBgm: state.viduBgm,
        viduAspectRatio: state.viduAspectRatio,
        klingCfgScale: state.klingCfgScale,
        hailuoFastMode: state.hailuoFastMode,
        minimaxEnablePromptExpansion: state.minimaxEnablePromptExpansion,
        pixFastMode: state.pixFastMode,
        pixStyle: state.pixStyle,
        wanSize: state.wanSize,
        wanResolution: state.wanResolution,
        wanPromptExtend: state.wanPromptExtend,
        wanAudio: state.wanAudio,
        seedanceVariant: state.seedanceVariant,
        seedanceResolution: state.seedanceResolution,
        seedanceAspectRatio: state.seedanceAspectRatio,
        seedanceCameraFixed: state.seedanceCameraFixed,
        veoMode: state.veoMode,
        veoAspectRatio: state.veoAspectRatio,
        veoResolution: state.veoResolution,
        veoEnhancePrompt: state.veoEnhancePrompt,
        veoGenerateAudio: state.veoGenerateAudio,
        veoAutoFix: state.veoAutoFix,
        veoFastMode: state.veoFastMode,
        audioSpeed: state.audioSpeed,
        audioEmotion: state.audioEmotion,
        voiceId: state.voiceId,
        audioSpec: state.audioSpec,
        audioVol: state.audioVol,
        audioPitch: state.audioPitch,
        audioSampleRate: state.audioSampleRate,
        audioBitrate: state.audioBitrate,
        audioFormat: state.audioFormat,
        audioChannel: state.audioChannel,
        latexRead: state.latexRead,
        textNormalization: state.textNormalization,
        languageBoost: state.languageBoost,
        calculateSmartResolution: (img) => calculateSmartResolution(img, state.resolutionQuality),
        calculateSeedreamSmartResolution: (img) => calculateSeedreamSmartResolution(img, state.resolutionQuality),
        calculatePPIOSeedreamSmartResolution: (img) => calculatePPIOSeedreamSmartResolution(img, state.resolutionQuality)
      })

      let finalInput = state.input
      if (state.selectedModel === 'seedream-4.0' && state.maxImages > 1) {
        finalInput = `生成${state.maxImages}张图片。${state.input}`
      }

      onGenerate(finalInput, state.selectedModel, currentModel?.type || 'image', options)
    } catch (error: any) {
      alert(error.message)
    }
  }

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* 参数行 */}
      <ParamRow className="mb-4">
        {/* 模型选择器 */}
        <PanelTrigger
          label="模型"
          display={`${currentProvider?.name}_${currentModel?.name || '选择'}`}
          className="w-auto min-w-[180px] flex-shrink-0"
          panelWidth={720}
          alignment="aboveCenter"
          stableHeight={true}
          closeOnPanelClick={(t) => {
            if ((t as HTMLElement).closest('[data-prevent-close]')) return false
            return !!(t as HTMLElement).closest('[data-close-on-select]')
          }}
          renderPanel={() => (
            <ModelSelectorPanel
              selectedProvider={state.selectedProvider}
              selectedModel={state.selectedModel}
              modelFilterProvider={state.modelFilterProvider}
              modelFilterType={state.modelFilterType}
              modelFilterFunction={state.modelFilterFunction}
              favoriteModels={state.favoriteModels}
              onModelSelect={handleModelSelect}
              onFilterProviderChange={state.setModelFilterProvider}
              onFilterTypeChange={state.setModelFilterType}
              onFilterFunctionChange={state.setModelFilterFunction}
              onToggleFavorite={toggleFavorite}
            />
          )}
        />


        {/* 参数配置面板 */}
        <ParameterPanel
          currentModel={currentModel}
          selectedModel={state.selectedModel}
          uploadedImages={state.uploadedImages}
          values={{
            ...state
          }}
          onChange={handleSchemaChange}
        />
      </ParamRow>

      {/* 输入区域 */}
      <InputArea
        input={state.input}
        setInput={state.setInput}
        currentModel={currentModel}
        selectedModel={state.selectedModel}
        uploadedImages={state.uploadedImages}
        isLoading={isLoading}
        isGenerating={isGenerating}
        viduMode={state.viduMode}
        veoMode={state.veoMode}
        onImageUpload={(files) => {
          const maxCount = getMaxImageCount(state.selectedModel, state.selectedModel === 'vidu-q1' ? state.viduMode : state.selectedModel === 'veo3.1' ? state.veoMode : undefined)
          imageUpload.handleImageFileUpload(files, maxCount)
        }}
        onImageRemove={imageUpload.removeImage}
        onImageReplace={imageUpload.handleImageReplace}
        onImageReorder={imageUpload.handleImageReorder}
        onPaste={(e) => {
          const maxCount = getMaxImageCount(state.selectedModel, state.selectedModel === 'vidu-q1' ? state.viduMode : state.selectedModel === 'veo3.1' ? state.veoMode : undefined)
          imageUpload.handlePaste(e, maxCount)
        }}
        onImageDrop={(files) => {
          const maxCount = getMaxImageCount(state.selectedModel, state.selectedModel === 'vidu-q1' ? state.viduMode : state.selectedModel === 'veo3.1' ? state.veoMode : undefined)
          imageUpload.handleImageFileDrop(files, maxCount)
        }}
        onDragStateChange={imageUpload.setIsDraggingImage}
        onGenerate={handleGenerate}
      />

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-3 mt-4 justify-between items-center">
        <button
          onClick={onOpenClearHistory}
          disabled={isLoading}
          className="px-4 py-2 bg-red-600/60 hover:bg-red-600/80 backdrop-blur-lg rounded-lg transition-all duration-300 border border-red-700/50 flex items-center text-sm"
          title="清除历史"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          清除历史
        </button>
        <button
          onClick={onOpenSettings}
          className="px-4 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 backdrop-blur-lg rounded-lg transition-all duration-300 border border-zinc-700/50 flex items-center text-sm"
          title="设置"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          设置
        </button>

        {/* 预设按钮 */}
        <PresetPanel
          getCurrentState={() => ({ ...state })}
          onLoadPreset={(params: Record<string, any>) => {
            for (const [key, value] of Object.entries(params)) {
              const setter = setterMap[key]
              if (setter && value !== undefined && value !== null) {
                setter(value)
              }
            }
          }}
          disabled={isLoading}
        />

        {/* 价格估算 */}
        <div className="ml-auto">
          <PriceEstimate
            providerId={state.selectedProvider}
            modelId={state.selectedModel}
            params={{
              num_images: state.numImages,
              maxImages: state.maxImages,
              uploadedImages: state.uploadedImages,
              resolution: state.resolution,
              videoDuration: state.videoDuration,
              videoResolution: state.videoResolution,
              viduMode: state.viduMode,
              hailuoFastMode: state.hailuoFastMode,
              pixFastMode: state.pixFastMode,
              seedanceVariant: state.seedanceVariant,
              seedanceResolution: state.seedanceResolution,
              seedanceAspectRatio: state.seedanceAspectRatio,
              wanResolution: state.wanResolution,
              mode: state.veoMode,
              veoGenerateAudio: state.veoGenerateAudio,
              veoFastMode: state.veoFastMode,
              veoAspectRatio: state.veoAspectRatio,
              veoResolution: state.veoResolution,
              veoEnhancePrompt: state.veoEnhancePrompt,
              veoAutoFix: state.veoAutoFix,
              input: state.input,
              audioSpec: state.audioSpec
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default MediaGenerator
