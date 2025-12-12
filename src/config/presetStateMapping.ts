/**
 * 预设状态映射配置
 * 新增模型参数时，只需在此文件添加对应的映射关系
 */

// 定义所有setter函数的类型
export interface PresetSetters {
    // 基础参数
    setInput: (v: string) => void
    setSelectedProvider: (v: string) => void
    setSelectedModel: (v: string) => void
    setUploadedImages: (v: string[]) => void

    // 图片参数
    setSelectedResolution: (v: string) => void
    setResolutionQuality: (v: '2K' | '4K') => void
    setCustomWidth: (v: string) => void
    setCustomHeight: (v: string) => void
    setMaxImages: (v: number) => void
    setNumImages: (v: number) => void
    setAspectRatio: (v: string) => void
    setResolution: (v: string) => void
    setModelscopeImageSize: (v: string) => void

    // Z-Image-Turbo
    setFalZImageTurboNumInferenceSteps: (v: number) => void
    setFalZImageTurboEnablePromptExpansion: (v: boolean) => void
    setFalZImageTurboAcceleration: (v: string) => void

    // 魔搭
    setModelscopeSteps: (v: number) => void
    setModelscopeGuidance: (v: number) => void
    setModelscopeNegativePrompt: (v: string) => void
    setModelscopeCustomModel: (v: string) => void
    setResolutionBaseSize: (v: number) => void

    // 视频参数
    setVideoDuration: (v: number) => void
    setVideoResolution: (v: string) => void
    setVideoAspectRatio: (v: string) => void
    setVideoNegativePrompt: (v: string) => void
    setVideoSeed: (v: number | undefined) => void

    // Vidu
    setPpioViduQ1VideoDuration: (v: number) => void
    setPpioViduQ1Mode: (v: any) => void
    setPpioViduQ1AspectRatio: (v: string) => void
    setPpioViduQ1Style: (v: string) => void
    setPpioViduQ1MovementAmplitude: (v: any) => void
    setPpioViduQ1Bgm: (v: boolean) => void

    // Kling
    setPpioKling25CfgScale: (v: number) => void

    // Hailuo
    setPpioHailuo23FastMode: (v: boolean) => void
    setPpioHailuo23EnablePromptExpansion: (v: boolean) => void

    // Pixverse
    setPpioPixverse45FastMode: (v: boolean) => void
    setPpioPixverse45Style: (v: string | undefined) => void

    // Seedance (派欧云)
    setPpioSeedanceV1Variant: (v: 'lite' | 'pro') => void
    setPpioSeedanceV1Resolution: (v: string) => void
    setPpioSeedanceV1AspectRatio: (v: string) => void
    setPpioSeedanceV1CameraFixed: (v: boolean) => void

    // Seedance v1 (Fal)
    setFalSeedanceV1Mode: (v: 'text-to-video' | 'image-to-video' | 'reference-to-video') => void
    setFalSeedanceV1Version: (v: 'lite' | 'pro') => void
    setFalSeedanceV1FastMode: (v: boolean) => void

    // Veo 3.1
    setFalVeo31Mode: (v: 'text-image-to-video' | 'start-end-frame' | 'reference-to-video') => void
    setFalVeo31AspectRatio: (v: string) => void
    setFalVeo31Resolution: (v: string) => void
    setFalVeo31EnhancePrompt: (v: boolean) => void
    setFalVeo31GenerateAudio: (v: boolean) => void
    setFalVeo31AutoFix: (v: boolean) => void
    setFalVeo31FastMode: (v: boolean) => void

    // MiniMax Hailuo 2.3 (Fal)
    setFalHailuo23Resolution: (v: string) => void
    setFalHailuo23Duration: (v: string) => void
    setFalHailuo23FastMode: (v: boolean) => void
    setFalHailuo23PromptOptimizer: (v: boolean) => void

    // MiniMax Hailuo 02 (Fal)
    setFalHailuo02Resolution: (v: string) => void
    setFalHailuo02Duration: (v: string) => void
    setFalHailuo02FastMode: (v: boolean) => void
    setFalHailuo02PromptOptimizer: (v: boolean) => void

    // Wan25 (派欧云)
    setPpioWan25Size: (v: string) => void
    setPpioWan25PromptExtend: (v: boolean) => void
    setPpioWan25Audio: (v: boolean) => void

