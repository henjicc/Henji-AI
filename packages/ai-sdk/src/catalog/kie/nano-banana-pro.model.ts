import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { resolveKieImageSources } from './mediaSources';
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';
export const kieNanoBananaProModel = defineModel({
    meta: {
        id: 'kie-nano-banana-pro',
        canonicalModelId: 'nano-banana-pro',
        seriesId: 'nano-banana',
        seriesRank: 2,
        provider: 'kie',
        type: 'image',
        tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-kie'],
        aliases: ['nano-banana-pro-kie']
    },
    inputLimits: {
        images: { max: 8 },
        videos: { max: 0 }
    },
    params: [
        {
            id: 'kieNanoBananaAspectRatio',
            type: 'dropdown',
            order: 1,
            default: 'smart',
            options: [
                { value: 'smart' },
                { value: '1:1' },
                { value: '2:3' },
                { value: '3:2' },
                { value: '4:3' },
                { value: '3:4' },
                { value: '4:5' },
                { value: '5:4' },
                { value: '16:9' },
                { value: '9:16' },
                { value: '21:9' }
            ]
        },
        {
            id: 'kieNanoBananaResolution',
            type: 'dropdown',
            order: 2,
            default: '1K',
            options: [
                { value: '1K' },
                { value: '2K' },
                { value: '4K' }
            ]
        }
    ],
    endpoints: KIE_CREATE_TASK_ENDPOINT,
    request: {
        builder: (params) => {
            const images = resolveKieImageSources(params);
            const prompt = typeof params.prompt === 'string' ? params.prompt.slice(0, 10000) : '';
            const rawAspectRatio = String(params.kieNanoBananaAspectRatio || params.aspect_ratio || 'smart');
            const resolution = params.kieNanoBananaResolution || params.resolution;
            const supportedAspectRatios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
            const ratioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
                ? params.__firstImageRatio
                : 1;
            let aspectRatio = supportedAspectRatios.includes(rawAspectRatio) ? rawAspectRatio : '1:1';
            if (rawAspectRatio === 'smart' || rawAspectRatio === 'auto') {
                let bestDiff = Number.POSITIVE_INFINITY;
                for (const candidate of supportedAspectRatios) {
                    const pair = candidate.split(':').map(Number);
                    const candidateRatio = pair[0] / pair[1];
                    const difference = Math.abs(candidateRatio - ratioHint);
                    if (difference < bestDiff) {
                        bestDiff = difference;
                        aspectRatio = candidate;
                    }
                }
            }
            const input: JsonObject = { prompt, aspect_ratio: aspectRatio };
            if (resolution) {
                input.resolution = resolution;
            }
            if (images.length > 0) {
                input.image_input = images.slice(0, 8);
            }
            return {
                model: 'nano-banana-pro',
                input
            };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => params.kieNanoBananaResolution === '4K' ? 0.12 : 0.09,
        description: '1K/2K $0.09/张，4K $0.12/张'
    }
});
export default kieNanoBananaProModel;
