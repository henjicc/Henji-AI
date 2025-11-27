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
  const [resolution, setResolution] = useState('1K')

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

    // UI
    isDraggingImage, setIsDraggingImage
  }
}
