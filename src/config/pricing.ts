// 价格配置文件
// 集中管理所有模型的价格信息，支持固定价格和动态计算

export interface PricingConfig {
    providerId: string // 新增：供应商ID
    modelId: string
    currency: '¥' | '$'
    type: 'fixed' | 'calculated'

    // 固定价格（如图片模型）
    fixedPrice?: number

    // 动态计算（传入当前参数，返回价格或价格范围）
    calculator?: (params: any) => number | { min: number; max: number }
}

export type PriceResult = number | { min: number; max: number } | null

// ===== 汇率常量 =====
const USD_TO_CNY = 7.071 // 1 美元 ≈ 7.071 人民币

// ===== 价格常量（便于批量调整）=====
const PRICES = {
    // 图片
    SEEDREAM: 0.2,

    // fal 模型价格（美元）
    NANO_BANANA: 0.039, // USD
    NANO_BANANA_PRO: 0.15, // USD
    KLING_IMAGE_O1: 0.028, // USD

    // Kling Video O1 价格（美元/秒）
    KLING_VIDEO_O1: {
        IMAGE_VIDEO: 0.112,  // image-to-video & reference-to-video
        VIDEO_VIDEO: 0.168   // video-to-video-edit & video-to-video-reference
    },

    // Kling Video v2.6 Pro 价格（美元/秒）
    KLING_VIDEO_V26_PRO: {
        AUDIO_OFF: 0.07,  // 音频关闭
        AUDIO_ON: 0.14    // 音频开启
    },

    // 音频（每万字符）
    SPEECH_HD: 3.5,
    SPEECH_TURBO: 2,

    // 视频 - Vidu Q1
    VIDU: 2.25,

    // 视频 - Kling
    KLING: {
        5: 2.5,
        10: 5
    },

    // 视频 - Minimax Hailuo 2.3
    HAILUO_23: {
        text: {
            '768P': { 6: 2, 10: 4 },
            '1080P': { 6: 3.5, 10: 0 }
        },
        image: {
            '768P': { 6: 2, 10: 4 },
            '1080P': { 6: 3.5, 10: 0 }
        },
        imageFast: {
            '768P': { 6: 1.35, 10: 2.25 },
            '1080P': { 6: 2.3, 10: 0 }
        }
    },

    // 视频 - Minimax Hailuo-02
    HAILUO_02: {
        '768P': { 6: 1.8, 10: 3.6 },
        '1080P': { 6: 3.15, 10: 0 }
    },

    // 视频 - PixVerse V4.5
    PIXVERSE: {
        normal: {
            '360p': 1.8125,
            '540p': 1.8125,
            '720p': 2.5375,
            '1080p': 5.075
        },
        fast: {
            '360p': 3.625,
            '540p': 3.625,
            '720p': 5.075,
            '1080p': 0 // 快速模式不支持1080p
        }
    },

    // 视频 - Wan 2.5
    WAN: {
        '480p': { 5: 1.5, 10: 3 },
        '720p': { 5: 3, 10: 6 },
        '1080p': { 5: 5, 10: 10 }
    },

    // 视频 - Seedance V1
    // 结构: Variant -> Duration -> Resolution -> AspectGroup -> Price
    // AspectGroup: 'wide'(21:9/9:21), 'standard'(16:9/9:16), 'classic'(4:3/3:4), 'square'(1:1)
    SEEDANCE: {
        lite: {
            5: {
                '480p': { wide: 0.47, standard: 0.49, classic: 0.47, square: 0.48 },
                '720p': { wide: 1.13, standard: 1.03, classic: 1.09, square: 1.08 },
                '1080p': { wide: 2.37, standard: 2.45, classic: 2.43, square: 2.43 }
            },
            10: {
                '480p': { wide: 0.94, standard: 0.97, classic: 0.94, square: 0.96 },
                '720p': { wide: 2.26, standard: 2.06, classic: 2.18, square: 2.16 },
                '1080p': { wide: 4.73, standard: 4.9, classic: 4.87, square: 4.86 }
            }
        },
        pro: {
            5: {
                '480p': { wide: 0.7, standard: 0.73, classic: 0.7, square: 0.72 },
                '720p': { wide: 1.69, standard: 1.54, classic: 1.64, square: 1.62 },
                '1080p': { wide: 3.55, standard: 3.67, classic: 3.65, square: 3.65 }
            },
            10: {
                '480p': { wide: 1.4, standard: 1.46, classic: 1.41, square: 1.44 },
                '720p': { wide: 3.38, standard: 3.09, classic: 3.28, square: 3.24 },
                '1080p': { wide: 7.1, standard: 7.34, classic: 7.3, square: 7.29 }
            }
        }
    },

    // 视频 - Veo 3.1
    // 价格单位：美元/秒
    VEO31: {
        normal: {
            audioOff: 0.2,  // USD
            audioOn: 0.4    // USD
        },
        fast: {
            audioOff: 0.1,  // USD
            audioOn: 0.15    // USD
        }
    },

    // 视频 - Sora 2
    // 价格单位：美元/秒
    SORA2: {
        standard: 0.1,  // USD/s - 标准版
        pro: {
            '720p': 0.30,  // USD/s - 专业版 720p
            '1080p': 0.50  // USD/s - 专业版 1080p
        }
    },

    // 视频 - LTX-2
    // 价格单位：美元/秒
    LTX2: {
        pro: {
            '1080p': 0.06,  // USD/s - Pro 1080p
            '1440p': 0.12,  // USD/s - Pro 1440p
            '2160p': 0.24   // USD/s - Pro 2160p
        },
        fast: {
            '1080p': 0.04,  // USD/s - Fast 1080p
            '1440p': 0.08,  // USD/s - Fast 1440p
            '2160p': 0.16   // USD/s - Fast 2160p
        },
        retake: 0.10  // USD/s - Retake 模式
    },

    // 视频 - Bytedance Seedance v1 (Fal)
    // 价格单位：美元/百万 tokens
    // tokens(video) = (总像素 x FPS x duration) / 1024
    // 注意：同一分辨率等级下，不同宽高比的总像素数近似相同
    SEEDANCE_V1_FAL: {
        // 标准分辨率的总像素数（用于 token 计算）
        resolutionPixels: {
            '480p': 409600,    // 约 640×640
            '720p': 921600,    // 约 960×960
            '1080p': 2073600   // 约 1440×1440
        },
        // Pro Fast 模式（固定价格，基于 1080p 5秒）
        proFast: {
            textToVideo: 0.245,  // 1080p 5秒 $0.245
            imageToVideo: 0.243,  // 1080p 5秒 $0.243
            perMillionTokens: 1.0  // 其他分辨率：$1 per million tokens
        },
        // Pro 模式（非快速）
        pro: {
            perMillionTokens: 2.5  // $2.5 per million tokens
        },
        // Lite 模式
        lite: {
            perMillionTokens: 1.8  // $1.8 per million tokens
        }
    },

    // 视频 - Pixverse V5.5
    // 价格单位：美元
    // 基础价格（5秒，单镜头，无音频）
    PIXVERSE_V55: {
        '360p': 0.15,
        '540p': 0.15,
        '720p': 0.20,
        '1080p': 0.40
    },

    // 视频 - Vidu Q2
    // 价格单位：美元
    VIDU_Q2: {
        // Reference To Video & Text To Video: $0.1/图
        referenceToVideo: 0.1,
        textToVideo: {
            '360p': 0.1,
            '520p': 0.2,
            '720p': 0.3,
            '1080p': { base: 0.2, perSecond: 0.1 }  // $0.2 基础 + $0.1/秒
        },
        // Image To Video Turbo: $0.05/秒（720p），$0.2基础+$0.05/秒（1080p）
        imageToVideoTurbo: {
            '720p': 0.05,  // USD/s
            '1080p': { base: 0.2, perSecond: 0.05 }
        },
        // Image To Video Pro: $0.1基础+$0.05/秒（720p），$0.3基础+$0.1/秒（1080p）
        imageToVideoPro: {
            '720p': { base: 0.1, perSecond: 0.05 },
            '1080p': { base: 0.3, perSecond: 0.1 }
        },
        // Video Extension Pro: 按分辨率和时长计费
        videoExtension: {
            '360p': 0.15,
            '520p': 0.22,
            '720p': 0.075,  // USD/s
            '1080p': { base: 0.28, perSecond: 0.075 }
        }
    },

    // 视频 - Wan 2.5 Preview (Fal)
    // 价格单位：美元/秒
    WAN_25_FAL: {
        '480p': 0.05,  // USD/s
        '720p': 0.10,  // USD/s
        '1080p': 0.15  // USD/s
    }
} as const

