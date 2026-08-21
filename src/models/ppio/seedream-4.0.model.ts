import { createLogger } from '@/core/logging'

const logger = createLogger('models.ppio.seedream-4.0.model')
/**
 * Seedream 4.0 模型定义
 *
 * 派欧云即梦图片 4.0 - 支持文生图和图生图
 *
 * 分辨率约束（派欧云限制）：
 * - 宽高比范围：[1/16, 16]
 * - 最小尺寸：宽度和高度都 > 14 像素
 * - 最大总像素：4096×4096 = 16,777,216 像素
 * - 2K模式：目标像素 2048×2048
 * - 4K模式：目标像素 4096×4096
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import {
    calculateSeedreamSizeFromRatio,
    getImageSize,
    normalizeSeedreamCustomSize,
    normalizeSeedreamSizeString,
    resolveSeedreamRatio,
    type SeedreamResolutionValue,
} from '@/models/shared/seedreamResolution'
import { resolvePpioImageSources } from './mediaSources'

const SEEDREAM_40_CONSTRAINTS = {
    minSide: 15,
    maxSide: 4096,
    minAspectRatio: 1 / 16,
    maxAspectRatio: 16,
    maxPixels: 16777216,
}

export const seedream40Model = defineModel({
    meta: {
        id: 'ppio-seedream-4.0',
        canonicalModelId: 'seedream-4.0',
        seriesId: 'seedream',
        seriesRank: 4.0,
        provider: 'ppio',
        type: 'image',
        i18nScope: 'models.defs.ppio-seedream-4.0',
        name: { key: 'meta.name', fallback: 'Seedream 4.0' },
        tags: ['text-to-image', 'image-to-image', 'supports-4k', 'provider-ppio'],
        polling: {
            interval: 3000,
            maxAttempts: 120,
            expectedAttempts: 20
        }
    },

    params: [
        {
            id: 'ppioSeedream40AspectRatio',
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
            id: 'ppioSeedream40Resolution',
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
            valueType: 'number',
            name: { key: 'params.maxImages.name', fallback: 'Quantity' },
            tooltip: { key: 'params.maxImages.tooltip', fallback: 'Set to 1 to generate a single image; greater than 1 will generate multiple images. Total reference + generated images cannot exceed 15.' },
            default: 1,
            min: 1,
            max: 15,
            step: 1
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

    endpoints: '/seedream-4.0',

    request: {
        builder: async (params) => {
            const requestImages = resolvePpioImageSources(params)
            const previewImages = Array.isArray(params.images)
                ? params.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : requestImages
            // 处理组图数量：当 maxImages > 1 时，在 prompt 前添加"生成X张"
            // 兼容两种参数格式：maxImages（参数ID）和 max_images（API字段名）
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
            const aspectRatio = legacyResolution?.aspectRatio ?? String(params.ppioSeedream40AspectRatio || 'smart')
            const quality = legacyResolution?.quality === '4K' || params.ppioSeedream40Resolution === '4K'
                ? '4K'
                : '2K'

            if (legacyResolution?.width && legacyResolution.height) {
                const size = normalizeSeedreamCustomSize(
                    legacyResolution.width,
                    legacyResolution.height,
                    SEEDREAM_40_CONSTRAINTS
                )
                requestData.size = `${size.width}x${size.height}`
            } else if (
                params.size &&
                params.ppioSeedream40AspectRatio === undefined &&
                params.ppioSeedream40Resolution === undefined
            ) {
                const normalizedSize = normalizeSeedreamSizeString(params.size, SEEDREAM_40_CONSTRAINTS)
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
                            logger.warn('[Seedream 4.0] 读取参考图比例失败，回退到 1:1', error)
                        }
                    }
                }
                const size = calculateSeedreamSizeFromRatio(
                    resolveSeedreamRatio(aspectRatio, ratioHint ?? 1),
                    quality,
                    SEEDREAM_40_CONSTRAINTS
                )
                requestData.size = `${size.width}x${size.height}`
            }

            // 处理图片上传
            if (requestImages.length > 0) {
                requestData.images = requestImages
            }

            // 处理组图设置（maxImages 已在函数开头声明）
            if (maxImages > 1) {
                requestData.sequential_image_generation = 'auto'
                requestData.max_images = maxImages
            } else {
                requestData.sequential_image_generation = 'disabled'
            }

            return requestData
        }
    },

    pricing: {
        currency: '¥',
        calculator: (params) => {
            const basePrice = 0.2
            const maxImages = params.maxImages || 1
            return basePrice * maxImages
        },
        description: '基础价格 ¥0.2/张'
    }
})

export default seedream40Model
