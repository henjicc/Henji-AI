import { defineModel } from "../defineModel";
import type { JsonObject, JsonValue } from "../../types/runtime";
import { hasUploadedImage, resolveUploadedImageSources, resolveUploadedVideoDurationSeconds, resolveUploadedVideoSources } from "../shared/mediaPresence";

// 价格与字段来源：docs/model-adaptation/Wan-3.0/Wan-3.0_Fal.md（Fal 模型页与 OpenAPI，2026-11-07 读取）
const RATES: Record<string, Record<string, number>> = {
    standard: { '480p': 0.05, '720p': 0.10, '1080p': 0.20 },
    prime: { '480p': 0.068, '720p': 0.14, '1080p': 0.28 }
};
const RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'];

function isReference(params: JsonObject): boolean {
    return params.falWan30Mode === 'reference-to-video';
}

function audioSources(params: JsonObject): string[] {
    for (const candidate of [params.uploadedAudioFilePaths, params.audios, params.uploadedAudios] as JsonValue[]) {
        if (!Array.isArray(candidate))
            continue;
        const sources = candidate.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : []);
        if (sources.length > 0)
            return sources;
    }
    return [];
}

function duration(params: JsonObject): number {
    const value = Math.round(Number(params.falWan30Duration));
    return Number.isFinite(value) ? Math.min(30, Math.max(2, value)) : 5;
}

export const falWan30Model = defineModel({
    meta: {
        id: 'fal-ai-wan-3.0', canonicalModelId: 'wan-3.0', seriesId: 'wan', seriesRank: 3,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode'],
        polling: { interval: 3000, maxAttempts: 400, expectedAttempts: 90 }
    },
    inputLimits: {
        images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [{ when: 'falWan30Mode === "reference-to-video"', images: { max: 10 }, videos: { max: 5 }, audios: { max: 5 } }]
    },
    params: [
        {
            id: 'falWan30Version', type: 'dropdown', order: 1,
            default: 'standard',
            options: [{ value: 'standard' }, { value: 'prime' }]
        },
        {
            id: 'falWan30Mode', type: 'dropdown', order: 2,
            default: 'text-image-to-video',
            options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }]
        },
        {
            id: 'falWan30AspectRatio', type: 'dropdown', order: 3,
            default: 'smart',
            options: [{ value: 'smart' }, ...RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falWan30Resolution', type: 'dropdown', order: 4,
            default: '1080p',
            options: [{ value: '480p' }, { value: '720p' }, { value: '1080p' }]
        },
        {
            id: 'falWan30Duration', type: 'number', order: 5,
            default: 5, min: 2, max: 30, step: 1
        },
        {
            id: 'falWan30GenerateAudio', type: 'switch', order: 6,
            default: true
        },
        {
            id: 'falWan30PromptExpansion', type: 'switch', order: 7,
            default: true
        },
        {
            id: 'falWan30Thinking', type: 'switch', order: 8,
            default: false
        }
    ],
    endpoints: {
        selector: async (params) => {
            const family = params.falWan30Version === 'prime' ? 'alibaba/wan-3.0-prime' : 'alibaba/wan-3.0';
            if (isReference(params))
                return `${family}/reference-to-video`;
            return hasUploadedImage(params) ? `${family}/image-to-video` : `${family}/text-to-video`;
        }
    },
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim().slice(0, 20000) : '';
            const images = resolveUploadedImageSources(params);
            const raw = String(params.falWan30AspectRatio || 'smart');
            const body: JsonObject = {
                resolution: ['480p', '720p'].includes(String(params.falWan30Resolution)) ? String(params.falWan30Resolution) : '1080p',
                aspect_ratio: RATIOS.includes(raw) ? raw : 'adaptive',
                duration: duration(params),
                audio: params.falWan30GenerateAudio !== false,
                enable_prompt_expansion: params.falWan30PromptExpansion !== false,
                enable_thinking: params.falWan30Thinking === true
            };
            if (prompt)
                body.prompt = prompt;
            if (isReference(params)) {
                const videos = resolveUploadedVideoSources(params);
                const audios = audioSources(params);
                if (images.length + videos.length + audios.length === 0)
                    throw new Error('Wan 3.0 参考生视频至少需要 1 个参考图片、视频或音频');
                if (images.length > 0)
                    body.reference_image_urls = images.slice(0, 10);
                if (videos.length > 0)
                    body.reference_video_urls = videos.slice(0, 5);
                if (audios.length > 0)
                    body.reference_audio_urls = audios.slice(0, 5);
                return body;
            }
            if (images.length > 0) {
                body.start_image_url = images[0];
                if (images.length > 1)
                    body.end_image_url = images[1];
                return body;
            }
            if (!prompt)
                throw new Error('Wan 3.0 文生视频需要填写提示词');
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const rates = params.falWan30Version === 'prime' ? RATES.prime : RATES.standard;
            const rate = rates[String(params.falWan30Resolution)] ?? rates['1080p'];
            // 参考视频的输入时长与输出时长一起计费。
            // 读不到素材时长时按输出时长估，不按 0 秒低估。
            const inputVideo = isReference(params) ? resolveUploadedVideoDurationSeconds(params, duration(params)) : 0;
            return rate * (duration(params) + inputVideo);
        },
        description: '标准版 480p/720p/1080p $0.05/$0.10/$0.20 每秒，Prime $0.068/$0.14/$0.28 每秒；参考视频的输入时长另计'
    }
});
export default falWan30Model;
