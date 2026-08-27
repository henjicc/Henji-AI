import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { resolveKieImageSources } from './mediaSources';
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';
export const kieGrokImagineVideoModel = defineModel({
    meta: {
        id: 'kie-grok-imagine-video',
        canonicalModelId: 'grok-imagine-video',
        provider: 'kie',
        type: 'video',
        tags: ['text-to-video', 'image-to-video', 'english-prompt-only', 'provider-kie'],
        aliases: ['grok-imagine-video-kie'],
        polling: {
            interval: 3000,
            maxAttempts: 120,
            expectedAttempts: 40
        }
    },
    inputLimits: {
        images: { max: 1 },
        videos: { max: 0 }
    },
    params: [
        {
            id: 'kieGrokImagineVideoAspectRatio',
            type: 'dropdown',
            order: 1,
            default: '2:3',
            options: [
                { value: '2:3' },
                { value: '3:2' },
                { value: '16:9' },
                { value: '9:16' },
                { value: '1:1' }
            ]
        },
        {
            id: 'kieGrokImagineVideoMode',
            type: 'dropdown',
            order: 2,
            default: 'normal',
            // 官方 mode 枚举是 fun / normal / spicy（默认 normal）
            options: [
                { value: 'fun' },
                { value: 'normal' },
                { value: 'spicy' }
            ]
        },
        {
            id: 'kieGrokImagineVideoDuration',
            type: 'number',
            order: 3,
            default: 6,
            min: 6,
            max: 30,
            step: 1
        },
        {
            id: 'kieGrokImagineVideoResolution',
            type: 'dropdown',
            order: 4,
            default: '480p',
            options: [
                { value: '480p' },
                { value: '720p' },
                { value: '1080p' }
            ]
        }
    ],
    endpoints: KIE_CREATE_TASK_ENDPOINT,
    request: {
        builder: (params) => {
            const images = resolveKieImageSources(params);
            const prompt = params.prompt || '';
            const hasImages = images.length > 0;
            const aspectRatio = params.kieGrokImagineVideoAspectRatio || params.aspect_ratio;
            const mode = params.kieGrokImagineVideoMode || params.mode;
            const duration = Math.min(30, Math.max(6, Math.round(Number(params.kieGrokImagineVideoDuration) || 6)));
            const resolution = params.kieGrokImagineVideoResolution || '480p';
            const model = hasImages
                ? 'grok-imagine/image-to-video'
                : 'grok-imagine/text-to-video';
            const input: JsonObject = { prompt, duration, resolution };
            if (!hasImages && aspectRatio) {
                input.aspect_ratio = aspectRatio;
            }
            if (hasImages) {
                input.image_urls = [images[0]];
            }
            if (mode) {
                input.mode = hasImages && mode === 'spicy' ? 'normal' : mode;
            }
            return {
                model,
                input
            };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const duration = Math.min(30, Math.max(6, Math.round(Number(params.kieGrokImagineVideoDuration) || 6)));
            const rate: Record<string, number> = { '480p': 0.012, '720p': 0.0225, '1080p': 0.04 };
            return (rate[params.kieGrokImagineVideoResolution as string] ?? rate['480p']) * duration;
        },
        description: '480p $0.012/秒，720p $0.0225/秒，1080p $0.04/秒'
    }
});
export default kieGrokImagineVideoModel;
