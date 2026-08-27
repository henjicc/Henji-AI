import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
export const klingImageO1Model = defineModel({
    meta: {
        id: 'fal-ai-kling-image-o1',
        canonicalModelId: 'kling-image-o1',
        provider: 'fal',
        type: 'image',
        tags: ['image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-10', 'provider-fal']
    },
    inputLimits: {
        images: { min: 1, max: 10 },
        videos: { max: 0 }
    },
    params: [
        // 1. 生成数量
        {
            id: 'falKlingImageO1NumImages',
            order: 1,
            type: 'number',
            default: 1,
            min: 1,
            max: 9
        },
        // 2. 宽高比
        {
            id: 'falKlingImageO1AspectRatio',
            order: 2,
            type: 'dropdown',
            default: '1:1',
            options: [
                { value: 'auto' },
                { value: '1:1' },
                { value: '16:9' },
                { value: '9:16' },
                { value: '4:3' },
                { value: '3:4' },
                { value: '3:2' },
                { value: '2:3' },
                { value: '21:9' }
            ]
        },
        // 3. 分辨率
        {
            id: 'falKlingImageO1Resolution',
            order: 3,
            type: 'dropdown',
            default: '1K',
            options: [
                { value: '1K' },
                { value: '2K' }
            ]
        }
    ],
    endpoints: {
        selector: async () => 'fal-ai/kling-image/o1'
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
                prompt,
                image_urls: images
            };
            const requestedImages = Number(params.falKlingImageO1NumImages || 0);
            if (requestedImages > 0) {
                requestData.num_images = requestedImages;
            }
            const aspectRatio = params.falKlingImageO1AspectRatio;
            if (aspectRatio && aspectRatio !== 'auto') {
                requestData.aspect_ratio = aspectRatio;
            }
            const resolution = params.falKlingImageO1Resolution;
            if (resolution) {
                requestData.resolution = resolution;
            }
            return requestData;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const numImages = Number(params.falKlingImageO1NumImages) || 1;
            return 0.028 * numImages;
        },
        description: '$0.028/张'
    }
});
export default klingImageO1Model;
