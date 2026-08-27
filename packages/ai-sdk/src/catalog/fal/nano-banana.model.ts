import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
export const nanoBananaModel = defineModel({
    meta: {
        id: 'fal-ai-nano-banana',
        canonicalModelId: 'nano-banana',
        seriesId: 'nano-banana',
        seriesRank: 1,
        provider: 'fal',
        type: 'image',
        tags: ['image', 'text-to-image', 'image-to-image']
    },
    params: [
        // 1. 生成数量
        {
            id: 'falNanoBananaNumImages',
            order: 1,
            type: 'number',
            default: 1,
            min: 1,
            max: 4
        },
        // 2. 宽高比
        {
            id: 'falNanoBananaAspectRatio',
            order: 2,
            type: 'dropdown',
            default: '1:1',
            options: [
                { value: 'smart' },
                { value: '1:1' },
                { value: '16:9' },
                { value: '9:16' },
                { value: '21:9' },
                { value: '3:2' },
                { value: '2:3' },
                { value: '4:3' },
                { value: '3:4' },
                { value: '5:4' },
                { value: '4:5' }
            ]
        }
    ],
    endpoints: {
        selector: async (params) => {
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const uploaded = filterSources(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : filterSources(params.images);
            return images.length > 0 ? 'fal-ai/nano-banana/edit' : 'fal-ai/nano-banana';
        }
    },
    request: {
        builder: (params) => {
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const uploaded = filterSources(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : filterSources(params.images);
            const prompt = params.prompt || '';
            const requestData: JsonObject = {
                prompt
            };
            if (params.falNanoBananaNumImages !== undefined) {
                requestData.num_images = params.falNanoBananaNumImages;
            }
            const aspectRatio = params.falNanoBananaAspectRatio;
            if (aspectRatio && aspectRatio !== 'auto' && aspectRatio !== 'smart') {
                requestData.aspect_ratio = aspectRatio;
            }
            if (images.length > 0) {
                requestData.image_urls = images;
            }
            return requestData;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const numImages = Number(params.falNanoBananaNumImages) || 1;
            return 0.039 * numImages;
        },
        description: '$0.039/张'
    }
});
export default nanoBananaModel;