    // Wan25 (Fal)
    setFalWan25AspectRatio: (v: string) => void
    setFalWan25Resolution: (v: string) => void
    setFalWan25PromptExpansion: (v: boolean) => void

    // Kling Video O1
    setFalKlingVideoO1Mode: (v: 'image-to-video' | 'reference-to-video' | 'video-to-video-edit' | 'video-to-video-reference') => void
    setFalKlingVideoO1AspectRatio: (v: string) => void
    setFalKlingVideoO1KeepAudio: (v: boolean) => void
    setFalKlingVideoO1Elements: (v: any[]) => void
    setUploadedVideos: (v: string[]) => void
    // 注意：setUploadedVideoFiles 不在这里定义，因为 File 对象无法序列化

    // Kling v2.6 Pro
    setFalKlingV26ProAspectRatio: (v: string) => void
    setFalKlingV26ProGenerateAudio: (v: boolean) => void
    setFalKlingV26ProCfgScale: (v: number) => void

    // Sora 2
    setFalSora2Mode: (v: 'standard' | 'pro') => void
    setFalSora2AspectRatio: (v: string) => void
    setFalSora2Resolution: (v: string) => void

    // LTX-2
    setFalLtx2Mode: (v: 'text-to-video' | 'image-to-video' | 'retake-video') => void
    setFalLtx2Resolution: (v: string) => void
    setFalLtx2Fps: (v: number) => void
    setFalLtx2GenerateAudio: (v: boolean) => void
    setFalLtx2FastMode: (v: boolean) => void
    setFalLtx2RetakeDuration: (v: number) => void
    setFalLtx2RetakeStartTime: (v: number) => void
    setFalLtx2RetakeMode: (v: 'replace_audio' | 'replace_video' | 'replace_audio_and_video') => void
    setUploadedVideoFilePaths: (v: string[]) => void

    // Vidu Q2
    setFalViduQ2Mode: (v: 'text-to-video' | 'image-to-video' | 'reference-to-video' | 'video-extension') => void
    setFalViduQ2AspectRatio: (v: string) => void
    setFalViduQ2Resolution: (v: string) => void
    setFalViduQ2MovementAmplitude: (v: string) => void
    setFalViduQ2Bgm: (v: boolean) => void
    setFalViduQ2FastMode: (v: boolean) => void

    // Pixverse V5.5
    setFalPixverse55AspectRatio: (v: string) => void
    setFalPixverse55Resolution: (v: string) => void
    setFalPixverse55Style: (v: string) => void
    setFalPixverse55ThinkingType: (v: string) => void
    setFalPixverse55GenerateAudio: (v: boolean) => void
    setFalPixverse55MultiClip: (v: boolean) => void

    // 音频参数
    setMinimaxVoiceId: (v: string) => void
    setMinimaxAudioSpec: (v: 'hd' | 'turbo') => void
    setMinimaxAudioEmotion: (v: string) => void
    setMinimaxLanguageBoost: (v: string) => void
    setMinimaxAudioVol: (v: number) => void
    setMinimaxAudioPitch: (v: number) => void
    setMinimaxAudioSpeed: (v: number) => void
    setMinimaxAudioSampleRate: (v: number) => void
    setMinimaxAudioBitrate: (v: number) => void
    setMinimaxAudioFormat: (v: string) => void
    setMinimaxAudioChannel: (v: number) => void
    setMinimaxLatexRead: (v: boolean) => void
    setMinimaxTextNormalization: (v: boolean) => void