// ===== 辅助函数：格式化价格（最多2位小数）=====
function formatPrice(price: number): number {
    // 四舍五入到2位小数，自动去除不必要的尾随零
    return Math.round(price * 100) / 100
}

// ===== 辅助函数：获取Seedance宽高比分组 =====
function getSeedanceAspectGroup(aspect: string): 'wide' | 'standard' | 'classic' | 'square' {
    // 移除可能存在的空格
    const ratio = aspect.replace(/\s/g, '')

    if (['21:9', '9:21'].includes(ratio)) return 'wide'
    if (['16:9', '9:16'].includes(ratio)) return 'standard'
    if (['4:3', '3:4'].includes(ratio)) return 'classic'
    if (['1:1'].includes(ratio)) return 'square'

    return 'standard' // 默认
}

// ===== 辅助函数：解析分辨率为宽高 =====
function parseResolution(resolution: string, aspectRatio: string): { width: number; height: number } {
    // 标准分辨率映射（基于 16:9）
    const standardResolutions: Record<string, { width: number; height: number }> = {
        '480p': { width: 854, height: 480 },
        '720p': { width: 1280, height: 720 },
        '1080p': { width: 1920, height: 1080 }
    }

    // 获取基础分辨率
    const baseRes = standardResolutions[resolution] || standardResolutions['720p']

    // 如果是标准 16:9 比例，直接返回
    if (aspectRatio === '16:9') {
        return baseRes
    }

    // 根据宽高比调整分辨率
    const [w, h] = aspectRatio.split(':').map(Number)
    const targetRatio = w / h

    // 保持高度不变，调整宽度
    if (targetRatio > 16 / 9) {
        // 更宽的比例（如 21:9）
        return {
            width: Math.round(baseRes.height * targetRatio),
            height: baseRes.height
        }
    } else if (targetRatio < 16 / 9) {
        // 更窄的比例（如 9:16, 4:3, 1:1）
        return {
            width: Math.round(baseRes.height * targetRatio),
            height: baseRes.height
        }
    }

    return baseRes
}

