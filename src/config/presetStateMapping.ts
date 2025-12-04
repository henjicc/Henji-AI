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
    setImageSize: (v: string) => void

    // Z-Image-Turbo
    setNumInferenceSteps: (v: number) => void
    setEnablePromptExpansion: (v: boolean) => void
    setAcceleration: (v: string) => void

    // 魔搭
    setSteps: (v: number) => void
    setGuidance: (v: number) => void
    setNegativePrompt: (v: string) => void
    setModelscopeCustomModel: (v: string) => void
    setResolutionBaseSize: (v: number) => void

    // 视频参数
    setVideoDuration: (v: number) => void
    setVideoResolution: (v: string) => void
    setVideoAspectRatio: (v: string) => void
    setVideoNegativePrompt: (v: string) => void
    setVideoSeed: (v: number | undefined) => void

    // Vidu
    setViduMode: (v: any) => void
    setViduAspectRatio: (v: string) => void
    setViduStyle: (v: string) => void
    setViduMovementAmplitude: (v: any) => void
    setViduBgm: (v: boolean) => void

    // Kling
    setKlingCfgScale: (v: number) => void

    // Hailuo
    setHailuoFastMode: (v: boolean) => void
    setMinimaxEnablePromptExpansion: (v: boolean) => void

    // Pixverse
    setPixFastMode: (v: boolean) => void
    setPixStyle: (v: string | undefined) => void

    // Seedance
    setSeedanceVariant: (v: 'lite' | 'pro') => void
    setSeedanceResolution: (v: string) => void
    setSeedanceAspectRatio: (v: string) => void
    setSeedanceCameraFixed: (v: boolean) => void

    // Veo 3.1
    setVeoMode: (v: 'text-image-to-video' | 'start-end-frame' | 'reference-to-video') => void
    setVeoAspectRatio: (v: string) => void
    setVeoResolution: (v: string) => void
    setVeoEnhancePrompt: (v: boolean) => void
    setVeoGenerateAudio: (v: boolean) => void
    setVeoAutoFix: (v: boolean) => void
    setVeoFastMode: (v: boolean) => void

    // Wan25
    setWanSize: (v: string) => void
    setWanResolution: (v: string) => void
    setWanPromptExtend: (v: boolean) => void
    setWanAudio: (v: boolean) => void

    // Kling Video O1
    setKlingMode: (v: 'image-to-video' | 'reference-to-video' | 'video-to-video-edit' | 'video-to-video-reference') => void
    setKlingAspectRatio: (v: string) => void
    setKlingKeepAudio: (v: boolean) => void
    setKlingElements: (v: any[]) => void
    setUploadedVideos: (v: string[]) => void
    // 注意：setUploadedVideoFiles 不在这里定义，因为 File 对象无法序列化

    // 音频参数
    setVoiceId: (v: string) => void
    setAudioSpec: (v: 'hd' | 'turbo') => void
    setAudioEmotion: (v: string) => void
    setLanguageBoost: (v: string) => void
    setAudioVol: (v: number) => void
    setAudioPitch: (v: number) => void
    setAudioSpeed: (v: number) => void
    setAudioSampleRate: (v: number) => void
    setAudioBitrate: (v: number) => void
    setAudioFormat: (v: string) => void
    setAudioChannel: (v: number) => void
    setLatexRead: (v: boolean) => void
    setTextNormalization: (v: boolean) => void
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
        imageSize: setters.setImageSize,

        // Z-Image-Turbo
        numInferenceSteps: setters.setNumInferenceSteps,
        enablePromptExpansion: setters.setEnablePromptExpansion,
        acceleration: setters.setAcceleration,

        // 魔搭
        steps: setters.setSteps,
        guidance: setters.setGuidance,
        negativePrompt: setters.setNegativePrompt,
        modelscopeCustomModel: setters.setModelscopeCustomModel,
        resolutionBaseSize: setters.setResolutionBaseSize,

        // 视频参数
        videoDuration: setters.setVideoDuration,
        videoResolution: setters.setVideoResolution,
        videoAspectRatio: setters.setVideoAspectRatio,
        videoNegativePrompt: setters.setVideoNegativePrompt,
        videoSeed: setters.setVideoSeed,

        // Vidu
        viduMode: setters.setViduMode,
        viduAspectRatio: setters.setViduAspectRatio,
        viduStyle: setters.setViduStyle,
        viduMovementAmplitude: setters.setViduMovementAmplitude,
        viduBgm: setters.setViduBgm,

        // Kling
        klingCfgScale: setters.setKlingCfgScale,

        // Hailuo
        hailuoFastMode: setters.setHailuoFastMode,
        minimaxEnablePromptExpansion: setters.setMinimaxEnablePromptExpansion,

        // Pixverse
        pixFastMode: setters.setPixFastMode,
        pixStyle: setters.setPixStyle,

        // Seedance
        seedanceVariant: setters.setSeedanceVariant,
        seedanceResolution: setters.setSeedanceResolution,
        seedanceAspectRatio: setters.setSeedanceAspectRatio,
        seedanceCameraFixed: setters.setSeedanceCameraFixed,

        // Veo 3.1
        veoMode: setters.setVeoMode,
        veoAspectRatio: setters.setVeoAspectRatio,
        veoResolution: setters.setVeoResolution,
        veoEnhancePrompt: setters.setVeoEnhancePrompt,
        veoGenerateAudio: setters.setVeoGenerateAudio,
        veoAutoFix: setters.setVeoAutoFix,
        veoFastMode: setters.setVeoFastMode,

        // Wan25
        wanSize: setters.setWanSize,
        wanResolution: setters.setWanResolution,
        wanPromptExtend: setters.setWanPromptExtend,
        wanAudio: setters.setWanAudio,

        // Kling Video O1
        klingMode: setters.setKlingMode,
        klingAspectRatio: setters.setKlingAspectRatio,
        klingKeepAudio: setters.setKlingKeepAudio,
        klingElements: setters.setKlingElements,
        uploadedVideos: setters.setUploadedVideos,
        // 注意：视频 File 对象无法序列化，不支持保存到预设
        // uploadedVideoFiles 不添加到映射中

        // 音频参数
        voiceId: setters.setVoiceId,
        audioSpec: setters.setAudioSpec,
        audioEmotion: setters.setAudioEmotion,
        languageBoost: setters.setLanguageBoost,
        audioVol: setters.setAudioVol,
        audioPitch: setters.setAudioPitch,
        audioSpeed: setters.setAudioSpeed,
        audioSampleRate: setters.setAudioSampleRate,
        audioBitrate: setters.setAudioBitrate,
        audioFormat: setters.setAudioFormat,
        audioChannel: setters.setAudioChannel,
        latexRead: setters.setLatexRead,
        textNormalization: setters.setTextNormalization
    }
}