    // 重构后的参数 setters
    setFalSeedanceV1VideoDuration: (v: number) => void
    setFalSeedream40NumImages: (v: number) => void
    setFalKlingImageO1AspectRatio: (v: string) => void
    setFalKlingImageO1NumImages: (v: number) => void
    setFalKlingImageO1Resolution: (v: string) => void
    setFalKlingVideoO1VideoDuration: (v: number) => void
    setFalKlingV26ProVideoDuration: (v: number) => void
    setFalLtx2VideoDuration: (v: number) => void
    setFalNanoBananaProAspectRatio: (v: string) => void
    setFalNanoBananaProNumImages: (v: number) => void
    setFalNanoBananaProResolution: (v: string) => void
    setFalNanoBananaAspectRatio: (v: string) => void
    setFalNanoBananaNumImages: (v: number) => void
    setFalPixverse55VideoDuration: (v: number) => void
    setFalSora2VideoDuration: (v: number) => void
    setFalVeo31VideoDuration: (v: number) => void
    setFalViduQ2VideoDuration: (v: number) => void
    setFalWan25VideoDuration: (v: number) => void
    setFalZImageTurboImageSize: (v: string) => void
    setFalZImageTurboNumImages: (v: number) => void
    setPpioKling25VideoDuration: (v: number) => void
    setPpioKling25VideoAspectRatio: (v: string) => void
    setPpioHailuo23VideoDuration: (v: number) => void
    setPpioHailuo23VideoResolution: (v: string) => void
    setPpioPixverse45VideoAspectRatio: (v: string) => void
    setPpioPixverse45VideoResolution: (v: string) => void
    setPpioSeedanceV1VideoDuration: (v: number) => void
    setPpioWan25VideoDuration: (v: number) => void

    // KIE Nano Banana Pro
    setKieNanoBananaAspectRatio: (v: string) => void
    setKieNanoBananaResolution: (v: string) => void
    setKieNanoBananaOutputFormat: (v: string) => void

    // KIE Seedream 4.5
    setKieSeedreamAspectRatio: (v: string) => void
    setKieSeedreamQuality: (v: string) => void

    // KIE Seedream 4.0
    setKieSeedream40AspectRatio: (v: string) => void
    setKieSeedream40Resolution: (v: string) => void
    setKieSeedream40MaxImages: (v: number) => void

    // KIE Grok Imagine
    setKieGrokImagineAspectRatio: (v: string) => void

    // KIE Z-Image
    setKieZImageAspectRatio: (v: string) => void

    // KIE Grok Imagine Video
    setKieGrokImagineVideoAspectRatio: (v: string) => void
    setKieGrokImagineVideoMode: (v: string) => void

    // KIE Kling V2.6
    setKieKlingV26AspectRatio: (v: string) => void
    setKieKlingV26Duration: (v: string) => void
    setKieKlingV26EnableAudio: (v: boolean) => void

    // KIE Hailuo 2.3
    setKieHailuo23Mode: (v: string) => void
    setKieHailuo23Duration: (v: number) => void
    setKieHailuo23Resolution: (v: string) => void

    // KIE Hailuo 02
    setKieHailuo02Duration: (v: number) => void
    setKieHailuo02Resolution: (v: string) => void
    setKieHailuo02PromptOptimizer: (v: boolean) => void

    // KIE Seedance V3
    setKieSeedanceV3Version: (v: string) => void
    setKieSeedanceV3AspectRatio: (v: string) => void
    setKieSeedanceV3Resolution: (v: string) => void
    setKieSeedanceV3Duration: (v: string) => void
    setKieSeedanceV3CameraFixed: (v: boolean) => void
    setKieSeedanceV3FastMode: (v: boolean) => void
}

/**
 * 创建预设状态映射表
 * @param setters 所有setter函数的集合
 * @returns 参数名到setter的映射表
 */
