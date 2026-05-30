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

import { defineModel } from '@/core'
import type { CompositePanelDef } from '@/core/types'
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

type ResolutionValue = SeedreamResolutionValue & { mode?: string }

export const seedream40Model = defineModel({
    meta: {
        id: 'ppio-seedream-4.0',
        provider: 'ppio',
        type: 'image',
        i18nScope: 'models.defs.ppio-seedream-4.0',
        name: { key: 'meta.name', fallback: 'Seedream 4.0' },
        description: { key: 'meta.description', fallback: 'PPIO Seedream image generation model v4.0, supports 2K/4K resolution' },
        tags: ['text-to-image', 'image-to-image', 'supports-4k', 'provider-ppio'],
        polling: {
            interval: 3000,
            maxAttempts: 120,
            expectedAttempts: 20
        },
        progress: {
            mode: 'time',
            baseDurationMs: 20000,
            perUnitMs: 20000,
            scaleWith: 'maxImages',
            maxDurationMs: 180000
        }
    },

    params: [
        // 1. 分辨率面板（特殊复合面板）
        {
            id: 'resolution',
            type: 'composite',
            order: 1,
            valueType: 'object',
            name: { key: 'params.resolution.name', fallback: 'Resolution' },
            panel: 'resolution',
            default: {
                mode: 'aspect-quality',
                aspectRatio: 'smart',
                quality: '2K'
            },
            config: {
                mode: 'aspect-quality',
                aspectRatios: {
                    options: [
                        { value: 'smart', label: { key: 'params.resolution.options.aspectRatios.smart', fallback: 'Smart' } },
                        { value: '21:9', label: '21:9' },
                        { value: '16:9', label: '16:9' },
                        { value: '3:2', label: '3:2' },
                        { value: '4:3', label: '4:3' },
                        { value: '1:1', label: '1:1' },
                        { value: '3:4', label: '3:4' },
                        { value: '2:3', label: '2:3' },
                        { value: '9:16', label: '9:16' }
                    ],
                    default: 'smart',
                    smartMatch: true
                },
                qualityTiers: {
                    options: [
                        { value: '2K', label: { key: 'params.resolution.options.qualityTiers.2K', fallback: 'HD 2K' } },
                        { value: '4K', label: { key: 'params.resolution.options.qualityTiers.4K', fallback: 'UHD 4K' } }
                    ],
                    default: '2K'
                },
                customSize: {
                    enabled: true,
                    minWidth: 15,
                    maxWidth: 4096,
                    minHeight: 15,
                    maxHeight: 4096,
                    step: 1,
                    lockRatio: false
                }
            }
        } as CompositePanelDef,

        // 2. 数量（数字输入）
        {
            id: 'maxImages',
            type: 'number',
            order: 2,
            valueType: 'number',
            name: { key: 'params.maxImages.name', fallback: 'Quantity' },
            tooltip: { key: 'params.maxImages.tooltip', fallback: 'Set to 1 to generate a single image; greater than 1 will generate multiple images. Total reference + generated images cannot exceed 15.' },
            default: 1,
            min: 1,
            max: 15,
            step: 1
        }
    ],

    linkages: [
        // 当分辨率的 aspectRatio 或 quality 变化时，自动计算 width 和 height
        {
            trigger: 'resolution',
            effect: 'setValue',
            target: 'resolution',
            condition: (triggerValue: ResolutionValue) => {
                // 只在非智能模式下计算
                return Boolean(triggerValue && triggerValue.aspectRatio && triggerValue.aspectRatio !== 'smart')
            },
            value: (triggerValue: ResolutionValue) => {
                if (!triggerValue.aspectRatio || triggerValue.aspectRatio === 'smart') {
                    return triggerValue
                }

                const size = calculateSeedreamSizeFromRatio(
                    resolveSeedreamRatio(triggerValue.aspectRatio, null),
                    triggerValue.quality === '4K' ? '4K' : '2K',
                    SEEDREAM_40_CONSTRAINTS
                )

                return {
                    ...triggerValue,
                    width: size.width,
                    height: size.height
                }
            }
        }
    ],

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

            const requestData: Record<string, unknown> = {
                prompt: finalPrompt,
                watermark: false
            }

            // 处理分辨率
            if (params.resolution) {
                const resolution = params.resolution as ResolutionValue

                // 智能模式：有图按首图比例，无图按 1:1
                if (resolution.aspectRatio === 'smart') {
                    try {
                        const ratioHint = typeof params.__firstImageRatio === 'number' &&
                            Number.isFinite(params.__firstImageRatio) &&
                            params.__firstImageRatio > 0
                            ? params.__firstImageRatio
                            : null
                        let ratio = ratioHint ?? 1
                        let sourceLabel = ratioHint ? `hint:${ratioHint.toFixed(4)}` : '1:1 默认'

                        if (ratioHint === null && previewImages.length > 0) {
                            const imageSize = await getImageSize(previewImages[0])
                            ratio = imageSize.width / imageSize.height
                            sourceLabel = `${imageSize.width}x${imageSize.height}`
                        }
                        const quality = resolution.quality === '4K' ? '4K' : '2K'
                        const size = calculateSeedreamSizeFromRatio(
                            resolveSeedreamRatio('smart', ratio),
                            quality,
                            SEEDREAM_40_CONSTRAINTS
                        )
                        requestData.size = `${size.width}x${size.height}`
                        logger.info(`[Seedream 4.0] 智能模式计算尺寸: ${sourceLabel} (${ratio.toFixed(2)}) -> ${size.width}x${size.height} (${quality})`)
                    } catch (error) {
                        logger.error('[Seedream 4.0] 智能模式计算尺寸失败:', error)
                    }
                }
                // 如果不是智能模式
                else if (resolution.aspectRatio !== 'smart') {
                    // 优先使用 resolution 中的 width/height
                    if (resolution.width && resolution.height) {
                        const size = normalizeSeedreamCustomSize(
                            resolution.width,
                            resolution.height,
                            SEEDREAM_40_CONSTRAINTS
                        )
                        requestData.size = `${size.width}x${size.height}`
                    }
                    // 如果 resolution 中没有 width/height，但是有直接传入的 size，使用它
                    else if (params.size) {
                        const normalizedSize = normalizeSeedreamSizeString(params.size, SEEDREAM_40_CONSTRAINTS)
                        if (normalizedSize) {
                            requestData.size = normalizedSize
                        }
                    }
                }
            }
            // 如果没有 resolution 参数，但是有直接传入的 size，使用它
            else if (params.size) {
                const normalizedSize = normalizeSeedreamSizeString(params.size, SEEDREAM_40_CONSTRAINTS)
                if (normalizedSize) {
                    requestData.size = normalizedSize
                }
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
