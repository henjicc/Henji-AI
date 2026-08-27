import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
const GROK_RATIOS = ['2:1', '20:9', '19.5:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:19.5', '9:20', '1:2'] as const;
export const falGrokImagine20Model = defineModel({
    meta: {
        id: 'fal-ai-grok-imagine-2.0', canonicalModelId: 'grok-imagine-image-2.0', seriesId: 'grok-imagine-image', seriesRank: 2,
        provider: 'fal', type: 'image',
        tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'provider-fal'],
        aliases: ['grok-imagine-image-2-fal'], polling: { interval: 3000, maxAttempts: 180, expectedAttempts: 35 }
    },
    inputLimits: { images: { max: 3 }, videos: { max: 0 } },
    params: [
        {
            id: 'falGrokImagine20AspectRatio', type: 'dropdown', order: 1,
            default: 'smart',
            options: [{ value: 'smart' }, ...GROK_RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falGrokImagine20Resolution', type: 'dropdown', order: 2,
            default: '1K',
            options: ['1K', '2K'].map((value) => ({ value }))
        },
        {
            id: 'falGrokImagine20Quality', type: 'dropdown', order: 3,
            default: 'medium',
            options: [{ value: 'low' }, { value: 'medium' }]
        },
        {
            id: 'falGrokImagine20NumImages', type: 'number', order: 4,
            default: 1, min: 1, max: 4, step: 1
        }
    ],
    endpoints: {
        selector: async (params) => {
            const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : [];
            const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : []);
            return images.length > 0 ? 'xai/grok-imagine-image/v2.0/edit' : 'xai/grok-imagine-image/v2.0/text-to-image';
        }
    },
    request: {
        builder: (params) => {
            const clean = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
            const uploaded = clean(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : clean(params.images);
            const supported = ['2:1', '20:9', '19.5:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:19.5', '9:20', '1:2'];
            const raw = String(params.falGrokImagine20AspectRatio || 'smart');
            const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1;
            let ratio = supported.includes(raw) ? raw : '1:1';
            if (raw === 'smart' || raw === 'auto') {
                let difference = Number.POSITIVE_INFINITY;
                for (const candidate of supported) {
                    const pair = candidate.split(':').map(Number);
                    const next = Math.abs(pair[0] / pair[1] - hint);
                    if (next < difference) {
                        difference = next;
                        ratio = candidate;
                    }
                }
            }
            const body: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt : '',
                aspect_ratio: images.length > 0 && raw === 'smart' ? 'auto' : ratio,
                resolution: params.falGrokImagine20Resolution === '2K' ? '2k' : '1k',
                quality: params.falGrokImagine20Quality === 'low' ? 'low' : 'medium',
                num_images: Math.min(4, Math.max(1, Math.round(Number(params.falGrokImagine20NumImages || 1))))
            };
            if (images.length > 0)
                body.image_urls = images.slice(0, 3);
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const resolution = params.falGrokImagine20Resolution === '2K' ? '2K' : '1K';
            const quality = params.falGrokImagine20Quality === 'low' ? 'low' : 'medium';
            const prices: Record<string, number> = { '1K-low': 0.04, '1K-medium': 0.06, '2K-low': 0.06, '2K-medium': 0.08 };
            const count = Math.min(4, Math.max(1, Math.round(Number(params.falGrokImagine20NumImages || 1))));
            const inputs = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths.length : (Array.isArray(params.images) ? params.images.length : 0);
            return count * (prices[`${resolution}-${quality}`] ?? 0.06) + inputs * 0.01;
        },
        description: '1K $0.04/$0.06、2K $0.06/$0.08（低/标准）；编辑另加 $0.01/输入图'
    }
});
export default falGrokImagine20Model;
