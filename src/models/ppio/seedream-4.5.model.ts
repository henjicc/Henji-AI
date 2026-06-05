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
        provider: 'ppio',
        type: 'image',
        i18nScope: 'models.defs.ppio-seedream-4.5',
        name: { key: 'meta.name', fallback: 'Seedream 4.5' },
        description: { key: 'meta.description', fallback: 'PPIO Seedream image generation model v4.5, supports 2K/4K resolution' },
        tags: ['text-to-image', 'image-to-image', 'supports-4k', 'provider-ppio'],
        polling: {
            interval: 3000,
            maxAttempts: 120,
            expectedAttempts: 20
        }
    },

    params: [
        // 1. 分辨率面板（特殊复合面板）
        {
            id: 'resolution',
            type: 'composite',
            order: 1,
            name: sharedFieldText('resolution'),
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
                        { value: 'smart', label: sharedOptionText('smart') },
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
                        { value: '2K', label: sharedOptionText('hd2k') },
                        { value: '4K', label: sharedOptionText('uhd4k') }
                    ],
                    default: '2K'
                },
                customSize: {
                    enabled: true,
                    minWidth: 480,
                    maxWidth: 4096,
                    minHeight: 480,
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
            order: 3,
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

    linkages: [
                // 当分辨率的 aspectRatio 或 quality 变化时，自动计算 width 和 height
        {
            trigger: 'resolution',
            effect: 'setValue',
            target: 'resolution',
            condition: (triggerValue: SeedreamResolutionValue) => {
                // 只在非智能模式下计算
                return Boolean(triggerValue && triggerValue.aspectRatio && triggerValue.aspectRatio !== 'smart')
            },
            value: (triggerValue: SeedreamResolutionValue) => {
                if (!triggerValue?.aspectRatio || triggerValue.aspectRatio === 'smart') {
                    return triggerValue
                }

                const size = calculateSeedreamSizeFromRatio(
                    resolveSeedreamRatio(triggerValue.aspectRatio, null),
                    triggerValue.quality === '4K' ? '4K' : '2K',
                    SEEDREAM_45_CONSTRAINTS
                )

                return {
                    ...triggerValue,
                    width: size.width,
                    height: size.height
                }
            }
        }
    ],

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

            const requestData: Record<string, unknown> = {
                prompt: finalPrompt,
                watermark: false
            }

            // 处理分辨率
            if (params.resolution) {
                const resolution = params.resolution as SeedreamResolutionValue

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
                            SEEDREAM_45_CONSTRAINTS
                        )
                        requestData.size = `${size.width}x${size.height}`
                        logger.info(`[Seedream 4.5] 智能模式计算尺寸: ${sourceLabel} (${ratio.toFixed(2)}) -> ${size.width}x${size.height} (${quality})`)
                    } catch (error) {
                        logger.error('[Seedream 4.5] 智能模式计算尺寸失败:', error)
                    }
                }
                // 如果不是智能模式
                else if (resolution.aspectRatio !== 'smart') {
                    // 优先使用 resolution 中的 width/height
                    if (resolution.width && resolution.height) {
                        const size = normalizeSeedreamCustomSize(
                            resolution.width,
                            resolution.height,
                            SEEDREAM_45_CONSTRAINTS
                        )
                        requestData.size = `${size.width}x${size.height}`
                    }
                    // 如果 resolution 中没有 width/height，但是有直接传入的 size，使用它
                    else if (params.size) {
                        const normalizedSize = normalizeSeedreamSizeString(params.size, SEEDREAM_45_CONSTRAINTS)
                        if (normalizedSize) {
                            requestData.size = normalizedSize
                        }
                    }
                }
            }
            // 如果没有 resolution 参数，但是有直接传入的 size，使用它
            else if (params.size) {
                const normalizedSize = normalizeSeedreamSizeString(params.size, SEEDREAM_45_CONSTRAINTS)
                if (normalizedSize) {
                    requestData.size = normalizedSize
                }
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
            const quality = params.resolution?.quality || '2K'

            // 4K 分辨率翻倍
            const qualityMultiplier = quality === '4K' ? 2 : 1

            return basePrice * maxImages * qualityMultiplier
        },
        description: '基础价格 ¥0.15/张，4K分辨率翻倍'
    }
})

export default seedream45Model
