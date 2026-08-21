import { createLogger } from '@/core/logging'

const logger = createLogger('models.ppio.seedream-4.5.model')
/**
 * Seedream 4.5 模型定义
 *
 * 派欧云即梦图片 4.5 - 支持文生图和图生图
 *
 * 分辨率约束（派欧云限制）：
 * - 宽高比范围：[1/16, 16]
 * - 总像素范围：[3686400, 16777216]（约 1920×1920 到 4096×4096）
 * - 2K模式：目标像素 2048×2048
 * - 4K模式：目标像素 4096×4096
 */

import { defineModel, sharedFieldText, sharedOptionText, sharedText } from '@/core'
import {
    calculateSeedreamSizeFromRatio,
    getImageSize,
    normalizeSeedreamCustomSize,
    normalizeSeedreamSizeString,
    resolveSeedreamRatio,
    type SeedreamResolutionValue,
} from '@/models/shared/seedreamResolution'
import { resolvePpioImageSources } from './mediaSources'

const SEEDREAM_45_CONSTRAINTS = {
    minSide: 480,
    maxSide: 4096,
    minAspectRatio: 1 / 16,
    maxAspectRatio: 16,
    minPixels: 3686400,
    maxPixels: 16777216,
}

export const seedream45Model = defineModel({
    meta: {
        id: 'ppio-seedream-4.5',
        canonicalModelId: 'seedream-4.5',
        seriesId: 'seedream',
        seriesRank: 4.5,
        provider: 'ppio',
        type: 'image',
        i18nScope: 'models.defs.ppio-seedream-4.5',
        name: { key: 'meta.name', fallback: 'Seedream 4.5' },
        tags: ['text-to-image', 'image-to-image', 'supports-4k', 'provider-ppio'],
        polling: {
            interval: 3000,
            maxAttempts: 120,
            expectedAttempts: 20
        }
    },

    params: [
        {
            id: 'ppioSeedream45AspectRatio',
            type: 'dropdown',
            order: 1,
            name: sharedFieldText('aspectRatio'),
            default: 'smart',
            options: [
                { value: 'smart', label: sharedOptionText('smart') },
                { value: '21:9', label: '21:9' },
                { value: '16:9', label: '16:9' },
                { value: '3:2', label: '3:2' },
                { value: '4:3', label: '4:3' },
                { value: '1:1', label: '1:1' },
                { value: '3:4', label: '3:4' },
                { value: '2:3', label: '2:3' },
                { value: '9:16', label: '9:16' }
            ]
        },
        {
            id: 'ppioSeedream45Resolution',
            type: 'dropdown',
            order: 2,
            name: sharedFieldText('resolution'),
            default: '2K',
            options: [
                { value: '2K', label: sharedOptionText('hd2k') },
                { value: '4K', label: sharedOptionText('uhd4k') }
            ]
        },

        // 2. 数量（数字输入）
        {
            id: 'maxImages',
            type: 'number',
            order: 3,
            name: sharedFieldText('quantity'),
            tooltip: sharedText('tips.numberOfImagesLimit'),
            default: 1,
            min: 1,
            max: 15,
            step: 1
        },

        // 3. 提示词优化（开关）
        {
            id: 'optimizePrompt',
            type: 'switch',
            order: 4,
            name: sharedFieldText('promptOptimization'),
            tooltip: sharedText('tips.promptOptimization'),
            default: false
        }
    ],

    runtimeConstraints: {
        imageSizeFields: [
            {
                field: 'size',
                format: 'string',
                minPixels: 3686400,
                maxPixels: 16777216,
                minAspectRatio: 1 / 16,
                maxAspectRatio: 16
            }
        ]
    },

    linkages: [],

    endpoints: '/seedream-4.5',

    request: {
        builder: async (params) => {
            const requestImages = resolvePpioImageSources(params)
            const previewImages = Array.isArray(params.images)
                ? params.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : requestImages
            // 处理组图数量
            const maxImages = params.maxImages || params.max_images || 1
            let finalPrompt = params.prompt
            if (maxImages > 1) {
                finalPrompt = `生成${maxImages}张图片。${params.prompt}`
            }

            const requestData: DynamicValueMap = {
                prompt: finalPrompt,
                watermark: false
            }

            const legacyResolution = params.resolution && typeof params.resolution === 'object'
                ? params.resolution as SeedreamResolutionValue
                : undefined
            const aspectRatio = legacyResolution?.aspectRatio ?? String(params.ppioSeedream45AspectRatio || 'smart')
            const quality = legacyResolution?.quality === '4K' || params.ppioSeedream45Resolution === '4K'
                ? '4K'
                : '2K'

            if (legacyResolution?.width && legacyResolution.height) {
                const size = normalizeSeedreamCustomSize(
                    legacyResolution.width,
                    legacyResolution.height,
                    SEEDREAM_45_CONSTRAINTS
                )
                requestData.size = `${size.width}x${size.height}`
            } else if (
                params.size &&
                params.ppioSeedream45AspectRatio === undefined &&
                params.ppioSeedream45Resolution === undefined
            ) {
                const normalizedSize = normalizeSeedreamSizeString(params.size, SEEDREAM_45_CONSTRAINTS)
                if (normalizedSize) {
                    requestData.size = normalizedSize
                }
            } else {
                let ratioHint: number | null = null
                if (aspectRatio === 'smart' || aspectRatio === 'auto') {
                    ratioHint = typeof params.__firstImageRatio === 'number' &&
                        Number.isFinite(params.__firstImageRatio) &&
                        params.__firstImageRatio > 0
                        ? params.__firstImageRatio
                        : null
                    if (ratioHint === null && previewImages.length > 0) {
                        try {
                            const imageSize = await getImageSize(previewImages[0])
                            ratioHint = imageSize.width / imageSize.height
                        } catch (error) {
                            logger.warn('[Seedream 4.5] 读取参考图比例失败，回退到 1:1', error)
                        }
                    }
                }
                const size = calculateSeedreamSizeFromRatio(
                    resolveSeedreamRatio(aspectRatio, ratioHint ?? 1),
                    quality,
                    SEEDREAM_45_CONSTRAINTS
                )
                requestData.size = `${size.width}x${size.height}`
            }

            // 处理图片上传（4.5 使用 image 字段，而非 images）
            if (requestImages.length > 0) {
                requestData.image = requestImages
            }

            // 处理组图设置
            if (maxImages > 1) {
                requestData.sequential_image_generation = 'auto'
                requestData.sequential_image_generation_options = {
                    max_images: maxImages
                }
            } else {
                requestData.sequential_image_generation = 'disabled'
            }

            // 处理提示词优化（4.5 特有功能）
            if (params.optimizePrompt === true) {
                requestData.optimize_prompt_options = {
                    mode: 'standard'
                }
            }

            return requestData
        }
    },

    pricing: {
        currency: '¥',
        calculator: (params) => {
            const basePrice = 0.15
            const maxImages = params.maxImages || 1
            const legacyResolution = params.resolution && typeof params.resolution === 'object'
                ? params.resolution as SeedreamResolutionValue
                : undefined
            const quality = legacyResolution?.quality ?? params.ppioSeedream45Resolution ?? '2K'

            // 4K 分辨率翻倍
            const qualityMultiplier = quality === '4K' ? 2 : 1

            return basePrice * maxImages * qualityMultiplier
        },
        description: '基础价格 ¥0.15/张，4K分辨率翻倍'
    }
})

export default seedream45Model
