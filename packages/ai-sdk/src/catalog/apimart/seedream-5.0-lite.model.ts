import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
const APIMART_IMAGE_ENDPOINT = '/v1/images/generations';
const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '21:9'] as const;
export const apimartSeedream50LiteModel = defineModel({
    meta: {
        id: 'apimart-seedream-5.0-lite', canonicalModelId: 'seedream-5.0-lite', seriesId: 'seedream', seriesRank: 5,
        provider: 'apimart', type: 'image',
        tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-14', 'multi-output', 'supports-4k', 'provider-apimart'],
        aliases: ['seedream-5-lite-apimart'], polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
    },
    inputLimits: { images: { max: 14 }, videos: { max: 0 } },
    params: [
        {
            id: 'apimartSeedream50LiteAspectRatio', type: 'dropdown', order: 1,
            default: 'smart',
            options: [{ value: 'smart' }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio }))]
        },
        {
            id: 'apimartSeedream50LiteResolution', type: 'dropdown', order: 2,
            default: '2K',
            options: ['2K', '3K', '4K'].map((value) => ({ value }))
        },
        {
            id: 'apimartSeedream50LiteCount', type: 'number', order: 3,
            default: 1, min: 1, max: 15, step: 1
        }
    ],
    endpoints: APIMART_IMAGE_ENDPOINT,
    request: {
        builder: (params) => {
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
            const uploaded = filterSources(params.uploadedFilePaths);
            const images = (uploaded.length > 0 ? uploaded : filterSources(params.images)).slice(0, 14);
            const supported = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '21:9'];
            const raw = String(params.apimartSeedream50LiteAspectRatio || 'smart');
            const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1;
            let size = supported.includes(raw) ? raw : '1:1';
            if (raw === 'smart' || raw === 'auto') {
                let difference = Number.POSITIVE_INFINITY;
                for (const candidate of supported) {
                    const pair = candidate.split(':').map(Number);
                    const next = Math.abs(pair[0] / pair[1] - hint);
                    if (next < difference) {
                        difference = next;
                        size = candidate;
                    }
                }
            }
            const requestedCount = Math.min(15, Math.max(1, Math.round(Number(params.apimartSeedream50LiteCount || 1))));
            const count = Math.max(1, Math.min(requestedCount, 15 - images.length));
            const resolution = ['3K', '4K'].includes(String(params.apimartSeedream50LiteResolution))
                ? String(params.apimartSeedream50LiteResolution) : '2K';
            const body: JsonObject = {
                model: 'seedream-5-0-lite', prompt: typeof params.prompt === 'string' ? params.prompt : '',
                size, resolution, n: count,
                sequential_image_generation: count > 1 ? 'auto' : 'disabled'
            };
            if (images.length > 0)
                body.image_urls = images;
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const images = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths.length : (Array.isArray(params.images) ? params.images.length : 0);
            const requested = Math.min(15, Math.max(1, Math.round(Number(params.apimartSeedream50LiteCount || 1))));
            return Math.max(1, Math.min(requested, 15 - Math.min(14, images))) * 0.0228;
        },
        description: '$0.0228/张；参考图数量与生成数量之和不超过 15'
    }
});
export default apimartSeedream50LiteModel;
