import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { hasUploadedImage } from './mediaSources';
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';
export const kieKling30TurboModel = defineModel({
    meta: {
        id: 'kie-kling-3.0-turbo',
        canonicalModelId: 'kling-video-3.0-turbo',
        seriesId: 'kling-video',
        seriesRank: 3.01,
        provider: 'kie',
        type: 'video',
        tags: ['text-to-video', 'image-to-video', 'turbo-mode', 'provider-kie'],
        polling: { interval: 3000, maxAttempts: 240, expectedAttempts: 70 }
    },
    inputLimits: {
        images: { max: 1 },
        videos: { max: 0 }
    },
    params: [
        {
            id: 'kieKling30TurboAspectRatio',
            type: 'dropdown',
            order: 1,
            default: 'smart',
            visible: {
                condition: (params) => !hasUploadedImage(params)
            },
            options: [
                { value: 'smart' },
                { value: '16:9' },
                { value: '9:16' },
                { value: '1:1' }
            ]
        },
        {
            id: 'kieKling30TurboResolution',
            type: 'dropdown',
            order: 2,
            default: '720p',
            options: [
                { value: '720p' },
                { value: '1080p' }
            ]
        },
        {
            id: 'kieKling30TurboDuration',
            type: 'dropdown',
            order: 3,
            default: '5',
            options: Array.from({ length: 13 }, (_, index) => {
                const value = String(index + 3);
                return { value };
            })
        }
    ],
    endpoints: KIE_CREATE_TASK_ENDPOINT,
    request: {
        builder: (params) => {
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const uploadedImages = filterSources(params.uploadedFilePaths);
            const images = uploadedImages.length > 0 ? uploadedImages : filterSources(params.images);
            const input: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 2500) : '',
                duration: String(params.kieKling30TurboDuration || '5'),
                resolution: params.kieKling30TurboResolution === '1080p' ? '1080p' : '720p'
            };
            if (images.length > 0) {
                input.image_urls = images.slice(0, 1);
                return { model: 'kling/v3-turbo-image-to-video', input };
            }
            const rawAspectRatio = String(params.kieKling30TurboAspectRatio || 'smart');
            input.aspect_ratio = rawAspectRatio === '9:16' || rawAspectRatio === '1:1'
                ? rawAspectRatio
                : '16:9';
            return { model: 'kling/v3-turbo-text-to-video', input };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const duration = Math.min(15, Math.max(3, Number(params.kieKling30TurboDuration || 5)));
            const rate = params.kieKling30TurboResolution === '1080p' ? 0.1125 : 0.09;
            return duration * rate;
        },
        description: '720p $0.09/秒；1080p $0.1125/秒'
    }
});
export default kieKling30TurboModel;
