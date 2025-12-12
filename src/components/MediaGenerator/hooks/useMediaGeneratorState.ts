import { useState } from 'react'

/**
 * MediaGenerator 的所有状态管理
 * 将原本分散的 160+ 行 useState 集中管理
 */
export const useMediaGeneratorState = () => {
  // 基础状态
  const [input, setInput] = useState('')
  const [selectedProvider, setSelectedProvider] = useState('ppio')
  const [selectedModel, setSelectedModel] = useState('seedream-4.0')
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const [uploadedFilePaths, setUploadedFilePaths] = useState<string[]>([])

  // 模型筛选状态
  const [modelFilterProvider, setModelFilterProvider] = useState<string>('all')
  const [modelFilterType, setModelFilterType] = useState<'all' | 'favorite' | 'image' | 'video' | 'audio'>('all')
  const [modelFilterFunction, setModelFilterFunction] = useState<string>('all')
  const [favoriteModels, setFavoriteModels] = useState<Set<string>>(new Set())

  // 图片分辨率状态
  const [selectedResolution, setSelectedResolution] = useState('smart')
  const [resolutionQuality, setResolutionQuality] = useState<'2K' | '4K'>('2K')
  const [customWidth, setCustomWidth] = useState('')
  const [customHeight, setCustomHeight] = useState('')
  const [isManualInput, setIsManualInput] = useState(false)
  const [maxImages, setMaxImages] = useState<number>(1)
  const [resolutionBaseSize, setResolutionBaseSize] = useState<number>(1440)  // 基数，默认 1440

  // Vidu Q1 参数（派欧云）
  const [ppioViduQ1VideoDuration, setPpioViduQ1VideoDuration] = useState(4)
  const [ppioViduQ1Mode, setPpioViduQ1Mode] = useState<'text-image-to-video' | 'start-end-frame' | 'reference-to-video'>('text-image-to-video')
  const [ppioViduQ1AspectRatio, setPpioViduQ1AspectRatio] = useState('16:9')
  const [ppioViduQ1Style, setPpioViduQ1Style] = useState('general')
  const [ppioViduQ1MovementAmplitude, setPpioViduQ1MovementAmplitude] = useState('auto')
  const [ppioViduQ1Bgm, setPpioViduQ1Bgm] = useState(false)

  // 视频通用参数（保留用于向后兼容）
  const [videoDuration, setVideoDuration] = useState(5)
  const [videoAspectRatio, setVideoAspectRatio] = useState('16:9')
  const [videoResolution, setVideoResolution] = useState('540p')
  const [videoSeed, setVideoSeed] = useState<number | undefined>(undefined)
  const [videoNegativePrompt, setVideoNegativePrompt] = useState('')

  // 模型特定参数 - 派欧云 Kling 2.5 Turbo
  const [ppioKling25VideoDuration, setPpioKling25VideoDuration] = useState(5)
  const [ppioKling25VideoAspectRatio, setPpioKling25VideoAspectRatio] = useState('16:9')

  // 模型特定参数 - 派欧云 Hailuo 2.3
  const [ppioHailuo23VideoDuration, setPpioHailuo23VideoDuration] = useState(5)
  const [ppioHailuo23VideoResolution, setPpioHailuo23VideoResolution] = useState('540p')

  // 模型特定参数 - 派欧云 Pixverse 4.5
  const [ppioPixverse45VideoAspectRatio, setPpioPixverse45VideoAspectRatio] = useState('16:9')
  const [ppioPixverse45VideoResolution, setPpioPixverse45VideoResolution] = useState('540p')

  // 模型特定参数 - 派欧云 Wan 2.5
  const [ppioWan25VideoDuration, setPpioWan25VideoDuration] = useState(5)

  // 模型特定参数 - 派欧云 Seedance V1
  const [ppioSeedanceV1VideoDuration, setPpioSeedanceV1VideoDuration] = useState(5)

  // 模型特定参数 - Fal Wan 2.5
  const [falWan25VideoDuration, setFalWan25VideoDuration] = useState(5)

  // 模型特定参数 - Fal Seedance V1
  const [falSeedanceV1VideoDuration, setFalSeedanceV1VideoDuration] = useState(5)

  // 模型特定参数 - Fal Veo 3.1
  const [falVeo31VideoDuration, setFalVeo31VideoDuration] = useState(5)

  // 模型特定参数 - Fal Sora 2
  const [falSora2VideoDuration, setFalSora2VideoDuration] = useState(5)

  // 模型特定参数 - Fal LTX-2
  const [falLtx2VideoDuration, setFalLtx2VideoDuration] = useState(5)

  // 模型特定参数 - Fal Vidu Q2
  const [falViduQ2VideoDuration, setFalViduQ2VideoDuration] = useState(5)

  // 模型特定参数 - Fal Pixverse 5.5
  const [falPixverse55VideoDuration, setFalPixverse55VideoDuration] = useState(5)

  // 模型特定参数 - Fal Kling V2.6 Pro
  const [falKlingV26ProVideoDuration, setFalKlingV26ProVideoDuration] = useState(5)

  // 模型特定参数 - Fal Kling Video O1
  const [falKlingVideoO1VideoDuration, setFalKlingVideoO1VideoDuration] = useState(5)

  // Kling 2.5 Turbo 参数（派欧云）
  const [ppioKling25CfgScale, setPpioKling25CfgScale] = useState(0.5)

  // PixVerse v4.5 参数（派欧云）
  const [ppioPixverse45FastMode, setPpioPixverse45FastMode] = useState(false)
  const [ppioPixverse45Style, setPpioPixverse45Style] = useState<string | undefined>(undefined)

  // Hailuo 2.3 参数（派欧云）
  const [ppioHailuo23EnablePromptExpansion, setPpioHailuo23EnablePromptExpansion] = useState(true)
  const [ppioHailuo23FastMode, setPpioHailuo23FastMode] = useState(false)

  // Wan 2.5 参数（派欧云）
  const [ppioWan25Size, setPpioWan25Size] = useState('1920*1080')
  const [ppioWan25PromptExtend, setPpioWan25PromptExtend] = useState(true)
  const [ppioWan25Audio, setPpioWan25Audio] = useState(true)

  // Wan 2.5 参数（Fal）
  const [falWan25AspectRatio, setFalWan25AspectRatio] = useState('16:9')
  const [falWan25Resolution, setFalWan25Resolution] = useState('1080p')
  const [falWan25PromptExpansion, setFalWan25PromptExpansion] = useState(true)

  // Seedance v1 参数（派欧云）
  const [ppioSeedanceV1Resolution, setPpioSeedanceV1Resolution] = useState('720p')
  const [ppioSeedanceV1AspectRatio, setPpioSeedanceV1AspectRatio] = useState('16:9')
  const [ppioSeedanceV1CameraFixed, setPpioSeedanceV1CameraFixed] = useState(false)
  const [ppioSeedanceV1Variant, setPpioSeedanceV1Variant] = useState<'lite' | 'pro'>('lite')

  // Seedance v1 参数（Fal）
  const [falSeedanceV1Mode, setFalSeedanceV1Mode] = useState<'text-to-video' | 'image-to-video' | 'reference-to-video'>('text-to-video')
  const [falSeedanceV1Version, setFalSeedanceV1Version] = useState<'lite' | 'pro'>('lite')
  const [falSeedanceV1FastMode, setFalSeedanceV1FastMode] = useState(true)

  // Veo 3.1 参数（Fal）
  const [falVeo31Mode, setFalVeo31Mode] = useState<'text-image-to-video' | 'start-end-frame' | 'reference-to-video'>('text-image-to-video')
  const [falVeo31AspectRatio, setFalVeo31AspectRatio] = useState('16:9')
  const [falVeo31Resolution, setFalVeo31Resolution] = useState('1080p')
  const [falVeo31EnhancePrompt, setFalVeo31EnhancePrompt] = useState(true)
  const [falVeo31GenerateAudio, setFalVeo31GenerateAudio] = useState(false)
  const [falVeo31AutoFix, setFalVeo31AutoFix] = useState(true)
  const [falVeo31FastMode, setFalVeo31FastMode] = useState(true)

  // MiniMax Hailuo 2.3 参数（Fal）
  const [falHailuo23Resolution, setFalHailuo23Resolution] = useState('768P')
  const [falHailuo23Duration, setFalHailuo23Duration] = useState('6')
  const [falHailuo23FastMode, setFalHailuo23FastMode] = useState(true)
  const [falHailuo23PromptOptimizer, setFalHailuo23PromptOptimizer] = useState(true)

  // MiniMax Hailuo 02 参数（Fal）
  const [falHailuo02Duration, setFalHailuo02Duration] = useState('6')
  const [falHailuo02Resolution, setFalHailuo02Resolution] = useState('768P')
  const [falHailuo02FastMode, setFalHailuo02FastMode] = useState(false)
  const [falHailuo02PromptOptimizer, setFalHailuo02PromptOptimizer] = useState(true)

  // Nano Banana 参数（保留旧参数用于向后兼容，但新增模型特定参数）
  const [numImages, setNumImages] = useState(1)
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [resolution, setResolution] = useState('2K')  // 保留用于向后兼容
  const [modelscopeImageSize, setModelscopeImageSize] = useState('1:1')  // 魔搭模型默认 1:1

  // 模型特定参数 - Fal Nano Banana
  const [falNanoBananaAspectRatio, setFalNanoBananaAspectRatio] = useState('1:1')
  const [falNanoBananaNumImages, setFalNanoBananaNumImages] = useState(1)

  // 模型特定参数 - Fal Nano Banana Pro
  const [falNanoBananaProResolution, setFalNanoBananaProResolution] = useState('2K')

  // 模型特定参数 - Fal Kling Image O1
  const [falKlingImageO1Resolution, setFalKlingImageO1Resolution] = useState('2K')

  // 模型特定参数 - Fal Nano Banana Pro
  const [falNanoBananaProAspectRatio, setFalNanoBananaProAspectRatio] = useState('1:1')
  const [falNanoBananaProNumImages, setFalNanoBananaProNumImages] = useState(1)

  // 模型特定参数 - Fal Kling Image O1
  const [falKlingImageO1AspectRatio, setFalKlingImageO1AspectRatio] = useState('1:1')
  const [falKlingImageO1NumImages, setFalKlingImageO1NumImages] = useState(1)

  // 模型特定参数 - Fal Z-Image-Turbo
  const [falZImageTurboImageSize, setFalZImageTurboImageSize] = useState('1:1')
  const [falZImageTurboNumImages, setFalZImageTurboNumImages] = useState(1)

  // 模型特定参数 - Fal Seedream 4.0
  const [falSeedream40NumImages, setFalSeedream40NumImages] = useState(1)

  // Z-Image-Turbo 参数
  const [falZImageTurboNumInferenceSteps, setFalZImageTurboNumInferenceSteps] = useState(8)
  const [falZImageTurboEnablePromptExpansion, setFalZImageTurboEnablePromptExpansion] = useState(false)
  const [falZImageTurboAcceleration, setFalZImageTurboAcceleration] = useState('none')

  // 魔搭参数
  const [modelscopeSteps, setModelscopeSteps] = useState(30)
  const [modelscopeGuidance, setModelscopeGuidance] = useState(7.5)
  const [modelscopeNegativePrompt, setModelscopeNegativePrompt] = useState('')
  const [modelscopeCustomModel, setModelscopeCustomModel] = useState('')

  // 模型特定参数 - KIE Nano Banana Pro
  const [kieNanoBananaAspectRatio, setKieNanoBananaAspectRatio] = useState('1:1')
  const [kieNanoBananaResolution, setKieNanoBananaResolution] = useState('2K')
  const [kieNanoBananaOutputFormat, setKieNanoBananaOutputFormat] = useState('png')

  // 模型特定参数 - KIE Seedream 4.5
  const [kieSeedreamAspectRatio, setKieSeedreamAspectRatio] = useState('1:1')
  const [kieSeedreamQuality, setKieSeedreamQuality] = useState('2K')

  // 模型特定参数 - KIE Seedream 4.0
  const [kieSeedream40AspectRatio, setKieSeedream40AspectRatio] = useState('1:1')
  const [kieSeedream40Resolution, setKieSeedream40Resolution] = useState('2K')
  const [kieSeedream40MaxImages, setKieSeedream40MaxImages] = useState(1)

  // 模型特定参数 - KIE Grok Imagine
  const [kieGrokImagineAspectRatio, setKieGrokImagineAspectRatio] = useState('1:1')

  // 模型特定参数 - KIE Z-Image
  const [kieZImageAspectRatio, setKieZImageAspectRatio] = useState('1:1')

  // 模型特定参数 - KIE Grok Imagine Video
  const [kieGrokImagineVideoAspectRatio, setKieGrokImagineVideoAspectRatio] = useState('2:3')
  const [kieGrokImagineVideoMode, setKieGrokImagineVideoMode] = useState('normal')

  // 音频参数
  const [minimaxAudioSpeed, setMinimaxAudioSpeed] = useState<number>(1.0)
  const [minimaxAudioEmotion, setMinimaxAudioEmotion] = useState<string>('neutral')
  const [minimaxVoiceId, setMinimaxVoiceId] = useState<string>('male-qn-jingying')
  const [voiceFilterGender, setVoiceFilterGender] = useState<'all' | 'male' | 'female' | 'child' | 'other'>('all')
  const [minimaxAudioVol, setMinimaxAudioVol] = useState<number>(1.0)
  const [minimaxAudioPitch, setMinimaxAudioPitch] = useState<number>(0)
  const [minimaxAudioSampleRate, setMinimaxAudioSampleRate] = useState<number>(32000)
  const [minimaxAudioBitrate, setMinimaxAudioBitrate] = useState<number>(128000)
  const [minimaxAudioFormat, setMinimaxAudioFormat] = useState<string>('mp3')
  const [minimaxAudioChannel, setMinimaxAudioChannel] = useState<number>(1)
  const [minimaxLatexRead, setMinimaxLatexRead] = useState<boolean>(false)
  const [minimaxTextNormalization, setMinimaxTextNormalization] = useState<boolean>(false)
  const [minimaxLanguageBoost, setMinimaxLanguageBoost] = useState<string>('auto')
  const [minimaxAudioSpec, setMinimaxAudioSpec] = useState<'hd' | 'turbo'>('hd')

  // Kling Video O1 参数（Fal）
  const [falKlingVideoO1Mode, setFalKlingVideoO1Mode] = useState<'image-to-video' | 'reference-to-video' | 'video-to-video-edit' | 'video-to-video-reference'>('image-to-video')
  const [falKlingVideoO1AspectRatio, setFalKlingVideoO1AspectRatio] = useState('16:9')
  const [falKlingVideoO1KeepAudio, setFalKlingVideoO1KeepAudio] = useState(false)
  const [falKlingVideoO1Elements, setFalKlingVideoO1Elements] = useState<any[]>([])  // Element[] 类型稍后定义
  const [uploadedVideos, setUploadedVideos] = useState<string[]>([])  // 视频缩略图（用于 UI 预览）
  const [uploadedVideoFiles, setUploadedVideoFiles] = useState<File[]>([])  // 视频 File 对象（延迟读取）
  const [uploadedVideoFilePaths, setUploadedVideoFilePaths] = useState<string[]>([])  // 视频文件路径（持久化存储）

  // Kling v2.6 Pro 参数（Fal）
  const [falKlingV26ProAspectRatio, setFalKlingV26ProAspectRatio] = useState('16:9')
  const [falKlingV26ProGenerateAudio, setFalKlingV26ProGenerateAudio] = useState(true)
  const [falKlingV26ProCfgScale, setFalKlingV26ProCfgScale] = useState(0.5)

  // Sora 2 参数（Fal）
  const [falSora2Mode, setFalSora2Mode] = useState<'standard' | 'pro'>('standard')
  const [falSora2AspectRatio, setFalSora2AspectRatio] = useState('16:9')
  const [falSora2Resolution, setFalSora2Resolution] = useState('720p')

  // LTX-2 参数（Fal）
  const [falLtx2Mode, setFalLtx2Mode] = useState<'text-to-video' | 'image-to-video' | 'retake-video'>('text-to-video')
  const [falLtx2Resolution, setFalLtx2Resolution] = useState('1080p')
  const [falLtx2Fps, setFalLtx2Fps] = useState(25)
  const [falLtx2GenerateAudio, setFalLtx2GenerateAudio] = useState(true)
  const [falLtx2FastMode, setFalLtx2FastMode] = useState(true)
  const [falLtx2RetakeDuration, setFalLtx2RetakeDuration] = useState(5)  // 视频编辑模式的时长
  const [falLtx2RetakeStartTime, setFalLtx2RetakeStartTime] = useState(0)
  const [falLtx2RetakeMode, setFalLtx2RetakeMode] = useState<'replace_audio' | 'replace_video' | 'replace_audio_and_video'>('replace_audio_and_video')

  // Vidu Q2 参数（Fal）
  const [falViduQ2Mode, setFalViduQ2Mode] = useState<'text-to-video' | 'image-to-video' | 'reference-to-video' | 'video-extension'>('text-to-video')
  const [falViduQ2AspectRatio, setFalViduQ2AspectRatio] = useState('16:9')
  const [falViduQ2Resolution, setFalViduQ2Resolution] = useState('720p')
  const [falViduQ2MovementAmplitude, setFalViduQ2MovementAmplitude] = useState('auto')
  const [falViduQ2Bgm, setFalViduQ2Bgm] = useState(false)
  const [falViduQ2FastMode, setFalViduQ2FastMode] = useState(true)

  // Pixverse V5.5 参数（Fal）
  const [falPixverse55AspectRatio, setFalPixverse55AspectRatio] = useState('16:9')
  const [falPixverse55Resolution, setFalPixverse55Resolution] = useState('720p')
  const [falPixverse55Style, setFalPixverse55Style] = useState('none')
  const [falPixverse55ThinkingType, setFalPixverse55ThinkingType] = useState('auto')
  const [falPixverse55GenerateAudio, setFalPixverse55GenerateAudio] = useState(false)
  const [falPixverse55MultiClip, setFalPixverse55MultiClip] = useState(false)

  // UI 状态
  const [isDraggingImage, setIsDraggingImage] = useState(false)

  return {
    // 基础状态
    input, setInput,
    selectedProvider, setSelectedProvider,
    selectedModel, setSelectedModel,
    uploadedImages, setUploadedImages,
    uploadedFilePaths, setUploadedFilePaths,

    // 模型筛选
    modelFilterProvider, setModelFilterProvider,
    modelFilterType, setModelFilterType,
    modelFilterFunction, setModelFilterFunction,
    favoriteModels, setFavoriteModels,

    // 图片分辨率
    selectedResolution, setSelectedResolution,
    resolutionQuality, setResolutionQuality,
    customWidth, setCustomWidth,
    customHeight, setCustomHeight,
    isManualInput, setIsManualInput,
    maxImages, setMaxImages,
    resolutionBaseSize, setResolutionBaseSize,

    // Vidu Q1（派欧云）
    ppioViduQ1VideoDuration, setPpioViduQ1VideoDuration,
    ppioViduQ1Mode, setPpioViduQ1Mode,
    ppioViduQ1AspectRatio, setPpioViduQ1AspectRatio,
    ppioViduQ1Style, setPpioViduQ1Style,
    ppioViduQ1MovementAmplitude, setPpioViduQ1MovementAmplitude,
    ppioViduQ1Bgm, setPpioViduQ1Bgm,

    // 视频通用
    videoDuration, setVideoDuration,
    videoAspectRatio, setVideoAspectRatio,
    videoResolution, setVideoResolution,
    videoSeed, setVideoSeed,
    videoNegativePrompt, setVideoNegativePrompt,

    // Kling 2.5 Turbo（派欧云）
    ppioKling25CfgScale, setPpioKling25CfgScale,

    // PixVerse v4.5（派欧云）
    ppioPixverse45FastMode, setPpioPixverse45FastMode,
    ppioPixverse45Style, setPpioPixverse45Style,

    // Hailuo 2.3（派欧云）
    ppioHailuo23EnablePromptExpansion, setPpioHailuo23EnablePromptExpansion,
    ppioHailuo23FastMode, setPpioHailuo23FastMode,

    // Wan 2.5（派欧云）
    ppioWan25Size, setPpioWan25Size,
    ppioWan25PromptExtend, setPpioWan25PromptExtend,
    ppioWan25Audio, setPpioWan25Audio,

    // Wan 2.5（Fal）
    falWan25AspectRatio, setFalWan25AspectRatio,
    falWan25Resolution, setFalWan25Resolution,
    falWan25PromptExpansion, setFalWan25PromptExpansion,

    // Seedance v1（派欧云）
    ppioSeedanceV1Resolution, setPpioSeedanceV1Resolution,
    ppioSeedanceV1AspectRatio, setPpioSeedanceV1AspectRatio,
    ppioSeedanceV1CameraFixed, setPpioSeedanceV1CameraFixed,
    ppioSeedanceV1Variant, setPpioSeedanceV1Variant,

    // Seedance v1（Fal）
    falSeedanceV1Mode, setFalSeedanceV1Mode,
    falSeedanceV1Version, setFalSeedanceV1Version,
    falSeedanceV1FastMode, setFalSeedanceV1FastMode,

    // Veo 3.1（Fal）
    falVeo31Mode, setFalVeo31Mode,
    falVeo31AspectRatio, setFalVeo31AspectRatio,
    falVeo31Resolution, setFalVeo31Resolution,
    falVeo31EnhancePrompt, setFalVeo31EnhancePrompt,
    falVeo31GenerateAudio, setFalVeo31GenerateAudio,
    falVeo31AutoFix, setFalVeo31AutoFix,
    falVeo31FastMode, setFalVeo31FastMode,

    // MiniMax Hailuo 2.3（Fal）
    falHailuo23Duration, setFalHailuo23Duration,
    falHailuo23Resolution, setFalHailuo23Resolution,
    falHailuo23FastMode, setFalHailuo23FastMode,
    falHailuo23PromptOptimizer, setFalHailuo23PromptOptimizer,

    // MiniMax Hailuo 02（Fal）
    falHailuo02Duration, setFalHailuo02Duration,
    falHailuo02Resolution, setFalHailuo02Resolution,
    falHailuo02FastMode, setFalHailuo02FastMode,
    falHailuo02PromptOptimizer, setFalHailuo02PromptOptimizer,

    // Nano Banana（旧参数，保留向后兼容）
    numImages, setNumImages,
    aspectRatio, setAspectRatio,
    resolution, setResolution,
    modelscopeImageSize, setModelscopeImageSize,

    // 模型特定参数
    falNanoBananaAspectRatio, setFalNanoBananaAspectRatio,
    falNanoBananaNumImages, setFalNanoBananaNumImages,
    falNanoBananaProAspectRatio, setFalNanoBananaProAspectRatio,
    falNanoBananaProNumImages, setFalNanoBananaProNumImages,
    falNanoBananaProResolution, setFalNanoBananaProResolution,
    falKlingImageO1AspectRatio, setFalKlingImageO1AspectRatio,
    falKlingImageO1NumImages, setFalKlingImageO1NumImages,
    falKlingImageO1Resolution, setFalKlingImageO1Resolution,
    falZImageTurboImageSize, setFalZImageTurboImageSize,
    falZImageTurboNumImages, setFalZImageTurboNumImages,
    falSeedream40NumImages, setFalSeedream40NumImages,
    ppioKling25VideoDuration, setPpioKling25VideoDuration,
    ppioKling25VideoAspectRatio, setPpioKling25VideoAspectRatio,
    ppioHailuo23VideoDuration, setPpioHailuo23VideoDuration,
    ppioHailuo23VideoResolution, setPpioHailuo23VideoResolution,
    ppioPixverse45VideoAspectRatio, setPpioPixverse45VideoAspectRatio,
    ppioPixverse45VideoResolution, setPpioPixverse45VideoResolution,
    ppioWan25VideoDuration, setPpioWan25VideoDuration,
    ppioSeedanceV1VideoDuration, setPpioSeedanceV1VideoDuration,
    falWan25VideoDuration, setFalWan25VideoDuration,
    falSeedanceV1VideoDuration, setFalSeedanceV1VideoDuration,
    falVeo31VideoDuration, setFalVeo31VideoDuration,
    falSora2VideoDuration, setFalSora2VideoDuration,
    falLtx2VideoDuration, setFalLtx2VideoDuration,
    falViduQ2VideoDuration, setFalViduQ2VideoDuration,
    falPixverse55VideoDuration, setFalPixverse55VideoDuration,
    falKlingV26ProVideoDuration, setFalKlingV26ProVideoDuration,
    falKlingVideoO1VideoDuration, setFalKlingVideoO1VideoDuration,

    // Z-Image-Turbo
    falZImageTurboNumInferenceSteps, setFalZImageTurboNumInferenceSteps,
    falZImageTurboEnablePromptExpansion, setFalZImageTurboEnablePromptExpansion,
    falZImageTurboAcceleration, setFalZImageTurboAcceleration,

    // 魔搭
    modelscopeSteps, setModelscopeSteps,
    modelscopeGuidance, setModelscopeGuidance,
    modelscopeNegativePrompt, setModelscopeNegativePrompt,
    modelscopeCustomModel, setModelscopeCustomModel,

    // KIE Nano Banana Pro
    kieNanoBananaAspectRatio, setKieNanoBananaAspectRatio,
    kieNanoBananaResolution, setKieNanoBananaResolution,
    kieNanoBananaOutputFormat, setKieNanoBananaOutputFormat,

    // KIE Seedream 4.5
    kieSeedreamAspectRatio, setKieSeedreamAspectRatio,
    kieSeedreamQuality, setKieSeedreamQuality,

    // KIE Seedream 4.0
    kieSeedream40AspectRatio, setKieSeedream40AspectRatio,
    kieSeedream40Resolution, setKieSeedream40Resolution,
    kieSeedream40MaxImages, setKieSeedream40MaxImages,

    // KIE Grok Imagine
    kieGrokImagineAspectRatio, setKieGrokImagineAspectRatio,

    // KIE Z-Image
    kieZImageAspectRatio, setKieZImageAspectRatio,

    // KIE Grok Imagine Video
    kieGrokImagineVideoAspectRatio, setKieGrokImagineVideoAspectRatio,
    kieGrokImagineVideoMode, setKieGrokImagineVideoMode,

    // 音频
    minimaxAudioSpeed, setMinimaxAudioSpeed,
    minimaxAudioEmotion, setMinimaxAudioEmotion,
    minimaxVoiceId, setMinimaxVoiceId,
    voiceFilterGender, setVoiceFilterGender,
    minimaxAudioVol, setMinimaxAudioVol,
    minimaxAudioPitch, setMinimaxAudioPitch,
    minimaxAudioSampleRate, setMinimaxAudioSampleRate,
    minimaxAudioBitrate, setMinimaxAudioBitrate,
    minimaxAudioFormat, setMinimaxAudioFormat,
    minimaxAudioChannel, setMinimaxAudioChannel,
    minimaxLatexRead, setMinimaxLatexRead,
    minimaxTextNormalization, setMinimaxTextNormalization,
    minimaxLanguageBoost, setMinimaxLanguageBoost,
    minimaxAudioSpec, setMinimaxAudioSpec,

    // Kling Video O1（Fal）
    falKlingVideoO1Mode, setFalKlingVideoO1Mode,
    falKlingVideoO1AspectRatio, setFalKlingVideoO1AspectRatio,
    falKlingVideoO1KeepAudio, setFalKlingVideoO1KeepAudio,
    falKlingVideoO1Elements, setFalKlingVideoO1Elements,
    uploadedVideos, setUploadedVideos,
    uploadedVideoFiles, setUploadedVideoFiles,
    uploadedVideoFilePaths, setUploadedVideoFilePaths,

    // Kling v2.6 Pro（Fal）
    falKlingV26ProAspectRatio, setFalKlingV26ProAspectRatio,
    falKlingV26ProGenerateAudio, setFalKlingV26ProGenerateAudio,
    falKlingV26ProCfgScale, setFalKlingV26ProCfgScale,

    // Sora 2（Fal）
    falSora2Mode, setFalSora2Mode,
    falSora2AspectRatio, setFalSora2AspectRatio,
    falSora2Resolution, setFalSora2Resolution,

    // LTX-2（Fal）
    falLtx2Mode, setFalLtx2Mode,
    falLtx2Resolution, setFalLtx2Resolution,
    falLtx2Fps, setFalLtx2Fps,
    falLtx2GenerateAudio, setFalLtx2GenerateAudio,
    falLtx2FastMode, setFalLtx2FastMode,
    falLtx2RetakeDuration, setFalLtx2RetakeDuration,
    falLtx2RetakeStartTime, setFalLtx2RetakeStartTime,
    falLtx2RetakeMode, setFalLtx2RetakeMode,

    // Vidu Q2（Fal）
    falViduQ2Mode, setFalViduQ2Mode,
    falViduQ2AspectRatio, setFalViduQ2AspectRatio,
    falViduQ2Resolution, setFalViduQ2Resolution,
    falViduQ2MovementAmplitude, setFalViduQ2MovementAmplitude,
    falViduQ2Bgm, setFalViduQ2Bgm,
    falViduQ2FastMode, setFalViduQ2FastMode,

    // Pixverse V5.5（Fal）
    falPixverse55AspectRatio, setFalPixverse55AspectRatio,
    falPixverse55Resolution, setFalPixverse55Resolution,
    falPixverse55Style, setFalPixverse55Style,
    falPixverse55ThinkingType, setFalPixverse55ThinkingType,
    falPixverse55GenerateAudio, setFalPixverse55GenerateAudio,
    falPixverse55MultiClip, setFalPixverse55MultiClip,

    // UI
    isDraggingImage, setIsDraggingImage
  }
}
