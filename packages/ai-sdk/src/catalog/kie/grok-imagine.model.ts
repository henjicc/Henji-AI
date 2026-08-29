import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';
export const kieGrokImagineModel = defineModel({
    meta: {
        id: 'kie-grok-imagine',
        canonicalModelId: 'grok-imagine-image',
        provider: 'kie',
        type: 'image',
        tags: ['text-to-image', 'provider-kie'],
        aliases: ['grok-imagine-kie']
    },
    inputLimits: {
        images: { max: 0 },
        videos: { max: 0 },
        rules: [
            { when: 'kieGrokImagineMode === "image-to-image"', images: { exact: 1 } }
        ]
    },
    requirements: [
        {
            id: 'kie-grok-imagine-image-to-image',
            when: 'kieGrokImagineMode === "image-to-image"',
            require: { images: { exact: 1 } },
            message: {
                title: '需要一张图片',
                message: '图生图模式需要且只能输入 1 张图片。',
                type: 'warning'
            }
        }
    ],
    params: [
        {
            id: 'kieGrokImagineMode',
            type: 'dropdown',
            order: 1,
            default: 'text-to-image',
            options: [
                { value: 'text-to-image' },
                { value: 'image-to-image' }
            ]
        },
        {
            id: 'kieGrokImagineQuality',
            type: 'dropdown',
            order: 2,
            default: 'standard',
            visible: { condition: 'kieGrokImagineMode !== "image-to-image"' },
            options: [
                { value: 'standard' },
                { value: 'quality' }
            ]
        },
        {
            id: 'kieGrokImagineAspectRatio',
            type: 'dropdown',
            order: 3,
            default: '1:1',
            options: [
                { value: '1:1' },
                { value: '2:3' },
                { value: '3:2' },
                { value: '9:16' },
                { value: '16:9' }
            ]
        }
    ],
    endpoints: KIE_CREATE_TASK_ENDPOINT,
    request: {
        builder: (params) => {
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const uploaded = filterSources(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : filterSources(params.images);
            const prompt = params.prompt || '';
            const aspectRatio = params.kieGrokImagineAspectRatio || params.aspect_ratio;
            const mode = params.kieGrokImagineMode === 'image-to-image' ? 'image-to-image' : 'text-to-image';
            const input: JsonObject = { prompt };
            if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
                input.aspect_ratio = aspectRatio;
            }
            if (mode === 'image-to-image') {
                if (images.length > 0)
                    input.image_urls = images.slice(0, 1);
                return { model: 'grok-imagine/image-to-image', input };
            }
            input.enable_pro = params.kieGrokImagineQuality === 'quality';
            return {
                model: 'grok-imagine/text-to-image',
                input
            };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const mode = params.kieGrokImagineMode === 'image-to-image' ? 'image-to-image' : 'text-to-image';
            if (mode === 'image-to-image')
                return 0.02;
            return params.kieGrokImagineQuality === 'quality' ? 0.025 : 0.02;
        },
        description: '文生图：标准 $0.02/次（输出 2 张），质量 $0.025/次（输出 4 张）；图生图：$0.02/张'
    }
});
export default kieGrokImagineModel;
