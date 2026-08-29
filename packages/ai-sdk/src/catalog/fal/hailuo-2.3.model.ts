import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { countUploadedImages, resolveUploadedImageSources } from "../shared/mediaPresence";
export const hailuo23Model = defineModel({
    meta: {
        id: 'fal-ai-minimax-hailuo-2.3',
        canonicalModelId: 'hailuo-2.3',
        seriesId: 'hailuo',
        seriesRank: 2.3,
        provider: 'fal',
        type: 'video',
        tags: ['video', 'text-to-video', 'image-to-video'],
        aliases: ['fal-ai-hailuo-2.3', 'minimax-hailuo-2.3-fal']
    },
    inputLimits: {
        images: { max: 1 },
        videos: { max: 0 }
    },
    params: [
        {
            id: 'falHailuo23Version',
            order: 1,
            type: 'dropdown',
            default: 'standard',
            options: [
                { value: 'standard' },
                { value: 'pro' }
            ]
        },
        {
            id: 'falHailuo23Duration',
            order: 2,
            type: 'dropdown',
            default: '6',
            visible: { condition: (params: JsonObject) => params.falHailuo23Version !== 'pro' },
            options: [
                { value: '6' },
                { value: '10' }
            ]
        },
        {
            id: 'falHailuo23FastMode',
            order: 3,
            type: 'switch',
            default: true,
            visible: { condition: (params: JsonObject) => countUploadedImages(params) > 0 }
        },
        {
            id: 'falHailuo23PromptOptimizer',
            order: 4,
            type: 'switch',
            default: true
        }
    ],
    endpoints: {
        selector: async (params) => {
            const imageCount = resolveUploadedImageSources(params).length;
            const version = params.falHailuo23Version || 'standard';
            const fastMode = params.falHailuo23FastMode !== false;
            if (imageCount > 0) {
                if (fastMode) {
                    return version === 'pro'
                        ? 'fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video'
                        : 'fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video';
                }
                return version === 'pro'
                    ? 'fal-ai/minimax/hailuo-2.3/pro/image-to-video'
                    : 'fal-ai/minimax/hailuo-2.3/standard/image-to-video';
            }
            return version === 'pro'
                ? 'fal-ai/minimax/hailuo-2.3/pro/text-to-video'
                : 'fal-ai/minimax/hailuo-2.3/standard/text-to-video';
        }
    },
    request: {
        builder: (params) => {
            const images = resolveUploadedImageSources(params);
            const prompt = params.prompt || '';
            const version = params.falHailuo23Version || 'standard';
            const duration = params.falHailuo23Duration || '6';
            const promptOptimizer = params.falHailuo23PromptOptimizer !== false;
            const requestData: JsonObject = { prompt };
            if (promptOptimizer !== undefined) {
                requestData.prompt_optimizer = promptOptimizer;
            }
            if (version === 'standard') {
                requestData.duration = duration;
            }
            if (images.length > 0) {
                requestData.image_url = images[0];
            }
            return requestData;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const duration = params.falHailuo23Duration === '10' ? 10 : 6;
            const version = params.falHailuo23Version === 'pro' ? 'pro' : 'standard';
            const fastMode = countUploadedImages(params) > 0 && params.falHailuo23FastMode !== false;
            if (version === 'pro')
                return fastMode ? 0.33 : 0.49;
            return fastMode
                ? (duration === 10 ? 0.32 : 0.19)
                : (duration === 10 ? 0.56 : 0.28);
        },
        description: 'Standard：6s $0.28、10s $0.56；Standard 快速：6s $0.19、10s $0.32；Pro：$0.49/次；Pro 快速：$0.33/次'
    }
});
export default hailuo23Model;
