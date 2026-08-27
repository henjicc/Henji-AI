import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { countUploadedImages } from './mediaSources';
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';
const SUPPORTED_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'] as const;
export const kieSeedream50ProModel = defineModel({
    meta: {
        id: 'kie-seedream-5.0-pro',
        canonicalModelId: 'seedream-5.0-pro',
        seriesId: 'seedream',
        seriesRank: 5.0,
        provider: 'kie',
        type: 'image',
        tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-10', 'provider-kie'],
        aliases: ['seedream-5-pro-kie']
    },
    inputLimits: {
        images: { max: 10 },
        videos: { max: 0 },
        rules: [
            { when: 'kieSeedream50ProMode === "layer-decomposition"', images: { min: 1, max: 1 } }
        ]
    },
    requirements: [
        {
            id: 'kie-seedream-5-pro-layer-single-image',
            when: 'kieSeedream50ProMode === "layer-decomposition"',
            require: { images: { exact: 1 } },
            message: {
                title: '需要一张图片',
                message: '图层拆分模式必须且只能输入 1 张图片。',
                type: 'warning'
            }
        }
    ],
    params: [
        {
            id: 'kieSeedream50ProMode',
            type: 'dropdown',
            order: 1,
            default: 'generate',
            options: [
                { value: 'generate' },
                { value: 'layer-decomposition' }
            ]
        },
        {
            id: 'kieSeedream50ProAspectRatio',
            type: 'dropdown',
            order: 2,
            default: 'smart',
            visible: { condition: 'kieSeedream50ProMode !== "layer-decomposition"' },
            options: [
                { value: 'smart' },
                ...SUPPORTED_ASPECT_RATIOS.map((ratio) => ({ value: ratio }))
            ]
        },
        {
            id: 'kieSeedream50ProResolution',
            type: 'dropdown',
            order: 3,
            default: '1K',
            visible: { condition: 'kieSeedream50ProMode !== "layer-decomposition"' },
            options: [
                { value: '1K' },
                { value: '2K' }
            ]
        },
        {
            id: 'kieSeedream50ProLayerSize',
            type: 'dropdown',
            order: 4,
            default: 'auto',
            visible: { condition: 'kieSeedream50ProMode === "layer-decomposition"' },
            options: [
                { value: 'auto' },
                { value: '1K' },
                { value: '1.5K' },
                { value: '2K' }
            ]
        }
    ],
    endpoints: KIE_CREATE_TASK_ENDPOINT,
    request: {
        builder: (params) => {
            const supportedAspectRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'];
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const resolveImages = (): string[] => {
                const uploaded = filterSources(params.uploadedFilePaths);
                return uploaded.length > 0 ? uploaded : filterSources(params.images);
            };
            const parseRatio = (value: string): number | null => {
                const parts = value.split(':').map(Number);
                return parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[0] > 0 && parts[1] > 0
                    ? parts[0] / parts[1]
                    : null;
            };
            const resolveClosestAspectRatio = (targetRatio: number): string => {
                let closest = '1:1';
                let smallestDifference = Number.POSITIVE_INFINITY;
                for (const candidate of supportedAspectRatios) {
                    const candidateRatio = parseRatio(candidate);
                    if (candidateRatio === null)
                        continue;
                    const difference = Math.abs(candidateRatio - targetRatio);
                    if (difference < smallestDifference) {
                        closest = candidate;
                        smallestDifference = difference;
                    }
                }
                return closest;
            };
            const legacyResolution = params.resolution && typeof params.resolution === 'object'
                ? params.resolution as JsonObject
                : {};
            const rawAspectRatio = typeof params.kieSeedream50ProAspectRatio === 'string'
                ? params.kieSeedream50ProAspectRatio
                : (typeof legacyResolution.aspectRatio === 'string' ? legacyResolution.aspectRatio : 'smart');
            const imageRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
                ? params.__firstImageRatio
                : 1;
            const aspectRatio = rawAspectRatio === 'smart' || rawAspectRatio === 'auto' || rawAspectRatio.length === 0
                ? resolveClosestAspectRatio(imageRatioHint)
                : rawAspectRatio;
            const rawResolution = params.kieSeedream50ProResolution ?? legacyResolution.quality;
            const quality = rawResolution === '2K' || rawResolution === 'high' ? 'high' : 'basic';
            const images = resolveImages();
            if (params.kieSeedream50ProMode === 'layer-decomposition') {
                if (images.length !== 1)
                    throw new Error('Seedream 5.0 Pro 图层拆分模式必须且只能输入 1 张图片');
                const rawLayerSize = String(params.kieSeedream50ProLayerSize || 'auto');
                return {
                    model: 'seedream/5-pro-layer-decomposition',
                    input: {
                        prompt: typeof params.prompt === 'string' ? params.prompt : '',
                        image_url: images[0],
                        size: ['auto', '1K', '1.5K', '2K'].includes(rawLayerSize) ? rawLayerSize : 'auto'
                    }
                };
            }
            const input: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt : '',
                aspect_ratio: supportedAspectRatios.includes(aspectRatio) ? aspectRatio : '1:1',
                quality
            };
            if (images.length > 0)
                input.image_urls = images.slice(0, 10);
            return {
                model: images.length > 0 ? 'seedream/5-pro-image-to-image' : 'seedream/5-pro-text-to-image',
                input
            };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const legacyResolution = params.resolution && typeof params.resolution === 'object'
                ? params.resolution as JsonObject
                : undefined;
            const resolution = params.kieSeedream50ProResolution ?? legacyResolution?.quality;
            if (params.kieSeedream50ProMode === 'layer-decomposition') {
                return params.kieSeedream50ProLayerSize === '2K' ? 0.07 : 0.035;
            }
            const outputPrice = resolution === '2K' || resolution === 'high' ? 0.07 : 0.035;
            return outputPrice + Math.max(0, countUploadedImages(params) - 1) * 0.0025;
        },
        description: '生成/编辑：1K $0.035、2K $0.07/张，首张输入免费、后续输入 $0.0025/张；图层拆分：自动/1K/1.5K $0.035、2K $0.07/输出图层'
    }
});
export default kieSeedream50ProModel;
