import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { hasUploadedImage, resolveUploadedImageSources } from "../shared/mediaPresence";

// 价格与字段来源：docs/model-adaptation/FLUX-3/FLUX-3_Fal.md（Fal 模型页与 OpenAPI，2026-11-07 读取）。
// Fal 按百万像素计费（$0.048/MP），页面只公布 1K=1MP；其余档位按档位边长的正方形像素数估算。
const RATIOS = ['21:9', '2:1', '16:9', '3:2', '7:5', '4:3', '5:4', '1:1', '4:5', '3:4', '5:7', '2:3', '9:16', '1:2'];
const RESOLUTIONS = ['768sq', '1k', '1.5k', '2k', '4k'];
const MEGAPIXELS: Record<string, number> = { '768sq': 0.5898, '1k': 1, '1.5k': 2.25, '2k': 4, '4k': 16 };

function resolution(params: JsonObject): string {
    return RESOLUTIONS.includes(String(params.falFlux3Resolution)) ? String(params.falFlux3Resolution) : '1k';
}

function ratio(params: JsonObject): string {
    const raw = String(params.falFlux3AspectRatio || 'smart');
    if (RATIOS.includes(raw))
        return raw;
    // 编辑时交给平台按第一张参考图自适应；纯文生图回退 1:1。
    return hasUploadedImage(params) ? 'auto' : '1:1';
}

export const falFlux3Model = defineModel({
    meta: {
        id: 'fal-ai-flux-3', canonicalModelId: 'flux-3', seriesId: 'flux', seriesRank: 3,
        provider: 'fal', type: 'image',
        tags: ['text-to-image', 'image-to-image'],
        polling: { interval: 2000, maxAttempts: 300, expectedAttempts: 15 }
    },
    inputLimits: { images: { max: 10 }, videos: { max: 0 } },
    params: [
        {
            id: 'falFlux3AspectRatio', type: 'dropdown', order: 1,
            default: 'smart',
            options: [{ value: 'smart' }, ...RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falFlux3Resolution', type: 'dropdown', order: 2,
            default: '1k',
            options: RESOLUTIONS.map((value) => ({ value }))
        },
        {
            id: 'falFlux3PromptExpansion', type: 'switch', order: 3,
            default: false
        }
    ],
    endpoints: {
        selector: async (params) => hasUploadedImage(params) ? 'blackforestlabs/flux-3/edit-image' : 'blackforestlabs/flux-3/text-to-image'
    },
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
            if (!prompt)
                throw new Error('FLUX 3 的提示词不能为空');
            const body: JsonObject = {
                prompt,
                resolution: resolution(params),
                aspect_ratio: ratio(params),
                enable_prompt_expansion: params.falFlux3PromptExpansion === true
            };
            const images = resolveUploadedImageSources(params);
            if (images.length > 0)
                body.image_urls = images.slice(0, 10);
            return body;
        }
    },
    pricing: {
        currency: '$',
        billingMode: 'estimated',
        calculator: (params) => 0.048 * MEGAPIXELS[resolution(params)],
        description: '$0.048/百万像素（1K 约 $0.048/张）；其余档位按像素数估算'
    }
});
export default falFlux3Model;
