import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
export const falKling30TurboModel = defineModel({
    meta: {
        id: 'fal-ai-kling-3.0-turbo', canonicalModelId: 'kling-video-3.0-turbo', seriesId: 'kling-video', seriesRank: 3.01,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'fast-mode', 'provider-fal'],
        aliases: ['kling-v3-turbo-fal'], polling: { interval: 3000, maxAttempts: 280, expectedAttempts: 65 }
    },
    inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } },
    params: [
        {
            id: 'falKling30TurboAspectRatio', type: 'dropdown', order: 1,
            default: 'smart',
            options: [
                { value: 'smart' },
                { value: '16:9' }, { value: '9:16' }, { value: '1:1' }
            ]
        },
        {
            id: 'falKling30TurboResolution', type: 'dropdown', order: 2,
            default: 'standard',
            options: [
                { value: 'standard' },
                { value: 'pro' }
            ]
        },
        {
            id: 'falKling30TurboDuration', type: 'number', order: 3,
            default: 5, min: 3, max: 15, step: 1
        }
    ],
    endpoints: {
        selector: async (params) => {
            const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : [];
            const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : []);
            const tier = params.falKling30TurboResolution === 'pro' ? 'pro' : 'standard';
            return `fal-ai/kling-video/v3/turbo/${tier}/${images.length > 0 ? 'image-to-video' : 'text-to-video'}`;
        }
    },
    request: {
        builder: (params) => {
            const clean = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
            const uploaded = clean(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : clean(params.images);
            const raw = String(params.falKling30TurboAspectRatio || 'smart');
            const body: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 2500) : '',
                duration: String(Math.min(15, Math.max(3, Math.round(Number(params.falKling30TurboDuration || 5)))))
            };
            if (images.length > 0)
                body.image_url = images[0];
            else
                body.aspect_ratio = ['9:16', '1:1'].includes(raw) ? raw : '16:9';
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const duration = Math.min(15, Math.max(3, Math.round(Number(params.falKling30TurboDuration || 5))));
            return duration * (params.falKling30TurboResolution === 'pro' ? 0.14 : 0.112);
        },
        description: 'Turbo 标准 $0.112/秒，Turbo 专业 $0.14/秒'
    }
});
export default falKling30TurboModel;
