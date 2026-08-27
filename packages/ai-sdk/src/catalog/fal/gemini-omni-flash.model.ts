import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
export const falGeminiOmniFlashModel = defineModel({
    meta: {
        id: 'fal-ai-gemini-omni-flash', canonicalModelId: 'gemini-omni-video', seriesId: 'gemini-omni', seriesRank: 1,
        provider: 'fal', type: 'video',
        tags: ['image-to-video', 'reference-mode', 'supports-multi-image', 'multi-mode-switch', 'provider-fal'],
        aliases: ['gemini-omni-flash-fal'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 70 }
    },
    inputLimits: {
        images: { exact: 1 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [{ when: 'falGeminiOmniFlashMode === "reference-to-video"', images: { min: 1, max: 10 } }]
    },
    requirements: [
        {
            id: 'fal-gemini-omni-image', require: { images: { min: 1 } },
            message: { title: '图片必需', message: 'Gemini Omni Flash 需要至少 1 张图片作为视频输入。', type: 'warning' }
        }
    ],
    params: [
        {
            id: 'falGeminiOmniFlashMode', type: 'dropdown', order: 1,
            default: 'image-to-video',
            options: [
                { value: 'image-to-video' },
                { value: 'reference-to-video' }
            ]
        },
        {
            id: 'falGeminiOmniFlashAspectRatio', type: 'dropdown', order: 2,
            default: '16:9',
            options: [{ value: '16:9' }, { value: '9:16' }]
        },
        {
            id: 'falGeminiOmniFlashResolution', type: 'dropdown', order: 3,
            default: '720p',
            options: [{ value: '720p' }]
        },
        {
            id: 'falGeminiOmniFlashDuration', type: 'number', order: 4,
            default: 8, min: 3, max: 10, step: 1
        }
    ],
    endpoints: {
        selector: async (params) => params.falGeminiOmniFlashMode === 'reference-to-video'
            ? 'google/gemini-omni-flash/reference-to-video' : 'google/gemini-omni-flash/image-to-video'
    },
    request: {
        builder: (params) => {
            const clean = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
            const uploaded = clean(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : clean(params.images);
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
            if (!prompt)
                throw new Error('Gemini Omni Flash 的提示词不能为空');
            if (images.length === 0)
                throw new Error('Gemini Omni Flash 至少需要 1 张图片');
            const body: JsonObject = {
                prompt,
                aspect_ratio: params.falGeminiOmniFlashAspectRatio === '9:16' ? '9:16' : '16:9',
                duration: Math.min(10, Math.max(3, Math.round(Number(params.falGeminiOmniFlashDuration || 8))))
            };
            if (params.falGeminiOmniFlashMode === 'reference-to-video')
                body.image_urls = images.slice(0, 10);
            else
                body.image_url = images[0];
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => Math.min(10, Math.max(3, Math.round(Number(params.falGeminiOmniFlashDuration || 8)))) * 0.13,
        description: '按 token 计费；720p 约 $0.13/秒'
    }
});
export default falGeminiOmniFlashModel;
