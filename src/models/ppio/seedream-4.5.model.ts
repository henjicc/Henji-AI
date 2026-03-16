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

import { defineModel } from '@/core'
import type { CompositePanelDef } from '@/core/types'

/**
 * 从 base64 或 URL 获取图片尺寸
 */
function getImageSize(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
            resolve({ width: img.width, height: img.height })
        }
        img.onerror = () => {
            reject(new Error('Failed to load image'))
        }
        img.src = src
    })
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
        },
        progress: {
            mode: 'time',
            baseDurationMs: 22000,
            perUnitMs: 16000,
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
            name: { key: 'auto.1', fallback: 'Resolution' },
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
                        { value: 'smart', label: { key: 'auto.2', fallback: 'Smart' } },
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
                        { value: '2K', label: { key: 'auto.3', fallback: 'HD 2K' } },
                        { value: '4K', label: { key: 'auto.4', fallback: 'UHD 4K' } }
                    ],
                    default: '2K'
                },
                customSize: {
                    enabled: true,
                    minWidth: 1920,
                    maxWidth: 4096,
                    minHeight: 1920,
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
            name: { key: 'auto.5', fallback: 'Quantity' },
            tooltip: { key: 'auto.6', fallback: 'Set to 1 to generate a single image; greater than 1 will generate multiple images. Total reference + generated images cannot exceed 15.' },
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
            name: { key: 'auto.7', fallback: 'Prompt Optimization' },
            tooltip: { key: 'auto.8', fallback: 'When enabled, the model will automatically optimize prompts for better generation results. Currently only supports standard mode.' },
            default: false
        }
    ],

    linkages: [
        // 当分辨率的 aspectRatio 或 quality 变化时，自动计算 width 和 height
        {
            trigger: 'resolution',
            effect: 'setValue',
            target: 'resolution',
            condition: (triggerValue: any) => {
                // 只在非智能模式下计算
                return triggerValue && triggerValue.aspectRatio && triggerValue.aspectRatio !== 'smart'
            },
            value: (triggerValue: any) => {
                const { aspectRatio, quality } = triggerValue

                // 解析宽高比
                const [w, h] = aspectRatio.split(':').map(Number)
                if (isNaN(w) || isNaN(h)) return triggerValue

                const ratio = w / h

                // 根据质量确定目标像素
                const targetPixels = quality === '4K' ? 16777216 : 4194304 // 4K: 4096*4096, 2K: 2048*2048

                // 派欧云 4.5 约束
                const constraints = {
                    minRatio: 1 / 16,
                    maxRatio: 16,
                    minPixels: 3686400,      // 约 1920*1920
                    absoluteMaxPixels: 16777216,  // 4096*4096
                    minSize: 1920
                }

                // 计算理想尺寸
                const targetHeight = Math.sqrt(targetPixels / ratio)
                const targetWidth = targetHeight * ratio

                let width = Math.round(targetWidth)
                let height = Math.round(targetHeight)

                // 确保不小于目标像素数
                let currentPixels = width * height
                while (currentPixels < targetPixels && currentPixels < constraints.absoluteMaxPixels) {
                    const withExtraWidth = (width + 1) * height
                    const withExtraHeight = width * (height + 1)

                    if (withExtraWidth <= constraints.absoluteMaxPixels && withExtraHeight <= constraints.absoluteMaxPixels) {
                        if (Math.abs(withExtraWidth - targetPixels) < Math.abs(withExtraHeight - targetPixels)) {
                            width += 1
                            currentPixels = withExtraWidth
                        } else {
                            height += 1
                            currentPixels = withExtraHeight
                        }
                    } else if (withExtraWidth <= constraints.absoluteMaxPixels) {
                        width += 1
                        currentPixels = withExtraWidth
                    } else if (withExtraHeight <= constraints.absoluteMaxPixels) {
                        height += 1
                        currentPixels = withExtraHeight
                    } else {
                        break
                    }
                }

                // 确保不超过最大允许像素
                if (currentPixels > constraints.absoluteMaxPixels) {
                    const scale = Math.sqrt(constraints.absoluteMaxPixels / currentPixels)
                    width = Math.round(width * scale)
                    height = Math.round(height * scale)
                }

                // 确保最小尺寸（4.5 要求更高的最小像素）
                if (width < constraints.minSize) width = constraints.minSize
                if (height < constraints.minSize) height = constraints.minSize

                // 验证宽高比是否在范围内
                const finalRatio = width / height
                if (finalRatio < constraints.minRatio || finalRatio > constraints.maxRatio) {
                    return triggerValue
                }

                return {
                    ...triggerValue,
                    width,
                    height
                }
            }
        }
    ],

    endpoints: '/seedream-4.5',

    request: {
        builder: async (params) => {
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
                const resolution = params.resolution

                // 智能模式：有图按首图比例，无图按 1:1
                if (resolution.aspectRatio === 'smart') {
                    try {
                        const hasImages = params.images && params.images.length > 0
                        let ratio = 1
                        let sourceLabel = '1:1 默认'

                        if (hasImages) {
                            const imageSize = await getImageSize(params.images[0])
                            ratio = imageSize.width / imageSize.height
                            sourceLabel = `${imageSize.width}x${imageSize.height}`
                        }
                        const quality = resolution.quality || '2K'
                        const targetPixels = quality === '4K' ? 16777216 : 4194304

                        // 派欧云 4.5 约束
                        const constraints = {
                            minRatio: 1 / 16,
                            maxRatio: 16,
                            minPixels: 3686400,
                            absoluteMaxPixels: 16777216,
                            minSize: 1920
                        }

                        // 计算理想尺寸
                        const targetHeight = Math.sqrt(targetPixels / ratio)
                        const targetWidth = targetHeight * ratio

                        let width = Math.round(targetWidth)
                        let height = Math.round(targetHeight)

                        // 确保不小于目标像素数
                        let currentPixels = width * height
                        while (currentPixels < targetPixels && currentPixels < constraints.absoluteMaxPixels) {
                            const withExtraWidth = (width + 1) * height
                            const withExtraHeight = width * (height + 1)

                            if (withExtraWidth <= constraints.absoluteMaxPixels && withExtraHeight <= constraints.absoluteMaxPixels) {
                                if (Math.abs(withExtraWidth - targetPixels) < Math.abs(withExtraHeight - targetPixels)) {
                                    width += 1
                                    currentPixels = withExtraWidth
                                } else {
                                    height += 1
                                    currentPixels = withExtraHeight
                                }
                            } else if (withExtraWidth <= constraints.absoluteMaxPixels) {
                                width += 1
                                currentPixels = withExtraWidth
                            } else if (withExtraHeight <= constraints.absoluteMaxPixels) {
                                height += 1
                                currentPixels = withExtraHeight
                            } else {
                                break
                            }
                        }

                        // 确保不超过最大允许像素
                        if (currentPixels > constraints.absoluteMaxPixels) {
                            const scale = Math.sqrt(constraints.absoluteMaxPixels / currentPixels)
                            width = Math.round(width * scale)
                            height = Math.round(height * scale)
                        }

                        // 确保最小尺寸
                        if (width < constraints.minSize) width = constraints.minSize
                        if (height < constraints.minSize) height = constraints.minSize

                        // 验证宽高比是否在范围内
                        const finalRatio = width / height
                        if (finalRatio >= constraints.minRatio && finalRatio <= constraints.maxRatio) {
                            requestData.size = `${width}x${height}`
                            console.log(`[Seedream 4.5] 智能模式计算尺寸: ${sourceLabel} (${ratio.toFixed(2)}) -> ${width}x${height} (${quality})`)
                        }
                    } catch (error) {
                        console.error('[Seedream 4.5] 智能模式计算尺寸失败:', error)
                    }
                }
                // 如果不是智能模式
                else if (resolution.aspectRatio !== 'smart') {
                    // 优先使用 resolution 中的 width/height
                    if (resolution.width && resolution.height) {
                        requestData.size = `${resolution.width}x${resolution.height}`
                    }
                    // 如果 resolution 中没有 width/height，但是有直接传入的 size，使用它
                    else if (params.size) {
                        requestData.size = params.size
                    }
                }
            }
            // 如果没有 resolution 参数，但是有直接传入的 size，使用它
            else if (params.size) {
                requestData.size = params.size
            }

            // 处理图片上传（4.5 使用 image 字段，而非 images）
            if (params.images && params.images.length > 0) {
                requestData.image = params.images
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
