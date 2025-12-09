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
    setModelscopeImageSize: state.setModelscopeImageSize,
    setFalVeo31Mode: state.setFalVeo31Mode,
    setFalVeo31AspectRatio: state.setFalVeo31AspectRatio,
    setFalVeo31Resolution: state.setFalVeo31Resolution,
    setFalVeo31EnhancePrompt: state.setFalVeo31EnhancePrompt,
    setFalVeo31GenerateAudio: state.setFalVeo31GenerateAudio,
    setFalVeo31AutoFix: state.setFalVeo31AutoFix,
    setFalVeo31FastMode: state.setFalVeo31FastMode,
    setFalHailuo23Version: state.setFalHailuo23Version,
    setFalHailuo23Duration: state.setFalHailuo23Duration,
    setFalHailuo23FastMode: state.setFalHailuo23FastMode,
    setFalHailuo23PromptOptimizer: state.setFalHailuo23PromptOptimizer,
    setVideoDuration: state.setVideoDuration,
    setVideoResolution: state.setVideoResolution,
    setVideoAspectRatio: state.setVideoAspectRatio,
    setVideoNegativePrompt: state.setVideoNegativePrompt,
    setVideoSeed: state.setVideoSeed,
    // 模型特定参数 - 派欧云
    setPpioKling25VideoDuration: state.setPpioKling25VideoDuration,
    setPpioKling25VideoAspectRatio: state.setPpioKling25VideoAspectRatio,
    setPpioHailuo23VideoDuration: state.setPpioHailuo23VideoDuration,
    setPpioHailuo23VideoResolution: state.setPpioHailuo23VideoResolution,
    setPpioPixverse45VideoAspectRatio: state.setPpioPixverse45VideoAspectRatio,
    setPpioPixverse45VideoResolution: state.setPpioPixverse45VideoResolution,
    setPpioWan25VideoDuration: state.setPpioWan25VideoDuration,
    setPpioSeedanceV1VideoDuration: state.setPpioSeedanceV1VideoDuration,
    // 模型特定参数 - Fal
    setFalNanoBananaAspectRatio: state.setFalNanoBananaAspectRatio,
    setFalNanoBananaNumImages: state.setFalNanoBananaNumImages,
    setFalNanoBananaProAspectRatio: state.setFalNanoBananaProAspectRatio,
    setFalNanoBananaProNumImages: state.setFalNanoBananaProNumImages,
    setFalNanoBananaProResolution: state.setFalNanoBananaProResolution,
    setFalKlingImageO1AspectRatio: state.setFalKlingImageO1AspectRatio,
    setFalKlingImageO1NumImages: state.setFalKlingImageO1NumImages,
    setFalKlingImageO1Resolution: state.setFalKlingImageO1Resolution,
    setFalZImageTurboImageSize: state.setFalZImageTurboImageSize,
    setFalZImageTurboNumImages: state.setFalZImageTurboNumImages,
    setFalSeedream40NumImages: state.setFalSeedream40NumImages,
    setFalWan25VideoDuration: state.setFalWan25VideoDuration,
    setFalSeedanceV1VideoDuration: state.setFalSeedanceV1VideoDuration,
    setFalVeo31VideoDuration: state.setFalVeo31VideoDuration,
    setFalSora2VideoDuration: state.setFalSora2VideoDuration,
    setFalLtx2VideoDuration: state.setFalLtx2VideoDuration,
    setFalViduQ2VideoDuration: state.setFalViduQ2VideoDuration,
    setFalPixverse55VideoDuration: state.setFalPixverse55VideoDuration,
    setFalKlingV26ProVideoDuration: state.setFalKlingV26ProVideoDuration,
    setFalKlingVideoO1VideoDuration: state.setFalKlingVideoO1VideoDuration,
    setFalKlingVideoO1Mode: state.setFalKlingVideoO1Mode,
    setFalKlingVideoO1AspectRatio: state.setFalKlingVideoO1AspectRatio,
    setFalKlingVideoO1KeepAudio: state.setFalKlingVideoO1KeepAudio,
    setFalKlingVideoO1Elements: state.setFalKlingVideoO1Elements,
    setPpioViduQ1VideoDuration: state.setPpioViduQ1VideoDuration,
    setPpioViduQ1Mode: state.setPpioViduQ1Mode,
    setPpioViduQ1AspectRatio: state.setPpioViduQ1AspectRatio,
    setPpioViduQ1Style: state.setPpioViduQ1Style,
    setPpioViduQ1MovementAmplitude: state.setPpioViduQ1MovementAmplitude,
    setPpioViduQ1Bgm: state.setPpioViduQ1Bgm,
    setPpioKling25CfgScale: state.setPpioKling25CfgScale,
    setPpioHailuo23FastMode: state.setPpioHailuo23FastMode,
    setPpioHailuo23EnablePromptExpansion: state.setPpioHailuo23EnablePromptExpansion,
    setPpioPixverse45FastMode: state.setPpioPixverse45FastMode,
    setPpioPixverse45Style: state.setPpioPixverse45Style,
    setPpioSeedanceV1Variant: state.setPpioSeedanceV1Variant,
    setPpioSeedanceV1Resolution: state.setPpioSeedanceV1Resolution,
    setPpioSeedanceV1AspectRatio: state.setPpioSeedanceV1AspectRatio,
    setPpioSeedanceV1CameraFixed: state.setPpioSeedanceV1CameraFixed,
    setFalSeedanceV1Mode: state.setFalSeedanceV1Mode,
    setFalSeedanceV1Version: state.setFalSeedanceV1Version,
    setFalSeedanceV1FastMode: state.setFalSeedanceV1FastMode,
    setPpioWan25Size: state.setPpioWan25Size,
    setPpioWan25PromptExtend: state.setPpioWan25PromptExtend,
    setPpioWan25Audio: state.setPpioWan25Audio,
    setFalWan25AspectRatio: state.setFalWan25AspectRatio,
    setFalWan25Resolution: state.setFalWan25Resolution,
    setFalWan25PromptExpansion: state.setFalWan25PromptExpansion,
    setUploadedVideos: state.setUploadedVideos,
    setUploadedVideoFilePaths: state.setUploadedVideoFilePaths,
    setFalKlingV26ProAspectRatio: state.setFalKlingV26ProAspectRatio,
    setFalKlingV26ProGenerateAudio: state.setFalKlingV26ProGenerateAudio,
    setFalKlingV26ProCfgScale: state.setFalKlingV26ProCfgScale,
    setFalSora2Mode: state.setFalSora2Mode,
    setFalSora2AspectRatio: state.setFalSora2AspectRatio,
    setFalSora2Resolution: state.setFalSora2Resolution,
    setFalLtx2Mode: state.setFalLtx2Mode,
    setFalLtx2Resolution: state.setFalLtx2Resolution,
    setFalLtx2Fps: state.setFalLtx2Fps,
    setFalLtx2GenerateAudio: state.setFalLtx2GenerateAudio,
    setFalLtx2FastMode: state.setFalLtx2FastMode,
    setFalLtx2RetakeDuration: state.setFalLtx2RetakeDuration,
    setFalLtx2RetakeStartTime: state.setFalLtx2RetakeStartTime,
    setFalLtx2RetakeMode: state.setFalLtx2RetakeMode,
    setFalViduQ2Mode: state.setFalViduQ2Mode,
    setFalViduQ2AspectRatio: state.setFalViduQ2AspectRatio,
    setFalViduQ2Resolution: state.setFalViduQ2Resolution,
    setFalViduQ2MovementAmplitude: state.setFalViduQ2MovementAmplitude,
    setFalViduQ2Bgm: state.setFalViduQ2Bgm,
    setFalViduQ2FastMode: state.setFalViduQ2FastMode,
    setFalPixverse55AspectRatio: state.setFalPixverse55AspectRatio,
    setFalPixverse55Resolution: state.setFalPixverse55Resolution,
    setFalPixverse55Style: state.setFalPixverse55Style,
    setFalPixverse55ThinkingType: state.setFalPixverse55ThinkingType,
    setFalPixverse55GenerateAudio: state.setFalPixverse55GenerateAudio,
    setFalPixverse55MultiClip: state.setFalPixverse55MultiClip,
    setMinimaxVoiceId: state.setMinimaxVoiceId,
    setMinimaxAudioSpec: state.setMinimaxAudioSpec,
    setMinimaxAudioEmotion: state.setMinimaxAudioEmotion,
    setMinimaxLanguageBoost: state.setMinimaxLanguageBoost,
    setMinimaxAudioVol: state.setMinimaxAudioVol,
    setMinimaxAudioPitch: state.setMinimaxAudioPitch,
    setMinimaxAudioSpeed: state.setMinimaxAudioSpeed,
    setMinimaxAudioSampleRate: state.setMinimaxAudioSampleRate,
    setMinimaxAudioBitrate: state.setMinimaxAudioBitrate,
    setMinimaxAudioFormat: state.setMinimaxAudioFormat,
    setMinimaxAudioChannel: state.setMinimaxAudioChannel,
    setMinimaxLatexRead: state.setMinimaxLatexRead,
    setMinimaxTextNormalization: state.setMinimaxTextNormalization,
    setFalZImageTurboNumInferenceSteps: state.setFalZImageTurboNumInferenceSteps,
    setFalZImageTurboEnablePromptExpansion: state.setFalZImageTurboEnablePromptExpansion,
    setFalZImageTurboAcceleration: state.setFalZImageTurboAcceleration,
    setResolutionBaseSize: state.setResolutionBaseSize,
    // 魔搭模型参数
    setModelscopeSteps: state.setModelscopeSteps,
    setModelscopeGuidance: state.setModelscopeGuidance,
    setModelscopeNegativePrompt: state.setModelscopeNegativePrompt,
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
      modelscopeImageSize: state.modelscopeImageSize,
      baseSize: state.resolutionBaseSize,
      currentWidth: state.customWidth,
      currentHeight: state.customHeight,
      isUpdatingFromCustomSize: isUpdatingFromCustomSizeRef.current
    })

    if (state.selectedModel !== 'fal-ai-z-image-turbo') return
    if (!state.modelscopeImageSize) return

    // 如果是从 customSize 更新触发的，跳过
    if (isUpdatingFromCustomSizeRef.current) {
      console.log('[Z-Image-Turbo] Skipping update (triggered by customSize change)')
      isUpdatingFromCustomSizeRef.current = false
      return
    }

    // 如果是 "自定义"，不做任何处理，保持当前的 customWidth 和 customHeight
    if (state.modelscopeImageSize === '自定义') {
      console.log('[Z-Image-Turbo] imageSize is 自定义, skipping update')
      return
    }

    // 如果是比例格式（如 "4:3"），使用基数动态计算分辨率
    if (state.modelscopeImageSize.includes(':')) {
      const [w, h] = state.modelscopeImageSize.split(':').map(Number)
      if (!isNaN(w) && !isNaN(h)) {
        // 使用基数计算分辨率
        import('@/utils/resolutionCalculator').then(({ calculateResolution }) => {
          const baseSize = state.resolutionBaseSize || 1440 // 默认 1440
          const size = calculateResolution(baseSize, w, h)
          console.log('[Z-Image-Turbo] Calculated size:', { ratio: state.modelscopeImageSize, baseSize, size })

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
  }, [state.modelscopeImageSize, state.resolutionBaseSize, state.selectedModel])

  // 监听 customWidth 和 customHeight 变化，反向匹配比例（Z-Image-Turbo）
  // 只有用户手动修改时才触发
  useEffect(() => {
    console.log('[Z-Image-Turbo] customWidth/Height changed:', {
      selectedModel: state.selectedModel,
      customWidth: state.customWidth,
      customHeight: state.customHeight,
      currentImageSize: state.modelscopeImageSize,
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
      if (matchedRatio && state.modelscopeImageSize !== matchedRatio) {
        console.log('[Z-Image-Turbo] Setting imageSize to matched ratio:', matchedRatio)
        isUpdatingFromCustomSizeRef.current = true
        state.setModelscopeImageSize(matchedRatio)
      }
      // 如果没有匹配的比例，设置为 "自定义"
      else if (!matchedRatio && state.modelscopeImageSize !== '自定义') {
        console.log('[Z-Image-Turbo] Setting imageSize to 自定义')
        isUpdatingFromCustomSizeRef.current = true
        state.setModelscopeImageSize('自定义')
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
    if (!state.modelscopeImageSize) return

    console.log('[ModelScope] imageSize or baseSize changed:', {
      selectedModel: state.selectedModel,
      modelscopeImageSize: state.modelscopeImageSize,
      baseSize: state.resolutionBaseSize,
      currentWidth: state.customWidth,
      currentHeight: state.customHeight
    })

    // 如果是 "自定义"，不做任何处理
    if (state.modelscopeImageSize === '自定义') {
      console.log('[ModelScope] imageSize is 自定义, skipping update')
      return
    }

    // 如果是比例格式（如 "4:3"），使用基数动态计算分辨率
    if (state.modelscopeImageSize.includes(':')) {
      const [w, h] = state.modelscopeImageSize.split(':').map(Number)
      if (!isNaN(w) && !isNaN(h)) {
        // 使用基数计算分辨率
        import('@/utils/resolutionCalculator').then(({ calculateResolution }) => {
          const baseSize = state.resolutionBaseSize || 1024 // 默认 1024
          const size = calculateResolution(baseSize, w, h)
          console.log('[ModelScope] Calculated size:', { ratio: state.modelscopeImageSize, baseSize, size })

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
  }, [state.modelscopeImageSize, state.resolutionBaseSize, state.selectedModel])

  // 监听重新编辑事件
  const isRestoringRef = useRef(false)
  useEffect(() => {
    const handleReedit = async (event: CustomEvent) => {
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

      // 恢复参数 - 同时处理 UI 参数和 API 参数
      if (options) {
        console.log('[MediaGenerator] Restore - Model:', model)
        console.log('[MediaGenerator] Restore - Options keys:', Object.keys(options))
        console.log('[MediaGenerator] Restore - Options:', options)

        const paramsToRestore: Record<string, any> = {}

        // 1. 首先直接恢复已存在的 UI 参数（新的历史记录）
        for (const [key, value] of Object.entries(options)) {
          if (key in setterMap) {
            paramsToRestore[key] = value
            console.log(`[MediaGenerator] Restore - Direct UI param: ${key} = ${JSON.stringify(value)}`)
          }
        }

        console.log('[MediaGenerator] Restore - Direct UI params count:', Object.keys(paramsToRestore).length)

        // 2. 对于没有 UI 参数的情况，尝试反向映射 API 参数（旧的历史记录）
        const { reverseMapOptions } = await import('./builders/optionsBuilder')
        const reverseMappedParams = reverseMapOptions(model, options)

        console.log('[MediaGenerator] Restore - Reverse mapped params:', reverseMappedParams)

        // 合并反向映射的参数（UI 参数优先）
        for (const [key, value] of Object.entries(reverseMappedParams)) {
          if (!(key in paramsToRestore)) {
            paramsToRestore[key] = value
            console.log(`[MediaGenerator] Restore - Reverse mapped: ${key} = ${JSON.stringify(value)}`)
          } else {
            console.log(`[MediaGenerator] Restore - Skipped (already exists): ${key}`)
          }
        }

        console.log('[MediaGenerator] Restore - Final params to restore:', paramsToRestore)

        // 使用 setterMap 恢复所有参数
        let restoredCount = 0
        for (const [key, value] of Object.entries(paramsToRestore)) {
          const setter = setterMap[key]
          if (setter && value !== undefined && value !== null) {
            setter(value)
            restoredCount++
            console.log(`[MediaGenerator] Restore - Applied: ${key} = ${JSON.stringify(value)}`)
          } else if (!setter) {
            console.log(`[MediaGenerator] Restore - No setter for: ${key}`)
          }
        }

        console.log(`[MediaGenerator] Restore - Successfully restored ${restoredCount} parameters`)
      }

      // 恢复完成后重置标记
      setTimeout(() => {
        isRestoringRef.current = false
      }, 100)
    }

    window.addEventListener('reedit-content', handleReedit as unknown as EventListener)
    return () => {
      window.removeEventListener('reedit-content', handleReedit as unknown as EventListener)
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

  // 使用 ref 追踪上一次的关键状态，避免无限循环
  const prevAutoSwitchStateRef = useRef({
    selectedModel: state.selectedModel,
    uploadedImagesLength: state.uploadedImages.length,
    uploadedVideosLength: state.uploadedVideos.length,
    modelscopeCustomModel: state.modelscopeCustomModel,
    falSeedanceV1Mode: state.falSeedanceV1Mode
  })

  // 自动应用模型 Schema 中定义的自动切换规则
  useEffect(() => {
    if (isRestoringRef.current) return // 重新编辑时不切换

    const prev = prevAutoSwitchStateRef.current
    const hasChanged =
      prev.selectedModel !== state.selectedModel ||
      prev.uploadedImagesLength !== state.uploadedImages.length ||
      prev.uploadedVideosLength !== state.uploadedVideos.length ||
      prev.modelscopeCustomModel !== state.modelscopeCustomModel ||
      prev.falSeedanceV1Mode !== state.falSeedanceV1Mode

    // 只有当关键状态真正改变时才执行自动切换
    if (!hasChanged) return

    // 更新 ref
    prevAutoSwitchStateRef.current = {
      selectedModel: state.selectedModel,
      uploadedImagesLength: state.uploadedImages.length,
      uploadedVideosLength: state.uploadedVideos.length,
      modelscopeCustomModel: state.modelscopeCustomModel,
      falSeedanceV1Mode: state.falSeedanceV1Mode
    }

    const switches = getAutoSwitchValues(state.selectedModel, state)

    // 应用所有自动切换
    for (const [key, value] of Object.entries(switches)) {
      const setter = setterMap[key]
      if (setter) {
        setter(value)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedModel, state.uploadedImages.length, state.uploadedVideos.length, state.modelscopeCustomModel, state.falSeedanceV1Mode])

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
      modelId === 'vidu-q1' ? state.ppioViduQ1Mode :
      (modelId === 'veo3.1' || modelId === 'fal-ai-veo-3.1') ? state.falVeo31Mode :
      (modelId === 'fal-ai-bytedance-seedance-v1' || modelId === 'bytedance-seedance-v1') ? state.falSeedanceV1Mode :
      (modelId === 'fal-ai-vidu-q2' || modelId === 'vidu-q2') ? state.falViduQ2Mode :
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
      // 通用视频参数（向后兼容）
      videoDuration: state.setVideoDuration,
      videoAspectRatio: state.setVideoAspectRatio,
      videoResolution: state.setVideoResolution,
      videoNegativePrompt: state.setVideoNegativePrompt,
      videoSeed: state.setVideoSeed,
      // 模型特定参数 - 派欧云
      ppioKling25VideoDuration: state.setPpioKling25VideoDuration,
      ppioKling25VideoAspectRatio: state.setPpioKling25VideoAspectRatio,
      ppioHailuo23VideoDuration: state.setPpioHailuo23VideoDuration,
      ppioHailuo23VideoResolution: state.setPpioHailuo23VideoResolution,
      ppioPixverse45VideoAspectRatio: state.setPpioPixverse45VideoAspectRatio,
      ppioPixverse45VideoResolution: state.setPpioPixverse45VideoResolution,
      ppioWan25VideoDuration: state.setPpioWan25VideoDuration,
      ppioSeedanceV1VideoDuration: state.setPpioSeedanceV1VideoDuration,
      // 模型特定参数 - Fal
      falNanoBananaAspectRatio: state.setFalNanoBananaAspectRatio,
      falNanoBananaNumImages: state.setFalNanoBananaNumImages,
      falNanoBananaProAspectRatio: state.setFalNanoBananaProAspectRatio,
      falNanoBananaProNumImages: state.setFalNanoBananaProNumImages,
      falNanoBananaProResolution: state.setFalNanoBananaProResolution,
      falKlingImageO1AspectRatio: state.setFalKlingImageO1AspectRatio,
      falKlingImageO1NumImages: state.setFalKlingImageO1NumImages,
      falKlingImageO1Resolution: state.setFalKlingImageO1Resolution,
      falZImageTurboImageSize: state.setFalZImageTurboImageSize,
      falZImageTurboNumImages: state.setFalZImageTurboNumImages,
      falSeedream40NumImages: state.setFalSeedream40NumImages,
      falWan25VideoDuration: state.setFalWan25VideoDuration,
      falSeedanceV1VideoDuration: state.setFalSeedanceV1VideoDuration,
      falVeo31VideoDuration: state.setFalVeo31VideoDuration,
      falSora2VideoDuration: state.setFalSora2VideoDuration,
      falLtx2VideoDuration: state.setFalLtx2VideoDuration,
      falViduQ2VideoDuration: state.setFalViduQ2VideoDuration,
      falPixverse55VideoDuration: state.setFalPixverse55VideoDuration,
      falKlingV26ProVideoDuration: state.setFalKlingV26ProVideoDuration,
      falKlingVideoO1VideoDuration: state.setFalKlingVideoO1VideoDuration,
      // Vidu
      ppioViduQ1VideoDuration: state.setPpioViduQ1VideoDuration,
      ppioViduQ1Mode: state.setPpioViduQ1Mode,
      ppioViduQ1AspectRatio: state.setPpioViduQ1AspectRatio,
      ppioViduQ1Style: state.setPpioViduQ1Style,
      ppioViduQ1MovementAmplitude: state.setPpioViduQ1MovementAmplitude,
      ppioViduQ1Bgm: state.setPpioViduQ1Bgm,
      // Kling
      ppioKling25CfgScale: state.setPpioKling25CfgScale,
      // Kling Video O1
      falKlingVideoO1Mode: state.setFalKlingVideoO1Mode,
      falKlingVideoO1AspectRatio: state.setFalKlingVideoO1AspectRatio,
      falKlingVideoO1KeepAudio: state.setFalKlingVideoO1KeepAudio,
      // Kling v2.6 Pro
      falKlingV26ProAspectRatio: state.setFalKlingV26ProAspectRatio,
      falKlingV26ProGenerateAudio: state.setFalKlingV26ProGenerateAudio,
      falKlingV26ProCfgScale: state.setFalKlingV26ProCfgScale,
      // Hailuo
      ppioHailuo23FastMode: state.setPpioHailuo23FastMode,
      ppioHailuo23EnablePromptExpansion: state.setPpioHailuo23EnablePromptExpansion,
      // PixVerse
      ppioPixverse45FastMode: state.setPpioPixverse45FastMode,
      ppioPixverse45Style: state.setPpioPixverse45Style,
      // Wan（派欧云）
      ppioWan25Size: state.setPpioWan25Size,
      ppioWan25PromptExtend: state.setPpioWan25PromptExtend,
      ppioWan25Audio: state.setPpioWan25Audio,
      // Wan（Fal）
      falWan25AspectRatio: state.setFalWan25AspectRatio,
      falWan25Resolution: state.setFalWan25Resolution,
      wanResolution: state.setFalWan25Resolution,  // qualityKey 映射
      falWan25PromptExpansion: state.setFalWan25PromptExpansion,
      // Seedance（派欧云）
      ppioSeedanceV1Variant: state.setPpioSeedanceV1Variant,
      ppioSeedanceV1Resolution: state.setPpioSeedanceV1Resolution,
      ppioSeedanceV1AspectRatio: state.setPpioSeedanceV1AspectRatio,
      ppioSeedanceV1CameraFixed: state.setPpioSeedanceV1CameraFixed,
      // Seedance v1（Fal）
      falSeedanceV1Mode: state.setFalSeedanceV1Mode,
      falSeedanceV1Version: state.setFalSeedanceV1Version,
      falSeedanceV1FastMode: state.setFalSeedanceV1FastMode,
      seedanceResolution: state.setPpioSeedanceV1Resolution,  // qualityKey 映射
      // Veo
      falVeo31Mode: state.setFalVeo31Mode,
      falVeo31AspectRatio: state.setFalVeo31AspectRatio,
      falVeo31Resolution: state.setFalVeo31Resolution,
      veoResolution: state.setFalVeo31Resolution,  // qualityKey 映射
      falVeo31EnhancePrompt: state.setFalVeo31EnhancePrompt,
      falVeo31GenerateAudio: state.setFalVeo31GenerateAudio,
      falVeo31AutoFix: state.setFalVeo31AutoFix,
      falVeo31FastMode: state.setFalVeo31FastMode,
      // MiniMax Hailuo 2.3（Fal）
      falHailuo23Version: state.setFalHailuo23Version,
      falHailuo23Duration: state.setFalHailuo23Duration,
      falHailuo23FastMode: state.setFalHailuo23FastMode,
      falHailuo23PromptOptimizer: state.setFalHailuo23PromptOptimizer,
      // Sora 2
      falSora2Mode: state.setFalSora2Mode,
      falSora2AspectRatio: state.setFalSora2AspectRatio,
      falSora2Resolution: state.setFalSora2Resolution,
      soraResolution: state.setFalSora2Resolution,  // qualityKey 映射
      // LTX-2
      falLtx2Mode: state.setFalLtx2Mode,
      falLtx2Resolution: state.setFalLtx2Resolution,
      falLtx2Fps: state.setFalLtx2Fps,
      falLtx2GenerateAudio: state.setFalLtx2GenerateAudio,
      falLtx2FastMode: state.setFalLtx2FastMode,
      falLtx2RetakeDuration: state.setFalLtx2RetakeDuration,
      falLtx2RetakeStartTime: state.setFalLtx2RetakeStartTime,
      falLtx2RetakeMode: state.setFalLtx2RetakeMode,
      // Vidu Q2
      falViduQ2Mode: state.setFalViduQ2Mode,
      falViduQ2AspectRatio: state.setFalViduQ2AspectRatio,
      falViduQ2Resolution: state.setFalViduQ2Resolution,
      viduQ2Resolution: state.setFalViduQ2Resolution,  // qualityKey 映射
      falViduQ2MovementAmplitude: state.setFalViduQ2MovementAmplitude,
      falViduQ2Bgm: state.setFalViduQ2Bgm,
      falViduQ2FastMode: state.setFalViduQ2FastMode,
      // Pixverse V5.5
      falPixverse55AspectRatio: state.setFalPixverse55AspectRatio,
      falPixverse55Resolution: state.setFalPixverse55Resolution,
      pixverseResolution: state.setFalPixverse55Resolution,  // qualityKey 映射
      falPixverse55Style: state.setFalPixverse55Style,
      falPixverse55ThinkingType: state.setFalPixverse55ThinkingType,
      falPixverse55GenerateAudio: state.setFalPixverse55GenerateAudio,
      falPixverse55MultiClip: state.setFalPixverse55MultiClip,
      // Seedream
      maxImages: state.setMaxImages,
      selectedResolution: state.setSelectedResolution,
      resolutionQuality: state.setResolutionQuality,
      // 通用图片参数（向后兼容）
      numImages: state.setNumImages,
      num_images: state.setNumImages,
      aspectRatio: state.setAspectRatio,
      resolution: state.setResolution,
      // Z-Image-Turbo
      modelscopeImageSize: state.setModelscopeImageSize,
      customWidth: state.setCustomWidth,
      customHeight: state.setCustomHeight,
      resolutionBaseSize: state.setResolutionBaseSize,
      falZImageTurboNumInferenceSteps: state.setFalZImageTurboNumInferenceSteps,
      falZImageTurboEnablePromptExpansion: state.setFalZImageTurboEnablePromptExpansion,
      falZImageTurboAcceleration: state.setFalZImageTurboAcceleration,
      // 魔搭
      modelscopeSteps: state.setModelscopeSteps,
      modelscopeGuidance: state.setModelscopeGuidance,
      modelscopeNegativePrompt: state.setModelscopeNegativePrompt,
      modelscopeCustomModel: state.setModelscopeCustomModel,
      // 音频
      minimaxVoiceId: state.setMinimaxVoiceId,
      minimaxAudioSpec: state.setMinimaxAudioSpec,
      minimaxAudioEmotion: state.setMinimaxAudioEmotion,
      minimaxLanguageBoost: state.setMinimaxLanguageBoost,
      minimaxAudioVol: state.setMinimaxAudioVol,
      minimaxAudioPitch: state.setMinimaxAudioPitch,
      minimaxAudioSpeed: state.setMinimaxAudioSpeed,
      minimaxAudioSampleRate: state.setMinimaxAudioSampleRate,
      minimaxAudioBitrate: state.setMinimaxAudioBitrate,
      minimaxAudioFormat: state.setMinimaxAudioFormat,
      minimaxAudioChannel: state.setMinimaxAudioChannel,
      minimaxLatexRead: state.setMinimaxLatexRead,
      minimaxTextNormalization: state.setMinimaxTextNormalization
    }

    // 直接设置值，保持界面显示为 'smart'
    const setter = setterMap[id]
    if (setter) {
      setter(value)
    }

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

  // 弹窗状态
  const [isWarningDialogOpen, setIsWarningDialogOpen] = React.useState(false)
  const [warningOpacity, setWarningOpacity] = React.useState(0)

  // 生成处理
  const handleGenerate = async () => {
    if ((!state.input.trim() && state.uploadedImages.length === 0) || isLoading) return

    // 检查 Seedance v1 Fast 模式的限制
    if ((state.selectedModel === 'fal-ai-bytedance-seedance-v1' || state.selectedModel === 'bytedance-seedance-v1') &&
        state.falSeedanceV1Version === 'pro' &&
        state.falSeedanceV1FastMode &&
        state.falSeedanceV1Mode === 'image-to-video' &&
        state.uploadedImages.length >= 2) {
      // 显示警告弹窗
      setIsWarningDialogOpen(true)
      setTimeout(() => setWarningOpacity(1), 10)
      return
    }

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
        // 模型特定参数 - 派欧云
        ppioKling25VideoDuration: state.ppioKling25VideoDuration,
        ppioKling25VideoAspectRatio: state.ppioKling25VideoAspectRatio,
        ppioHailuo23VideoDuration: state.ppioHailuo23VideoDuration,
        ppioHailuo23VideoResolution: state.ppioHailuo23VideoResolution,
        ppioPixverse45VideoAspectRatio: state.ppioPixverse45VideoAspectRatio,
        ppioPixverse45VideoResolution: state.ppioPixverse45VideoResolution,
        ppioWan25VideoDuration: state.ppioWan25VideoDuration,
        ppioSeedanceV1VideoDuration: state.ppioSeedanceV1VideoDuration,
        // 模型特定参数 - Fal
        falNanoBananaAspectRatio: state.falNanoBananaAspectRatio,
        falNanoBananaNumImages: state.falNanoBananaNumImages,
        falNanoBananaProAspectRatio: state.falNanoBananaProAspectRatio,
        falNanoBananaProNumImages: state.falNanoBananaProNumImages,
        falKlingImageO1AspectRatio: state.falKlingImageO1AspectRatio,
        falKlingImageO1NumImages: state.falKlingImageO1NumImages,
        falZImageTurboImageSize: state.falZImageTurboImageSize,
        falZImageTurboNumImages: state.falZImageTurboNumImages,
        falSeedream40NumImages: state.falSeedream40NumImages,
        falWan25VideoDuration: state.falWan25VideoDuration,
        falSeedanceV1VideoDuration: state.falSeedanceV1VideoDuration,
        falVeo31VideoDuration: state.falVeo31VideoDuration,
        falSora2VideoDuration: state.falSora2VideoDuration,
        falLtx2VideoDuration: state.falLtx2VideoDuration,
        falViduQ2VideoDuration: state.falViduQ2VideoDuration,
        falPixverse55VideoDuration: state.falPixverse55VideoDuration,
        falKlingV26ProVideoDuration: state.falKlingV26ProVideoDuration,
        falKlingVideoO1VideoDuration: state.falKlingVideoO1VideoDuration,
        ppioViduQ1Mode: state.ppioViduQ1Mode,
        ppioViduQ1Style: state.ppioViduQ1Style,
        ppioViduQ1MovementAmplitude: state.ppioViduQ1MovementAmplitude,
        ppioViduQ1Bgm: state.ppioViduQ1Bgm,
        ppioViduQ1AspectRatio: state.ppioViduQ1AspectRatio,
        ppioKling25CfgScale: state.ppioKling25CfgScale,
        ppioHailuo23FastMode: state.ppioHailuo23FastMode,
        ppioHailuo23EnablePromptExpansion: state.ppioHailuo23EnablePromptExpansion,
        ppioPixverse45FastMode: state.ppioPixverse45FastMode,
        ppioPixverse45Style: state.ppioPixverse45Style,
        // Wan（派欧云）
        ppioWan25Size: state.ppioWan25Size,
        ppioWan25PromptExtend: state.ppioWan25PromptExtend,
        ppioWan25Audio: state.ppioWan25Audio,
        // Wan（Fal）
        falWan25AspectRatio: state.falWan25AspectRatio,
        falWan25Resolution: state.falWan25Resolution,
        falWan25PromptExpansion: state.falWan25PromptExpansion,
        ppioSeedanceV1Variant: state.ppioSeedanceV1Variant,
        ppioSeedanceV1Resolution: state.ppioSeedanceV1Resolution,
        ppioSeedanceV1AspectRatio: state.ppioSeedanceV1AspectRatio,
        ppioSeedanceV1CameraFixed: state.ppioSeedanceV1CameraFixed,
        // Seedance v1（Fal）参数
        falSeedanceV1Mode: state.falSeedanceV1Mode,
        falSeedanceV1Version: state.falSeedanceV1Version,
        falSeedanceV1FastMode: state.falSeedanceV1FastMode,
        falVeo31Mode: state.falVeo31Mode,
        falVeo31AspectRatio: state.falVeo31AspectRatio,
        falVeo31Resolution: state.falVeo31Resolution,
        falVeo31EnhancePrompt: state.falVeo31EnhancePrompt,
        falVeo31GenerateAudio: state.falVeo31GenerateAudio,
        falVeo31AutoFix: state.falVeo31AutoFix,
        falVeo31FastMode: state.falVeo31FastMode,
        // MiniMax Hailuo 2.3（Fal）参数
        falHailuo23Version: state.falHailuo23Version,
        falHailuo23Duration: state.falHailuo23Duration,
        falHailuo23FastMode: state.falHailuo23FastMode,
        falHailuo23PromptOptimizer: state.falHailuo23PromptOptimizer,
        falKlingVideoO1Mode: state.falKlingVideoO1Mode,
        falKlingVideoO1AspectRatio: state.falKlingVideoO1AspectRatio,
        falKlingVideoO1KeepAudio: state.falKlingVideoO1KeepAudio,
        falKlingVideoO1Elements: state.falKlingVideoO1Elements,
        uploadedVideos: state.uploadedVideos,
        uploadedVideoFiles: state.uploadedVideoFiles,
        falKlingV26ProAspectRatio: state.falKlingV26ProAspectRatio,
        falKlingV26ProGenerateAudio: state.falKlingV26ProGenerateAudio,
        falKlingV26ProCfgScale: state.falKlingV26ProCfgScale,
        falSora2Mode: state.falSora2Mode,
        falSora2AspectRatio: state.falSora2AspectRatio,
        falSora2Resolution: state.falSora2Resolution,
        // LTX-2 参数
        falLtx2Mode: state.falLtx2Mode,
        falLtx2Resolution: state.falLtx2Resolution,
        falLtx2Fps: state.falLtx2Fps,
        falLtx2GenerateAudio: state.falLtx2GenerateAudio,
        falLtx2FastMode: state.falLtx2FastMode,
        falLtx2RetakeDuration: state.falLtx2RetakeDuration,
        falLtx2RetakeStartTime: state.falLtx2RetakeStartTime,
        falLtx2RetakeMode: state.falLtx2RetakeMode,
        // Vidu Q2 参数
        falViduQ2Mode: state.falViduQ2Mode,
        falViduQ2AspectRatio: state.falViduQ2AspectRatio,
        falViduQ2Resolution: state.falViduQ2Resolution,
        falViduQ2MovementAmplitude: state.falViduQ2MovementAmplitude,
        falViduQ2Bgm: state.falViduQ2Bgm,
        falViduQ2FastMode: state.falViduQ2FastMode,
        // Pixverse V5.5 参数
        falPixverse55AspectRatio: state.falPixverse55AspectRatio,
        falPixverse55Resolution: state.falPixverse55Resolution,
        falPixverse55Style: state.falPixverse55Style,
        falPixverse55ThinkingType: state.falPixverse55ThinkingType,
        falPixverse55GenerateAudio: state.falPixverse55GenerateAudio,
        falPixverse55MultiClip: state.falPixverse55MultiClip,
        minimaxAudioSpeed: state.minimaxAudioSpeed,
        minimaxAudioEmotion: state.minimaxAudioEmotion,
        minimaxVoiceId: state.minimaxVoiceId,
        minimaxAudioSpec: state.minimaxAudioSpec,
        minimaxAudioVol: state.minimaxAudioVol,
        minimaxAudioPitch: state.minimaxAudioPitch,
        minimaxAudioSampleRate: state.minimaxAudioSampleRate,
        minimaxAudioBitrate: state.minimaxAudioBitrate,
        minimaxAudioFormat: state.minimaxAudioFormat,
        minimaxAudioChannel: state.minimaxAudioChannel,
        minimaxLatexRead: state.minimaxLatexRead,
        minimaxTextNormalization: state.minimaxTextNormalization,
        minimaxLanguageBoost: state.minimaxLanguageBoost,
        modelscopeImageSize: state.modelscopeImageSize,
        falZImageTurboNumInferenceSteps: state.falZImageTurboNumInferenceSteps,
        falZImageTurboEnablePromptExpansion: state.falZImageTurboEnablePromptExpansion,
        falZImageTurboAcceleration: state.falZImageTurboAcceleration,
        // 魔搭模型参数
        resolutionBaseSize: state.resolutionBaseSize,
        modelscopeSteps: state.modelscopeSteps,
        modelscopeGuidance: state.modelscopeGuidance,
        modelscopeNegativePrompt: state.modelscopeNegativePrompt,
        modelscopeCustomModel: state.modelscopeCustomModel,
        calculateSmartResolution: (img) => calculateSmartResolution(img, state.resolutionQuality),
        calculateSeedreamSmartResolution: (img) => calculateSeedreamSmartResolution(img, state.resolutionQuality),
        calculatePPIOSeedreamSmartResolution: (img) => calculatePPIOSeedreamSmartResolution(img, state.resolutionQuality)
      })

      // 保留原始 UI 参数值（用于重新编辑时恢复）
      // 这些参数可能在 buildGenerateOptions 中被智能匹配转换，但我们需要保留原始值
      const originalUIParams: Record<string, any> = {}

      // 自动提取模型特定的 UI 参数（基于配置驱动架构）
      const { optionsBuilder } = await import('./builders/configs')
      const config = optionsBuilder.getConfig(state.selectedModel)

      console.log('[MediaGenerator] Save - Model:', state.selectedModel)
      console.log('[MediaGenerator] Save - Config found:', !!config)
      console.log('[MediaGenerator] Save - API options keys:', Object.keys(options))

      if (config && config.paramMapping) {
        console.log('[MediaGenerator] Save - ParamMapping keys:', Object.keys(config.paramMapping))

        // 遍历参数映射，提取所有 UI 参数
        for (const [apiKey, mapping] of Object.entries(config.paramMapping)) {
          let uiKey: string | undefined

          if (typeof mapping === 'string') {
            uiKey = mapping
          } else if (typeof mapping === 'object' && mapping !== null && 'source' in mapping) {
            const source = mapping.source
            if (typeof source === 'string') {
              uiKey = source
            } else if (Array.isArray(source) && source.length > 0) {
              // 改进：尝试每个 key，使用第一个存在的值
              for (const key of source) {
                if (key in state && (state as any)[key] !== undefined) {
                  uiKey = key
                  break
                }
              }
              // 如果都不存在，使用第一个作为默认值（向后兼容）
              if (!uiKey) {
                uiKey = source[0]
              }
            }
          }

          // 如果找到了 UI 参数名，从 state 中读取值并保存
          if (uiKey && uiKey in state) {
            const value = (state as any)[uiKey]
            originalUIParams[uiKey] = value
            console.log(`[MediaGenerator] Save - Extracted: ${apiKey} -> ${uiKey} = ${JSON.stringify(value)}`)
          } else if (uiKey) {
            console.log(`[MediaGenerator] Save - Skipped (not in state): ${apiKey} -> ${uiKey}`)
          }
        }
      }

      // 兼容旧的手动添加方式（向后兼容）
      // Nano Banana 和 Nano Banana Pro 的 aspectRatio
      if (state.selectedModel === 'nano-banana' || state.selectedModel === 'nano-banana-pro' ||
          state.selectedModel === 'fal-ai-nano-banana' || state.selectedModel === 'fal-ai-nano-banana-pro') {
        if (!('aspectRatio' in originalUIParams)) {
          originalUIParams.aspectRatio = state.aspectRatio
          console.log('[MediaGenerator] Save - Manual add: aspectRatio =', state.aspectRatio)
        }
      }

      // ByteDance Seedream v4 和 Seedream 4.0 的 selectedResolution
      if (state.selectedModel === 'bytedance-seedream-v4' ||
          state.selectedModel === 'fal-ai-bytedance-seedream-v4' ||
          state.selectedModel === 'seedream-4.0') {
        if (!('selectedResolution' in originalUIParams)) {
          originalUIParams.selectedResolution = state.selectedResolution
          console.log('[MediaGenerator] Save - Manual add: selectedResolution =', state.selectedResolution)
        }
      }

      console.log('[MediaGenerator] Save - Final UI params:', originalUIParams)
      console.log('[MediaGenerator] Save - Final options keys:', Object.keys({ ...options, ...originalUIParams }))

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
          panelWidth={960}
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
        viduMode={state.ppioViduQ1Mode}
        veoMode={state.falVeo31Mode}
        klingMode={state.falKlingVideoO1Mode}
        mode={state.falLtx2Mode}
        seedanceMode={state.falSeedanceV1Mode}
        viduQ2Mode={state.falViduQ2Mode}
        modelscopeCustomModel={state.modelscopeCustomModel}
        onImageUpload={(files) => {
          const maxCount = getMaxImageCount(
            state.selectedModel,
            state.selectedModel === 'vidu-q1' ? state.ppioViduQ1Mode :
            (state.selectedModel === 'veo3.1' || state.selectedModel === 'fal-ai-veo-3.1') ? state.falVeo31Mode :
            (state.selectedModel === 'fal-ai-bytedance-seedance-v1' || state.selectedModel === 'bytedance-seedance-v1') ? state.falSeedanceV1Mode :
            (state.selectedModel === 'fal-ai-vidu-q2' || state.selectedModel === 'vidu-q2') ? state.falViduQ2Mode :
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
            state.selectedModel === 'vidu-q1' ? state.ppioViduQ1Mode :
            (state.selectedModel === 'veo3.1' || state.selectedModel === 'fal-ai-veo-3.1') ? state.falVeo31Mode :
            (state.selectedModel === 'fal-ai-bytedance-seedance-v1' || state.selectedModel === 'bytedance-seedance-v1') ? state.falSeedanceV1Mode :
            (state.selectedModel === 'fal-ai-vidu-q2' || state.selectedModel === 'vidu-q2') ? state.falViduQ2Mode :
            undefined
          )
          imageUpload.handlePaste(e, maxCount)
        }}
        onImageDrop={(files) => {
          const maxCount = getMaxImageCount(
            state.selectedModel,
            state.selectedModel === 'vidu-q1' ? state.ppioViduQ1Mode :
            (state.selectedModel === 'veo3.1' || state.selectedModel === 'fal-ai-veo-3.1') ? state.falVeo31Mode :
            (state.selectedModel === 'fal-ai-bytedance-seedance-v1' || state.selectedModel === 'bytedance-seedance-v1') ? state.falSeedanceV1Mode :
            (state.selectedModel === 'fal-ai-vidu-q2' || state.selectedModel === 'vidu-q2') ? state.falViduQ2Mode :
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
          // 打开视频查看器，使用 File 对象创建预览 URL
          const index = state.uploadedVideos.indexOf(videoUrl)
          const videoFile = index >= 0 ? state.uploadedVideoFiles[index] : undefined

          if (videoFile) {
            // 从 File 对象创建临时 Object URL 用于预览
            const videoObjectUrl = URL.createObjectURL(videoFile)
            // 触发自定义事件，让 App.tsx 打开视频查看器
            window.dispatchEvent(new CustomEvent('open-video-viewer', {
              detail: {
                url: videoObjectUrl,
                thumbnail: videoUrl, // 传递缩略图用于显示
                isTemporary: true // 标记这是临时 URL，需要在关闭时清理
              }
            }))
          }
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
              // 通用参数（作为回退值）
              numImages: state.numImages,
              num_images: state.numImages,
              maxImages: state.maxImages,
              uploadedImages: state.uploadedImages,
              resolution: state.resolution,
              videoDuration: state.videoDuration,
              videoResolution: state.videoResolution,
              // 模型特定参数 - 派欧云
              ppioKling25VideoDuration: state.ppioKling25VideoDuration,
              ppioHailuo23VideoDuration: state.ppioHailuo23VideoDuration,
              ppioHailuo23VideoResolution: state.ppioHailuo23VideoResolution,
              ppioPixverse45VideoResolution: state.ppioPixverse45VideoResolution,
              ppioWan25VideoDuration: state.ppioWan25VideoDuration,
              ppioSeedanceV1VideoDuration: state.ppioSeedanceV1VideoDuration,
              // 模型特定参数 - Fal
              falNanoBananaNumImages: state.falNanoBananaNumImages,
              falNanoBananaProNumImages: state.falNanoBananaProNumImages,
              falKlingImageO1NumImages: state.falKlingImageO1NumImages,
              falZImageTurboNumImages: state.falZImageTurboNumImages,
              falSeedream40NumImages: state.falSeedream40NumImages,
              falWan25VideoDuration: state.falWan25VideoDuration,
              falSeedanceV1VideoDuration: state.falSeedanceV1VideoDuration,
              falVeo31VideoDuration: state.falVeo31VideoDuration,
              falSora2VideoDuration: state.falSora2VideoDuration,
              falLtx2VideoDuration: state.falLtx2VideoDuration,
              falViduQ2VideoDuration: state.falViduQ2VideoDuration,
              falPixverse55VideoDuration: state.falPixverse55VideoDuration,
              falKlingV26ProVideoDuration: state.falKlingV26ProVideoDuration,
              falKlingVideoO1VideoDuration: state.falKlingVideoO1VideoDuration,
              ppioViduQ1VideoDuration: state.ppioViduQ1VideoDuration,
              ppioViduQ1Mode: state.ppioViduQ1Mode,
              ppioHailuo23FastMode: state.ppioHailuo23FastMode,
              ppioPixverse45FastMode: state.ppioPixverse45FastMode,
              // Seedance（派欧云）
              ppioSeedanceV1Variant: state.ppioSeedanceV1Variant,
              ppioSeedanceV1Resolution: state.ppioSeedanceV1Resolution,
              ppioSeedanceV1AspectRatio: state.ppioSeedanceV1AspectRatio,
              // Seedance v1（Fal）
              falSeedanceV1Mode: state.falSeedanceV1Mode,
              falSeedanceV1Version: state.falSeedanceV1Version,
              falSeedanceV1FastMode: state.falSeedanceV1FastMode,
              falWan25Resolution: state.falWan25Resolution,
              falVeo31Mode: state.falVeo31Mode,  // Veo 3.1 模式
              falVeo31GenerateAudio: state.falVeo31GenerateAudio,
              falVeo31FastMode: state.falVeo31FastMode,
              falVeo31AspectRatio: state.falVeo31AspectRatio,
              falVeo31Resolution: state.falVeo31Resolution,
              falVeo31EnhancePrompt: state.falVeo31EnhancePrompt,
              falVeo31AutoFix: state.falVeo31AutoFix,
              // MiniMax Hailuo 2.3（Fal）参数
              falHailuo23Version: state.falHailuo23Version,
              falHailuo23Duration: state.falHailuo23Duration,
              falHailuo23FastMode: state.falHailuo23FastMode,
              falHailuo23PromptOptimizer: state.falHailuo23PromptOptimizer,
              hailuoVersion: state.falHailuo23Version,  // 别名映射
              hailuoFastMode: state.falHailuo23FastMode,  // 别名映射
              duration: state.falHailuo23Duration,  // 通用映射
              images: state.uploadedImages,  // 用于判断是否图生视频
              falKlingVideoO1Mode: state.falKlingVideoO1Mode,
              falKlingV26ProGenerateAudio: state.falKlingV26ProGenerateAudio,
              falSora2Mode: state.falSora2Mode,
              falSora2Resolution: state.falSora2Resolution,
              // LTX-2 参数
              ltxMode: state.falLtx2Mode,  // LTX-2 模式（使用 ltxMode 避免冲突）
              falLtx2Resolution: state.falLtx2Resolution,
              falLtx2FastMode: state.falLtx2FastMode,
              falLtx2RetakeDuration: state.falLtx2RetakeDuration,  // 视频编辑模式的时长
              // Vidu Q2 参数
              falViduQ2Mode: state.falViduQ2Mode,
              falViduQ2AspectRatio: state.falViduQ2AspectRatio,
              falViduQ2Resolution: state.falViduQ2Resolution,
              falViduQ2MovementAmplitude: state.falViduQ2MovementAmplitude,
              falViduQ2Bgm: state.falViduQ2Bgm,
              falViduQ2FastMode: state.falViduQ2FastMode,
              // Pixverse V5.5 参数
              falPixverse55AspectRatio: state.falPixverse55AspectRatio,
              falPixverse55Resolution: state.falPixverse55Resolution,
              falPixverse55Style: state.falPixverse55Style,
              falPixverse55ThinkingType: state.falPixverse55ThinkingType,
              falPixverse55GenerateAudio: state.falPixverse55GenerateAudio,
              falPixverse55MultiClip: state.falPixverse55MultiClip,
              input: state.input,
              minimaxAudioSpec: state.minimaxAudioSpec
            }}
          />
        </div>
      </div>

      {/* 警告弹窗 */}
      {isWarningDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            style={{ opacity: warningOpacity, transition: 'opacity 180ms ease' }}
            onClick={() => {
              setWarningOpacity(0)
              setTimeout(() => setIsWarningDialogOpen(false), 180)
            }}
          />
          <div
            className="relative bg-[#131313]/80 border border-zinc-700/50 rounded-xl p-4 w-[400px] shadow-2xl"
            style={{
              opacity: warningOpacity,
              transform: `scale(${0.97 + 0.03 * warningOpacity})`,
              transition: 'opacity 180ms ease, transform 180ms ease'
            }}
          >
            <div className="text-white text-base">不支持的参数组合</div>
            <div className="text-zinc-300 text-sm mt-2">
              Pro模型的快速模式不支持结束帧（首尾帧）
              <br />
              <br />
              请选择以下操作之一：
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => {
                  // 切换到 Lite 版本
                  state.setFalSeedanceV1Version('lite')
                  setWarningOpacity(0)
                  setTimeout(() => setIsWarningDialogOpen(false), 180)
                }}
                className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-blue-600/70 hover:bg-blue-600 text-white text-sm transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                切换到Lite模型
              </button>
              <button
                onClick={() => {
                  // 关闭快速模式
                  state.setFalSeedanceV1FastMode(false)
                  setWarningOpacity(0)
                  setTimeout(() => setIsWarningDialogOpen(false), 180)
                }}
                className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-yellow-600/70 hover:bg-yellow-600 text-white text-sm transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                关闭快速模式
              </button>
              <button
                onClick={() => {
                  setWarningOpacity(0)
                  setTimeout(() => setIsWarningDialogOpen(false), 180)
                }}
                className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-zinc-700/60 hover:bg-zinc-600/60 text-sm transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MediaGenerator
