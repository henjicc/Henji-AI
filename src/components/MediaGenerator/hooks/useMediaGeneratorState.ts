import { useState } from 'react'

/**
 * MediaGenerator 的所有状态管理
 * 将原本分散的 160+ 行 useState 集中管理
 */
export const useMediaGeneratorState = () => {
  // 基础状态
  const [input, setInput] = useState('')
  const [selectedProvider, setSelectedProvider] = useState('piaoyun')
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

  // Vidu Q1 参数
  const [viduMode, setViduMode] = useState<'text-image-to-video' | 'start-end-frame' | 'reference-to-video'>('text-image-to-video')
  const [viduAspectRatio, setViduAspectRatio] = useState('16:9')
  const [viduStyle, setViduStyle] = useState('general')
  const [viduMovementAmplitude, setViduMovementAmplitude] = useState('auto')
  const [viduBgm, setViduBgm] = useState(false)

  // 视频通用参数
  const [videoDuration, setVideoDuration] = useState(5)
  const [videoAspectRatio, setVideoAspectRatio] = useState('16:9')
  const [videoResolution, setVideoResolution] = useState('540p')
  const [videoSeed, setVideoSeed] = useState<number | undefined>(undefined)
  const [videoNegativePrompt, setVideoNegativePrompt] = useState('')

  // Kling 参数
  const [klingCfgScale, setKlingCfgScale] = useState(0.5)

  // PixVerse 参数
  const [pixFastMode, setPixFastMode] = useState(false)
  const [pixStyle, setPixStyle] = useState<string | undefined>(undefined)

  // Hailuo 参数
  const [minimaxEnablePromptExpansion, setMinimaxEnablePromptExpansion] = useState(true)
  const [hailuoFastMode, setHailuoFastMode] = useState(false)

  // Wan 参数
  const [wanSize, setWanSize] = useState('1920*1080')
  const [wanResolution, setWanResolution] = useState('1080P')
  const [wanPromptExtend, setWanPromptExtend] = useState(true)
  const [wanAudio, setWanAudio] = useState(true)

  // Seedance 参数
  const [seedanceResolution, setSeedanceResolution] = useState('720p')
  const [seedanceAspectRatio, setSeedanceAspectRatio] = useState('16:9')
  const [seedanceCameraFixed, setSeedanceCameraFixed] = useState(false)
  const [seedanceVariant, setSeedanceVariant] = useState<'lite' | 'pro'>('lite')

  // Veo 3.1 参数
  const [veoMode, setVeoMode] = useState<'text-image-to-video' | 'start-end-frame' | 'reference-to-video'>('text-image-to-video')
  const [veoAspectRatio, setVeoAspectRatio] = useState('16:9')
  const [veoResolution, setVeoResolution] = useState('1080p')
  const [veoEnhancePrompt, setVeoEnhancePrompt] = useState(true)
  const [veoGenerateAudio, setVeoGenerateAudio] = useState(false)
  const [veoAutoFix, setVeoAutoFix] = useState(true)
  const [veoFastMode, setVeoFastMode] = useState(true)

  // Nano Banana 参数
  const [numImages, setNumImages] = useState(1)
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [resolution, setResolution] = useState('2K')  // Nano Banana Pro 默认 2K
  const [imageSize, setImageSize] = useState('1:1')  // Z-Image-Turbo 默认 1:1

  // Z-Image-Turbo 参数
  const [numInferenceSteps, setNumInferenceSteps] = useState(8)
  const [enablePromptExpansion, setEnablePromptExpansion] = useState(false)
  const [acceleration, setAcceleration] = useState('none')

  // 魔搭参数
  const [steps, setSteps] = useState(30)
  const [guidance, setGuidance] = useState(7.5)
  const [negativePrompt, setNegativePrompt] = useState('')
  const [modelscopeCustomModel, setModelscopeCustomModel] = useState('')

  // 音频参数
  const [audioSpeed, setAudioSpeed] = useState<number>(1.0)
  const [audioEmotion, setAudioEmotion] = useState<string>('neutral')
  const [voiceId, setVoiceId] = useState<string>('male-qn-jingying')
  const [voiceFilterGender, setVoiceFilterGender] = useState<'all' | 'male' | 'female' | 'child' | 'other'>('all')
  const [audioVol, setAudioVol] = useState<number>(1.0)
  const [audioPitch, setAudioPitch] = useState<number>(0)
  const [audioSampleRate, setAudioSampleRate] = useState<number>(32000)
  const [audioBitrate, setAudioBitrate] = useState<number>(128000)
  const [audioFormat, setAudioFormat] = useState<string>('mp3')
  const [audioChannel, setAudioChannel] = useState<number>(1)
  const [latexRead, setLatexRead] = useState<boolean>(false)
  const [textNormalization, setTextNormalization] = useState<boolean>(false)
  const [languageBoost, setLanguageBoost] = useState<string>('auto')
  const [audioSpec, setAudioSpec] = useState<'hd' | 'turbo'>('hd')

  // Kling O1 参数
  const [klingMode, setKlingMode] = useState<'image-to-video' | 'reference-to-video' | 'video-to-video-edit' | 'video-to-video-reference'>('image-to-video')
  const [klingAspectRatio, setKlingAspectRatio] = useState('16:9')
  const [klingKeepAudio, setKlingKeepAudio] = useState(false)
  const [klingElements, setKlingElements] = useState<any[]>([])  // Element[] 类型稍后定义
  const [uploadedVideos, setUploadedVideos] = useState<string[]>([])  // 视频缩略图（用于 UI 预览）
  const [uploadedVideoFiles, setUploadedVideoFiles] = useState<File[]>([])  // 视频 File 对象（延迟读取）

  // Kling v2.6 Pro 参数
  const [klingV26AspectRatio, setKlingV26AspectRatio] = useState('16:9')
  const [klingV26GenerateAudio, setKlingV26GenerateAudio] = useState(true)
  const [klingV26CfgScale, setKlingV26CfgScale] = useState(0.5)

  // Sora 2 参数
  const [soraMode, setSoraMode] = useState<'standard' | 'pro'>('standard')
  const [soraAspectRatio, setSoraAspectRatio] = useState('16:9')
  const [soraResolution, setSoraResolution] = useState('720p')

  // LTX-2 参数
  const [mode, setMode] = useState<'text-to-video' | 'image-to-video' | 'retake-video'>('text-to-video')
  const [ltxResolution, setLtxResolution] = useState('1080p')
  const [ltxFps, setLtxFps] = useState(25)
  const [ltxGenerateAudio, setLtxGenerateAudio] = useState(true)
  const [ltxFastMode, setLtxFastMode] = useState(true)
  const [ltxRetakeDuration, setLtxRetakeDuration] = useState(5)  // 视频编辑模式的时长
  const [ltxRetakeStartTime, setLtxRetakeStartTime] = useState(0)
  const [ltxRetakeMode, setLtxRetakeMode] = useState<'replace_audio' | 'replace_video' | 'replace_audio_and_video'>('replace_audio_and_video')

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

    // Vidu
    viduMode, setViduMode,
    viduAspectRatio, setViduAspectRatio,
    viduStyle, setViduStyle,
    viduMovementAmplitude, setViduMovementAmplitude,
    viduBgm, setViduBgm,

    // 视频通用
    videoDuration, setVideoDuration,
    videoAspectRatio, setVideoAspectRatio,
    videoResolution, setVideoResolution,
    videoSeed, setVideoSeed,
    videoNegativePrompt, setVideoNegativePrompt,

    // Kling
    klingCfgScale, setKlingCfgScale,

    // PixVerse
    pixFastMode, setPixFastMode,
    pixStyle, setPixStyle,

    // Hailuo
    minimaxEnablePromptExpansion, setMinimaxEnablePromptExpansion,
    hailuoFastMode, setHailuoFastMode,

    // Wan
    wanSize, setWanSize,
    wanResolution, setWanResolution,
    wanPromptExtend, setWanPromptExtend,
    wanAudio, setWanAudio,

    // Seedance
    seedanceResolution, setSeedanceResolution,
    seedanceAspectRatio, setSeedanceAspectRatio,
    seedanceCameraFixed, setSeedanceCameraFixed,
    seedanceVariant, setSeedanceVariant,

    // Veo 3.1
    veoMode, setVeoMode,
    veoAspectRatio, setVeoAspectRatio,
    veoResolution, setVeoResolution,
    veoEnhancePrompt, setVeoEnhancePrompt,
    veoGenerateAudio, setVeoGenerateAudio,
    veoAutoFix, setVeoAutoFix,
    veoFastMode, setVeoFastMode,

    // Nano Banana
    numImages, setNumImages,
    aspectRatio, setAspectRatio,
    resolution, setResolution,
    imageSize, setImageSize,

    // Z-Image-Turbo
    numInferenceSteps, setNumInferenceSteps,
    enablePromptExpansion, setEnablePromptExpansion,
    acceleration, setAcceleration,

    // 魔搭
    steps, setSteps,
    guidance, setGuidance,
    negativePrompt, setNegativePrompt,
    modelscopeCustomModel, setModelscopeCustomModel,

    // 音频
    audioSpeed, setAudioSpeed,
    audioEmotion, setAudioEmotion,
    voiceId, setVoiceId,
    voiceFilterGender, setVoiceFilterGender,
    audioVol, setAudioVol,
    audioPitch, setAudioPitch,
    audioSampleRate, setAudioSampleRate,
    audioBitrate, setAudioBitrate,
    audioFormat, setAudioFormat,
    audioChannel, setAudioChannel,
    latexRead, setLatexRead,
    textNormalization, setTextNormalization,
    languageBoost, setLanguageBoost,
    audioSpec, setAudioSpec,

    // Kling O1
    klingMode, setKlingMode,
    klingAspectRatio, setKlingAspectRatio,
    klingKeepAudio, setKlingKeepAudio,
    klingElements, setKlingElements,
    uploadedVideos, setUploadedVideos,
    uploadedVideoFiles, setUploadedVideoFiles,

    // Kling v2.6 Pro
    klingV26AspectRatio, setKlingV26AspectRatio,
    klingV26GenerateAudio, setKlingV26GenerateAudio,
    klingV26CfgScale, setKlingV26CfgScale,

    // Sora 2
    soraMode, setSoraMode,
    soraAspectRatio, setSoraAspectRatio,
    soraResolution, setSoraResolution,

    // LTX-2
    mode, setMode,
    ltxResolution, setLtxResolution,
    ltxFps, setLtxFps,
    ltxGenerateAudio, setLtxGenerateAudio,
    ltxFastMode, setLtxFastMode,
    ltxRetakeDuration, setLtxRetakeDuration,
    ltxRetakeStartTime, setLtxRetakeStartTime,
    ltxRetakeMode, setLtxRetakeMode,

    // UI
    isDraggingImage, setIsDraggingImage
  }
}
