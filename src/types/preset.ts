// 预设类型定义

export type PresetSaveMode = 'prompt' | 'prompt-image' | 'full'

export interface Preset {
    id: string                    // UUID
    name: string                  // 预设名称
    createdAt: number            // 创建时间戳
    updatedAt: number            // 更新时间戳

    // === 必需数据 ===
    prompt: string               // 提示词

    // === 可选数据 ===
    saveMode: PresetSaveMode     // 保存模式

    // 图片 (仅 prompt-image 和 full 模式)
    images?: {
        filePaths?: string[]       // 文件路径（新格式，推荐）
        dataUrls?: string[]        // 图片 base64 数据（旧格式，兼容）
    }

    // 模型和参数 (仅 full 模式)
    model?: {
        provider: string           // 'ppio' | 'fal'
        modelId: string           // 'seedream-4.0'
        type: 'image' | 'video' | 'audio'
    }

    // 根据模型类型保存的参数 (仅 full 模式)
    params?: {
        // 图片参数
        image?: {
            resolution?: string
            quality?: '2K' | '4K'
            customWidth?: string
            customHeight?: string
            // seedream
            maxImages?: number
            // nano-banana
            numImages?: number
            aspectRatio?: string
        }

        // 视频参数
        video?: {
            // 通用
            duration?: string
            resolution?: string
            aspectRatio?: string
            negativePrompt?: string
            seed?: number

            // Vidu
            viduMode?: string
            viduStyle?: string
            viduMovementAmplitude?: number
            viduBgm?: boolean

            // Kling
            klingCfgScale?: number

            // Hailuo
            hailuoFastMode?: boolean
            enablePromptExpansion?: boolean

            // PixVerse
            pixFastMode?: boolean

            // Seedance
            seedanceVariant?: string
            seedanceResolution?: string
            seedanceAspectRatio?: string
            seedanceCameraFixed?: boolean

            // Wan
            wanSize?: string
            wanResolution?: string
            wanPromptExtend?: boolean
            wanAudio?: boolean
        }

        // 音频参数
        audio?: {
            voiceId?: string
            spec?: string
            emotion?: string
            languageBoost?: number
            vol?: number
            pitch?: number
            speed?: number
            sampleRate?: number
            bitrate?: number
            format?: string
            channel?: number
            latexRead?: boolean
            textNormalization?: boolean
        }
    }
}
