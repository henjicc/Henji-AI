import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { hasUploadedImage, resolveUploadedImageSources, resolveUploadedVideoSources } from "../shared/mediaPresence";

// 价格与字段来源：docs/model-adaptation/Gemini-Omni-1.2-Flash/Gemini-Omni-1.2-Flash_Fal.md（Fal 模型页与 OpenAPI，2026-11-07 读取）
const RATES: Record<string, number> = { '360p': 0.0273, '720p': 0.0819, '1080p': 0.1229, '4k': 0.2457 };
const MODES = ['text-image-to-video', 'reference-to-video', 'video-edit', 'video-extension'] as const;

function mode(params: JsonObject): (typeof MODES)[number] {
    return MODES.includes(params.falGeminiOmni12Mode as (typeof MODES)[number])
        ? params.falGeminiOmni12Mode as (typeof MODES)[number]
        : 'text-image-to-video';
}

/** 首尾帧最长 10 秒，延长视频 3–10 秒，其余 3–15 秒。 */
function duration(params: JsonObject): number {
    const current = mode(params);
    const max = current === 'video-extension' || (current === 'text-image-to-video' && resolveUploadedImageSources(params).length > 1) ? 10 : 15;
    const value = Math.round(Number(params.falGeminiOmni12Duration));
    return Number.isFinite(value) ? Math.min(max, Math.max(3, value)) : 8;
}

/** 编辑输出与源视频等长（源视频最长 15 秒）；时长未知时按 8 秒估算。 */
function editSeconds(params: JsonObject): number {
    const durations = Array.isArray(params.__videoDurationSeconds) ? params.__videoDurationSeconds : [];
    const first = typeof durations[0] === 'number' && durations[0] > 0 ? durations[0]
        : (typeof params.__firstVideoDurationSeconds === 'number' && params.__firstVideoDurationSeconds > 0 ? params.__firstVideoDurationSeconds : 8);
    return Math.min(15, first);
}

export const falGeminiOmni12FlashModel = defineModel({
    meta: {
        id: 'fal-ai-gemini-omni-1.2-flash', canonicalModelId: 'gemini-omni-1.2-flash', seriesId: 'gemini-omni', seriesRank: 1.2,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'video-to-video', 'video-extension'],
        polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 70 }
    },
    inputLimits: {
        images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [
            { when: 'falGeminiOmni12Mode === "reference-to-video"', images: { max: 10 }, videos: { max: 3 } },
            { when: 'falGeminiOmni12Mode === "video-edit" || falGeminiOmni12Mode === "video-extension"', images: { max: 0 }, videos: { exact: 1 } }
        ]
    },
    requirements: [
        {
            id: 'fal-gemini-omni-1.2-source-video',
            when: 'falGeminiOmni12Mode === "video-edit" || falGeminiOmni12Mode === "video-extension"',
            require: { videos: { exact: 1 } },
            message: { title: '视频必需', message: '视频编辑和延长视频需要上传 1 个视频', type: 'warning' }
        }
    ],
    params: [
        {
            id: 'falGeminiOmni12Mode', type: 'dropdown', order: 1,
            default: 'text-image-to-video',
            options: MODES.map((value) => ({ value }))
        },
        {
            id: 'falGeminiOmni12AspectRatio', type: 'dropdown', order: 2,
            default: '16:9',
            visible: { condition: (params: JsonObject) => mode(params) === 'text-image-to-video' || mode(params) === 'reference-to-video' },
            options: [{ value: '16:9' }, { value: '9:16' }]
        },
        {
            id: 'falGeminiOmni12Resolution', type: 'dropdown', order: 3,
            default: '720p',
            options: [{ value: '360p' }, { value: '720p' }, { value: '1080p' }, { value: '4k' }]
        },
        {
            id: 'falGeminiOmni12Duration', type: 'number', order: 4,
            default: 8, min: 3, max: 15, step: 1,
            visible: { condition: (params: JsonObject) => mode(params) !== 'video-edit' }
        }
    ],
    endpoints: {
        selector: async (params) => {
            const current = mode(params);
            if (current === 'reference-to-video')
                return 'google/gemini-omni-flash/v1.2/reference-to-video';
            if (current === 'video-edit')
                return 'google/gemini-omni-flash/v1.2/edit';
            if (current === 'video-extension')
                return 'google/gemini-omni-flash/v1.2/extend';
            return hasUploadedImage(params) ? 'google/gemini-omni-flash/v1.2/image-to-video' : 'google/gemini-omni-flash/v1.2/text-to-video';
        }
    },
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim().slice(0, 20000) : '';
            if (!prompt)
                throw new Error('Gemini Omni 1.2 Flash 的提示词不能为空');
            const current = mode(params);
            const resolution = Object.keys(RATES).includes(String(params.falGeminiOmni12Resolution)) ? String(params.falGeminiOmni12Resolution) : '720p';
            if (current === 'video-edit' || current === 'video-extension') {
                const video = resolveUploadedVideoSources(params)[0];
                if (!video)
                    throw new Error('Gemini Omni 1.2 Flash 视频编辑和延长视频需要上传 1 个视频');
                const body: JsonObject = { prompt, video_url: video, resolution };
                if (current === 'video-extension')
                    body.duration = duration(params);
                return body;
            }
            const images = resolveUploadedImageSources(params);
            const body: JsonObject = {
                prompt, resolution,
                aspect_ratio: params.falGeminiOmni12AspectRatio === '9:16' ? '9:16' : '16:9',
                duration: duration(params)
            };
            if (current === 'reference-to-video') {
                const videos = resolveUploadedVideoSources(params);
                if (images.length > 0)
                    body.image_urls = images.slice(0, 10);
                if (videos.length > 0)
                    body.reference_video_urls = videos.slice(0, 3);
                return body;
            }
            if (images.length > 0) {
                body.image_url = images[0];
                if (images.length > 1)
                    body.end_image_url = images[1];
            }
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const rate = RATES[String(params.falGeminiOmni12Resolution)] ?? RATES['720p'];
            return rate * (mode(params) === 'video-edit' ? editSeconds(params) : duration(params));
        },
        description: '按输出秒数计费：360p $0.0273/秒、720p $0.0819/秒、1080p $0.1229/秒、4K $0.2457/秒；视频编辑按源视频时长计，延长视频只计新生成部分'
    }
});
export default falGeminiOmni12FlashModel;
