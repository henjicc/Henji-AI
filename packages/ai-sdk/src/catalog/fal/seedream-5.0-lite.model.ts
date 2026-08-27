import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
const SEEDREAM_LITE_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;
export const falSeedream50LiteModel = defineModel({
    meta: {
        id: 'fal-ai-seedream-5.0-lite', canonicalModelId: 'seedream-5.0-lite', seriesId: 'seedream', seriesRank: 5,
        provider: 'fal', type: 'image',
        tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-fal'],
        aliases: ['seedream-5-lite-fal'], polling: { interval: 3000, maxAttempts: 180, expectedAttempts: 35 }
    },
    inputLimits: { images: { max: 10 }, videos: { max: 0 } },
    params: [
        {
            id: 'falSeedream50LiteAspectRatio', type: 'dropdown', order: 1,
            default: 'smart',
            options: [{ value: 'smart' }, ...SEEDREAM_LITE_RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falSeedream50LiteResolution', type: 'dropdown', order: 2,
            default: '2K',
            options: ['2K', '3K', '4K'].map((value) => ({ value }))
        },
        {
            id: 'falSeedream50LiteNumImages', type: 'number', order: 3,
            default: 1, min: 1, max: 6, step: 1
        },
        {
            id: 'falSeedream50LiteMaxImages', type: 'number', order: 4,
            default: 1, min: 1, max: 6, step: 1
        }
    ],
    endpoints: {
        selector: async (params) => {
            const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : [];
            const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : []);
            return images.length > 0 ? 'bytedance/seedream/v5/lite/edit' : 'bytedance/seedream/v5/lite/text-to-image';
        }
    },
    request: {
        builder: (params) => {
            const clean = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
            const uploaded = clean(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : clean(params.images);
            const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16'];
            const raw = String(params.falSeedream50LiteAspectRatio || 'smart');
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
            const resolution = ['3K', '4K'].includes(String(params.falSeedream50LiteResolution)) ? String(params.falSeedream50LiteResolution) : '2K';
            let imageSize: JsonValue = `auto_${resolution}`;
            if (raw !== 'smart' && raw !== 'auto') {
                const longSide = resolution === '4K' ? 4096 : (resolution === '3K' ? 3072 : 2560);
                const pair = ratio.split(':').map(Number);
                const width = pair[0] >= pair[1] ? longSide : Math.round(longSide * pair[0] / pair[1]);
                const height = pair[1] >= pair[0] ? longSide : Math.round(longSide * pair[1] / pair[0]);
                imageSize = { width, height };
            }
            const body: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt : '',
                image_size: imageSize,
                num_images: Math.min(6, Math.max(1, Math.round(Number(params.falSeedream50LiteNumImages || 1)))),
                max_images: Math.min(6, Math.max(1, Math.round(Number(params.falSeedream50LiteMaxImages || 1)))),
                enable_safety_checker: true
            };
            if (images.length > 0)
                body.image_urls = images.slice(0, 10);
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const runs = Math.min(6, Math.max(1, Math.round(Number(params.falSeedream50LiteNumImages || 1))));
            const maximum = Math.min(6, Math.max(1, Math.round(Number(params.falSeedream50LiteMaxImages || 1))));
            return runs * maximum * 0.035;
        },
        description: '$0.035/张；多图模式按最多返回数量估算'
    }
});
export default falSeedream50LiteModel;
