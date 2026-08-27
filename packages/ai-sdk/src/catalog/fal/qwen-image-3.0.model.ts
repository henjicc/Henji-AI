import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { FAL_COMMON_IMAGE_RATIOS, falOneMegapixelSize } from './imageSizing';
const QWEN_IMAGE_3_RATIOS = FAL_COMMON_IMAGE_RATIOS;
export const falQwenImage30Model = defineModel({
    meta: {
        id: 'fal-ai-qwen-image-3.0', canonicalModelId: 'qwen-image-3.0', seriesId: 'qwen-image', seriesRank: 3,
        provider: 'fal', type: 'image',
        tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-prompt-expansion', 'provider-fal'],
        aliases: ['qwen-image-3-fal'], polling: { interval: 3000, maxAttempts: 180, expectedAttempts: 35 }
    },
    inputLimits: { images: { max: 3 }, videos: { max: 0 } },
    params: [
        {
            id: 'falQwenImage30AspectRatio', type: 'dropdown', order: 1,
            default: 'smart',
            options: [{ value: 'smart' }, ...QWEN_IMAGE_3_RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falQwenImage30Resolution', type: 'dropdown', order: 2,
            default: '1K',
            options: ['1K', '2K', '1MP'].map((value) => ({ value }))
        },
        {
            id: 'falQwenImage30NumImages', type: 'number', order: 3,
            default: 1, min: 1, max: 6, step: 1
        },
        {
            id: 'falQwenImage30PromptExpansion', type: 'switch', order: 4,
            default: true
        }
    ],
    endpoints: {
        selector: async (params) => {
            const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : [];
            const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : []);
            return images.length > 0 ? 'alibaba/qwen-image-3/edit' : 'alibaba/qwen-image-3/text-to-image';
        }
    },
    request: {
        builder: (params) => {
            const clean = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
            const uploaded = clean(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : clean(params.images);
            const ratios: readonly string[] = FAL_COMMON_IMAGE_RATIOS;
            const raw = String(params.falQwenImage30AspectRatio || 'smart');
            const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1;
            let ratio = ratios.includes(raw) ? raw : '1:1';
            if (raw === 'smart' || raw === 'auto') {
                let difference = Number.POSITIVE_INFINITY;
                for (const candidate of ratios) {
                    const pair = candidate.split(':').map(Number);
                    const next = Math.abs(pair[0] / pair[1] - hint);
                    if (next < difference) {
                        difference = next;
                        ratio = candidate;
                    }
                }
            }
            const pair = ratio.split(':').map(Number);
            const oneMegapixel = params.falQwenImage30Resolution === '1MP';
            const longSide = params.falQwenImage30Resolution === '2K' ? 2048 : 1024;
            let width = pair[0] >= pair[1] ? longSide : Math.round(longSide * pair[0] / pair[1]);
            let height = pair[1] >= pair[0] ? longSide : Math.round(longSide * pair[1] / pair[0]);
            width = Math.max(384, Math.round(width / 16) * 16);
            height = Math.max(384, Math.round(height / 16) * 16);
            const body: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 5000) : '',
                enable_prompt_expansion: params.falQwenImage30PromptExpansion !== false,
                enable_safety_checker: true,
                num_images: Math.min(6, Math.max(1, Math.round(Number(params.falQwenImage30NumImages || 1))))
            };
            if (!(oneMegapixel && images.length > 0)) {
                body.image_size = oneMegapixel ? falOneMegapixelSize(ratio) : { width, height };
            }
            if (images.length > 0)
                body.image_urls = images.slice(0, 3);
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const count = Math.min(6, Math.max(1, Math.round(Number(params.falQwenImage30NumImages || 1))));
            return count * (params.falQwenImage30Resolution === '2K' ? 0.075 : 0.04);
        },
        description: '1K $0.04/张，2K $0.075/张'
    }
});
export default falQwenImage30Model;
