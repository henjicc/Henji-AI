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
            const numImages = params.numImages || 1
            return formatPrice(0.0283 * USD_TO_CNY * numImages)
        }
    },
    {
        providerId: 'fal',
        modelId: 'fal-ai-bytedance-seedream-v4.5',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const numImages = params.numImages || 1
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
            const mode = params.klingMode || 'image-to-video'

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
            const generateAudio = params.klingV26GenerateAudio !== undefined ? params.klingV26GenerateAudio : true

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
            const pricePerChar = params.audioSpec === 'audio-pro'
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
            const duration = (params.videoDuration || 5) as 5 | 10
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
            const duration = params.videoDuration || 6
            const resolution = (params.videoResolution || '768P') as '768P' | '1080P'
            const isFast = params.hailuoFastMode

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
            const duration = params.videoDuration || 6
            const resolution = (params.videoResolution || '768P') as '768P' | '1080P'
            return PRICES.HAILUO_02[resolution]?.[duration as 6 | 10] || 0
        }
    },
    {
        providerId: 'piaoyun',
        modelId: 'pixverse-v4.5',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const resolution = (params.videoResolution || '540p') as '360p' | '540p' | '720p' | '1080p'
            const isFast = params.pixFastMode
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
            const duration = params.videoDuration || 5
            // wanResolution 格式为 "1080P"，需要转换为 "1080p"
            const resolution = (params.wanResolution || '1080P').toLowerCase() as '480p' | '720p' | '1080p'
            return PRICES.WAN[resolution]?.[duration as 5 | 10] || 0
        }
    },
    {
        providerId: 'piaoyun',
        modelId: 'seedance-v1',
        currency: '¥',
        type: 'calculated',
        calculator: (params) => {
            const variant = (params.seedanceVariant || 'lite') as 'lite' | 'pro'
            const duration = (params.seedanceDuration || 5) as 5 | 10
            const resolution = (params.seedanceResolution || '720p') as '480p' | '720p' | '1080p'
            const aspect = params.seedanceAspectRatio || '16:9'
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
            const duration = params.videoDuration || 8
            const mode = params.veoMode || 'text-image-to-video'  // 使用 veoMode
            const isFastMode = (params.veoFastMode || false) && mode !== 'reference-to-video' // 参考生视频模式不支持快速模式
            const isAudioOn = params.veoGenerateAudio || false

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
            const mode = params.soraMode || 'standard'

            // 获取价格（美元/秒）
            let pricePerSecondUSD: number
            if (mode === 'standard') {
                pricePerSecondUSD = PRICES.SORA2.standard
            } else {
                // 专业模式：根据分辨率选择价格
                const resolution = params.soraResolution || '720p'
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
            const resolution = params.ltxResolution || '1080p'
            const fastMode = params.ltxFastMode !== undefined ? params.ltxFastMode : true

            // 根据模式选择时长参数
            let duration: number
            if (mode === 'retake-video') {
                // 视频编辑模式：使用 ltxRetakeDuration
                duration = params.ltxRetakeDuration || 5
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
