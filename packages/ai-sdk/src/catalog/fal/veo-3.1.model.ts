import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
export const veo31Model = defineModel({
    meta: {
        id: 'fal-ai-veo-3.1',
        canonicalModelId: 'veo-3.1',
        provider: 'fal',
        type: 'video',
        tags: ['video', 'text-to-video', 'image-to-video']
    },
    inputLimits: {
        images: { max: 7 },
        videos: { max: 0 },
        rules: [
            {
                when: 'falVeo31Mode === "start-end-frame"',
                images: { exact: 2 }
            },
            {
                when: 'falVeo31Mode === "reference-to-video"',
                images: { max: 7 }
            }
        ]
    },
    requirements: [
        {
            id: 'veo-31-start-end-frame',
            when: 'falVeo31Mode === "start-end-frame"',
            require: { images: { exact: 2 } },
            message: {
                title: '图片必需',
                message: '首尾帧模式需要上传2张图片',
                type: 'warning'
            }
        }
    ],
    params: [
        {
            id: 'falVeo31Mode',
            order: 1,
            type: 'dropdown',
            default: 'text-image-to-video',
            options: [
                { value: 'text-image-to-video' },
                { value: 'start-end-frame' },
                { value: 'reference-to-video' }
            ]
        },
        {
            id: 'falVeo31VideoDuration',
            order: 2,
            type: 'dropdown',
            default: 8,
            options: [
                { value: 4 },
                { value: 6 },
                { value: 8 }
            ]
        },
        {
            id: 'falVeo31AspectRatio',
            order: 3,
            type: 'dropdown',
            default: '16:9',
            visible: {
                condition: 'falVeo31Mode !== "reference-to-video"'
            },
            options: [
                { value: 'auto' },
                { value: 'smart' },
                { value: '16:9' },
                { value: '9:16' },
                { value: '1:1' }
            ]
        },
        {
            id: 'falVeo31Resolution',
            order: 4,
            type: 'dropdown',
            default: '720p',
            options: [
                { value: '720p' },
                { value: '1080p' }
            ]
        },
        {
            id: 'falVeo31GenerateAudio',
            order: 5,
            type: 'switch',
            default: true
        },
        {
            id: 'falVeo31AutoFix',
            order: 6,
            type: 'switch',
            default: false
        },
        {
            id: 'falVeo31FastMode',
            order: 7,
            type: 'switch',
            default: false
        },
        {
            id: 'falVeo31EnhancePrompt',
            order: 8,
            type: 'switch',
            default: false
        }
    ],
    endpoints: {
        selector: async (params) => {
            const mode = params.falVeo31Mode || 'text-image-to-video';
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const uploaded = filterSources(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : filterSources(params.images);
            const fastMode = params.falVeo31FastMode === true;
            if (mode === 'start-end-frame') {
                return fastMode
                    ? 'fal-ai/veo3.1/fast/first-last-frame-to-video'
                    : 'fal-ai/veo3.1/first-last-frame-to-video';
            }
            if (mode === 'reference-to-video') {
                return 'fal-ai/veo3.1/reference-to-video';
            }
            if (images.length > 0) {
                return fastMode ? 'fal-ai/veo3.1/fast/image-to-video' : 'fal-ai/veo3.1/image-to-video';
            }
            return fastMode ? 'fal-ai/veo3.1/fast' : 'fal-ai/veo3.1';
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
            const mode = params.falVeo31Mode || 'text-image-to-video';
            const duration = params.falVeo31VideoDuration || 8;
            const aspectRatio = params.falVeo31AspectRatio;
            const resolution = params.falVeo31Resolution || '720p';
            const enhancePrompt = params.falVeo31EnhancePrompt;
            const generateAudio = params.falVeo31GenerateAudio !== false;
            const autoFix = params.falVeo31AutoFix;
            const requestData: JsonObject = {
                prompt,
                duration: `${duration}s`
            };
            if (aspectRatio && aspectRatio !== 'auto' && aspectRatio !== 'smart' && mode !== 'reference-to-video') {
                requestData.aspect_ratio = aspectRatio;
            }
            if (resolution) {
                requestData.resolution = resolution;
            }
            if (enhancePrompt !== undefined) {
                requestData.enhance_prompt = enhancePrompt;
            }
            if (generateAudio !== undefined) {
                requestData.generate_audio = generateAudio;
            }
            if (autoFix !== undefined) {
                requestData.auto_fix = autoFix;
            }
            if (images.length > 0) {
                if (mode === 'start-end-frame') {
                    requestData.first_frame_url = images[0];
                    requestData.last_frame_url = images[1];
                }
                else if (mode === 'reference-to-video') {
                    requestData.image_urls = images;
                }
                else {
                    requestData.image_url = images[0];
                }
            }
            return requestData;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const duration = Number(params.falVeo31VideoDuration) || 8;
            const fastMode = params.falVeo31FastMode === true;
            const generateAudio = params.falVeo31GenerateAudio !== false;
            const rate = fastMode
                ? (generateAudio ? 0.15 : 0.1)
                : (generateAudio ? 0.4 : 0.2);
            return rate * duration;
        },
        description: '标准（720p/1080p）：无音频 $0.20/秒，有音频 $0.40/秒；快速：无音频 $0.10/秒，有音频 $0.15/秒'
    }
});
export default veo31Model;
