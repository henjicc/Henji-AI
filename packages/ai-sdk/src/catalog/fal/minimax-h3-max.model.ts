import { defineModel } from "../defineModel";
import type { JsonObject, JsonValue } from "../../types/runtime";
import { hasUploadedImage, resolveUploadedImageSources, resolveUploadedVideoSources } from "../shared/mediaPresence";

// 价格与字段来源：docs/model-adaptation/MiniMax-H3-Max/MiniMax-H3-Max_Fal.md（Fal 模型页与 OpenAPI，2026-11-07 读取）。
// 计价按 2026-11-16 起的标准价；此前的限时折扣只会让实际账单更低。
const RATES: Record<string, Record<string, number>> = {
    max: { '480P': 0.05, '768P': 0.08, '1080P': 0.16 },
    turbo: { '480P': 0.025, '768P': 0.04, '1080P': 0.08 }
};
const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

function reference(params: JsonObject): boolean {
    return params.falMiniMaxH3MaxMode === 'reference-to-video';
}

function resolution(params: JsonObject): string {
    return ['480P', '1080P'].includes(String(params.falMiniMaxH3MaxResolution)) ? String(params.falMiniMaxH3MaxResolution) : '768P';
}

function duration(params: JsonObject): number {
    const value = Math.round(Number(params.falMiniMaxH3MaxDuration));
    return Number.isFinite(value) ? Math.min(15, Math.max(1, value)) : 5;
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

function ratio(params: JsonObject): string {
    const raw = String(params.falMiniMaxH3MaxAspectRatio || 'smart');
    return RATIOS.includes(raw) ? raw : '16:9';
}

export const falMiniMaxH3MaxModel = defineModel({
    meta: {
        id: 'fal-ai-minimax-h3-max', canonicalModelId: 'minimax-h3-max', seriesId: 'hailuo', seriesRank: 3.1,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode'],
        polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 75 }
    },
    inputLimits: {
        images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [{ when: 'falMiniMaxH3MaxMode === "reference-to-video"', images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } }]
    },
    params: [
        {
            id: 'falMiniMaxH3MaxVersion', type: 'dropdown', order: 1,
            default: 'max',
            options: [{ value: 'max' }, { value: 'turbo' }]
        },
        {
            id: 'falMiniMaxH3MaxMode', type: 'dropdown', order: 2,
            default: 'text-image-to-video',
            options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }]
        },
        {
            id: 'falMiniMaxH3MaxAspectRatio', type: 'dropdown', order: 3,
            default: 'smart',
            visible: { condition: (params: JsonObject) => reference(params) || !hasUploadedImage(params) },
            options: [{ value: 'smart' }, ...RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falMiniMaxH3MaxResolution', type: 'dropdown', order: 4,
            default: '768P',
            options: [{ value: '480P' }, { value: '768P' }, { value: '1080P' }]
        },
        {
            id: 'falMiniMaxH3MaxDuration', type: 'number', order: 5,
            default: 5, min: 1, max: 15, step: 1
        },
        {
            id: 'falMiniMaxH3MaxPromptExpansion', type: 'dropdown', order: 6,
            default: 'balanced',
            options: [{ value: 'balanced' }, { value: 'quality' }, { value: 'disabled' }]
        }
    ],
    endpoints: {
        selector: async (params) => {
            const family = params.falMiniMaxH3MaxVersion === 'turbo' ? 'minimax/h3-max-turbo' : 'minimax/h3-max';
            if (reference(params))
                return `${family}/reference-to-video`;
            return hasUploadedImage(params) ? `${family}/image-to-video` : `${family}/text-to-video`;
        }
    },
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim().slice(0, 50000) : '';
            if (!prompt)
                throw new Error('MiniMax H3 Max 的提示词不能为空');
            const images = resolveUploadedImageSources(params);
            const body: JsonObject = {
                prompt,
                duration: duration(params),
                resolution: resolution(params),
                prompt_expansion_mode: ['quality', 'disabled'].includes(String(params.falMiniMaxH3MaxPromptExpansion))
                    ? String(params.falMiniMaxH3MaxPromptExpansion) : 'balanced'
            };
            if (reference(params)) {
                const videos = resolveUploadedVideoSources(params);
                const audios = audioSources(params);
                if (images.length + videos.length + audios.length > 12)
                    throw new Error('MiniMax H3 Max 的参考素材总数不能超过 12 个');
                body.aspect_ratio = String(params.falMiniMaxH3MaxAspectRatio || 'smart') === 'smart' ? 'adaptive' : ratio(params);
                if (images.length > 0)
                    body.reference_image_urls = images.slice(0, 9);
                if (videos.length > 0)
                    body.reference_video_urls = videos.slice(0, 3);
                if (audios.length > 0)
                    body.reference_audio_urls = audios.slice(0, 3);
                return body;
            }
            if (images.length > 0) {
                body.image_url = images[0];
                if (images.length > 1)
                    body.end_image_url = images[1];
                return body;
            }
            body.aspect_ratio = ratio(params);
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            // Turbo 的参考生视频与 Max 同价。
            const tier = params.falMiniMaxH3MaxVersion === 'turbo' && !reference(params) ? RATES.turbo : RATES.max;
            return tier[resolution(params)] * duration(params);
        },
        description: 'Max：480P/768P/1080P $0.05/$0.08/$0.16 每秒；Turbo：$0.025/$0.04/$0.08 每秒（参考生视频与 Max 同价）；参考素材超出 4096 token 额度后另计；按 11 月 16 日起的标准价估算'
    }
});
export default falMiniMaxH3MaxModel;