export function createPresetSetterMap(
    setters: PresetSetters
): Record<string, (value: any) => void> {
    return {
        // 基础参数
        input: setters.setInput,
        selectedProvider: setters.setSelectedProvider,
        selectedModel: setters.setSelectedModel,
        uploadedImages: setters.setUploadedImages,

        // 图片参数
        selectedResolution: setters.setSelectedResolution,
        resolutionQuality: setters.setResolutionQuality,
        customWidth: setters.setCustomWidth,
        customHeight: setters.setCustomHeight,
        maxImages: setters.setMaxImages,
        numImages: setters.setNumImages,
        aspectRatio: setters.setAspectRatio,
        aspect_ratio: setters.setAspectRatio,  // Nano Banana 使用下划线命名
        resolution: setters.setResolution,
        modelscopeImageSize: setters.setModelscopeImageSize,

        // Z-Image-Turbo
        falZImageTurboNumInferenceSteps: setters.setFalZImageTurboNumInferenceSteps,
        falZImageTurboEnablePromptExpansion: setters.setFalZImageTurboEnablePromptExpansion,
        falZImageTurboAcceleration: setters.setFalZImageTurboAcceleration,

        // 魔搭
        modelscopeSteps: setters.setModelscopeSteps,
        modelscopeGuidance: setters.setModelscopeGuidance,
        modelscopeNegativePrompt: setters.setModelscopeNegativePrompt,
        modelscopeCustomModel: setters.setModelscopeCustomModel,
        resolutionBaseSize: setters.setResolutionBaseSize,

        // 视频参数
        videoDuration: setters.setVideoDuration,
        videoResolution: setters.setVideoResolution,
        videoAspectRatio: setters.setVideoAspectRatio,
        videoNegativePrompt: setters.setVideoNegativePrompt,
        videoSeed: setters.setVideoSeed,

        // Vidu
        ppioViduQ1VideoDuration: setters.setPpioViduQ1VideoDuration,
        ppioViduQ1Mode: setters.setPpioViduQ1Mode,
        ppioViduQ1AspectRatio: setters.setPpioViduQ1AspectRatio,
        ppioViduQ1Style: setters.setPpioViduQ1Style,
        ppioViduQ1MovementAmplitude: setters.setPpioViduQ1MovementAmplitude,
        ppioViduQ1Bgm: setters.setPpioViduQ1Bgm,

        // Kling
        ppioKling25CfgScale: setters.setPpioKling25CfgScale,

        // Hailuo
        ppioHailuo23FastMode: setters.setPpioHailuo23FastMode,
        ppioHailuo23EnablePromptExpansion: setters.setPpioHailuo23EnablePromptExpansion,

        // Pixverse
        ppioPixverse45FastMode: setters.setPpioPixverse45FastMode,
        ppioPixverse45Style: setters.setPpioPixverse45Style,

        // Seedance (派欧云)
        ppioSeedanceV1Variant: setters.setPpioSeedanceV1Variant,
        ppioSeedanceV1Resolution: setters.setPpioSeedanceV1Resolution,
        ppioSeedanceV1AspectRatio: setters.setPpioSeedanceV1AspectRatio,
        ppioSeedanceV1CameraFixed: setters.setPpioSeedanceV1CameraFixed,

        // Seedance v1 (Fal)
        falSeedanceV1Mode: setters.setFalSeedanceV1Mode,
        falSeedanceV1Version: setters.setFalSeedanceV1Version,
        falSeedanceV1FastMode: setters.setFalSeedanceV1FastMode,

        // Veo 3.1
        falVeo31Mode: setters.setFalVeo31Mode,
        falVeo31AspectRatio: setters.setFalVeo31AspectRatio,
        falVeo31Resolution: setters.setFalVeo31Resolution,
        falVeo31EnhancePrompt: setters.setFalVeo31EnhancePrompt,
        falVeo31GenerateAudio: setters.setFalVeo31GenerateAudio,
        falVeo31AutoFix: setters.setFalVeo31AutoFix,
        falVeo31FastMode: setters.setFalVeo31FastMode,

        // MiniMax Hailuo 2.3 (Fal)
        falHailuo23Resolution: setters.setFalHailuo23Resolution,
        hailuoResolution: setters.setFalHailuo23Resolution,  // 别名映射
        falHailuo23Duration: setters.setFalHailuo23Duration,
        falHailuo23FastMode: setters.setFalHailuo23FastMode,
        falHailuo23PromptOptimizer: setters.setFalHailuo23PromptOptimizer,

        // MiniMax Hailuo 02 (Fal)
        falHailuo02Resolution: setters.setFalHailuo02Resolution,
        hailuo02Resolution: setters.setFalHailuo02Resolution,  // 别名映射
        falHailuo02Duration: setters.setFalHailuo02Duration,
        falHailuo02FastMode: setters.setFalHailuo02FastMode,
        falHailuo02PromptOptimizer: setters.setFalHailuo02PromptOptimizer,

        // Wan25 (派欧云)
        ppioWan25Size: setters.setPpioWan25Size,
        ppioWan25PromptExtend: setters.setPpioWan25PromptExtend,
        ppioWan25Audio: setters.setPpioWan25Audio,

        // Wan25 (Fal)
        falWan25AspectRatio: setters.setFalWan25AspectRatio,
        falWan25Resolution: setters.setFalWan25Resolution,
        falWan25PromptExpansion: setters.setFalWan25PromptExpansion,

        // Kling Video O1
        falKlingVideoO1Mode: setters.setFalKlingVideoO1Mode,
        falKlingVideoO1AspectRatio: setters.setFalKlingVideoO1AspectRatio,
        falKlingVideoO1KeepAudio: setters.setFalKlingVideoO1KeepAudio,
        falKlingVideoO1Elements: setters.setFalKlingVideoO1Elements,
        uploadedVideos: setters.setUploadedVideos,
        // 注意：视频 File 对象无法序列化，不支持保存到预设
        // uploadedVideoFiles 不添加到映射中

        // Kling v2.6 Pro
        falKlingV26ProAspectRatio: setters.setFalKlingV26ProAspectRatio,
        falKlingV26ProGenerateAudio: setters.setFalKlingV26ProGenerateAudio,
        falKlingV26ProCfgScale: setters.setFalKlingV26ProCfgScale,

        // Sora 2
        falSora2Mode: setters.setFalSora2Mode,
        falSora2AspectRatio: setters.setFalSora2AspectRatio,
        falSora2Resolution: setters.setFalSora2Resolution,

        // LTX-2
        falLtx2Mode: setters.setFalLtx2Mode,
        falLtx2Resolution: setters.setFalLtx2Resolution,
        falLtx2Fps: setters.setFalLtx2Fps,
        falLtx2GenerateAudio: setters.setFalLtx2GenerateAudio,
        falLtx2FastMode: setters.setFalLtx2FastMode,
        falLtx2RetakeDuration: setters.setFalLtx2RetakeDuration,
        falLtx2RetakeStartTime: setters.setFalLtx2RetakeStartTime,
        falLtx2RetakeMode: setters.setFalLtx2RetakeMode,
        uploadedVideoFilePaths: setters.setUploadedVideoFilePaths,

        // Vidu Q2
        falViduQ2Mode: setters.setFalViduQ2Mode,
        falViduQ2AspectRatio: setters.setFalViduQ2AspectRatio,
        falViduQ2Resolution: setters.setFalViduQ2Resolution,
        falViduQ2MovementAmplitude: setters.setFalViduQ2MovementAmplitude,
        falViduQ2Bgm: setters.setFalViduQ2Bgm,
        falViduQ2FastMode: setters.setFalViduQ2FastMode,

        // Pixverse V5.5
        falPixverse55AspectRatio: setters.setFalPixverse55AspectRatio,
        falPixverse55Resolution: setters.setFalPixverse55Resolution,
        falPixverse55Style: setters.setFalPixverse55Style,
        falPixverse55ThinkingType: setters.setFalPixverse55ThinkingType,
        falPixverse55GenerateAudio: setters.setFalPixverse55GenerateAudio,
        falPixverse55MultiClip: setters.setFalPixverse55MultiClip,

        // 音频参数
        minimaxVoiceId: setters.setMinimaxVoiceId,
        minimaxAudioSpec: setters.setMinimaxAudioSpec,
        minimaxAudioEmotion: setters.setMinimaxAudioEmotion,
        minimaxLanguageBoost: setters.setMinimaxLanguageBoost,
        minimaxAudioVol: setters.setMinimaxAudioVol,
        minimaxAudioPitch: setters.setMinimaxAudioPitch,
        minimaxAudioSpeed: setters.setMinimaxAudioSpeed,
        minimaxAudioSampleRate: setters.setMinimaxAudioSampleRate,
        minimaxAudioBitrate: setters.setMinimaxAudioBitrate,
        minimaxAudioFormat: setters.setMinimaxAudioFormat,
        minimaxAudioChannel: setters.setMinimaxAudioChannel,
        minimaxLatexRead: setters.setMinimaxLatexRead,
        minimaxTextNormalization: setters.setMinimaxTextNormalization,

        // 重构后的参数映射
        falSeedanceV1VideoDuration: setters.setFalSeedanceV1VideoDuration,
        falSeedream40NumImages: setters.setFalSeedream40NumImages,
        falKlingImageO1NumImages: setters.setFalKlingImageO1NumImages,
        falKlingImageO1AspectRatio: setters.setFalKlingImageO1AspectRatio,
        falKlingImageO1Resolution: setters.setFalKlingImageO1Resolution,
        falKlingVideoO1VideoDuration: setters.setFalKlingVideoO1VideoDuration,
        falKlingV26ProVideoDuration: setters.setFalKlingV26ProVideoDuration,
        falLtx2VideoDuration: setters.setFalLtx2VideoDuration,
        falNanoBananaProNumImages: setters.setFalNanoBananaProNumImages,
        falNanoBananaProAspectRatio: setters.setFalNanoBananaProAspectRatio,
        falNanoBananaProResolution: setters.setFalNanoBananaProResolution,
        falNanoBananaNumImages: setters.setFalNanoBananaNumImages,
        falNanoBananaAspectRatio: setters.setFalNanoBananaAspectRatio,
        falPixverse55VideoDuration: setters.setFalPixverse55VideoDuration,
        falSora2VideoDuration: setters.setFalSora2VideoDuration,
        falVeo31VideoDuration: setters.setFalVeo31VideoDuration,
        falViduQ2VideoDuration: setters.setFalViduQ2VideoDuration,
        falWan25VideoDuration: setters.setFalWan25VideoDuration,
        falZImageTurboImageSize: setters.setFalZImageTurboImageSize,
        falZImageTurboNumImages: setters.setFalZImageTurboNumImages,
        ppioKling25VideoDuration: setters.setPpioKling25VideoDuration,
        ppioKling25VideoAspectRatio: setters.setPpioKling25VideoAspectRatio,
        ppioHailuo23VideoDuration: setters.setPpioHailuo23VideoDuration,
        ppioHailuo23VideoResolution: setters.setPpioHailuo23VideoResolution,
        ppioPixverse45VideoAspectRatio: setters.setPpioPixverse45VideoAspectRatio,
        ppioPixverse45VideoResolution: setters.setPpioPixverse45VideoResolution,
        ppioSeedanceV1VideoDuration: setters.setPpioSeedanceV1VideoDuration,
        ppioWan25VideoDuration: setters.setPpioWan25VideoDuration,

        // KIE Nano Banana Pro
        kieNanoBananaAspectRatio: setters.setKieNanoBananaAspectRatio,
        kieNanoBananaResolution: setters.setKieNanoBananaResolution,

        // KIE Seedream 4.5
        kieSeedreamAspectRatio: setters.setKieSeedreamAspectRatio,
        kieSeedreamQuality: setters.setKieSeedreamQuality,

        // KIE Seedream 4.0
        kieSeedream40AspectRatio: setters.setKieSeedream40AspectRatio,
        kieSeedream40Resolution: setters.setKieSeedream40Resolution,
        kieSeedream40MaxImages: setters.setKieSeedream40MaxImages,

        // KIE Grok Imagine
        kieGrokImagineAspectRatio: setters.setKieGrokImagineAspectRatio,

        // KIE Z-Image
        kieZImageAspectRatio: setters.setKieZImageAspectRatio,

        // KIE Grok Imagine Video
        kieGrokImagineVideoAspectRatio: setters.setKieGrokImagineVideoAspectRatio,
        kieGrokImagineVideoMode: setters.setKieGrokImagineVideoMode,

        // KIE Kling V2.6
        kieKlingV26AspectRatio: setters.setKieKlingV26AspectRatio,
        kieKlingV26Duration: setters.setKieKlingV26Duration,
        kieKlingV26EnableAudio: setters.setKieKlingV26EnableAudio,

        // KIE Hailuo 2.3
        kieHailuo23Mode: setters.setKieHailuo23Mode,
        kieHailuo23Duration: setters.setKieHailuo23Duration,
        kieHailuo23Resolution: setters.setKieHailuo23Resolution,

        // KIE Hailuo 02
        kieHailuo02Duration: setters.setKieHailuo02Duration,
        kieHailuo02Resolution: setters.setKieHailuo02Resolution,
        kieHailuo02PromptOptimizer: setters.setKieHailuo02PromptOptimizer,

        // KIE Seedance V3
        kieSeedanceV3Version: setters.setKieSeedanceV3Version,
        kieSeedanceV3AspectRatio: setters.setKieSeedanceV3AspectRatio,
        kieSeedanceV3Resolution: setters.setKieSeedanceV3Resolution,
        kieSeedanceV3Duration: setters.setKieSeedanceV3Duration,
        kieSeedanceV3CameraFixed: setters.setKieSeedanceV3CameraFixed,
        kieSeedanceV3FastMode: setters.setKieSeedanceV3FastMode,
    }
}
