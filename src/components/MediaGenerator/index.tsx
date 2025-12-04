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
import { useVideoUpload } from './hooks/useVideoUpload'
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
  onImageClick?: (imageUrl: string, imageList: string[]) => void
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
  onImageClick,
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

  // 使用视频上传 hook
  const videoUpload = useVideoUpload(
    state.uploadedVideos,
    state.setUploadedVideos,
    state.uploadedVideoFiles,
    state.setUploadedVideoFiles
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
    setKlingMode: state.setKlingMode,
    setKlingAspectRatio: state.setKlingAspectRatio,
    setKlingKeepAudio: state.setKlingKeepAudio,
    setKlingElements: state.setKlingElements,
    setUploadedVideos: state.setUploadedVideos,
    setUploadedVideoFilePaths: state.setUploadedVideoFilePaths,
    setKlingV26AspectRatio: state.setKlingV26AspectRatio,
    setKlingV26GenerateAudio: state.setKlingV26GenerateAudio,
    setKlingV26CfgScale: state.setKlingV26CfgScale,
    setSoraMode: state.setSoraMode,
    setSoraAspectRatio: state.setSoraAspectRatio,
    setSoraResolution: state.setSoraResolution,
    setMode: state.setMode,
    setLtxAspectRatio: state.setLtxAspectRatio,
    setLtxResolution: state.setLtxResolution,
    setLtxFps: state.setLtxFps,
    setLtxGenerateAudio: state.setLtxGenerateAudio,
    setLtxFastMode: state.setLtxFastMode,
    setLtxRetakeStartTime: state.setLtxRetakeStartTime,
    setLtxRetakeMode: state.setLtxRetakeMode,
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
    setTextNormalization: state.setTextNormalization,
    setNumInferenceSteps: state.setNumInferenceSteps,
    setEnablePromptExpansion: state.setEnablePromptExpansion,
    setAcceleration: state.setAcceleration,
    setResolutionBaseSize: state.setResolutionBaseSize,
    // 魔搭模型参数
    setSteps: state.setSteps,
    setGuidance: state.setGuidance,
    setNegativePrompt: state.setNegativePrompt,
    setModelscopeCustomModel: state.setModelscopeCustomModel
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

  // 监听分辨率选项变化（即梦 4.0 和 ByteDance Seedream v4）
  useEffect(() => {
    if (state.selectedResolution === 'smart' || state.isManualInput) return
    const resolution = getActualResolution(state.selectedResolution, state.resolutionQuality)
    if (resolution && resolution.includes('x')) {
      const [w, h] = resolution.split('x')
      state.setCustomWidth(w)
      state.setCustomHeight(h)
    }
  }, [state.selectedResolution, state.resolutionQuality])

  // 使用 ref 来防止 Z-Image-Turbo 的 useEffect 死循环
  const isUpdatingFromImageSizeRef = useRef(false)
  const isUpdatingFromCustomSizeRef = useRef(false)

  // 监听 Z-Image-Turbo 的 imageSize 和 resolutionBaseSize 变化，自动更新 customWidth 和 customHeight
  useEffect(() => {
    console.log('[Z-Image-Turbo] imageSize or baseSize changed:', {
      selectedModel: state.selectedModel,
      imageSize: state.imageSize,
      baseSize: state.resolutionBaseSize,
      currentWidth: state.customWidth,
      currentHeight: state.customHeight,
      isUpdatingFromCustomSize: isUpdatingFromCustomSizeRef.current
    })

    if (state.selectedModel !== 'fal-ai-z-image-turbo') return
    if (!state.imageSize) return

    // 如果是从 customSize 更新触发的，跳过
    if (isUpdatingFromCustomSizeRef.current) {
      console.log('[Z-Image-Turbo] Skipping update (triggered by customSize change)')
      isUpdatingFromCustomSizeRef.current = false
      return
    }

    // 如果是 "自定义"，不做任何处理，保持当前的 customWidth 和 customHeight
    if (state.imageSize === '自定义') {
      console.log('[Z-Image-Turbo] imageSize is 自定义, skipping update')
      return
    }

    // 如果是比例格式（如 "4:3"），使用基数动态计算分辨率
    if (state.imageSize.includes(':')) {
      const [w, h] = state.imageSize.split(':').map(Number)
      if (!isNaN(w) && !isNaN(h)) {
        // 使用基数计算分辨率
        import('@/utils/resolutionCalculator').then(({ calculateResolution }) => {
          const baseSize = state.resolutionBaseSize || 1440 // 默认 1440
          const size = calculateResolution(baseSize, w, h)
          console.log('[Z-Image-Turbo] Calculated size:', { ratio: state.imageSize, baseSize, size })

          const newWidth = String(size.width)
          const newHeight = String(size.height)

          // 只有当值真的不同时才更新
          if (state.customWidth !== newWidth || state.customHeight !== newHeight) {
            console.log('[Z-Image-Turbo] Updating customWidth and customHeight to:', size)
            isUpdatingFromImageSizeRef.current = true
            state.setCustomWidth(newWidth)
            state.setCustomHeight(newHeight)
          }
        })
      }
    }
  }, [state.imageSize, state.resolutionBaseSize, state.selectedModel])

  // 监听 customWidth 和 customHeight 变化，反向匹配比例（Z-Image-Turbo）
  // 只有用户手动修改时才触发
  useEffect(() => {
    console.log('[Z-Image-Turbo] customWidth/Height changed:', {
      selectedModel: state.selectedModel,
      customWidth: state.customWidth,
      customHeight: state.customHeight,
      currentImageSize: state.imageSize,
      isUpdatingFromImageSize: isUpdatingFromImageSizeRef.current
    })

    if (state.selectedModel !== 'fal-ai-z-image-turbo') return
    if (!state.customWidth || !state.customHeight) return

    // 如果是从 imageSize 更新触发的，跳过
    if (isUpdatingFromImageSizeRef.current) {
      console.log('[Z-Image-Turbo] Skipping update (triggered by imageSize change)')
      isUpdatingFromImageSizeRef.current = false
      return
    }

    const width = parseInt(state.customWidth)
    const height = parseInt(state.customHeight)
    if (isNaN(width) || isNaN(height)) return

    // 检查是否完全匹配某个预设尺寸（基于当前基数动态计算）
    let matchedRatio: string | null = null
    const baseSize = state.resolutionBaseSize || 1440

    // 定义所有支持的比例
    const aspectRatios = [
      '21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16', '9:21'
    ]

    // 动态计算每个比例的分辨率并匹配
    import('@/utils/resolutionCalculator').then(({ calculateResolution }) => {
      for (const ratio of aspectRatios) {
        const [w, h] = ratio.split(':').map(Number)
        const size = calculateResolution(baseSize, w, h)

        if (size.width === width && size.height === height) {
          matchedRatio = ratio
          break
        }
      }

      console.log('[Z-Image-Turbo] Matched ratio:', matchedRatio)

      // 如果找到匹配的比例，自动选中
      if (matchedRatio && state.imageSize !== matchedRatio) {
        console.log('[Z-Image-Turbo] Setting imageSize to matched ratio:', matchedRatio)
        isUpdatingFromCustomSizeRef.current = true
        state.setImageSize(matchedRatio)
      }
      // 如果没有匹配的比例，设置为 "自定义"
      else if (!matchedRatio && state.imageSize !== '自定义') {
        console.log('[Z-Image-Turbo] Setting imageSize to 自定义')
        isUpdatingFromCustomSizeRef.current = true
        state.setImageSize('自定义')
      }
    })
  }, [state.customWidth, state.customHeight, state.selectedModel, state.resolutionBaseSize])

  // 监听魔搭模型的 imageSize 和 resolutionBaseSize 变化，自动更新 customWidth 和 customHeight
  useEffect(() => {
    // 检查是否是魔搭模型
    const isModelscopeModel =
      state.selectedModel === 'Tongyi-MAI/Z-Image-Turbo' ||
      state.selectedModel === 'Qwen/Qwen-Image' ||
      state.selectedModel === 'black-forest-labs/FLUX.1-Krea-dev' ||
      state.selectedModel === 'modelscope-custom'

    if (!isModelscopeModel) return
    if (!state.imageSize) return

    console.log('[ModelScope] imageSize or baseSize changed:', {
      selectedModel: state.selectedModel,
      imageSize: state.imageSize,
      baseSize: state.resolutionBaseSize,
      currentWidth: state.customWidth,
      currentHeight: state.customHeight
    })

    // 如果是 "自定义"，不做任何处理
    if (state.imageSize === '自定义') {
      console.log('[ModelScope] imageSize is 自定义, skipping update')
      return
    }

    // 如果是比例格式（如 "4:3"），使用基数动态计算分辨率
    if (state.imageSize.includes(':')) {
      const [w, h] = state.imageSize.split(':').map(Number)
      if (!isNaN(w) && !isNaN(h)) {
        // 使用基数计算分辨率
        import('@/utils/resolutionCalculator').then(({ calculateResolution }) => {
          const baseSize = state.resolutionBaseSize || 1024 // 默认 1024
          const size = calculateResolution(baseSize, w, h)
          console.log('[ModelScope] Calculated size:', { ratio: state.imageSize, baseSize, size })

          const newWidth = String(size.width)
          const newHeight = String(size.height)

          // 只有当值真的不同时才更新
          if (state.customWidth !== newWidth || state.customHeight !== newHeight) {
            console.log('[ModelScope] Updating customWidth and customHeight to:', size)
            state.setCustomWidth(newWidth)
            state.setCustomHeight(newHeight)
          }
        })
      }
    }
  }, [state.imageSize, state.resolutionBaseSize, state.selectedModel])

  // 监听重新编辑事件
  const isRestoringRef = useRef(false)
  useEffect(() => {
    const handleReedit = (event: CustomEvent) => {
      const { prompt, images, uploadedFilePaths, videos, uploadedVideoFilePaths, model, provider, options } = event.detail as any

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

      // 恢复视频
      if (videos && Array.isArray(videos)) {
        state.setUploadedVideos(videos)
        // 将 base64 视频转换为 File 对象（用于后续上传）
        Promise.all(videos.map(async (videoDataUrl: string, index: number) => {
          try {
            const response = await fetch(videoDataUrl)
            const blob = await response.blob()
            const file = new File([blob], `video-${index}.mp4`, { type: blob.type || 'video/mp4' })
            return file
          } catch (e) {
            console.error('[MediaGenerator] Failed to convert video to File:', e)
            return null
          }
        })).then(files => {
          const validFiles = files.filter(f => f !== null) as File[]
          state.setUploadedVideoFiles(validFiles)
        })
      }
      if (uploadedVideoFilePaths && Array.isArray(uploadedVideoFilePaths)) {
        state.setUploadedVideoFilePaths(uploadedVideoFilePaths)
      } else {
        state.setUploadedVideoFilePaths([])
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
  }, [state.selectedModel, state.uploadedImages.length, state.modelscopeCustomModel, setterMap])

  // 注意：智能匹配已移除，现在只在生成时（optionsBuilder.ts）执行
  // 当用户上传图片时，autoSwitch 会自动将参数设置为 'smart'
  // 生成时，optionsBuilder.ts 会将 'smart' 转换为实际匹配的比例值


  // 模型选择处理
  const handleModelSelect = (providerId: string, modelId: string) => {
    state.setSelectedProvider(providerId)
    state.setSelectedModel(modelId)

    // 根据模型截断图片
    const max = getMaxImageCount(
      modelId,
      modelId === 'vidu-q1' ? state.viduMode :
      modelId === 'veo3.1' ? state.veoMode :
      undefined
    )
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
      // Kling Video O1
      klingMode: state.setKlingMode,
      klingAspectRatio: state.setKlingAspectRatio,
      klingKeepAudio: state.setKlingKeepAudio,
      // Kling v2.6 Pro
      klingV26AspectRatio: state.setKlingV26AspectRatio,
      klingV26GenerateAudio: state.setKlingV26GenerateAudio,
      klingV26CfgScale: state.setKlingV26CfgScale,
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
      // Sora 2
      soraMode: state.setSoraMode,
      soraAspectRatio: state.setSoraAspectRatio,
      soraResolution: state.setSoraResolution,
      // LTX-2
      mode: state.setMode,
      ltxResolution: state.setLtxResolution,
      ltxFps: state.setLtxFps,
      ltxGenerateAudio: state.setLtxGenerateAudio,
      ltxFastMode: state.setLtxFastMode,
      ltxRetakeDuration: state.setLtxRetakeDuration,
      ltxRetakeStartTime: state.setLtxRetakeStartTime,
      ltxRetakeMode: state.setLtxRetakeMode,
      // Seedream
      maxImages: state.setMaxImages,
      selectedResolution: state.setSelectedResolution,
      resolutionQuality: state.setResolutionQuality,
      // Nano Banana & ByteDance Seedream v4
      numImages: state.setNumImages,  // ByteDance Seedream v4 使用 numImages
      num_images: state.setNumImages, // Nano Banana 使用 num_images
      aspectRatio: state.setAspectRatio,
      resolution: state.setResolution,
      // Z-Image-Turbo
      imageSize: state.setImageSize,
      customWidth: state.setCustomWidth,
      customHeight: state.setCustomHeight,
      resolutionBaseSize: state.setResolutionBaseSize,
      numInferenceSteps: state.setNumInferenceSteps,
      enablePromptExpansion: state.setEnablePromptExpansion,
      acceleration: state.setAcceleration,
      // 魔搭
      steps: state.setSteps,
      guidance: state.setGuidance,
      negativePrompt: state.setNegativePrompt,
      modelscopeCustomModel: state.setModelscopeCustomModel,
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

    // 特殊处理：当切换自定义模型时，检查是否需要清空图片
    if (id === 'modelscopeCustomModel' && value) {
      try {
        const stored = localStorage.getItem('modelscope_custom_models')
        if (stored) {
          const models = JSON.parse(stored)
          const selectedModel = models.find((m: any) => m.id === value)

          // 如果切换到的是图片生成模型（不支持图片编辑），清空已上传的图片
          if (selectedModel && selectedModel.modelType && !selectedModel.modelType.imageEditing) {
            if (state.uploadedImages.length > 0) {
              state.setUploadedImages([])
              state.setUploadedFilePaths([])
            }
          }
        }
      } catch (e) {
        console.error('Failed to check model type:', e)
      }
    }
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
        uploadedVideoFilePaths: state.uploadedVideoFilePaths,
        setUploadedVideoFilePaths: state.setUploadedVideoFilePaths,
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
        klingMode: state.klingMode,
        klingAspectRatio: state.klingAspectRatio,
        klingKeepAudio: state.klingKeepAudio,
        klingElements: state.klingElements,
        uploadedVideos: state.uploadedVideos,
        uploadedVideoFiles: state.uploadedVideoFiles,
        klingV26AspectRatio: state.klingV26AspectRatio,
        klingV26GenerateAudio: state.klingV26GenerateAudio,
        klingV26CfgScale: state.klingV26CfgScale,
        soraMode: state.soraMode,
        soraAspectRatio: state.soraAspectRatio,
        soraResolution: state.soraResolution,
        // LTX-2 参数
        mode: state.mode,
        ltxResolution: state.ltxResolution,
        ltxFps: state.ltxFps,
        ltxGenerateAudio: state.ltxGenerateAudio,
        ltxFastMode: state.ltxFastMode,
        ltxRetakeDuration: state.ltxRetakeDuration,
        ltxRetakeStartTime: state.ltxRetakeStartTime,
        ltxRetakeMode: state.ltxRetakeMode,
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
        imageSize: state.imageSize,
        numInferenceSteps: state.numInferenceSteps,
        enablePromptExpansion: state.enablePromptExpansion,
        acceleration: state.acceleration,
        // 魔搭模型参数
        resolutionBaseSize: state.resolutionBaseSize,
        steps: state.steps,
        guidance: state.guidance,
        negativePrompt: state.negativePrompt,
        modelscopeCustomModel: state.modelscopeCustomModel,
        calculateSmartResolution: (img) => calculateSmartResolution(img, state.resolutionQuality),
        calculateSeedreamSmartResolution: (img) => calculateSeedreamSmartResolution(img, state.resolutionQuality),
        calculatePPIOSeedreamSmartResolution: (img) => calculatePPIOSeedreamSmartResolution(img, state.resolutionQuality)
      })

      // 保留原始 UI 参数值（用于重新编辑时恢复）
      // 这些参数可能在 buildGenerateOptions 中被智能匹配转换，但我们需要保留原始值
      const originalUIParams: Record<string, any> = {}

      // Nano Banana 和 Nano Banana Pro 的 aspectRatio
      if (state.selectedModel === 'nano-banana' || state.selectedModel === 'nano-banana-pro' ||
          state.selectedModel === 'fal-ai-nano-banana' || state.selectedModel === 'fal-ai-nano-banana-pro') {
        originalUIParams.aspectRatio = state.aspectRatio
      }

      // ByteDance Seedream v4 的 selectedResolution
      if (state.selectedModel === 'bytedance-seedream-v4' || state.selectedModel === 'fal-ai-bytedance-seedream-v4') {
        originalUIParams.selectedResolution = state.selectedResolution
      }

      // 将原始 UI 参数合并到 options 中
      const finalOptions = { ...options, ...originalUIParams }

      let finalInput = state.input
      if (state.selectedModel === 'seedream-4.0' && state.maxImages > 1) {
        finalInput = `生成${state.maxImages}张图片。${state.input}`
      }

      onGenerate(finalInput, state.selectedModel, currentModel?.type || 'image', finalOptions)
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
        klingMode={state.klingMode}
        mode={state.mode}
        modelscopeCustomModel={state.modelscopeCustomModel}
        onImageUpload={(files) => {
          const maxCount = getMaxImageCount(
            state.selectedModel,
            state.selectedModel === 'vidu-q1' ? state.viduMode :
            (state.selectedModel === 'veo3.1' || state.selectedModel === 'fal-ai-veo-3.1') ? state.veoMode :
            undefined
          )
          imageUpload.handleImageFileUpload(files, maxCount)
        }}
        onImageRemove={imageUpload.removeImage}
        onImageReplace={imageUpload.handleImageReplace}
        onImageReorder={imageUpload.handleImageReorder}
        onImageClick={onImageClick}
        onPaste={(e) => {
          const maxCount = getMaxImageCount(
            state.selectedModel,
            state.selectedModel === 'vidu-q1' ? state.viduMode :
            (state.selectedModel === 'veo3.1' || state.selectedModel === 'fal-ai-veo-3.1') ? state.veoMode :
            undefined
          )
          imageUpload.handlePaste(e, maxCount)
        }}
        onImageDrop={(files) => {
          const maxCount = getMaxImageCount(
            state.selectedModel,
            state.selectedModel === 'vidu-q1' ? state.viduMode :
            (state.selectedModel === 'veo3.1' || state.selectedModel === 'fal-ai-veo-3.1') ? state.veoMode :
            undefined
          )
          imageUpload.handleImageFileDrop(files, maxCount)
        }}
        onDragStateChange={imageUpload.setIsDraggingImage}
        uploadedVideos={state.uploadedVideos}
        onVideoUpload={videoUpload.handleVideoUpload}
        onVideoRemove={videoUpload.handleVideoRemove}
        onVideoReplace={videoUpload.handleVideoReplace}
        onVideoClick={(videoUrl: string) => {
          // 打开视频查看器，传递视频 URL 和文件路径（如果有）
          const index = state.uploadedVideos.indexOf(videoUrl)
          const filePath = index >= 0 ? state.uploadedVideoFilePaths[index] : undefined
          // 触发自定义事件，让 App.tsx 打开视频查看器
          window.dispatchEvent(new CustomEvent('open-video-viewer', {
            detail: { url: videoUrl, filePath }
          }))
        }}
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
              numImages: state.numImages,  // ByteDance Seedream v4 使用 numImages
              num_images: state.numImages, // Nano Banana 使用 num_images
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
              veoMode: state.veoMode,  // Veo 3.1 模式
              veoGenerateAudio: state.veoGenerateAudio,
              veoFastMode: state.veoFastMode,
              veoAspectRatio: state.veoAspectRatio,
              veoResolution: state.veoResolution,
              veoEnhancePrompt: state.veoEnhancePrompt,
              veoAutoFix: state.veoAutoFix,
              klingMode: state.klingMode,
              klingV26GenerateAudio: state.klingV26GenerateAudio,
              soraMode: state.soraMode,
              soraResolution: state.soraResolution,
              // LTX-2 参数
              ltxMode: state.mode,  // LTX-2 模式（使用 ltxMode 避免冲突）
              ltxResolution: state.ltxResolution,
              ltxFastMode: state.ltxFastMode,
              ltxRetakeDuration: state.ltxRetakeDuration,  // 视频编辑模式的时长
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
