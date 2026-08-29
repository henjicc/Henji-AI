import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { countUploadedImages, resolveUploadedImageSources } from "../shared/mediaPresence";
export const hailuo02Model = defineModel({
    meta: {
        id: 'fal-ai-minimax-hailuo-02',
        canonicalModelId: 'hailuo-02',
        seriesId: 'hailuo',
        seriesRank: 2.0,
        provider: 'fal',
        type: 'video',
        tags: ['video', 'text-to-video', 'image-to-video', 'start-end-frame'],
        aliases: ['fal-ai-hailuo-02', 'minimax-hailuo-02-fal']
    },
    inputLimits: {
        images: { max: 2 },
        videos: { max: 0 },
        rules: [
            {
                when: 'falHailuo02FastMode === true',
                images: { max: 1 }
            }
        ]
    },
    params: [
        {
            id: 'falHailuo02Version',
            order: 1,
            type: 'dropdown',
            default: 'standard',
            options: [
                { value: 'standard' },
                { value: 'pro' }
            ]
        },
        {
            id: 'falHailuo02Duration',
            order: 2,
            type: 'dropdown',
            default: '6',
            // Pro 端点的 schema 里没有 duration 字段，官方固定 6 秒（$0.48/条）。
            // 单图 Fast 路由优先于版本选择，仍接受 6/10 秒。
            visible: {
                condition: (params: JsonObject) => params.falHailuo02Version !== 'pro' ||
                    (params.falHailuo02FastMode === true && countUploadedImages(params) === 1)
            },
            options: [
                { value: '6' },
                { value: '10' }
            ]
        },
        {
            id: 'falHailuo02Resolution',
            order: 3,
            type: 'dropdown',
            default: '768P',
            // 只有 Standard 非 Fast 图生视频接受 resolution；文生、Pro 与 Fast 端点均不接受。
            visible: {
                condition: (params: JsonObject) => {
                    const imageCount = countUploadedImages(params);
                    const isFastMode = imageCount === 1 && params.falHailuo02FastMode === true;
                    return params.falHailuo02Version !== 'pro' && imageCount > 0 && !isFastMode;
                }
            },
            options: [
                { value: '512P' },
                { value: '768P' }
            ]
        },
        {
            id: 'falHailuo02FastMode',
            order: 4,
            type: 'switch',
            default: false,
            visible: { condition: (params: JsonObject) => countUploadedImages(params) === 1 }
        },
        {
            id: 'falHailuo02PromptOptimizer',
            order: 5,
            type: 'switch',
            default: true
        }
    ],
    endpoints: {
        selector: async (params) => {
            const imageCount = resolveUploadedImageSources(params).length;
            const version = params.falHailuo02Version || 'standard';
            const fastMode = params.falHailuo02FastMode === true;
            if (imageCount === 0) {
                return version === 'pro'
                    ? 'fal-ai/minimax/hailuo-02/pro/text-to-video'
                    : 'fal-ai/minimax/hailuo-02/standard/text-to-video';
            }
            if (imageCount === 1 && fastMode) {
                return 'fal-ai/minimax/hailuo-02-fast/image-to-video';
            }
            if (version === 'pro') {
                return 'fal-ai/minimax/hailuo-02/pro/image-to-video';
            }
            return 'fal-ai/minimax/hailuo-02/standard/image-to-video';
        }
    },
    request: {
        builder: (params) => {
            const images = resolveUploadedImageSources(params);
            const prompt = params.prompt || '';
            const version = params.falHailuo02Version || 'standard';
            const resolution = params.falHailuo02Resolution || '768P';
            const duration = params.falHailuo02Duration || '6';
            const isFastMode = images.length === 1 && params.falHailuo02FastMode === true;
            const promptOptimizer = params.falHailuo02PromptOptimizer !== false;
            const requestData: JsonObject = { prompt };
            if (promptOptimizer !== undefined) {
                requestData.prompt_optimizer = promptOptimizer;
            }
            if (version === 'standard' || isFastMode) {
                requestData.duration = duration;
            }
            if (version === 'standard' && images.length > 0 && !isFastMode) {
                requestData.resolution = resolution;
            }
            if (images.length >= 1) {
                requestData.image_url = images[0];
            }
            if (images.length >= 2) {
                requestData.end_image_url = images[1];
            }
            return requestData;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const duration = params.falHailuo02Duration === '10' ? 10 : 6;
            const version = params.falHailuo02Version === 'pro' ? 'pro' : 'standard';
            const imageCount = countUploadedImages(params);
            const isFastMode = imageCount === 1 && params.falHailuo02FastMode === true;
            // 单图 Fast 端点优先于 UI 中保留的版本值，按 512P Fast 秒价计费。
            if (isFastMode)
                return 0.017 * duration;
            // Pro 不接受 duration 入参，官方固定 6 秒，计价不能读 UI 上的时长
            if (version === 'pro')
                return 0.08 * 6;
            // Standard 文生视频不接受 resolution，固定按 768P 秒价计费。
            if (imageCount === 0)
                return 0.045 * duration;
            const resolution = params.falHailuo02Resolution === '512P' ? '512P' : '768P';
            return (resolution === '512P' ? 0.017 : 0.045) * duration;
        },
        description: 'Standard 文生：$0.045/秒；Standard 图生：768P $0.045/秒、512P $0.017/秒；Fast 图生：512P $0.017/秒；non-fast Pro：固定 1080P、6 秒，$0.48/条'
    }
});
export default hailuo02Model;