// ===== 模型价格配置 =====
export const pricingConfigs: PricingConfig[] = [
    //===== 图片模型 =====
    {
        providerId: 'piaoyun',
        modelId: 'seedream-4.0',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const maxImages = params.maxImages || 1
            return formatPrice(PRICES.SEEDREAM * maxImages)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-nano-banana',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const numImages = params.num_images || 1
            return formatPrice(PRICES.NANO_BANANA * USD_TO_CNY * numImages)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-nano-banana-pro',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const numImages = params.num_images || 1
            const basePrice = PRICES.NANO_BANANA_PRO * USD_TO_CNY * numImages
            // 4K 分辨率时价格为 2 倍
            const multiplier = params.resolution === '4K' ? 2 : 1
            return formatPrice(basePrice * multiplier)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-bytedance-seedream-v4',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const numImages = params.falSeedream40NumImages || 1
            return formatPrice(0.0283 * USD_TO_CNY * numImages)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-bytedance-seedream-v4.5',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const numImages = params.falSeedream40NumImages || 1
            return formatPrice(0.04 * USD_TO_CNY * numImages)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-z-image-turbo',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const numImages = params.numImages || 1

            // 映射预设分辨率到像素数量（宽x高）
            const resolutionToPixels: Record<string, number> = {
                'portrait_4_3': 768 * 1024,  // 竖版 4:3
                'portrait_16_9': 1080 * 1920, // 竖版 16:9
                'square': 1024 * 1024,        // 正方形
                'landscape_4_3': 1024 * 768,  // 横版 4:3
                'landscape_16_9': 1920 * 1080 // 横版 16:9
            }

            let totalPixels = resolutionToPixels[params.imageSize] || 1024 * 768

            // 处理自定义分辨率
            if (params.imageSize && params.imageSize.includes('*')) {
                const [width, height] = params.imageSize.split('*').map(Number)
                totalPixels = width * height
            }

            // 计算百万像素数
            const millionPixels = totalPixels / 1000000

            // 计算价格：0.005美元每百万像素
            const pricePerImage = millionPixels * 0.005 * USD_TO_CNY

            // 总价格，格式化为最多2位小数
            return formatPrice(pricePerImage * numImages)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-kling-image-o1',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const numImages = params.num_images || 1
            return formatPrice(PRICES.KLING_IMAGE_O1 * USD_TO_CNY * numImages)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-kling-video-o1',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const duration = params.videoDuration || 5
            const mode = params.falKlingVideoO1Mode || 'image-to-video'

            // 根据模式选择价格
            const pricePerSecondUSD =
                mode === 'video-to-video-edit' || mode === 'video-to-video-reference'
                    ? PRICES.KLING_VIDEO_O1.VIDEO_VIDEO
                    : PRICES.KLING_VIDEO_O1.IMAGE_VIDEO

            const totalPriceCNY = pricePerSecondUSD * USD_TO_CNY * duration
            return formatPrice(totalPriceCNY)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-kling-video-v2.6-pro',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const duration = params.videoDuration || 5
            const generateAudio = params.falKlingV26ProGenerateAudio !== undefined ? params.falKlingV26ProGenerateAudio : true

            // 根据音频开关选择价格
            const pricePerSecondUSD = generateAudio
                ? PRICES.KLING_VIDEO_V26_PRO.AUDIO_ON
                : PRICES.KLING_VIDEO_V26_PRO.AUDIO_OFF

            const totalPriceCNY = pricePerSecondUSD * USD_TO_CNY * duration
            return formatPrice(totalPriceCNY)
        }
    },

    // ===== 音频模型 =====
    {
        providerId: 'piaoyun',
        modelId: 'minimax-speech-2.6',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const textLength = params.input?.length || 0
            const charsIn10k = textLength / 10000
            const pricePerChar = params.minimaxAudioSpec === 'audio-pro'
                ? PRICES.SPEECH_HD
                : PRICES.SPEECH_TURBO
            return formatPrice(charsIn10k * pricePerChar)
        }
    },

    // ===== 视频模型 =====
    {
        providerId: 'piaoyun',
        modelId: 'vidu-q1',
        currency: '¥',
        type: 'fixed',
        fixedPrice: PRICES.VIDU
    },
    {
        providerId: 'piaoyun',
        modelId: 'kling-2.5-turbo',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const duration = (params.ppioKling25VideoDuration || params.videoDuration || 5) as 5 | 10
            return PRICES.KLING[duration] || PRICES.KLING[5]
        }
    },
    {
        providerId: 'piaoyun',
        modelId: 'minimax-hailuo-2.3',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const hasImage = params.uploadedImages?.length > 0
            const duration = params.ppioHailuo23VideoDuration || params.videoDuration || 6
            const resolution = (params.ppioHailuo23VideoResolution || params.videoResolution || '768P') as '768P' | '1080P'
            const isFast = params.ppioHailuo23FastMode

            let priceTable
            if (hasImage && isFast) {
                priceTable = PRICES.HAILUO_23.imageFast
            } else if (hasImage) {
                priceTable = PRICES.HAILUO_23.image
            } else {
                priceTable = PRICES.HAILUO_23.text
            }

            return priceTable[resolution]?.[duration as 6 | 10] || 0
        }
    },
    {
        providerId: 'piaoyun',
        modelId: 'minimax-hailuo-02',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const duration = params.ppioHailuo23VideoDuration || params.videoDuration || 6
            const resolution = (params.ppioHailuo23VideoResolution || params.videoResolution || '768P') as '768P' | '1080P'
            return PRICES.HAILUO_02[resolution]?.[duration as 6 | 10] || 0
        }
    },
    {
        providerId: 'piaoyun',
        modelId: 'pixverse-v4.5',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const resolution = (params.ppioPixverse45VideoResolution || params.videoResolution || '540p') as '360p' | '540p' | '720p' | '1080p'
            const isFast = params.ppioPixverse45FastMode
            const priceTable = isFast ? PRICES.PIXVERSE.fast : PRICES.PIXVERSE.normal
            return priceTable[resolution] || 0
        }
    },
    {
        providerId: 'piaoyun',
        modelId: 'wan-2.5-preview',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const duration = params.ppioWan25VideoDuration || params.videoDuration || 5

            // 处理两种分辨率参数：
            // 1. falWan25Resolution: 图生视频模式，格式为 "1080P"
            // 2. ppioWan25Size: 文生视频模式，格式为 "1280*720"
            let resolution: '480p' | '720p' | '1080p' = '720p'

            if (params.falWan25Resolution) {
                // 图生视频：直接使用分辨率参数
                resolution = params.falWan25Resolution.toLowerCase() as '480p' | '720p' | '1080p'
            } else if (params.ppioWan25Size) {
                // 文生视频：根据尺寸计算分辨率等级
                const [w, h] = params.ppioWan25Size.split('*').map(Number)
                const pixels = w * h
                if (pixels <= 400000) {
                    resolution = '480p'
                } else if (pixels <= 1000000) {
                    resolution = '720p'
                } else {
                    resolution = '1080p'
                }
            }

            return PRICES.WAN[resolution]?.[duration as 5 | 10] || 0
        }
    },
    {
        providerId: 'piaoyun',
        modelId: 'seedance-v1',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const variant = (params.ppioSeedanceV1Variant || 'lite') as 'lite' | 'pro'
            const duration = (params.ppioSeedanceV1VideoDuration || params.videoDuration || 5) as 5 | 10
            const resolution = (params.ppioSeedanceV1Resolution || '720p') as '480p' | '720p' | '1080p'
            const aspect = params.ppioSeedanceV1AspectRatio || '16:9'
            const aspectGroup = getSeedanceAspectGroup(aspect)

            // Seedance的价格结构：Variant -> Duration -> Resolution -> AspectGroup
            const price = PRICES.SEEDANCE[variant]?.[duration]?.[resolution]?.[aspectGroup]

            return price || 0
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-veo-3.1',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const duration = params.falVeo31VideoDuration || 8
            const mode = params.falVeo31Mode || 'text-image-to-video'
            const isFastMode = (params.falVeo31FastMode || false) && mode !== 'reference-to-video' // 参考生视频模式不支持快速模式
            const isAudioOn = params.falVeo31GenerateAudio || false

            // 获取价格（美元/秒）
            const pricePerSecondUSD = isFastMode
                ? (isAudioOn ? PRICES.VEO31.fast.audioOn : PRICES.VEO31.fast.audioOff)
                : (isAudioOn ? PRICES.VEO31.normal.audioOn : PRICES.VEO31.normal.audioOff)

            // 计算总价（转换为人民币）
            const totalPriceCNY = pricePerSecondUSD * USD_TO_CNY * duration

            // 格式化为最多2位小数
            return formatPrice(totalPriceCNY)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-sora-2',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const duration = params.videoDuration || 4
            const mode = params.falSora2Mode || 'standard'

            // 获取价格（美元/秒）
            let pricePerSecondUSD: number
            if (mode === 'standard') {
                pricePerSecondUSD = PRICES.SORA2.standard
            } else {
                // 专业模式：根据分辨率选择价格
                const resolution = params.falSora2Resolution || '720p'
                pricePerSecondUSD = resolution === '1080p'
                    ? PRICES.SORA2.pro['1080p']
                    : PRICES.SORA2.pro['720p']
            }

            // 计算总价（转换为人民币）
            const totalPriceCNY = pricePerSecondUSD * USD_TO_CNY * duration

            // 格式化为最多2位小数
            return formatPrice(totalPriceCNY)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-ltx-2',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const mode = params.ltxMode || 'text-to-video'  // 使用 ltxMode
            const resolution = params.falLtx2Resolution || '1080p'
            const fastMode = params.falLtx2FastMode !== undefined ? params.falLtx2FastMode : true

            // 根据模式选择时长参数
            let duration: number
            if (mode === 'retake-video') {
                // 视频编辑模式：使用 ltxRetakeDuration
                duration = params.falLtx2RetakeDuration || 5
            } else {
                // 文生视频和图生视频模式：使用 videoDuration
                duration = params.videoDuration || 6
            }

            // 获取价格（美元/秒）
            let pricePerSecondUSD: number

            if (mode === 'retake-video') {
                // 视频编辑模式：固定价格 0.1 美元/秒
                pricePerSecondUSD = PRICES.LTX2.retake
            } else {
                // 文生视频和图生视频模式：根据快速模式和分辨率选择价格
                const priceTable = fastMode ? PRICES.LTX2.fast : PRICES.LTX2.pro
                pricePerSecondUSD = priceTable[resolution as '1080p' | '1440p' | '2160p'] || priceTable['1080p']
            }

            // 计算总价（转换为人民币）
            const totalPriceCNY = pricePerSecondUSD * USD_TO_CNY * duration

            // 格式化为最多2位小数
            return formatPrice(totalPriceCNY)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-bytedance-seedance-v1',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const version = params.falSeedanceV1Version || 'lite'
            const mode = params.falSeedanceV1Mode || 'text-to-video'
            const fastMode = params.falSeedanceV1FastMode !== undefined ? params.falSeedanceV1FastMode : true
            const duration = params.videoDuration || 5
            const resolution = params.ppioSeedanceV1Resolution || '720p'

            // 获取分辨率对应的总像素数（不考虑宽高比）
            const totalPixels = PRICES.SEEDANCE_V1_FAL.resolutionPixels[resolution as '480p' | '720p' | '1080p'] || PRICES.SEEDANCE_V1_FAL.resolutionPixels['720p']

            // 假设 FPS 为 24（标准视频帧率）
            const fps = 24

            // 计算视频 tokens: (总像素 x FPS x duration) / 1024
            const videoTokens = (totalPixels * fps * duration) / 1024

            // 转换为百万 tokens
            const millionTokens = videoTokens / 1000000

            let totalPriceUSD: number

            // Pro Fast 模式（仅文生视频和图生视频支持）
            if (version === 'pro' && fastMode && mode !== 'reference-to-video') {
                // 检查是否是 1080p 5秒的标准情况
                const is1080p5s = resolution === '1080p' && duration === 5

                if (is1080p5s) {
                    // 使用固定价格
                    if (mode === 'text-to-video') {
                        totalPriceUSD = PRICES.SEEDANCE_V1_FAL.proFast.textToVideo
                    } else {
                        totalPriceUSD = PRICES.SEEDANCE_V1_FAL.proFast.imageToVideo
                    }
                } else {
                    // 其他分辨率：使用 token 计价
                    totalPriceUSD = millionTokens * PRICES.SEEDANCE_V1_FAL.proFast.perMillionTokens
                }
            }
            // Pro 模式（非快速）
            else if (version === 'pro' && !fastMode) {
                // 检查是否是 1080p 5秒的标准情况
                const is1080p5s = resolution === '1080p' && duration === 5

                if (is1080p5s) {
                    // 使用固定价格 $0.62
                    totalPriceUSD = 0.62
                } else {
                    // 其他分辨率：使用 token 计价
                    totalPriceUSD = millionTokens * PRICES.SEEDANCE_V1_FAL.pro.perMillionTokens
                }
            }
            // Lite 模式
            else {
                // 检查是否是 720p 5秒的标准情况
                const is720p5s = resolution === '720p' && duration === 5

                if (is720p5s) {
                    // 使用固定价格 $0.18
                    totalPriceUSD = 0.18
                } else {
                    // 其他分辨率：使用 token 计价
                    totalPriceUSD = millionTokens * PRICES.SEEDANCE_V1_FAL.lite.perMillionTokens
                }
            }

            // 转换为人民币并格式化
            return formatPrice(totalPriceUSD * USD_TO_CNY)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-pixverse-v5.5',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const resolution = params.falPixverse55Resolution || '720p'
            const duration = params.videoDuration || 5
            const generateAudio = params.falPixverse55GenerateAudio || false
            const multiClip = params.falPixverse55MultiClip || false

            // 获取基础价格（5秒，单镜头，无音频）
            const basePrice5s = PRICES.PIXVERSE_V55[resolution as '360p' | '540p' | '720p' | '1080p'] || PRICES.PIXVERSE_V55['720p']

            // 计算时长倍数
            let durationMultiplier = 1
            if (duration === 8) {
                durationMultiplier = 2  // 8秒：2倍价格
            } else if (duration === 10) {
                // 10秒：2.2倍价格（1080p不支持10秒）
                if (resolution === '1080p') {
                    // 1080p不支持10秒，回退到8秒价格
                    durationMultiplier = 2
                } else {
                    durationMultiplier = 2.2
                }
            }

            // 计算基础价格（含时长）
            let totalPriceUSD = basePrice5s * durationMultiplier

            // 添加音频费用
            if (generateAudio) {
                totalPriceUSD += 0.05
            }

            // 添加多镜头费用
            if (multiClip) {
                if (generateAudio) {
                    totalPriceUSD += 0.15  // 多镜头+音频：+$0.15
                } else {
                    totalPriceUSD += 0.10  // 仅多镜头：+$0.10
                }
            }

            // 转换为人民币并格式化
            return formatPrice(totalPriceUSD * USD_TO_CNY)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-vidu-q2',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const mode = params.falViduQ2Mode || 'text-to-video'
            const resolution = params.falViduQ2Resolution || '720p'
            const duration = params.videoDuration || 4
            const isTurbo = params.falViduQ2FastMode !== undefined ? params.falViduQ2FastMode : true

            let totalPriceUSD: number

            if (mode === 'reference-to-video') {
                // 参考生视频：固定 $0.1
                totalPriceUSD = PRICES.VIDU_Q2.referenceToVideo
            } else if (mode === 'text-to-video') {
                // 文生视频：按分辨率计费
                const pricing = PRICES.VIDU_Q2.textToVideo[resolution as '360p' | '520p' | '720p' | '1080p']
                if (!pricing) {
                    // 如果分辨率不支持，使用默认值
                    totalPriceUSD = 0
                } else if (typeof pricing === 'number') {
                    totalPriceUSD = pricing
                } else {
                    // 1080p: 基础价格 + 每秒价格
                    totalPriceUSD = pricing.base + pricing.perSecond * duration
                }
            } else if (mode === 'image-to-video') {
                // 图生视频：Turbo 或 Pro（仅支持 720p 和 1080p）
                // 如果分辨率不是 720p 或 1080p，默认使用 720p
                const validResolution = (resolution === '720p' || resolution === '1080p') ? resolution : '720p'

                const pricing = isTurbo
                    ? PRICES.VIDU_Q2.imageToVideoTurbo[validResolution]
                    : PRICES.VIDU_Q2.imageToVideoPro[validResolution]

                if (typeof pricing === 'number') {
                    // 720p Turbo: 按秒计费
                    totalPriceUSD = pricing * duration
                } else if (pricing) {
                    // 其他：基础价格 + 每秒价格
                    totalPriceUSD = pricing.base + pricing.perSecond * duration
                } else {
                    // 安全回退
                    totalPriceUSD = 0
                }
            } else if (mode === 'video-extension') {
                // 视频延长：按分辨率计费
                const pricing = PRICES.VIDU_Q2.videoExtension[resolution as '360p' | '520p' | '720p' | '1080p']
                if (!pricing) {
                    // 如果分辨率不支持，使用默认值
                    totalPriceUSD = 0
                } else if (typeof pricing === 'number') {
                    if (resolution === '360p' || resolution === '520p') {
                        // 360p/520p: 固定价格
                        totalPriceUSD = pricing
                    } else {
                        // 720p: 按秒计费
                        totalPriceUSD = pricing * duration
                    }
                } else {
                    // 1080p: 基础价格 + 每秒价格
                    totalPriceUSD = pricing.base + pricing.perSecond * duration
                }
            } else {
                totalPriceUSD = 0
            }

            // 转换为人民币并格式化
            return formatPrice(totalPriceUSD * USD_TO_CNY)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-wan-25-preview',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const duration = params.videoDuration || 5
            const resolution = (params.falWan25Resolution || '1080p').toLowerCase() as '480p' | '720p' | '1080p'

            // 获取价格（美元/秒）
            const pricePerSecondUSD = PRICES.WAN_25_FAL[resolution] || PRICES.WAN_25_FAL['1080p']

            // 计算总价（转换为人民币）
            const totalPriceCNY = pricePerSecondUSD * USD_TO_CNY * duration

            // 格式化为最多2位小数
            return formatPrice(totalPriceCNY)
        }
    }
]

// ===== 辅助函数 =====

/**
 * 根据模型ID和供应商ID获取价格配置
 */
export function getPricingConfig(providerId: string, modelId: string): PricingConfig | undefined {
    return pricingConfigs.find(config => config.providerId === providerId && config.modelId === modelId)
}

/**
 * 计算价格
 * @param providerId 供应商ID
 * @param modelId 模型ID
 * @param params 当前参数
 * @returns 价格（数字或范围）或 null（无配置）
 */
export function calculatePrice(providerId: string, modelId: string, params: any): PriceResult {
    const config = getPricingConfig(providerId, modelId)
    if (!config) return null

    if (config.type === 'fixed') {
        return config.fixedPrice || 0
    }

    if (config.calculator) {
        return config.calculator(params)
    }

    return 0
}
