import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import {
    countUploadedImages,
    hasUploadedImage,
    resolveUploadedImageSources,
    resolveUploadedVideoSources
} from "../shared/mediaPresence";
export const falMiniMaxH3Model = defineModel({
    meta: {
        id: 'fal-ai-minimax-h3', canonicalModelId: 'minimax-h3', seriesId: 'minimax-hailuo', seriesRank: 3,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'mixed-upload-mode', 'multi-mode-switch', 'supports-4k', 'provider-fal'],
        aliases: ['minimax-h3-fal'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 75 }
    },
    inputLimits: {
        images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [{ when: 'falMiniMaxH3Mode === "reference-to-video"', images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } }]
    },
    params: [
        {
            id: 'falMiniMaxH3Mode', type: 'dropdown', order: 1,
            default: 'text-image-to-video',
            options: [
                { value: 'text-image-to-video' },
                { value: 'reference-to-video' }
            ]
        },
        {
            id: 'falMiniMaxH3AspectRatio', type: 'dropdown', order: 2,
            default: 'smart',
            visible: {
                condition: (params: JsonObject) => params.falMiniMaxH3Mode === 'reference-to-video' ||
                    !hasUploadedImage(params)
            },
            options: [
                { value: 'smart' },
                { value: '21:9' }, { value: '16:9' },
                { value: '4:3' }, { value: '1:1' },
                { value: '3:4' }, { value: '9:16' }
            ]
        },
        {
            id: 'falMiniMaxH3Resolution', type: 'dropdown', order: 3,
            default: '2K',
            options: ['480P', '768P', '2K', '4K'].map((value) => ({ value }))
        },
        {
            id: 'falMiniMaxH3Duration', type: 'number', order: 4,
            default: 5, min: 5, max: 15, step: 1
        },
        {
            id: 'falMiniMaxH3PromptExpansion', type: 'switch', order: 5,
            default: true
        },
        {
            id: 'falMiniMaxH3PromptExpansionMode', type: 'dropdown', order: 6,
            default: 'balanced',
            options: [
                { value: 'balanced' },
                { value: 'fast' },
                { value: 'quality' }
            ]
        }
    ],
    endpoints: {
        selector: async (params) => {
            const images = resolveUploadedImageSources(params);
            if (params.falMiniMaxH3Mode === 'reference-to-video')
                return 'minimax/h3/reference-to-video';
            return images.length > 0 ? 'minimax/h3/image-to-video' : 'minimax/h3/text-to-video';
        }
    },
    request: {
        builder: (params) => {
            const clean = (value: JsonValue): string[] => Array.isArray(value)
                ? value.flatMap((item) => {
                    if (typeof item !== 'string')
                        return [];
                    const source = item.trim();
                    return source.length > 0 ? [source] : [];
                }) : [];
            const pick = (...candidates: JsonValue[]): string[] => {
                for (const candidate of candidates) {
                    const sources = clean(candidate);
                    if (sources.length > 0)
                        return sources;
                }
                return [];
            };
            const images = resolveUploadedImageSources(params);
            const videos = resolveUploadedVideoSources(params);
            const audios = pick(params.uploadedAudioFilePaths, params.audios, params.uploadedAudios);
            const ratios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
            const raw = String(params.falMiniMaxH3AspectRatio || 'smart');
            const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 16 / 9;
            let ratio = ratios.includes(raw) ? raw : '16:9';
            if (raw === 'smart' || raw === 'auto') {
                let difference = Number.POSITIVE_INFINITY;
                for (const candidate of ratios) {
                    const pair = candidate.split(':').map(Number);
                    const next = Math.abs(pair[0] / pair[1] - hint);
                    if (next < difference) {
                        difference = next;
                        ratio = candidate;
                    }
                }
            }
            const resolution = ['480P', '768P', '4K'].includes(String(params.falMiniMaxH3Resolution)) ? String(params.falMiniMaxH3Resolution) : '2K';
            const body: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt.trim().slice(0, 7000) : '',
                duration: Math.min(15, Math.max(5, Math.round(Number(params.falMiniMaxH3Duration || 5)))),
                resolution,
                enable_prompt_expansion: params.falMiniMaxH3PromptExpansion !== false,
                prompt_expansion_mode: ['fast', 'quality'].includes(String(params.falMiniMaxH3PromptExpansionMode))
                    ? String(params.falMiniMaxH3PromptExpansionMode)
                    : 'balanced',
                enable_safety_checker: true
            };
            if (!body.prompt)
                throw new Error('MiniMax H3 的提示词不能为空');
            if (params.falMiniMaxH3Mode === 'reference-to-video') {
                if (images.length + videos.length + audios.length > 12) {
                    throw new Error('Fal MiniMax H3 的参考素材总数不能超过 12 个');
                }
                if (audios.length > 0 && images.length + videos.length === 0) {
                    throw new Error('Fal MiniMax H3 的参考音频必须与参考图片或参考视频一起使用');
                }
                body.aspect_ratio = raw === 'smart' && (images.length + videos.length) > 0 ? 'adaptive' : ratio;
                if (images.length > 0)
                    body.reference_image_urls = images.slice(0, 9);
                if (videos.length > 0)
                    body.reference_video_urls = videos.slice(0, 3);
                if (audios.length > 0)
                    body.reference_audio_urls = audios.slice(0, 3);
            }
            else if (images.length > 0) {
                body.image_url = images[0];
                if (images.length > 1)
                    body.end_image_url = images[1];
            }
            else {
                body.aspect_ratio = ratio;
            }
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const duration = Math.min(15, Math.max(5, Math.round(Number(params.falMiniMaxH3Duration || 5))));
            const rates: Record<string, number> = { '480P': 0.05, '768P': 0.06, '2K': 0.13, '4K': 0.16 };
            const imageCount = countUploadedImages(params);
            const referenceExtra = params.falMiniMaxH3Mode === 'reference-to-video' ? Math.max(0, imageCount - 5) * 0.08 : 0;
            return duration * (rates[String(params.falMiniMaxH3Resolution || '2K')] ?? rates['2K']) + referenceExtra;
        },
        description: '480P/768P/2K/4K 为 $0.05/$0.06/$0.13/$0.16 每秒；参考模式第 6 张起图片 +$0.08/张'
    }
});
export default falMiniMaxH3Model;
