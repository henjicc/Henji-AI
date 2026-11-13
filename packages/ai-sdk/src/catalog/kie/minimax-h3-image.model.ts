import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { countUploadedImages, resolveKieImageSources } from './mediaSources';

// 字段与价格来源：docs/model-adaptation/MiniMax-H3-Image/MiniMax-H3-Image_KIE.md（KIE 文档与 kie.ai/pricing，2026-11-14 读取）
const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
const RESOLUTIONS = ['1K', '2K', '4K'] as const;
// 1 credit = $0.005：1K/2K 1.8 credits、4K 5.5 credits 每张；编辑时每张参考图（含第一张）另计 0.5 credit。
const OUTPUT_PRICE: Record<string, number> = { '1K': 0.009, '2K': 0.009, '4K': 0.0275 };
const REFERENCE_IMAGE_PRICE = 0.0025;

const resolution = (params: JsonObject): string =>
    RESOLUTIONS.includes(params.kieMiniMaxH3ImageResolution as typeof RESOLUTIONS[number]) ? String(params.kieMiniMaxH3ImageResolution) : '2K';

export const kieMiniMaxH3ImageModel = defineModel({
    meta: {
        id: 'kie-minimax-h3-image', canonicalModelId: 'minimax-h3-image', seriesId: 'minimax-image', seriesRank: 3,
        provider: 'kie', type: 'image',
        tags: ['text-to-image', 'image-to-image'],
        polling: { interval: 3000, maxAttempts: 200 }
    },
    inputLimits: { images: { max: 16 }, videos: { max: 0 } },
    params: [
        {
            id: 'kieMiniMaxH3ImageAspectRatio', type: 'dropdown', order: 1,
            default: 'smart',
            options: [{ value: 'smart' }, ...RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'kieMiniMaxH3ImageResolution', type: 'dropdown', order: 2,
            default: '2K',
            options: RESOLUTIONS.map((value) => ({ value }))
        },
        {
            id: 'kieMiniMaxH3ImagePromptExpansion', type: 'switch', order: 3,
            default: true
        }
    ],
    endpoints: '/api/v1/jobs/createTask',
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
            if (!prompt)
                throw new Error('MiniMax H3 Image 的提示词不能为空');
            if (prompt.length > 5000)
                throw new Error('MiniMax H3 Image 提示词最多 5000 字符');
            const images = resolveKieImageSources(params);
            if (images.length > 16)
                throw new Error('MiniMax H3 Image 最多接受 16 张参考图');
            const raw = String(params.kieMiniMaxH3ImageAspectRatio || 'smart');
            const ratios: readonly string[] = RATIOS;
            // 智能比例：编辑时交给官方 auto（跟随第一张参考图的任意比例），文生图用 1:1。
            const input: JsonObject = {
                prompt,
                aspect_ratio: ratios.includes(raw) ? raw : (images.length > 0 ? 'auto' : '1:1'),
                resolution: resolution(params),
                expand_prompt: params.kieMiniMaxH3ImagePromptExpansion !== false
            };
            if (images.length > 0)
                input.image_urls = images;
            return {
                model: images.length > 0 ? 'minimax-h3/image-edit' : 'minimax-h3/text-to-image',
                input
            };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => OUTPUT_PRICE[resolution(params)] + countUploadedImages(params) * REFERENCE_IMAGE_PRICE,
        description: '每次出 1 张：1K/2K $0.009、4K $0.0275；编辑时每张参考图另加 $0.0025'
    }
});
export default kieMiniMaxH3ImageModel;
